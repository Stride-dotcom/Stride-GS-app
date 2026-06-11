-- complete_task_atomic — resolve the service by CODE *or* NAME, and gate the
-- per-piece qty multiplier on the RESOLVED canonical code.
--
-- Why: public.tasks.type holds the service CODE for most creation paths (the
-- GAS→SB task mirror writes 'INSP'/'ASM'/'RUSH'), but some paths write the
-- service NAME (batch-create-tasks-sb / complete-shipment-sb write
-- `svcName` → 'Inspection', 'Rush Inspection'). The prior rate lookup keyed
-- ONLY on `UPPER(code) = UPPER(type)`, so a NAME-form task (e.g. a RUSH task
-- typed "Rush Inspection", or an INSP task typed "Inspection") found NO catalog
-- row → billed "Missing Rate". And the prior qty gate listed magic strings
-- ('INSP','INSPECTION','RUSH') which missed the RUSH name form "RUSH INSPECTION".
-- This was latent (no name-form task had completed on the SB path yet) but
-- would surface the first time a canary RUSH (or name-form INSP) task completed.
--
-- Fix (recreated byte-identical to 20260610120100 EXCEPT):
--   (a) catalog lookup: `WHERE UPPER(code)=v_upper_code OR UPPER(name)=v_upper_code`
--       with `ORDER BY (UPPER(code)=v_upper_code) DESC` so an exact CODE match
--       always wins over a NAME match (no behaviour change for code-form tasks;
--       name-form tasks now resolve their rate).
--   (b) v_eff_qty gates on the RESOLVED code `UPPER(COALESCE(v_svc.code,
--       v_svc_code)) IN ('INSP','RUSH')` instead of matching raw `type` strings,
--       so RUSH multiplies whether type is 'RUSH' or 'Rush Inspection', and INSP
--       whether 'INSP' or 'Inspection'.
-- Everything else (signature, grants, billing INSERT, ON CONFLICT, addon insert,
-- audit log) is identical. Mirrors StrideAPI.gs v38.272.0 (GAS keys off the
-- explicit Svc Code column, so it was already robust to the name form).

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
  v_cp_value     numeric;
  v_applied_rate numeric := 0;
  v_pct          numeric;
  v_missing_rate boolean := false;
  v_total        numeric := 0;
  v_eff_qty      integer := 1;   -- per-piece for INSP/RUSH (resolved code), else 1
  v_pt_date      text;
  v_ledger_id    text;
  v_item_notes   text;
  v_billing_ct   integer := 0;
  v_addon_ct     integer := 0;
  v_ledger_ids   text[]  := ARRAY[]::text[];
  v_addon        record;
  v_addon_id     text;
BEGIN
  v_role := COALESCE(((auth.jwt() -> 'user_metadata') ->> 'role'), '');
  v_caller_uid := auth.uid();
  IF v_role NOT IN ('admin', 'staff') AND v_caller_uid IS NOT NULL THEN
    RAISE EXCEPTION 'complete_task_atomic: caller role % is not staff/admin', v_role USING ERRCODE = '42501';
  END IF;

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

  SELECT name, discount_services_pct, discount_storage_pct
    INTO v_client_name, v_disc_serv, v_disc_stor
    FROM public.clients WHERE tenant_id = p_tenant_id;
  v_client_name := COALESCE(v_client_name, v_task.client_name, '');

  SELECT * INTO v_inv FROM public.inventory
    WHERE tenant_id = p_tenant_id AND item_id = v_task.item_id;

  v_pt_date := to_char(now() AT TIME ZONE 'America/Los_Angeles', 'YYYY-MM-DD');

  IF p_clear_custom_price THEN
    v_cp_value := NULL;
  ELSIF p_custom_price IS NOT NULL THEN
    v_cp_value := p_custom_price;
  ELSE
    v_cp_value := v_task.custom_price;
  END IF;
  v_has_cp := v_cp_value IS NOT NULL AND v_cp_value <> 0;

  v_svc_code    := trim(COALESCE(NULLIF(v_task.type, ''), ''));
  v_upper_code  := UPPER(v_svc_code);
  v_upper_class := UPPER(COALESCE(v_inv.item_class, ''));
  v_bill_if_pass := true;
  v_bill_if_fail := false;
  v_cat := '';

  IF v_svc_code <> '' THEN
    -- Resolve the catalog row by CODE first, then by NAME. tasks.type usually
    -- holds the code ('INSP'/'RUSH') but some creation paths store the service
    -- NAME ('Inspection'/'Rush Inspection'); matching both ensures the rate
    -- resolves either way. ORDER BY prefers an exact code match so a name that
    -- happens to collide with another row's code never wins over the real code.
    SELECT code, name, category, billing, rates, flat_rate, xxl_rate,
           active, bill_if_pass, bill_if_fail
      INTO v_svc
      FROM public.service_catalog
      WHERE UPPER(code) = v_upper_code OR UPPER(name) = v_upper_code
      ORDER BY (UPPER(code) = v_upper_code) DESC
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

  -- INSPECTION and RUSH are the per-piece services: bill tasks.qty x rate. Gate
  -- on the RESOLVED canonical code (v_svc.code) so it works whether tasks.type
  -- held the code ('INSP'/'RUSH') or the service name ('Inspection'/'Rush
  -- Inspection'). A rush inspection of a carton of N pieces is Nx the work, so
  -- RUSH multiplies exactly like INSP. Every other service code bills exactly 1
  -- per item ID. Matches StrideAPI.gs v38.272.0.
  v_eff_qty := CASE WHEN UPPER(COALESCE(v_svc.code, v_svc_code)) IN ('INSP', 'RUSH')
                    THEN GREATEST(1, COALESCE(v_task.qty, 1))
                    ELSE 1 END;

  v_missing_rate := (NOT v_has_cp) AND v_applied_rate <= 0;
  v_total := CASE WHEN v_missing_rate THEN 0 ELSE v_eff_qty * v_applied_rate END;

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
      v_eff_qty,
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
    WHERE public.billing.status <> 'Invoiced';

    v_billing_ct := 1;
    v_ledger_ids := array_append(v_ledger_ids, v_ledger_id);
  END IF;

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
      WHERE id = v_addon.id AND tenant_id = p_tenant_id;
    v_ledger_ids := array_append(v_ledger_ids, v_addon_id);
  END LOOP;
  v_billing_ct := v_billing_ct + v_addon_ct;

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

-- Corrected re-backfill: seed open RUSH tasks' qty from inventory, matching the
-- RUSH service in BOTH stored forms — the code 'RUSH' and the name
-- 'Rush Inspection'. (The prior 20260610120000 matched only 'RUSH'.) No-op when
-- no open RUSH tasks exist; same money-adjacent guards (open only, qty=1 only,
-- inventory qty>1 only) so already-billed rows and staff edits are never touched.
UPDATE public.tasks t
   SET qty = GREATEST(1, round(i.qty)::int),
       updated_at = now()
  FROM public.inventory i
 WHERE t.tenant_id = i.tenant_id
   AND t.item_id   = i.item_id
   AND upper(t.type) IN ('RUSH', 'RUSH INSPECTION')
   AND t.status NOT IN ('Completed', 'Cancelled')
   AND t.qty = 1
   AND round(COALESCE(i.qty, 1))::int > 1;
