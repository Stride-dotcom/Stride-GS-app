-- [MIGRATION-P4a] Atomic complete_repair RPC
-- ============================================
-- SB-primary completion flow. Per MIG-004 the status flip + billing
-- writes + addon flush must happen under one logical transaction so a
-- partial-failure can't leave a repair half-completed (the bug class
-- the GAS handler's LockService guards against).
--
-- Inputs:
--   p_tenant_id      — per-tenant scope (clients.spreadsheet_id)
--   p_repair_id      — RPR-{itemId}-{millis}
--   p_result         — 'Pass' or 'Fail'
--   p_final_amount   — optional override; otherwise use quote_amount fallback
--   p_repair_notes   — optional override for repairs.repair_notes
--   p_created_by     — caller email (used in audit log + billing.client_name fallback)
--
-- Returns:
--   new_repair_id      text  — the repair_id (for symmetry with create RPC)
--   skipped            bool  — true when status was already Complete/Cancelled (no-op)
--   skip_reason        text  — when skipped=true, why
--   billing_count      int   — number of billing rows inserted/updated
--   addon_count        int   — number of addons flushed to billing
--   ledger_row_ids     text[]— Ledger Row IDs of inserted/updated billing rows
--
-- Side effects (in one transaction):
--   • UPDATE public.repairs (status='Complete', completed_date, repair_result,
--     final_amount, repair_notes if provided, billed=true on any positive total)
--   • INSERT public.billing rows:
--       - Multi-line from repairs.quote_lines_json (one row per line, REPAIR-{repairId}-{N})
--       - OR legacy single REPAIR row (REPAIR-{repairId}) if no quote_lines_json
--   • Flush addons: UPDATE public.addons SET billed=true + INSERT public.billing rows
--   • INSERT entity_audit_log row matching GAS shape at StrideAPI.gs:7814:
--     { status: { new: "Complete" }, result: <Pass|Fail> }
--
-- Auth: SECURITY DEFINER. Three-case role check identical to
-- create_repair_quote_request (service_role bypass via auth.uid IS NULL,
-- staff/admin pass, client raises 42501).
--
-- Idempotency: skipped=true when status='Complete' or 'Cancelled'.
-- For idempotent re-completion after a Void+Re-Open, the billing inserts
-- use ON CONFLICT (tenant_id, ledger_row_id) DO UPDATE to re-flip Voided
-- rows back to Unbilled in place — matches `api_writeBillingRowIdempotent_`
-- un-void semantics from StrideAPI.gs v38.198.0.

CREATE OR REPLACE FUNCTION public.complete_repair_atomic(
  p_tenant_id     text,
  p_repair_id     text,
  p_result        text,
  p_final_amount  numeric DEFAULT NULL,
  p_repair_notes  text    DEFAULT NULL,
  p_created_by    text    DEFAULT NULL
)
RETURNS TABLE (
  new_repair_id  text,
  skipped        boolean,
  skip_reason    text,
  billing_count  integer,
  addon_count    integer,
  ledger_row_ids text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role          text;
  v_caller_uid    uuid;
  v_repair        record;
  v_quote_lines   jsonb;
  v_qline         jsonb;
  v_line_idx      integer := 0;
  v_line_qty      numeric;
  v_line_rate     numeric;
  v_line_total    numeric;
  v_line_amt      numeric;
  v_billing_amt   numeric;
  v_total_sum     numeric := 0;
  v_pt_date       text;
  v_ledger_id     text;
  v_inv           record;  -- inventory row for client_name / description / etc.
  v_client_name   text;
  v_billing_ct    integer := 0;
  v_addon_ct      integer := 0;
  v_ledger_ids    text[]  := ARRAY[]::text[];
  v_addon         record;
  v_addon_id      text;
BEGIN
  -- ── Auth ─────────────────────────────────────────────────────────
  v_role := COALESCE(((auth.jwt() -> 'user_metadata') ->> 'role'), '');
  v_caller_uid := auth.uid();
  IF v_role NOT IN ('admin', 'staff') AND v_caller_uid IS NOT NULL THEN
    RAISE EXCEPTION 'complete_repair_atomic: caller role % is not staff/admin', v_role USING ERRCODE = '42501';
  END IF;

  -- ── Input validation ────────────────────────────────────────────
  IF p_tenant_id IS NULL OR p_tenant_id = '' THEN
    RAISE EXCEPTION 'tenant_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_repair_id IS NULL OR p_repair_id = '' THEN
    RAISE EXCEPTION 'repair_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_result NOT IN ('Pass', 'Fail') THEN
    RAISE EXCEPTION 'result must be Pass or Fail (got %)', p_result USING ERRCODE = '22023';
  END IF;
  IF p_final_amount IS NOT NULL AND p_final_amount < 0 THEN
    RAISE EXCEPTION 'final_amount must be non-negative' USING ERRCODE = '22023';
  END IF;

  -- ── Load repair + verify state ──────────────────────────────────
  SELECT * INTO v_repair FROM public.repairs
    WHERE tenant_id = p_tenant_id AND repair_id = p_repair_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Repair % not found in tenant %', p_repair_id, p_tenant_id USING ERRCODE = '02000';
  END IF;

  -- Idempotency: short-circuit on already-terminal states.
  IF v_repair.status IN ('Complete', 'Cancelled') THEN
    RETURN QUERY SELECT
      p_repair_id, true, 'status_already_' || v_repair.status,
      0, 0, ARRAY[]::text[];
    RETURN;
  END IF;

  -- ── Resolve client_name + item info (for billing rows) ──────────
  SELECT * INTO v_inv FROM public.inventory
    WHERE tenant_id = p_tenant_id AND item_id = v_repair.item_id;
  -- v_inv may be NULL when the inventory row was archived/transferred;
  -- billing rows can still write with NULL description/vendor/etc.
  SELECT name INTO v_client_name FROM public.clients
    WHERE tenant_id = p_tenant_id;
  v_client_name := COALESCE(v_client_name, '');

  -- ── Compute billing amount + format date ─────────────────────────
  -- Precedence: explicit p_final_amount > existing repairs.final_amount
  -- > repairs.quote_amount > 0. Mirrors GAS at handleCompleteRepair_:18841.
  v_billing_amt := COALESCE(
    NULLIF(p_final_amount, 0),
    NULLIF(v_repair.final_amount, 0),
    NULLIF(v_repair.quote_amount, 0),
    0
  );
  v_pt_date := to_char(now() AT TIME ZONE 'America/Los_Angeles', 'YYYY-MM-DD');

  -- ── Insert billing rows ─────────────────────────────────────────
  -- Multi-line if quote_lines_json present; else single REPAIR row.
  v_quote_lines := v_repair.quote_lines_json;
  IF v_quote_lines IS NOT NULL AND jsonb_typeof(v_quote_lines) = 'array' AND jsonb_array_length(v_quote_lines) > 0 THEN
    -- Multi-line path
    FOR v_qline IN SELECT * FROM jsonb_array_elements(v_quote_lines) LOOP
      v_line_idx := v_line_idx + 1;
      v_line_qty  := COALESCE(NULLIF((v_qline->>'qty')::numeric,  0), 0);
      v_line_rate := COALESCE(NULLIF((v_qline->>'rate')::numeric, 0), 0);
      v_line_amt  := round(v_line_qty * v_line_rate, 2);
      v_total_sum := v_total_sum + v_line_amt;
      v_ledger_id := 'REPAIR-' || p_repair_id || '-' || v_line_idx::text;

      INSERT INTO public.billing (
        tenant_id, ledger_row_id, status, invoice_no, client_name, date,
        svc_code, svc_name, category, item_id, description, item_class,
        qty, rate, total, task_id, repair_id, shipment_number, item_notes,
        sidemark, reference, created_at, updated_at
      ) VALUES (
        p_tenant_id, v_ledger_id, 'Unbilled', '', v_client_name, v_pt_date,
        COALESCE(NULLIF(v_qline->>'svcCode', ''), 'REPAIR'),
        COALESCE(NULLIF(v_qline->>'svcName', ''), NULLIF(v_qline->>'svcCode', ''), 'Repair'),
        'Services',
        v_repair.item_id,
        COALESCE(v_inv.description, ''),
        COALESCE(v_inv.item_class, ''),
        v_line_qty, v_line_rate, v_line_amt,
        '', p_repair_id, '',
        'Repair line ' || v_line_idx::text || '/' || jsonb_array_length(v_quote_lines)::text ||
          ' | Result: ' || p_result ||
          COALESCE(' | ' || NULLIF(COALESCE(p_repair_notes, v_repair.repair_notes), ''), ''),
        COALESCE(v_inv.sidemark, ''),
        COALESCE(v_inv.reference, ''),
        now(), now()
      )
      ON CONFLICT (tenant_id, ledger_row_id) DO UPDATE SET
        status      = 'Unbilled',
        invoice_no  = '',
        qty         = EXCLUDED.qty,
        rate        = EXCLUDED.rate,
        total       = EXCLUDED.total,
        item_notes  = EXCLUDED.item_notes,
        date        = EXCLUDED.date,
        updated_at  = now()
      WHERE public.billing.status != 'Invoiced';  -- never overwrite Invoiced rows (un-void Void in place)

      v_billing_ct := v_billing_ct + 1;
      v_ledger_ids := array_append(v_ledger_ids, v_ledger_id);
    END LOOP;
  ELSE
    -- Legacy single-row path
    v_ledger_id := 'REPAIR-' || p_repair_id;
    INSERT INTO public.billing (
      tenant_id, ledger_row_id, status, invoice_no, client_name, date,
      svc_code, svc_name, category, item_id, description, item_class,
      qty, rate, total, task_id, repair_id, shipment_number, item_notes,
      sidemark, reference, created_at, updated_at
    ) VALUES (
      p_tenant_id, v_ledger_id, 'Unbilled', '', v_client_name, v_pt_date,
      'REPAIR', 'Repair', 'Services',
      v_repair.item_id,
      COALESCE(v_inv.description, ''),
      COALESCE(v_inv.item_class, ''),
      1,
      CASE WHEN v_billing_amt > 0 THEN v_billing_amt ELSE 0 END,
      v_billing_amt,
      '', p_repair_id, '',
      CASE WHEN v_billing_amt <= 0 THEN 'MISSING RATE - ' ELSE '' END ||
        'Result: ' || p_result ||
        COALESCE(' | ' || NULLIF(COALESCE(p_repair_notes, v_repair.repair_notes), ''), ''),
      COALESCE(v_inv.sidemark, ''),
      COALESCE(v_inv.reference, ''),
      now(), now()
    )
    ON CONFLICT (tenant_id, ledger_row_id) DO UPDATE SET
      status     = 'Unbilled',
      invoice_no = '',
      qty        = EXCLUDED.qty,
      rate       = EXCLUDED.rate,
      total      = EXCLUDED.total,
      item_notes = EXCLUDED.item_notes,
      date       = EXCLUDED.date,
      updated_at = now()
    WHERE public.billing.status != 'Invoiced';

    v_total_sum := v_billing_amt;
    v_billing_ct := 1;
    v_ledger_ids := array_append(v_ledger_ids, v_ledger_id);
  END IF;

  -- ── Flush addons → billing rows ─────────────────────────────────
  -- Mirrors api_writeAddonsToLedger_ (StrideAPI v38.177.0). One billing
  -- row per unbilled addon attached to this repair; mark addon billed
  -- with the new ledger_row_id stamp.
  FOR v_addon IN
    SELECT * FROM public.addons
    WHERE tenant_id = p_tenant_id
      AND parent_type = 'repair'
      AND parent_id = p_repair_id
      AND billed = false
    ORDER BY created_at ASC
  LOOP
    v_addon_ct := v_addon_ct + 1;
    v_addon_id := p_repair_id || '-' || v_addon.service_code || '-ADDON-' || v_addon_ct::text;
    INSERT INTO public.billing (
      tenant_id, ledger_row_id, status, invoice_no, client_name, date,
      svc_code, svc_name, category, item_id, description, item_class,
      qty, rate, total, task_id, repair_id, shipment_number, item_notes,
      sidemark, reference, created_at, updated_at
    ) VALUES (
      p_tenant_id, v_addon_id, 'Unbilled', '', v_client_name, v_pt_date,
      v_addon.service_code,
      v_addon.service_name,
      'Add-On',
      v_repair.item_id,
      COALESCE(v_inv.description, ''),
      COALESCE(NULLIF(v_addon.item_class, ''), v_inv.item_class, ''),
      v_addon.quantity,
      COALESCE(v_addon.rate, 0),
      COALESCE(v_addon.total, round(v_addon.quantity * COALESCE(v_addon.rate, 0), 2)),
      '', p_repair_id, '',
      'Add-on for Repair ' || p_repair_id,
      COALESCE(v_inv.sidemark, ''),
      COALESCE(v_inv.reference, ''),
      now(), now()
    )
    ON CONFLICT (tenant_id, ledger_row_id) DO NOTHING;
    UPDATE public.addons
      SET billed = true, billed_at = now(), ledger_row_id = v_addon_id, updated_at = now()
      WHERE id = v_addon.id;
    v_ledger_ids := array_append(v_ledger_ids, v_addon_id);
  END LOOP;
  v_billing_ct := v_billing_ct + v_addon_ct;

  -- ── UPDATE repairs row ───────────────────────────────────────────
  UPDATE public.repairs SET
    status         = 'Complete',
    completed_date = v_pt_date,
    repair_result  = p_result,
    final_amount   = COALESCE(NULLIF(v_total_sum, 0), v_billing_amt),
    repair_notes   = COALESCE(NULLIF(p_repair_notes, ''), repair_notes),
    billed         = (v_total_sum > 0),
    updated_at     = now()
  WHERE tenant_id = p_tenant_id AND repair_id = p_repair_id;

  -- ── Audit log ────────────────────────────────────────────────────
  -- Matches GAS at StrideAPI.gs:7814 exactly: action='complete',
  -- changes={status:{new:'Complete'},result:'Pass'|'Fail'}
  INSERT INTO public.entity_audit_log (
    entity_type, entity_id, tenant_id, action, changes, performed_by, source
  ) VALUES (
    'repair', p_repair_id, p_tenant_id, 'complete',
    jsonb_build_object('status', jsonb_build_object('new', 'Complete'), 'result', p_result),
    COALESCE(NULLIF(p_created_by, ''), 'system'),
    'edge'
  );

  RETURN QUERY SELECT
    p_repair_id, false, NULL::text,
    v_billing_ct, v_addon_ct, v_ledger_ids;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_repair_atomic(text, text, text, numeric, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_repair_atomic(text, text, text, numeric, text, text) TO authenticated, service_role;
