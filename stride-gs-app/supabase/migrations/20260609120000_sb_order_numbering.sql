-- ============================================================================
-- Supabase-generated clean order numbering for all order types
-- (feat/orders/sb-order-numbering)
--
-- Replaces the timestamp-based identifiers GAS mints for new repairs / will
-- calls / tasks with clean, client-scoped sequential numbers, matching the
-- delivery-order pattern (PREFIX-N). Gated to the Justin Demo Account via a
-- new `orderNumbering` feature_flags row (MIG-010 per-tenant scope). NEW
-- orders only — existing rows keep their stored identifiers (no renumbering).
--
-- Format produced (no leading zeros anywhere):
--   Repairs    {PREFIX}-RPR-{N}
--   Will Calls {PREFIX}-WC-{N}
--   Tasks      {PREFIX}-TSK-{N}
--   Delivery   {PREFIX}-{N}     (handled React-side: strip the lpad only;
--                                delivery keeps its global dt_order_number_seq
--                                so existing numbers never collide)
--
-- PREFIX reuses the exact buildOrderNumberBase() logic from
-- CreateDeliveryOrderModal.tsx: first 3 A-Z letters of the client name,
-- uppercased, falling back to 'STR'. (NOT client_name_prefix(), which uses
-- word-initials — a different algorithm.)
--
-- order_sequences is internal counter state: NOT in the parity_dryrun mirror
-- set (it is not an entity write-target replayed by the shadow harness — same
-- treatment as invoice_no_seq / shipment_no_seq). RLS-enabled with no
-- authenticated/anon policy; reached only through the SECURITY DEFINER
-- functions below.
-- ============================================================================

-- 1. Per-tenant, per-type sequence table -------------------------------------
CREATE TABLE IF NOT EXISTS public.order_sequences (
  tenant_id  text        NOT NULL,
  order_type text        NOT NULL,
  next_val   bigint      NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, order_type)
);

ALTER TABLE public.order_sequences ENABLE ROW LEVEL SECURITY;
-- No authenticated/anon policy by design: internal counter state, mutated
-- only via the SECURITY DEFINER functions below. service_role bypasses RLS
-- but still needs the table grant.
GRANT ALL ON public.order_sequences TO service_role;

-- 2. Atomic increment primitive ----------------------------------------------
-- Returns the next plain integer (no padding) for (tenant, type).
-- INSERT ... ON CONFLICT ... RETURNING is atomic and concurrency-safe (row
-- lock on the conflicting PK), so this is the order-number equivalent of the
-- next_invoice_no() / next_shipment_no() SEQUENCE pattern. First call for a
-- (tenant, type) returns 1.
CREATE OR REPLACE FUNCTION public.next_order_number(p_tenant_id text, p_order_type text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_next bigint;
BEGIN
  IF p_tenant_id IS NULL OR p_tenant_id = '' THEN
    RAISE EXCEPTION 'tenant_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_order_type IS NULL OR p_order_type = '' THEN
    RAISE EXCEPTION 'order_type is required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.order_sequences (tenant_id, order_type, next_val)
  VALUES (p_tenant_id, p_order_type, 1)
  ON CONFLICT (tenant_id, order_type)
  DO UPDATE SET next_val   = public.order_sequences.next_val + 1,
                updated_at = now()
  RETURNING next_val INTO v_next;

  RETURN v_next;
END;
$$;

-- 3. Client prefix helper — mirrors buildOrderNumberBase() exactly -----------
--    JS: clientName.replace(/[^A-Za-z]/g,'').slice(0,3).toUpperCase() || 'STR'
CREATE OR REPLACE FUNCTION public.order_client_prefix(p_tenant_id text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(
    (SELECT NULLIF(upper(left(regexp_replace(COALESCE(name, ''), '[^A-Za-z]', '', 'g'), 3)), '')
       FROM public.clients
      WHERE spreadsheet_id = p_tenant_id
      LIMIT 1),
    'STR'
  );
$$;

-- 4. Feature-flag resolver (MIG-010 per-tenant scope semantics) --------------
--    Treats active_backend='supabase' as "on". Mirrors resolveFlagBackend():
--    scope NULL → fleet-wide; tenant in scope → active_backend; tenant out of
--    scope → opposite. Missing flag → off.
CREATE OR REPLACE FUNCTION public.order_numbering_enabled(p_tenant_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(
    (SELECT CASE
        WHEN tenant_scope IS NULL            THEN (active_backend = 'supabase')
        WHEN p_tenant_id = ANY(tenant_scope) THEN (active_backend = 'supabase')
        ELSE                                      (active_backend <> 'supabase')
      END
       FROM public.feature_flags
      WHERE function_key = 'orderNumbering'),
    false
  );
$$;

-- 5. Full clean-ID builder ----------------------------------------------------
-- Returns the composed identifier, or NULL when the feature is disabled for
-- the tenant (callers fall back to their legacy generator). Increments the
-- sequence ONLY when enabled.
CREATE OR REPLACE FUNCTION public.next_order_id(p_tenant_id text, p_order_type text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_token  text;
  v_prefix text;
  v_n      bigint;
BEGIN
  IF NOT public.order_numbering_enabled(p_tenant_id) THEN
    RETURN NULL;
  END IF;

  v_token := CASE p_order_type
    WHEN 'repair'    THEN 'RPR'
    WHEN 'will_call' THEN 'WC'
    WHEN 'task'      THEN 'TSK'
    ELSE NULL                      -- delivery / unknown: no type token
  END;

  v_prefix := public.order_client_prefix(p_tenant_id);
  v_n      := public.next_order_number(p_tenant_id, p_order_type);

  IF v_token IS NULL THEN
    RETURN v_prefix || '-' || v_n::text;
  END IF;
  RETURN v_prefix || '-' || v_token || '-' || v_n::text;
END;
$$;

-- EXECUTE grants — callable by EFs (service_role) + the repair RPC (definer)
-- + React (authenticated, for any future direct use).
GRANT EXECUTE ON FUNCTION public.next_order_number(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.order_client_prefix(text)     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.order_numbering_enabled(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.next_order_id(text, text)     TO authenticated, service_role;

-- 6. Repairs: mint the clean ID inside the existing atomic create RPC --------
-- requestRepairQuote is fleet-wide SB, so the gate lives INSIDE the RPC:
-- next_order_id returns NULL for non-Justin tenants and the RPC falls back to
-- the legacy next_repair_id (timestamp). Body is byte-for-byte the live
-- definition except the two-line v_repair_id assignment below.
CREATE OR REPLACE FUNCTION public.create_repair_quote_request(
  p_tenant_id text,
  p_item_ids text[],
  p_repair_vendor text DEFAULT NULL::text,
  p_repair_notes text DEFAULT NULL::text,
  p_item_notes text DEFAULT NULL::text,
  p_created_by text DEFAULT NULL::text,
  p_source_task_id text DEFAULT NULL::text
)
RETURNS TABLE(new_repair_id text, item_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_repair_id   text;
  v_first_item  text;
  v_role        text;
  v_caller_uid  uuid;
  v_item_count  integer;
  v_missing     text[];
BEGIN
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
  -- Clean SB-generated repair id (PREFIX-RPR-N) when orderNumbering is on for
  -- this tenant; otherwise the legacy timestamp id. NULL == feature off.
  v_repair_id := public.next_order_id(p_tenant_id, 'repair');
  IF v_repair_id IS NULL THEN
    v_repair_id := public.next_repair_id(v_first_item);
  END IF;

  INSERT INTO public.repairs (tenant_id, repair_id, item_id, status, repair_vendor, repair_notes, item_notes, created_date, created_by, source_task_id, invoice_id, approved, billed, created_at, updated_at)
  VALUES (p_tenant_id, v_repair_id, v_first_item, 'Pending Quote', NULLIF(p_repair_vendor, ''), NULLIF(p_repair_notes, ''), NULLIF(p_item_notes, ''), to_char(now() AT TIME ZONE 'America/Los_Angeles', 'YYYY-MM-DD'), COALESCE(NULLIF(p_created_by, ''), 'system'), COALESCE(NULLIF(p_source_task_id, ''), ''), '', false, false, now(), now());

  INSERT INTO public.repair_items (tenant_id, repair_id, item_id, qty, created_at, updated_at)
  SELECT p_tenant_id, v_repair_id, item, 1, now(), now()
  FROM unnest(p_item_ids) AS t(item)
  ON CONFLICT (tenant_id, repair_id, item_id) DO NOTHING;

  GET DIAGNOSTICS v_item_count = ROW_COUNT;
  RETURN QUERY SELECT v_repair_id, array_length(p_item_ids, 1);
END;
$function$;

-- 7. Seed the feature flag — Justin Demo Account only ------------------------
-- UI/behavior gate only (no apiRouter routing): order_numbering_enabled() and
-- the React modal read it. tenant_scope=[Justin Demo] → on for Justin, opposite
-- (off) for every production tenant. Flip tenant_scope=NULL later to go fleet.
INSERT INTO public.feature_flags (function_key, active_backend, shadow_backend, parity_enabled, tenant_scope, notes)
VALUES (
  'orderNumbering',
  'supabase',
  'gas',
  false,
  ARRAY['1-nF3CgQBcfCncqW6u3d4jilsZzjqR1RO6y_f4OD-O2A'],
  'Clean SB-generated order numbers (PREFIX[-TYPE]-N, no leading zeros) for repairs/will calls/tasks/delivery. Behavior gate only — no routing. Canary: Justin Demo Account.'
)
ON CONFLICT (function_key) DO NOTHING;
