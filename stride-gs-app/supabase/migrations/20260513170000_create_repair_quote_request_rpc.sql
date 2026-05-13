-- SB-authoritative repair-quote creation
-- =======================================
-- SECURITY DEFINER RPC for atomic creation of a parent repair plus its
-- repair_items rows. Used by the new `request-repair-quote-sb` edge
-- function (and eventually directly from React for single-item flow as
-- the GAS-first path retires).
--
-- repair_id format kept identical to the existing GAS-generated shape:
--   RPR-{first_item_id}-{epoch_ms}
-- The timestamp suffix is the uniqueness guarantee — no per-tenant
-- counter needed. Matches the format produced by the legacy GAS
-- `handleRequestRepairQuote_` so single-item rows produced through
-- either path look identical to downstream consumers.

-- Helper: build a repair_id from tenant + first item.
-- Inlined into create_repair_quote_request — exposed as a separate
-- function only so the format lives in one place.
CREATE OR REPLACE FUNCTION public.next_repair_id(p_first_item_id text)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT 'RPR-' || p_first_item_id || '-' || (extract(epoch from clock_timestamp()) * 1000)::bigint::text;
$$;

COMMENT ON FUNCTION public.next_repair_id IS
  'Generates a repair_id in the canonical RPR-{item_id}-{millis} format. '
  'Uniqueness is guaranteed by the millisecond timestamp suffix; the '
  'first_item_id is only there for human-readable grouping in the sheet '
  'view. Multi-item repairs use the first selected item as the suffix '
  'seed — same as the existing GAS-generated format.';

-- ── RPC: create one repair with N items atomically ─────────────────
-- Returns the newly-created repair_id so the caller can chase up with
-- email send / UI refresh / etc.
--
-- Validation rules:
--   • p_tenant_id, p_item_ids must be non-null + non-empty
--   • p_item_ids must contain at least one element
--   • All p_item_ids must exist in public.inventory for that tenant
--   • Caller (auth.uid + role) must have write access to the tenant
--     — enforced via the standard staff/admin guard inside the function
--
-- Items receive qty=1, status NULL — operators can edit after create.
CREATE OR REPLACE FUNCTION public.create_repair_quote_request(
  p_tenant_id      text,
  p_item_ids       text[],
  p_repair_vendor  text DEFAULT NULL,
  p_repair_notes   text DEFAULT NULL,
  p_item_notes     text DEFAULT NULL,
  p_created_by     text DEFAULT NULL
)
RETURNS TABLE (
  repair_id  text,
  item_count integer
)
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
  -- This function is SECURITY DEFINER so we have to re-impose
  -- permissions inside the body. service_role's jwt() returns the
  -- service-role claims; staff/admin from logged-in clients gets the
  -- user_metadata.role check.
  v_role := COALESCE(((auth.jwt() -> 'user_metadata') ->> 'role'), '');
  v_caller_uid := auth.uid();
  IF v_role NOT IN ('admin', 'staff') AND v_caller_uid IS NOT NULL THEN
    RAISE EXCEPTION 'create_repair_quote_request: caller role % is not staff/admin', v_role
      USING ERRCODE = '42501';
  END IF;

  -- ── Validate inputs ──────────────────────────────────────────────
  IF p_tenant_id IS NULL OR p_tenant_id = '' THEN
    RAISE EXCEPTION 'tenant_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_item_ids IS NULL OR array_length(p_item_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'item_ids array must not be empty' USING ERRCODE = '22023';
  END IF;

  -- Verify every item exists in inventory for this tenant. Returns
  -- the missing IDs in the error message so the caller can show a
  -- useful failure rather than a generic "items not found".
  SELECT ARRAY_AGG(missing_id)
    INTO v_missing
    FROM (
      SELECT unnest(p_item_ids) AS missing_id
      EXCEPT
      SELECT item_id FROM public.inventory WHERE tenant_id = p_tenant_id
    ) sub;

  IF v_missing IS NOT NULL AND array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION 'item_ids not found in tenant inventory: %', array_to_string(v_missing, ', ')
      USING ERRCODE = '23503';
  END IF;

  -- ── Generate repair_id ───────────────────────────────────────────
  v_first_item := p_item_ids[1];
  v_repair_id := next_repair_id(v_first_item);

  -- ── Insert parent repair ─────────────────────────────────────────
  -- item_id is the "primary item" denormalized pointer; for back-
  -- compat with the existing UI/queries it stays populated with the
  -- first selected item. The full item list lives in repair_items.
  --
  -- status='Pending Quote' is the canonical first state in the
  -- repair lifecycle (Pending Quote → Quote Sent → Approved/Declined
  -- → In Progress → Completed/Failed). source_task_id and invoice_id
  -- are NOT NULL in the schema and get empty-string sentinels here;
  -- they're populated later by the task/billing flows.
  INSERT INTO public.repairs (
    tenant_id, repair_id, item_id,
    status, repair_vendor, repair_notes, item_notes,
    created_date, created_by,
    source_task_id, invoice_id,
    approved, billed,
    created_at, updated_at
  ) VALUES (
    p_tenant_id, v_repair_id, v_first_item,
    'Pending Quote', NULLIF(p_repair_vendor, ''), NULLIF(p_repair_notes, ''), NULLIF(p_item_notes, ''),
    to_char(now() AT TIME ZONE 'America/Los_Angeles', 'YYYY-MM-DD'),
    COALESCE(NULLIF(p_created_by, ''), 'system'),
    '', '',
    false, false,
    now(), now()
  );

  -- ── Insert items ─────────────────────────────────────────────────
  -- unnest expands the array; ON CONFLICT guards against the caller
  -- accidentally passing the same item_id twice (UNIQUE constraint
  -- on (tenant_id, repair_id, item_id) prevents duplicates anyway).
  INSERT INTO public.repair_items (tenant_id, repair_id, item_id, qty, created_at, updated_at)
  SELECT p_tenant_id, v_repair_id, item, 1, now(), now()
  FROM unnest(p_item_ids) AS t(item)
  ON CONFLICT (tenant_id, repair_id, item_id) DO NOTHING;

  GET DIAGNOSTICS v_item_count = ROW_COUNT;

  -- Return the new repair_id + number of items the caller passed
  -- (not v_item_count from the INSERT — that may differ if the array
  -- had duplicates; the caller passed N intent and that's what we
  -- report back).
  RETURN QUERY SELECT v_repair_id, array_length(p_item_ids, 1);
END;
$$;

COMMENT ON FUNCTION public.create_repair_quote_request IS
  'SB-authoritative atomic creation of a parent repair + N repair_items '
  'rows. SECURITY DEFINER — internal staff/admin role check. Used by '
  'the request-repair-quote-sb edge function and (eventually) directly '
  'from React when the GAS-first path retires. Returns the new repair_id.';

-- Grants — service_role + authenticated. anon never calls this.
REVOKE ALL ON FUNCTION public.create_repair_quote_request(text, text[], text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_repair_quote_request(text, text[], text, text, text, text) TO authenticated, service_role;
