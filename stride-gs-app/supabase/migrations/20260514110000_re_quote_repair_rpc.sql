-- Re-quote flow for in-flight repairs
-- ====================================
-- Lets staff add/remove items on an existing repair WITHOUT cancelling
-- and recreating. Resets the quote (clears quote_amount + quote_lines_json
-- + sent date) and flips status back to 'Pending Quote' so the standard
-- sendRepairQuote flow can re-issue the customer-facing quote with the
-- new item list.
--
-- Constraints:
--   • Allowed only for source status in (Pending Quote, Quote Sent).
--     Approved / In Progress / Complete / Cancelled / Declined repairs
--     must be cancel-and-rebuild — modifying items after approval would
--     break the customer agreement.
--   • Items list must be non-empty (repair must have at least one item
--     after the re-quote — empty would create an orphan).
--   • All new items must exist in the tenant's inventory (same
--     validation as create_repair_quote_request).
--
-- Atomic transaction:
--   1. Validate source status + tenant + items
--   2. DELETE existing repair_items
--   3. INSERT new repair_items
--   4. UPDATE repairs: status='Pending Quote', clear quote_* fields,
--      reset item_id to the new first item
--   5. INSERT entity_audit_log with action='requote', changes shape:
--      { old_item_ids: [...], new_item_ids: [...], cleared_quote: true }

-- Note on OUT-param naming: PL/pgSQL substitutes RETURNS TABLE column
-- names BEFORE Postgres parses the body, so any column reference whose
-- name collides with an OUT param raises a 42702 "ambiguous column
-- reference" at every invocation. The `create_repair_quote_request` RPC
-- hit this in PR #400 (2026-05-13) when its OUT was named `repair_id` —
-- the same pattern would bite this RPC's WHERE/ON CONFLICT clauses
-- below. Prefixing with `new_` / `result_` mirrors that fix's convention.
--
-- DROP-then-CREATE because changing OUT column names in a TABLE return
-- type requires a signature drop (Postgres errors "cannot change return
-- type of existing function" on plain CREATE OR REPLACE). Safe to
-- re-apply: REVOKE/GRANT at the bottom re-stamps permissions cleanly.
DROP FUNCTION IF EXISTS public.re_quote_repair(text, text, text[], text);

CREATE OR REPLACE FUNCTION public.re_quote_repair(
  p_tenant_id     text,
  p_repair_id     text,
  p_new_item_ids  text[],
  p_performed_by  text DEFAULT NULL
)
RETURNS TABLE (
  new_repair_id      text,
  result_item_count  integer,
  result_old_items   text[],
  result_new_items   text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role         text;
  v_caller_uid   uuid;
  v_repair       record;
  v_old_items    text[];
  v_missing      text[];
BEGIN
  -- Auth (same pattern as other repair RPCs)
  v_role := COALESCE(((auth.jwt() -> 'user_metadata') ->> 'role'), '');
  v_caller_uid := auth.uid();
  IF v_role NOT IN ('admin', 'staff') AND v_caller_uid IS NOT NULL THEN
    RAISE EXCEPTION 're_quote_repair: caller role % is not staff/admin', v_role USING ERRCODE = '42501';
  END IF;

  IF p_tenant_id IS NULL OR p_tenant_id = '' THEN
    RAISE EXCEPTION 'tenant_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_repair_id IS NULL OR p_repair_id = '' THEN
    RAISE EXCEPTION 'repair_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_new_item_ids IS NULL OR array_length(p_new_item_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'new_item_ids array must not be empty (a repair must have at least one item)' USING ERRCODE = '22023';
  END IF;

  -- Load existing repair + verify it can be re-quoted
  SELECT * INTO v_repair FROM public.repairs
    WHERE tenant_id = p_tenant_id AND repair_id = p_repair_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Repair % not found in tenant %', p_repair_id, p_tenant_id USING ERRCODE = '02000';
  END IF;
  IF v_repair.status NOT IN ('Pending Quote', 'Quote Sent') THEN
    RAISE EXCEPTION 'Cannot re-quote a repair with status %. Allowed: Pending Quote, Quote Sent. For other statuses, cancel and create a new repair.', v_repair.status
      USING ERRCODE = '22023', HINT = 'Approved/Complete/Cancelled repairs are locked — modifying items would invalidate the customer agreement.';
  END IF;

  -- Validate every new item exists in the tenant's inventory
  SELECT ARRAY_AGG(missing_id) INTO v_missing
    FROM (SELECT unnest(p_new_item_ids) AS missing_id EXCEPT SELECT item_id FROM public.inventory WHERE tenant_id = p_tenant_id) sub;
  IF v_missing IS NOT NULL AND array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION 'item_ids not found in tenant inventory: %', array_to_string(v_missing, ', ') USING ERRCODE = '23503';
  END IF;

  -- Snapshot old items for the audit log
  SELECT ARRAY_AGG(item_id ORDER BY item_id) INTO v_old_items
    FROM public.repair_items WHERE tenant_id = p_tenant_id AND repair_id = p_repair_id;
  v_old_items := COALESCE(v_old_items, ARRAY[]::text[]);

  -- Atomic swap: delete + insert
  DELETE FROM public.repair_items
    WHERE tenant_id = p_tenant_id AND repair_id = p_repair_id;
  INSERT INTO public.repair_items (tenant_id, repair_id, item_id, qty, created_at, updated_at)
  SELECT p_tenant_id, p_repair_id, item, 1, now(), now()
  FROM unnest(p_new_item_ids) AS t(item)
  ON CONFLICT (tenant_id, repair_id, item_id) DO NOTHING;

  -- Reset the parent repair row — clears quote fields, flips status,
  -- updates the "primary item" denormalized cache to the new first item.
  UPDATE public.repairs SET
    status                  = 'Pending Quote',
    item_id                 = p_new_item_ids[1],
    quote_amount            = NULL,
    quote_sent_date         = NULL,
    quote_lines_json        = NULL,
    quote_subtotal          = NULL,
    quote_taxable_subtotal  = NULL,
    quote_tax_area_id       = NULL,
    quote_tax_area_name     = NULL,
    quote_tax_rate          = NULL,
    quote_tax_amount        = NULL,
    quote_grand_total       = NULL,
    approved                = false,
    updated_at              = now()
  WHERE tenant_id = p_tenant_id AND repair_id = p_repair_id;

  -- Audit row
  INSERT INTO public.entity_audit_log (
    entity_type, entity_id, tenant_id, action, changes, performed_by, source
  ) VALUES (
    'repair', p_repair_id, p_tenant_id, 'requote',
    jsonb_build_object(
      'old_item_ids', to_jsonb(v_old_items),
      'new_item_ids', to_jsonb(p_new_item_ids),
      'previous_status', v_repair.status,
      'cleared_quote', true
    ),
    COALESCE(NULLIF(p_performed_by, ''), 'system'),
    'edge'
  );

  RETURN QUERY SELECT
    p_repair_id,
    array_length(p_new_item_ids, 1),
    v_old_items,
    p_new_item_ids;
END;
$$;

REVOKE ALL ON FUNCTION public.re_quote_repair(text, text, text[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.re_quote_repair(text, text, text[], text) TO authenticated, service_role;
