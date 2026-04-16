-- =============================================================================
-- LOCATION CAPACITY PATCH (B): GROUPING + LOCATION CAPABILITY FLAGS + RPC UPDATE
-- NVPC DB Patch Phase (B)
--
-- ADDITIVE ONLY — no existing columns/types/triggers/RLS modified or removed.
-- BILLING PARITY: NO billing objects touched.
--
-- PRE-FLIGHT DISCOVERY SUMMARY (PF1–PF5):
--   PF1: Prior migration objects confirmed:
--         location_capacity_cache ✓, rpc_get_location_suggestions ✓,
--         fn_update_location_capacity_cache ✓, fn_apply_location_capacity_deltas ✓,
--         fn_reconcile_location_capacity ✓
--   PF2: locations.id/tenant_id/warehouse_id/code ✓
--         NO existing grouping field (zone/area/section/group_code/aisle/bay) exists.
--         location_type and type exist but are type categories, not tenant-configurable grouping.
--         → Adding group_code TEXT NULL.
--   PF3: Flags framework current state:
--         pricing_flags was DROPPED in migration 20260128000000.
--         item_flags (current): id, tenant_id, item_id→items, service_code TEXT NOT NULL,
--           charge_type_id→charge_types, UNIQUE(item_id, service_code)
--         NO location<->flag join table exists.
--         → Creating location_flag_links using service_code to match item_flags pattern.
--   PF4: user_tenant_id() ✓, user_has_warehouse_access(uuid, uuid) ✓
--   PF5: RLS enabled on locations ✓, items ✓, location_capacity_cache ✓ (prior migration)
--
-- ASSUMPTIONS:
--   A1: items.size is the cubic_ft equivalent (from prior migration).
--   A2: items.item_code serves as the SKU equivalent (from prior migration).
--   A3: locations does NOT have tenant_id. Tenant scoping via warehouses.tenant_id.
--   A4: item_flags.service_code is the flag identifier for item requirements.
--   A5: location_flag_links.service_code is the flag identifier for location capabilities.
--   A6: flag_compliant = TRUE when item requirement service_codes ⊆ location capability service_codes.
-- =============================================================================


-- ============================================================
-- SECTION A: ADD group_code TO locations (TENANT-FLEXIBLE GROUPING)
--
-- No suitable existing grouping column found (PF2).
-- group_code is optional, nullable, no validations in this phase.
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'locations' AND column_name = 'group_code'
  ) THEN
    ALTER TABLE public.locations ADD COLUMN group_code TEXT NULL;
  END IF;
END $$;

-- Index for tenant+warehouse+group_code lookups (used by RPC)
CREATE INDEX IF NOT EXISTS idx_locations_wh_group
  ON public.locations(warehouse_id, group_code);


-- ============================================================
-- SECTION B: LOCATION CAPABILITY FLAGS (NEW JOIN TABLE)
--
-- Mirrors item_flags pattern: uses service_code TEXT as the flag
-- identifier. charge_type_id optional for parity.
-- pricing_flags was dropped (20260128000000); this uses the current
-- service_code-based flag framework.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.location_flag_links (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL,
  location_id  UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  service_code TEXT NOT NULL,
  charge_type_id UUID REFERENCES public.charge_types(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   UUID NULL,
  CONSTRAINT location_flag_links_unique UNIQUE (location_id, service_code)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_location_flag_links_tenant_location
  ON public.location_flag_links(tenant_id, location_id);

CREATE INDEX IF NOT EXISTS idx_location_flag_links_tenant_service
  ON public.location_flag_links(tenant_id, service_code);

-- RLS (follows item_flags pattern: tenant_id direct match)
ALTER TABLE public.location_flag_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "location_flag_links_tenant_select" ON public.location_flag_links;
CREATE POLICY "location_flag_links_tenant_select"
  ON public.location_flag_links
  FOR SELECT
  USING (tenant_id = public.user_tenant_id());

DROP POLICY IF EXISTS "location_flag_links_tenant_insert" ON public.location_flag_links;
CREATE POLICY "location_flag_links_tenant_insert"
  ON public.location_flag_links
  FOR INSERT
  WITH CHECK (tenant_id = public.user_tenant_id());

DROP POLICY IF EXISTS "location_flag_links_tenant_delete" ON public.location_flag_links;
CREATE POLICY "location_flag_links_tenant_delete"
  ON public.location_flag_links
  FOR DELETE
  USING (tenant_id = public.user_tenant_id());

DROP POLICY IF EXISTS "location_flag_links_tenant_update" ON public.location_flag_links;
CREATE POLICY "location_flag_links_tenant_update"
  ON public.location_flag_links
  FOR UPDATE
  USING (tenant_id = public.user_tenant_id())
  WITH CHECK (tenant_id = public.user_tenant_id());

-- Grant access to authenticated users
GRANT ALL ON public.location_flag_links TO authenticated;


-- ============================================================
-- SECTION C: RLS ON location_capacity_cache
--
-- ALREADY ENABLED in prior migration (20260212160000) with policies:
--   - location_capacity_cache_tenant_select (SELECT via warehouses.tenant_id)
--   - location_capacity_cache_tenant_modify (ALL via warehouses.tenant_id)
-- No additional changes needed. Documented here for traceability.
-- ============================================================

-- Verify RLS is enabled (idempotent, no-op if already enabled)
ALTER TABLE public.location_capacity_cache ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- SECTION D: UPDATE rpc_get_location_suggestions
--
-- Changes:
--   1. group_match: uses locations.group_code (new column)
--   2. flag_compliant: uses item_flags + location_flag_links (service_code match)
-- Signature UNCHANGED. Only body updated.
-- Permission checks PRESERVED. Deterministic ORDER BY PRESERVED.
-- ============================================================

CREATE OR REPLACE FUNCTION public.rpc_get_location_suggestions(
  p_tenant_id    UUID,
  p_warehouse_id UUID,
  p_mode         TEXT,       -- 'single' | 'batch'
  p_item_id      UUID DEFAULT NULL,
  p_item_ids     UUID[] DEFAULT NULL
)
RETURNS TABLE (
  location_id       UUID,
  location_code     TEXT,
  capacity_cuft     NUMERIC,
  used_cuft         NUMERIC,
  available_cuft    NUMERIC,
  utilization_pct   NUMERIC,
  flag_compliant    BOOLEAN,
  account_cluster   BOOLEAN,
  sku_or_vendor_match BOOLEAN,
  group_match       BOOLEAN,
  leftover_cuft     NUMERIC,
  overflow          BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_required_volume  NUMERIC;
  v_item_account_id  UUID;
  v_item_code        TEXT;
  v_item_vendor      TEXT;
  v_ref_item_id      UUID;       -- reference item for clustering/flags
  v_item_location_id UUID;       -- item's current location (for group_match)
  v_item_group_code  TEXT;       -- group_code of item's current location
  v_item_flag_count  INT := 0;   -- count of item requirement flags
  v_eligible_count   INT;
BEGIN
  -- -------------------------------------------------------
  -- PERMISSION VALIDATION (unchanged from prior migration)
  -- -------------------------------------------------------
  IF public.user_tenant_id() IS DISTINCT FROM p_tenant_id THEN
    RAISE EXCEPTION 'TENANT_MISMATCH: Caller tenant does not match p_tenant_id';
  END IF;

  IF NOT public.user_has_warehouse_access(auth.uid(), p_warehouse_id) THEN
    RAISE EXCEPTION 'ACCESS_DENIED: User does not have access to warehouse %', p_warehouse_id;
  END IF;

  -- -------------------------------------------------------
  -- MODE VALIDATION (unchanged)
  -- -------------------------------------------------------
  IF p_mode NOT IN ('single', 'batch') THEN
    RAISE EXCEPTION 'INVALID_MODE: mode must be single or batch, got %', p_mode;
  END IF;

  -- -------------------------------------------------------
  -- COMPUTE REQUIRED VOLUME + REFERENCE ITEM DATA
  -- items.size is used as the cubic_ft equivalent (Assumption A1)
  -- -------------------------------------------------------
  IF p_mode = 'single' THEN
    IF p_item_id IS NULL THEN
      RAISE EXCEPTION 'INVALID_INPUT: item_id required for single mode';
    END IF;

    v_ref_item_id := p_item_id;

    SELECT
      COALESCE(i.size, 0),
      i.account_id,
      i.item_code,
      i.vendor,
      i.location_id
    INTO v_required_volume, v_item_account_id, v_item_code, v_item_vendor, v_item_location_id
    FROM public.items i
    WHERE i.id = p_item_id
      AND i.tenant_id = p_tenant_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'ITEM_NOT_FOUND: item_id % not found for tenant', p_item_id;
    END IF;

  ELSIF p_mode = 'batch' THEN
    IF p_item_ids IS NULL OR array_length(p_item_ids, 1) IS NULL THEN
      RAISE EXCEPTION 'INVALID_INPUT: item_ids required for batch mode';
    END IF;

    v_ref_item_id := p_item_ids[1];

    SELECT
      COALESCE(SUM(COALESCE(i.size, 0)), 0)
    INTO v_required_volume
    FROM public.items i
    WHERE i.id = ANY(p_item_ids)
      AND i.tenant_id = p_tenant_id;

    -- Use first item's attributes for clustering/flags
    SELECT i.account_id, i.item_code, i.vendor, i.location_id
    INTO v_item_account_id, v_item_code, v_item_vendor, v_item_location_id
    FROM public.items i
    WHERE i.id = p_item_ids[1]
      AND i.tenant_id = p_tenant_id;
  END IF;

  -- -------------------------------------------------------
  -- RESOLVE GROUP_CODE from item's current location
  -- group_match = TRUE if candidate.group_code = item_location.group_code
  -- If item has no location or location has no group_code → group_match FALSE
  -- -------------------------------------------------------
  IF v_item_location_id IS NOT NULL THEN
    SELECT l.group_code INTO v_item_group_code
    FROM public.locations l
    WHERE l.id = v_item_location_id;
  END IF;

  -- -------------------------------------------------------
  -- COUNT ITEM REQUIREMENT FLAGS (from item_flags, service_code based)
  -- Used to check subset relationship: item flags ⊆ location flags
  -- -------------------------------------------------------
  SELECT count(DISTINCT ifr.service_code) INTO v_item_flag_count
  FROM public.item_flags ifr
  WHERE ifr.item_id = v_ref_item_id
    AND ifr.tenant_id = p_tenant_id;

  -- -------------------------------------------------------
  -- CHECK ELIGIBLE LOCATION COUNT (unchanged criteria)
  -- -------------------------------------------------------
  SELECT count(*) INTO v_eligible_count
  FROM public.locations l
  JOIN public.location_capacity_cache c ON c.location_id = l.id
  WHERE l.warehouse_id = p_warehouse_id
    AND l.capacity_cuft IS NOT NULL
    AND l.deleted_at IS NULL
    AND c.utilization_pct < 0.90;

  -- -------------------------------------------------------
  -- RETURN TOP 3 ELIGIBLE LOCATIONS (or overflow fallback)
  -- -------------------------------------------------------
  IF v_eligible_count > 0 THEN
    RETURN QUERY
    WITH
    -- CTE: item requirement flags (set of service_codes)
    item_req_flags AS (
      SELECT DISTINCT ifr.service_code
      FROM public.item_flags ifr
      WHERE ifr.item_id = v_ref_item_id
        AND ifr.tenant_id = p_tenant_id
    ),
    -- CTE: per-location count of matching capability flags (NO N+1)
    loc_flag_match AS (
      SELECT
        lfl.location_id AS loc_id,
        count(DISTINCT lfl.service_code) AS matched_count
      FROM public.location_flag_links lfl
      WHERE lfl.tenant_id = p_tenant_id
        AND lfl.service_code IN (SELECT service_code FROM item_req_flags)
      GROUP BY lfl.location_id
    ),
    -- CTE: account volume per location (NO N+1)
    account_volume AS (
      SELECT
        i.location_id AS loc_id,
        COALESCE(SUM(COALESCE(i.size, 0)), 0) AS acct_vol
      FROM public.items i
      WHERE i.tenant_id = p_tenant_id
        AND i.account_id = v_item_account_id
        AND i.location_id IS NOT NULL
        AND i.deleted_at IS NULL
      GROUP BY i.location_id
    ),
    -- CTE: sku/vendor matches per location (NO N+1)
    sku_vendor_match AS (
      SELECT DISTINCT i.location_id AS loc_id
      FROM public.items i
      WHERE i.tenant_id = p_tenant_id
        AND i.location_id IS NOT NULL
        AND i.deleted_at IS NULL
        AND (
          (v_item_code IS NOT NULL AND i.item_code = v_item_code)
          OR (v_item_vendor IS NOT NULL AND i.vendor = v_item_vendor)
        )
    )
    SELECT
      l.id                                                            AS location_id,
      l.code                                                          AS location_code,
      l.capacity_cuft                                                 AS capacity_cuft,
      c.used_cuft                                                     AS used_cuft,
      c.available_cuft                                                AS available_cuft,
      c.utilization_pct                                               AS utilization_pct,
      -- flag_compliant: item requirement service_codes ⊆ location capability service_codes
      CASE
        WHEN v_item_flag_count = 0 THEN TRUE
        WHEN COALESCE(lfm.matched_count, 0) >= v_item_flag_count THEN TRUE
        ELSE FALSE
      END                                                             AS flag_compliant,
      -- account_cluster: >= 35 cuft from same account
      COALESCE(av.acct_vol >= 35, FALSE)                              AS account_cluster,
      -- sku_or_vendor_match
      (svm.loc_id IS NOT NULL)                                        AS sku_or_vendor_match,
      -- group_match: candidate location group_code matches item's current location group_code
      (v_item_group_code IS NOT NULL
       AND l.group_code IS NOT NULL
       AND l.group_code = v_item_group_code)                          AS group_match,
      -- leftover_cuft: best-fit metric
      (c.available_cuft - v_required_volume)                          AS leftover_cuft,
      -- overflow: FALSE for eligible locations
      FALSE                                                           AS overflow
    FROM public.locations l
    JOIN public.location_capacity_cache c ON c.location_id = l.id
    LEFT JOIN loc_flag_match lfm ON lfm.loc_id = l.id
    LEFT JOIN account_volume av ON av.loc_id = l.id
    LEFT JOIN sku_vendor_match svm ON svm.loc_id = l.id
    WHERE l.warehouse_id = p_warehouse_id
      AND l.capacity_cuft IS NOT NULL
      AND l.deleted_at IS NULL
      AND c.utilization_pct < 0.90
    ORDER BY
      -- flag_compliant DESC: compliant locations ranked above non-compliant
      CASE
        WHEN v_item_flag_count = 0 THEN TRUE
        WHEN COALESCE(lfm.matched_count, 0) >= v_item_flag_count THEN TRUE
        ELSE FALSE
      END DESC,
      -- account_cluster DESC
      COALESCE(av.acct_vol >= 35, FALSE) DESC,
      -- sku_or_vendor_match DESC
      (svm.loc_id IS NOT NULL) DESC,
      -- group_match DESC
      (v_item_group_code IS NOT NULL
       AND l.group_code IS NOT NULL
       AND l.group_code = v_item_group_code) DESC,
      -- leftover_cuft ASC: smallest positive leftover first (best-fit)
      (c.available_cuft - v_required_volume) ASC,
      -- tiebreak: most available space
      c.available_cuft DESC,
      -- deterministic tiebreak: location UUID
      l.id ASC
    LIMIT 3;

  ELSE
    -- OVERFLOW FALLBACK: no eligible locations meet filters.
    -- Return top 3 by available_cuft DESC with overflow=true.
    -- flag_compliant and group_match still computed for informational value.
    RETURN QUERY
    WITH
    item_req_flags_overflow AS (
      SELECT DISTINCT ifr.service_code
      FROM public.item_flags ifr
      WHERE ifr.item_id = v_ref_item_id
        AND ifr.tenant_id = p_tenant_id
    ),
    loc_flag_match_overflow AS (
      SELECT
        lfl.location_id AS loc_id,
        count(DISTINCT lfl.service_code) AS matched_count
      FROM public.location_flag_links lfl
      WHERE lfl.tenant_id = p_tenant_id
        AND lfl.service_code IN (SELECT service_code FROM item_req_flags_overflow)
      GROUP BY lfl.location_id
    )
    SELECT
      l.id                                                            AS location_id,
      l.code                                                          AS location_code,
      l.capacity_cuft                                                 AS capacity_cuft,
      c.used_cuft                                                     AS used_cuft,
      c.available_cuft                                                AS available_cuft,
      c.utilization_pct                                               AS utilization_pct,
      CASE
        WHEN v_item_flag_count = 0 THEN TRUE
        WHEN COALESCE(lfmo.matched_count, 0) >= v_item_flag_count THEN TRUE
        ELSE FALSE
      END                                                             AS flag_compliant,
      FALSE                                                           AS account_cluster,
      FALSE                                                           AS sku_or_vendor_match,
      (v_item_group_code IS NOT NULL
       AND l.group_code IS NOT NULL
       AND l.group_code = v_item_group_code)                          AS group_match,
      (c.available_cuft - v_required_volume)                          AS leftover_cuft,
      TRUE                                                            AS overflow
    FROM public.locations l
    JOIN public.location_capacity_cache c ON c.location_id = l.id
    LEFT JOIN loc_flag_match_overflow lfmo ON lfmo.loc_id = l.id
    WHERE l.warehouse_id = p_warehouse_id
      AND l.capacity_cuft IS NOT NULL
      AND l.deleted_at IS NULL
    ORDER BY
      c.available_cuft DESC,
      l.id ASC
    LIMIT 3;
  END IF;
END;
$$;

-- Re-grant execute (function was replaced)
GRANT EXECUTE ON FUNCTION public.rpc_get_location_suggestions(UUID, UUID, TEXT, UUID, UUID[]) TO authenticated;
