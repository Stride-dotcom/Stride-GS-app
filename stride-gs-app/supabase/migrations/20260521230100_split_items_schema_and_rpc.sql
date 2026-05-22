-- =========================================================================
-- Split Items — schema + RPC
-- =========================================================================
-- Adds support for "Split" — turning a grouped inventory item (qty > 1)
-- into N individual single-qty rows so each piece can be tasked, will-
-- called, disposed, or invoiced independently.
--
-- This migration is purely additive:
--   1. tasks.metadata jsonb — generic per-task workflow blob, used here
--      to carry the split_workflow params (parent_item_id, keep_qty,
--      leftover_qty, requested_by_*, etc). Defaulted to '{}' so existing
--      task code that doesn't read metadata is unaffected.
--   2. inventory.parent_item_id text — non-FK pointer (cross-tenant
--      item_ids are not unique on a single column once transfer history
--      is considered, see item_id_ledger_conflicts view) recording which
--      split a child row came out of. Helps reporting + reverse-lookups
--      from the Sheet write-back layer.
--   3. service_catalog row for code='SPLIT' if not already present.
--      The user provisioned this manually pre-migration; the upsert below
--      is idempotent and won't clobber rates if they were already set.
--   4. rpc_complete_split_task(p_tenant_id, p_task_id) — atomic Postgres
--      function that performs the actual split work in one transaction:
--        a. Reads task.metadata->split_workflow for parent_item_id,
--           keep_qty, leftover_qty.
--        b. UPDATE parent inventory.qty = keep_qty.
--        c. INSERT leftover_qty child rows on public.inventory, copying
--           every field from the parent except item_id (suffix -S1, -S2,
--           …) and qty (always 1). parent_item_id points back.
--        d. INSERT one row per child into item_id_ledger so the cross-
--           tenant uniqueness guarantee is preserved.
--        e. INSERT a SPLIT billing row per CHILD into public.billing,
--           rate looked up from service_catalog (class-based by parent's
--           item_class, with xxl_rate fallback for XXL — same shape as
--           complete_task_atomic).
--        f. INSERT entity_audit_log rows for parent (qty reduced) and
--           each child (created via split).
--        g. UPDATE tasks.status = 'Completed', completed_at, billed.
--      Idempotent: returns {already_completed: true, child_item_codes}
--      when the task is already Completed (used by the React panel to
--      hydrate after refresh).
-- =========================================================================

-- ── 1. tasks.metadata ─────────────────────────────────────────
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.tasks.metadata IS
  'Per-task workflow blob. For task_type=Split, holds split_workflow.{parent_item_id,parent_item_code,grouped_qty,keep_qty,leftover_qty,requested_by_email,requested_by_name,request_notes,child_item_codes,origin_entity_type,origin_entity_id}.';

-- ── 2. inventory.parent_item_id ───────────────────────────────
ALTER TABLE public.inventory
  ADD COLUMN IF NOT EXISTS parent_item_id text;

COMMENT ON COLUMN public.inventory.parent_item_id IS
  'For rows created by a Split task, the item_id of the parent (grouped) row this child was split off of. NULL for non-split items.';

CREATE INDEX IF NOT EXISTS idx_inventory_parent_item_id
  ON public.inventory (tenant_id, parent_item_id)
  WHERE parent_item_id IS NOT NULL;

-- ── 3. Seed SPLIT in service_catalog (idempotent) ─────────────
-- If the operator already created this row manually, the ON CONFLICT
-- preserves their rates. If not, this seeds sensible defaults that
-- staff can edit on the Price List page later.
INSERT INTO public.service_catalog (
  code, name, category, billing, rates, flat_rate, xxl_rate, unit,
  taxable, active, show_in_matrix, show_as_task, display_order
) VALUES (
  'SPLIT', 'Split Item', 'Warehouse', 'class_based',
  jsonb_build_object(
    'SMALL', 5,
    'MEDIUM', 10,
    'LARGE', 20,
    'OVERSIZED', 30
  ),
  10, 40, 'per_item',
  true, true, true, true, 250
)
ON CONFLICT (code) DO NOTHING;

-- ── 4. rpc_complete_split_task ────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_complete_split_task(
  p_tenant_id  text,
  p_task_id    text,
  p_created_by text DEFAULT NULL
)
RETURNS TABLE (
  ok                  boolean,
  already_completed   boolean,
  parent_item_code    text,
  requester_email     text,
  requester_name      text,
  child_item_codes    text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role         text;
  v_caller_uid   uuid;
  v_task         record;
  v_inv_parent   record;
  v_meta         jsonb;
  v_sw           jsonb;
  v_parent_id    text;
  v_keep_qty     integer;
  v_leftover     integer;
  v_grouped_qty  integer;
  v_req_email    text;
  v_req_name     text;
  v_request_notes text;
  v_svc          record;
  v_class_upper  text;
  v_rate         numeric := 0;
  v_pt_date      text;
  v_now_ts       text;
  v_i            integer;
  v_child_id     text;
  v_child_codes  text[] := ARRAY[]::text[];
  v_ledger_id    text;
  v_actor        text;
BEGIN
  -- ── Auth (same shape as complete_task_atomic / complete_repair_atomic) ──
  v_role := COALESCE(((auth.jwt() -> 'user_metadata') ->> 'role'), '');
  v_caller_uid := auth.uid();
  IF v_role NOT IN ('admin', 'staff') AND v_caller_uid IS NOT NULL THEN
    RAISE EXCEPTION 'rpc_complete_split_task: caller role % is not staff/admin', v_role USING ERRCODE = '42501';
  END IF;

  IF p_tenant_id IS NULL OR p_tenant_id = '' THEN
    RAISE EXCEPTION 'tenant_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_task_id IS NULL OR p_task_id = '' THEN
    RAISE EXCEPTION 'task_id is required' USING ERRCODE = '22023';
  END IF;

  v_actor := COALESCE(NULLIF(p_created_by, ''), 'system');

  -- ── Load task ─────────────────────────────────────────────────
  SELECT * INTO v_task FROM public.tasks
    WHERE tenant_id = p_tenant_id AND task_id = p_task_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task % not found in tenant %', p_task_id, p_tenant_id USING ERRCODE = '02000';
  END IF;

  v_meta := COALESCE(v_task.metadata, '{}'::jsonb);
  v_sw   := COALESCE(v_meta -> 'split_workflow', '{}'::jsonb);

  v_parent_id     := NULLIF(v_sw ->> 'parent_item_id', '');
  v_keep_qty      := NULLIF(v_sw ->> 'keep_qty', '')::integer;
  v_leftover      := NULLIF(v_sw ->> 'leftover_qty', '')::integer;
  v_grouped_qty   := NULLIF(v_sw ->> 'grouped_qty', '')::integer;
  v_req_email     := NULLIF(v_sw ->> 'requested_by_email', '');
  v_req_name      := NULLIF(v_sw ->> 'requested_by_name', '');
  v_request_notes := NULLIF(v_sw ->> 'request_notes', '');

  -- ── Idempotency: already completed → hydrate + return ───────
  IF v_task.status = 'Completed' THEN
    SELECT COALESCE(array_agg(item_id ORDER BY item_id), ARRAY[]::text[])
      INTO v_child_codes
      FROM public.inventory
      WHERE tenant_id = p_tenant_id
        AND parent_item_id = v_parent_id;
    RETURN QUERY SELECT
      true, true,
      v_parent_id,
      v_req_email,
      v_req_name,
      v_child_codes;
    RETURN;
  END IF;

  IF v_parent_id IS NULL THEN
    RAISE EXCEPTION 'split_workflow.parent_item_id missing on task %', p_task_id USING ERRCODE = '22023';
  END IF;
  IF v_leftover IS NULL OR v_leftover < 1 THEN
    RAISE EXCEPTION 'split_workflow.leftover_qty must be >= 1 (got %)', v_leftover USING ERRCODE = '22023';
  END IF;
  IF v_keep_qty IS NULL OR v_keep_qty < 1 THEN
    RAISE EXCEPTION 'split_workflow.keep_qty must be >= 1 (got %)', v_keep_qty USING ERRCODE = '22023';
  END IF;

  -- ── Load + lock parent inventory row ────────────────────────
  SELECT * INTO v_inv_parent FROM public.inventory
    WHERE tenant_id = p_tenant_id AND item_id = v_parent_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Parent inventory % not found in tenant %', v_parent_id, p_tenant_id USING ERRCODE = '02000';
  END IF;

  -- Defensive: parent qty may have drifted between request + completion.
  -- Recompute keep_qty based on current parent qty so we never end up
  -- with a negative leftover.
  IF v_inv_parent.qty < v_keep_qty + v_leftover THEN
    RAISE EXCEPTION
      'Parent qty (%) is less than keep_qty (%) + leftover_qty (%); cannot complete split',
      v_inv_parent.qty, v_keep_qty, v_leftover USING ERRCODE = '22023';
  END IF;

  v_pt_date := to_char(now() AT TIME ZONE 'America/Los_Angeles', 'YYYY-MM-DD');
  v_now_ts  := to_char(now() AT TIME ZONE 'America/Los_Angeles', 'MM/DD/YYYY HH24:MI:SS');

  -- ── Service-catalog SPLIT rate lookup ───────────────────────
  v_class_upper := UPPER(COALESCE(v_inv_parent.item_class, ''));
  SELECT * INTO v_svc FROM public.service_catalog
    WHERE UPPER(code) = 'SPLIT'
    LIMIT 1;
  IF FOUND AND v_svc.active IS NOT FALSE THEN
    IF v_svc.billing = 'class_based' THEN
      IF v_class_upper = 'XXL' THEN
        v_rate := COALESCE(v_svc.xxl_rate, 0);
      ELSIF v_class_upper <> '' THEN
        v_rate := COALESCE(NULLIF((v_svc.rates ->> v_class_upper), '')::numeric, 0);
      ELSE
        v_rate := 0;
      END IF;
    ELSE
      v_rate := COALESCE(v_svc.flat_rate, 0);
    END IF;
  END IF;

  -- ── Reduce parent qty ───────────────────────────────────────
  UPDATE public.inventory SET
    qty        = v_keep_qty,
    updated_at = now()
  WHERE tenant_id = p_tenant_id AND item_id = v_parent_id;

  INSERT INTO public.entity_audit_log (
    entity_type, entity_id, tenant_id, action, changes, performed_by, source
  ) VALUES (
    'item', v_parent_id, p_tenant_id, 'split_parent_reduced',
    jsonb_build_object(
      'qty', jsonb_build_object('old', v_inv_parent.qty, 'new', v_keep_qty),
      'leftover_qty', v_leftover,
      'split_task_id', p_task_id
    ),
    v_actor, 'rpc'
  );

  -- ── Generate child rows ─────────────────────────────────────
  FOR v_i IN 1..v_leftover LOOP
    -- child item_id format: <parent>-S<n>. Collision-safe — parent_id is
    -- globally unique (item_id_ledger PK) so <parent>-S<n> is too.
    v_child_id := v_parent_id || '-S' || v_i::text;

    -- If the same suffix is somehow already burned (e.g. a previous
    -- partial split that errored mid-loop and didn't roll back; or a
    -- replay of this RPC), append a UUID suffix so we still allocate
    -- a fresh ID rather than failing.
    IF EXISTS (SELECT 1 FROM public.item_id_ledger WHERE item_id = v_child_id) THEN
      v_child_id := v_child_id || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
    END IF;

    INSERT INTO public.item_id_ledger (
      item_id, tenant_id, source, status, created_by, created_at
    ) VALUES (
      v_child_id, p_tenant_id, 'reassign', 'active', v_actor, now()
    );

    INSERT INTO public.inventory (
      tenant_id, item_id, parent_item_id,
      description, vendor, sidemark, room, item_class, qty,
      location, status, receive_date, release_date, shipment_number,
      carrier, tracking_number, item_notes, reference, task_notes,
      item_folder_url, shipment_folder_url, shipment_photos_url,
      inspection_photos_url, repair_photos_url, invoice_url, transfer_date,
      needs_inspection, needs_assembly,
      declared_value, coverage_option_id,
      created_at, updated_at
    ) VALUES (
      p_tenant_id, v_child_id, v_parent_id,
      v_inv_parent.description, v_inv_parent.vendor, v_inv_parent.sidemark,
      v_inv_parent.room, v_inv_parent.item_class, 1,
      v_inv_parent.location, COALESCE(v_inv_parent.status, 'Active'),
      v_inv_parent.receive_date, v_inv_parent.release_date,
      COALESCE(v_inv_parent.shipment_number, ''),
      COALESCE(v_inv_parent.carrier, ''),
      COALESCE(v_inv_parent.tracking_number, ''),
      'Split from ' || v_parent_id,
      COALESCE(v_inv_parent.reference, ''),
      COALESCE(v_inv_parent.task_notes, ''),
      COALESCE(v_inv_parent.item_folder_url, ''),
      COALESCE(v_inv_parent.shipment_folder_url, ''),
      COALESCE(v_inv_parent.shipment_photos_url, ''),
      COALESCE(v_inv_parent.inspection_photos_url, ''),
      COALESCE(v_inv_parent.repair_photos_url, ''),
      COALESCE(v_inv_parent.invoice_url, ''),
      COALESCE(v_inv_parent.transfer_date, ''),
      COALESCE(v_inv_parent.needs_inspection, false),
      COALESCE(v_inv_parent.needs_assembly, false),
      COALESCE(v_inv_parent.declared_value, 0),
      v_inv_parent.coverage_option_id,
      now(), now()
    );

    v_child_codes := array_append(v_child_codes, v_child_id);

    -- SPLIT billing row per child
    v_ledger_id := 'SPLIT-TASK-' || p_task_id || '-' || v_i::text;
    INSERT INTO public.billing (
      tenant_id, ledger_row_id, status, invoice_no, client_name, date,
      svc_code, svc_name, category, item_id, description, item_class,
      qty, rate, total, task_id, repair_id, shipment_number, item_notes,
      sidemark, reference, created_at, updated_at
    ) VALUES (
      p_tenant_id, v_ledger_id, 'Unbilled', '',
      COALESCE(v_task.client_name, ''),
      v_pt_date,
      'SPLIT',
      COALESCE(NULLIF(v_svc.name, ''), 'Split Item'),
      COALESCE(v_svc.category, 'Warehouse'),
      v_child_id,
      COALESCE(v_inv_parent.description, ''),
      COALESCE(v_inv_parent.item_class, ''),
      1,
      v_rate,
      v_rate,
      p_task_id, '',
      COALESCE(v_inv_parent.shipment_number, ''),
      'Split from ' || v_parent_id,
      COALESCE(v_inv_parent.sidemark, ''),
      COALESCE(v_inv_parent.reference, ''),
      now(), now()
    )
    ON CONFLICT (tenant_id, ledger_row_id) DO NOTHING;

    INSERT INTO public.entity_audit_log (
      entity_type, entity_id, tenant_id, action, changes, performed_by, source
    ) VALUES (
      'item', v_child_id, p_tenant_id, 'split_child_created',
      jsonb_build_object(
        'parent_item_id', v_parent_id,
        'split_task_id', p_task_id,
        'item_class', COALESCE(v_inv_parent.item_class, ''),
        'rate', v_rate
      ),
      v_actor, 'rpc'
    );
  END LOOP;

  -- ── Complete the task + stamp child codes back into metadata ─
  UPDATE public.tasks SET
    status       = 'Completed',
    completed_at = v_now_ts,
    billed       = (v_rate > 0),
    metadata     = jsonb_set(
                     COALESCE(metadata, '{}'::jsonb),
                     '{split_workflow,child_item_codes}',
                     to_jsonb(v_child_codes),
                     true
                   ),
    updated_at   = now()
  WHERE tenant_id = p_tenant_id AND task_id = p_task_id;

  INSERT INTO public.entity_audit_log (
    entity_type, entity_id, tenant_id, action, changes, performed_by, source
  ) VALUES (
    'task', p_task_id, p_tenant_id, 'complete',
    jsonb_build_object(
      'status', jsonb_build_object('old', v_task.status, 'new', 'Completed'),
      'child_item_codes', to_jsonb(v_child_codes)
    ),
    v_actor, 'rpc'
  );

  RETURN QUERY SELECT
    true, false,
    v_parent_id,
    v_req_email,
    v_req_name,
    v_child_codes;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_complete_split_task(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_complete_split_task(text, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.rpc_complete_split_task(text, text, text) IS
  'Atomic completion of a Split task: reduces parent inventory qty, creates N child inventory rows (qty=1, parent_item_id back-pointer, single ledger entries), writes one SPLIT billing row per child at class-based rate, records audit-log entries for parent + each child + the task. Idempotent — already-completed tasks return their existing child codes.';
