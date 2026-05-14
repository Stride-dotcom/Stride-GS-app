-- [MIGRATION-P3] Extend create_repair_quote_request with optional source_task_id
--
-- The existing RPC (20260513170000) hardcoded source_task_id='' on the
-- repair insert. That was fine for the multi-item path (created from
-- Inventory bulk action with no parent task) but breaks the single-item
-- migration: TaskDetailPanel's "Request Repair Quote" passes a
-- sourceTaskId so the resulting repair links back to its task. Without
-- that linkage, the Repair detail panel's "Source Task" deep link is
-- empty and the task → repair audit trail is broken.
--
-- Fix: add p_source_task_id parameter (DEFAULT NULL → empty string for
-- back-compat). Edge function passes it through when caller provides it.
--
-- DROP-then-CREATE because we're adding a parameter (changes function
-- signature). Same pattern as 20260513180000's rename.

DROP FUNCTION IF EXISTS public.create_repair_quote_request(text, text[], text, text, text, text);

CREATE FUNCTION public.create_repair_quote_request(
  p_tenant_id      text,
  p_item_ids       text[],
  p_repair_vendor  text DEFAULT NULL,
  p_repair_notes   text DEFAULT NULL,
  p_item_notes     text DEFAULT NULL,
  p_created_by     text DEFAULT NULL,
  p_source_task_id text DEFAULT NULL
)
RETURNS TABLE (new_repair_id text, item_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_repair_id   text;
  v_first_item  text;
  v_role        text;
  v_caller_uid  uuid;
  v_item_count  integer;
  v_missing     text[];
BEGIN
  -- ── Auth: staff/admin only, or service_role bypass ───────────────
  v_role := COALESCE(((auth.jwt() -> 'user_metadata') ->> 'role'), '');
  v_caller_uid := auth.uid();
  IF v_role NOT IN ('admin', 'staff') AND v_caller_uid IS NOT NULL THEN
    RAISE EXCEPTION 'create_repair_quote_request: caller role % is not staff/admin', v_role USING ERRCODE = '42501';
  END IF;

  IF p_tenant_id IS NULL OR p_tenant_id = '' THEN
    RAISE EXCEPTION 'tenant_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_item_ids IS NULL OR array_length(p_item_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'item_ids array must not be empty' USING ERRCODE = '22023';
  END IF;

  SELECT ARRAY_AGG(missing_id) INTO v_missing
    FROM (SELECT unnest(p_item_ids) AS missing_id EXCEPT SELECT item_id FROM public.inventory WHERE tenant_id = p_tenant_id) sub;
  IF v_missing IS NOT NULL AND array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION 'item_ids not found in tenant inventory: %', array_to_string(v_missing, ', ') USING ERRCODE = '23503';
  END IF;

  v_first_item := p_item_ids[1];
  v_repair_id := next_repair_id(v_first_item);

  -- source_task_id is NOT NULL on the schema; pass empty string when
  -- caller didn't provide one (legacy multi-item path from Inventory).
  INSERT INTO public.repairs (tenant_id, repair_id, item_id, status, repair_vendor, repair_notes, item_notes, created_date, created_by, source_task_id, invoice_id, approved, billed, created_at, updated_at)
  VALUES (p_tenant_id, v_repair_id, v_first_item, 'Pending Quote', NULLIF(p_repair_vendor, ''), NULLIF(p_repair_notes, ''), NULLIF(p_item_notes, ''), to_char(now() AT TIME ZONE 'America/Los_Angeles', 'YYYY-MM-DD'), COALESCE(NULLIF(p_created_by, ''), 'system'), COALESCE(NULLIF(p_source_task_id, ''), ''), '', false, false, now(), now());

  INSERT INTO public.repair_items (tenant_id, repair_id, item_id, qty, created_at, updated_at)
  SELECT p_tenant_id, v_repair_id, item, 1, now(), now()
  FROM unnest(p_item_ids) AS t(item)
  ON CONFLICT (tenant_id, repair_id, item_id) DO NOTHING;

  GET DIAGNOSTICS v_item_count = ROW_COUNT;
  RETURN QUERY SELECT v_repair_id, array_length(p_item_ids, 1);
END;
$$;

REVOKE ALL ON FUNCTION public.create_repair_quote_request(text, text[], text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_repair_quote_request(text, text[], text, text, text, text, text) TO authenticated, service_role;
