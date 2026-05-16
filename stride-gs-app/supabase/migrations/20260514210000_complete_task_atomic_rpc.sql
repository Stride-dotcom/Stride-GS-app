-- [MIGRATION-P4a] Atomic complete_task RPC
-- =========================================
-- SB-primary completion flow for `completeTask`. Per MIG-004 the status
-- flip + billing write + addon flush happen under one logical
-- transaction so a partial failure can't leave a task half-completed
-- (the bug class the GAS handler's LockService guards against).
--
-- Faithful port of StrideAPI.gs `handleCompleteTask_` (the billing
-- branch) + `api_lookupRateFromSupabase_` + `api_applyDiscount_`.
-- Mirrors the sibling complete_repair_atomic structure/auth/idempotency.
--
-- Inputs:
--   p_tenant_id    — per-tenant scope (clients.spreadsheet_id == tasks.tenant_id)
--   p_task_id      — Tasks.task_id (e.g. INSP-62391-1)
--   p_result       — 'Pass' or 'Fail'
--   p_task_notes   — optional; appended to task_notes when provided
--   p_custom_price — inline Custom Price override. NULL = "no change"
--                    (use existing tasks.custom_price); use the
--                    p_clear_custom_price flag to force-clear instead,
--                    matching GAS's number|""|undefined trichotomy
--                    (SQL can't distinguish JSON null from absent, so
--                    the edge function passes the resolved intent).
--   p_clear_custom_price — when true, clear tasks.custom_price (the
--                    GAS `customPrice === "" | null` clear case).
--   p_created_by   — caller email (audit log + billing.client_name fallback)
--
-- Returns:
--   new_task_id    text  — symmetry with create RPCs
--   skipped        bool  — true when status already Completed/Cancelled
--   skip_reason    text
--   billing_count  int   — billing rows inserted/updated (incl. addons)
--   addon_count    int
--   ledger_row_ids text[]
--   missing_rate   bool  — surfaced so the edge fn can warn (GAS parity)
--
-- Side effects (one transaction):
--   • UPDATE public.tasks (status='Completed', completed_at, result,
--     task_notes, custom_price, billed)
--   • INSERT/UPSERT public.billing row keyed {SVCCODE}-TASK-{taskId}
--     ON CONFLICT un-void in place (never overwrite Invoiced) — matches
--     api_writeBillingRowIdempotent_ (StrideAPI v38.198.0)
--   • Flush public.addons (parent_type='task') → billing rows + billed=true
--   • INSERT entity_audit_log matching GAS StrideAPI.gs:7987 exactly:
--     { status: { old: 'In Progress', new: 'Completed' }, result }
--
-- Billing math parity with GAS handleCompleteTask_:
--   svcCode      = tasks.type (SB tasks has no separate "Svc Code" col)
--   rate lookup  = service_catalog by UPPER(code); class_based →
--                  rates[UPPER(item_class)] (XXL → xxl_rate) else flat_rate
--                  (api_lookupRateFromSupabase_)
--   billIfPass   = bill_if_pass IS NOT false (default true)
--   billIfFail   = bill_if_fail IS true       (default false)
--   shouldBill   = (Pass AND billIfPass) OR (Fail AND billIfFail)
--   appliedRate  = customPrice when set & non-empty,
--                  else discount-adjusted catalog rate (api_applyDiscount_:
--                  storage cats → discount_storage_pct else
--                  discount_services_pct; ignore |pct|>100; round 2dp)
--   missingRate  = NOT hasCustomPrice AND appliedRate <= 0
--   billing.total/rate = missingRate ? 0 : appliedRate
--   item_notes   = (missingRate?'MISSING RATE - ':'') || result ||
--                  (task_notes ? ' - '||task_notes : '')
--   tasks.billed = shouldBill AND NOT missingRate
--
-- Date format note: public.billing.date is stored 'YYYY-MM-DD' to stay
-- consistent with every existing billing row + the sibling
-- complete_repair_atomic (sort/reporting depend on it). The MM/DD/YYYY
-- requirement in the build spec applies to the *display/email* layer;
-- the edge function formats completed_at + email tokens MM/DD/YYYY.
--
-- Auth: SECURITY DEFINER. service_role bypass (auth.uid IS NULL);
-- staff/admin pass; client raises 42501. Identical to
-- complete_repair_atomic.

CREATE OR REPLACE FUNCTION public.complete_task_atomic(
  p_tenant_id          text,
  p_task_id            text,
  p_result             text,
  p_task_notes         text    DEFAULT NULL,
  p_custom_price       numeric DEFAULT NULL,
  p_clear_custom_price boolean DEFAULT false,
  p_created_by         text    DEFAULT NULL
)
RETURNS TABLE (
  new_task_id    text,
  skipped        boolean,
  skip_reason    text,
  billing_count  integer,
  addon_count    integer,
  ledger_row_ids text[],
  missing_rate   boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role         text;
  v_caller_uid   uuid;
  v_task         record;
  v_inv          record;
  v_svc          record;
  v_client_name  text;
  v_disc_serv    numeric;
  v_disc_stor    numeric;
  v_svc_code     text;
  v_upper_code   text;
  v_upper_class  text;
  v_cat          text;
  v_cat_lower    text;
  v_rate         numeric := 0;
  v_bill_if_pass boolean;
  v_bill_if_fail boolean;
  v_should_bill  boolean;
  v_has_cp       boolean := false;
  v_cp_value     numeric;     -- resolved effective custom price (or NULL)
  v_applied_rate numeric := 0;
  v_pct          numeric;
  v_missing_rate boolean := false;
  v_total        numeric := 0;
  v_pt_date      text;
  v_ledger_id    text;
  v_item_notes   text;
  v_billing_ct   integer := 0;
  v_addon_ct     integer := 0;
  v_ledger_ids   text[]  := ARRAY[]::text[];
  v_addon        record;
  v_addon_id     text;
BEGIN
  -- ── Auth (identical to complete_repair_atomic) ──────────────────
  v_role := COALESCE(((auth.jwt() -> 'user_metadata') ->> 'role'), '');
  v_caller_uid := auth.uid();
  IF v_role NOT IN ('admin', 'staff') AND v_caller_uid IS NOT NULL THEN
    RAISE EXCEPTION 'complete_task_atomic: caller role % is not staff/admin', v_role USING ERRCODE = '42501';
  END IF;

  -- ── Input validation ───────────────────────────────────────────
  IF p_tenant_id IS NULL OR p_tenant_id = '' THEN
    RAISE EXCEPTION 'tenant_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_task_id IS NULL OR p_task_id = '' THEN
    RAISE EXCEPTION 'task_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_result NOT IN ('Pass', 'Fail') THEN
    RAISE EXCEPTION 'result must be Pass or Fail (got %)', p_result USING ERRCODE = '22023';
  END IF;
  IF p_custom_price IS NOT NULL AND p_custom_price < 0 THEN
    RAISE EXCEPTION 'custom_price must be non-negative' USING ERRCODE = '22023';
  END IF;

  -- ── Load task + idempotency ─────────────────────────────────────
  SELECT * INTO v_task FROM public.tasks
    WHERE tenant_id = p_tenant_id AND task_id = p_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task % not found in tenant %', p_task_id, p_tenant_id USING ERRCODE = '02000';
  END IF;
  IF v_task.status IN ('Completed', 'Cancelled') THEN
    RETURN QUERY SELECT
      p_task_id, true, 'status_already_' || v_task.status,
      0, 0, ARRAY[]::text[], false;
    RETURN;
  END IF;

  -- ── Resolve client + inventory + discounts ──────────────────────
  SELECT name, discount_services_pct, discount_storage_pct
    INTO v_client_name, v_disc_serv, v_disc_stor
    FROM public.clients WHERE tenant_id = p_tenant_id;
  v_client_name := COALESCE(v_client_name, v_task.client_name, '');

  SELECT * INTO v_inv FROM public.inventory
    WHERE tenant_id = p_tenant_id AND item_id = v_task.item_id;

  v_pt_date := to_char(now() AT TIME ZONE 'America/Los_Angeles', 'YYYY-MM-DD');

  -- ── Resolve effective custom price (GAS trichotomy) ─────────────
  -- p_clear_custom_price → clear; else p_custom_price NOT NULL → set;
  -- else fall through to the task's stored custom_price.
  IF p_clear_custom_price THEN
    v_cp_value := NULL;
  ELSIF p_custom_price IS NOT NULL THEN
    v_cp_value := p_custom_price;
  ELSE
    v_cp_value := v_task.custom_price;
  END IF;
  v_has_cp := v_cp_value IS NOT NULL AND v_cp_value <> 0;
  -- GAS treats "" and NaN as "no custom price"; numeric column already
  -- excludes those. A 0 custom price is treated as "not set" to mirror
  -- GAS's `customPriceRaw !== ""` + `!isNaN` + `> 0` effective gate
  -- (a literal 0 there falls through to the catalog/discount path).

  -- ── Service-catalog rate lookup (api_lookupRateFromSupabase_) ───
  v_svc_code    := UPPER(COALESCE(NULLIF(v_task.type, ''), ''));
  v_upper_class := UPPER(COALESCE(v_inv.item_class, ''));
  v_bill_if_pass := true;   -- defaults when no catalog row
  v_bill_if_fail := false;
  v_cat := '';

  IF v_svc_code <> '' THEN
    SELECT code, name, category, billing, rates, flat_rate, xxl_rate,
           active, bill_if_pass, bill_if_fail
      INTO v_svc
      FROM public.service_catalog
      WHERE UPPER(code) = v_svc_code
      LIMIT 1;
    IF FOUND AND v_svc.active IS NOT FALSE THEN
      IF v_svc.billing = 'class_based' THEN
        IF v_upper_class = 'XXL' THEN
          v_rate := COALESCE(v_svc.xxl_rate, 0);
        ELSIF v_upper_class <> '' THEN
          v_rate := COALESCE(NULLIF((v_svc.rates ->> v_upper_class), '')::numeric, 0);
        ELSE
          v_rate := 0;
        END IF;
      ELSE
        v_rate := COALESCE(v_svc.flat_rate, 0);
      END IF;
      v_cat          := COALESCE(v_svc.category, '');
      v_bill_if_pass := (v_svc.bill_if_pass IS NOT FALSE);
      v_bill_if_fail := (v_svc.bill_if_fail IS TRUE);
    END IF;
  END IF;

  v_should_bill := (p_result = 'Pass' AND v_bill_if_pass)
                OR (p_result = 'Fail' AND v_bill_if_fail);

  -- ── Applied rate + discount (api_applyDiscount_) ────────────────
  IF v_has_cp THEN
    v_applied_rate := v_cp_value;
  ELSIF v_rate > 0 AND v_cat <> '' THEN
    v_cat_lower := lower(trim(v_cat));
    IF v_cat_lower IN ('storage charges', 'storage') THEN
      v_pct := COALESCE(v_disc_stor, 0);
    ELSE
      v_pct := COALESCE(v_disc_serv, 0);
    END IF;
    IF v_pct = 0 OR v_pct < -100 OR v_pct > 100 THEN
      v_applied_rate := v_rate;
    ELSE
      v_applied_rate := round(v_rate * (1 + v_pct / 100.0), 2);
    END IF;
  ELSE
    v_applied_rate := v_rate;
  END IF;

  v_missing_rate := (NOT v_has_cp) AND v_applied_rate <= 0;
  v_total := CASE WHEN v_missing_rate THEN 0 ELSE v_applied_rate END;

  -- ── Billing row (only when shouldBill + has item) ───────────────
  IF v_should_bill AND COALESCE(v_task.item_id, '') <> '' THEN
    v_ledger_id := v_svc_code || '-TASK-' || p_task_id;
    v_item_notes := (CASE WHEN v_missing_rate THEN 'MISSING RATE - ' ELSE '' END)
                 || p_result
                 || COALESCE(' - ' || NULLIF(COALESCE(p_task_notes, v_task.task_notes), ''), '');

    INSERT INTO public.billing (
      tenant_id, ledger_row_id, status, invoice_no, client_name, date,
      svc_code, svc_name, category, item_id, description, item_class,
      qty, rate, total, task_id, repair_id, shipment_number, item_notes,
      sidemark, reference, created_at, updated_at
    ) VALUES (
      p_tenant_id, v_ledger_id, 'Unbilled', '', v_client_name, v_pt_date,
      v_svc_code,
      COALESCE(NULLIF(v_svc.name, ''), v_svc_code),
      v_cat,
      v_task.item_id,
      COALESCE(v_inv.description, ''),
      COALESCE(v_inv.item_class, ''),
      1,
      CASE WHEN v_missing_rate THEN 0 ELSE v_applied_rate END,
      v_total,
      p_task_id, '', COALESCE(v_task.shipment_number, ''),
      v_item_notes,
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
    WHERE public.billing.status <> 'Invoiced';  -- un-void in place; never touch Invoiced

    v_billing_ct := 1;
    v_ledger_ids := array_append(v_ledger_ids, v_ledger_id);
  END IF;

  -- ── Flush addons (parent_type='task') ───────────────────────────
  -- Mirrors api_writeAddonsToLedger_; same shape as complete_repair_atomic.
  FOR v_addon IN
    SELECT * FROM public.addons
    WHERE tenant_id = p_tenant_id
      AND parent_type = 'task'
      AND parent_id = p_task_id
      AND billed = false
    ORDER BY created_at ASC
  LOOP
    v_addon_ct := v_addon_ct + 1;
    v_addon_id := p_task_id || '-' || v_addon.service_code || '-ADDON-' || v_addon_ct::text;
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
      v_task.item_id,
      COALESCE(v_inv.description, ''),
      COALESCE(NULLIF(v_addon.item_class, ''), v_inv.item_class, ''),
      v_addon.quantity,
      COALESCE(v_addon.rate, 0),
      COALESCE(v_addon.total, round(v_addon.quantity * COALESCE(v_addon.rate, 0), 2)),
      p_task_id, '', COALESCE(v_task.shipment_number, ''),
      'Add-on for Task ' || p_task_id,
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

  -- ── UPDATE tasks row ────────────────────────────────────────────
  UPDATE public.tasks SET
    status       = 'Completed',
    completed_at = to_char(now() AT TIME ZONE 'America/Los_Angeles', 'MM/DD/YYYY HH24:MI:SS'),
    result       = p_result,
    task_notes   = COALESCE(NULLIF(p_task_notes, ''), task_notes),
    custom_price = CASE
                     WHEN p_clear_custom_price THEN NULL
                     WHEN p_custom_price IS NOT NULL THEN p_custom_price
                     ELSE custom_price
                   END,
    billed       = (v_should_bill AND NOT v_missing_rate),
    updated_at   = now()
  WHERE tenant_id = p_tenant_id AND task_id = p_task_id;

  -- ── Audit log — exact GAS shape (StrideAPI.gs:7987) ─────────────
  INSERT INTO public.entity_audit_log (
    entity_type, entity_id, tenant_id, action, changes, performed_by, source
  ) VALUES (
    'task', p_task_id, p_tenant_id, 'complete',
    jsonb_build_object(
      'status', jsonb_build_object('old', 'In Progress', 'new', 'Completed'),
      'result', p_result
    ),
    COALESCE(NULLIF(p_created_by, ''), 'system'),
    'edge'
  );

  RETURN QUERY SELECT
    p_task_id, false, NULL::text,
    v_billing_ct, v_addon_ct, v_ledger_ids, v_missing_rate;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_task_atomic(text, text, text, text, numeric, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_task_atomic(text, text, text, text, numeric, boolean, text) TO authenticated, service_role;
