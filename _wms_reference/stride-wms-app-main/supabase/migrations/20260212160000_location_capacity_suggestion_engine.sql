-- =============================================================================
-- LOCATION CAPACITY & SUGGESTION ENGINE — DB-ONLY MIGRATION
-- NVPC Revision v4
--
-- Creates: location dimension columns, location_capacity_cache table,
--          trigger functions, delta function, backfill, reconciliation, RPC
--
-- ADDITIVE ONLY — no existing columns/types/triggers/RLS modified or removed.
-- BILLING PARITY: NO billing objects touched.
--
-- PRE-FLIGHT DISCOVERY SUMMARY (PF1–PF7):
--   PF1: locations ✓, items ✓, warehouses ✓, warehouse_permissions ✓
--   PF2: locations.id/tenant_id/warehouse_id ✓
--         items.id/tenant_id/location_id ✓
--         items.cubic_ft NOT FOUND → using items.size (NUMERIC, nullable) as equivalent
--         items.account_id ✓
--   PF3: items.sku NOT FOUND → using items.item_code as equivalent
--         items.vendor ✓
--   PF4: locations.group_code NOT FOUND → group_match = FALSE always
--   PF5: RLS enabled on locations (via warehouse_id) and items (via tenant_id).
--         Functions use SECURITY DEFINER for RLS bypass.
--   PF6: pricing_flags + item_flags exist. NO location capability flags.
--         → flag_compliant = TRUE for all locations (no-op path).
--   PF7: user_has_warehouse_access(p_user_id, p_warehouse_id) ✓
--         user_tenant_id() ✓
--
-- CONCURRENCY STRATEGY (Section D2, Option B):
--   Row-level locking via SELECT ... FOR UPDATE on cache rows in both
--   the per-row trigger function and the batch delta function.
--   This prevents concurrent cache corruption.
--
-- ASSUMPTIONS:
--   A1: items.size represents cubic feet volume (the only numeric volume column).
--   A2: items.item_code serves as the SKU equivalent for sku_match.
--   A3: locations does NOT have tenant_id. Tenant scoping goes through
--       warehouses (locations.warehouse_id → warehouses.tenant_id).
--   A4: pg_cron extension is available (enabled in migration 20260119202512).
-- =============================================================================


-- ============================================================
-- SECTION A: ALTER locations — add 4 NEW NULLABLE columns
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'locations' AND column_name = 'length_in'
  ) THEN
    ALTER TABLE public.locations ADD COLUMN length_in INTEGER NULL CHECK (length_in > 0);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'locations' AND column_name = 'width_in'
  ) THEN
    ALTER TABLE public.locations ADD COLUMN width_in INTEGER NULL CHECK (width_in > 0);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'locations' AND column_name = 'usable_height_in'
  ) THEN
    ALTER TABLE public.locations ADD COLUMN usable_height_in INTEGER NULL CHECK (usable_height_in > 0);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'locations' AND column_name = 'capacity_cuft'
  ) THEN
    ALTER TABLE public.locations ADD COLUMN capacity_cuft NUMERIC NULL;
  END IF;
END $$;


-- ============================================================
-- SECTION B: CREATE location_capacity_cache TABLE + RLS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.location_capacity_cache (
  location_id   UUID PRIMARY KEY REFERENCES public.locations(id) ON DELETE CASCADE,
  used_cuft     NUMERIC NOT NULL DEFAULT 0,
  available_cuft NUMERIC NOT NULL DEFAULT 0,
  utilization_pct NUMERIC NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS on new cache table
ALTER TABLE public.location_capacity_cache ENABLE ROW LEVEL SECURITY;

-- RLS policy: tenants can only SELECT cache rows for their locations.
-- locations does not have tenant_id; scope via warehouses.tenant_id.
DROP POLICY IF EXISTS "location_capacity_cache_tenant_select" ON public.location_capacity_cache;
CREATE POLICY "location_capacity_cache_tenant_select"
  ON public.location_capacity_cache
  FOR SELECT
  USING (
    location_id IN (
      SELECT l.id FROM public.locations l
      JOIN public.warehouses w ON l.warehouse_id = w.id
      WHERE w.tenant_id = public.user_tenant_id()
    )
  );

-- RLS policy: tenants can only INSERT/UPDATE/DELETE cache rows for their locations
DROP POLICY IF EXISTS "location_capacity_cache_tenant_modify" ON public.location_capacity_cache;
CREATE POLICY "location_capacity_cache_tenant_modify"
  ON public.location_capacity_cache
  FOR ALL
  USING (
    location_id IN (
      SELECT l.id FROM public.locations l
      JOIN public.warehouses w ON l.warehouse_id = w.id
      WHERE w.tenant_id = public.user_tenant_id()
    )
  )
  WITH CHECK (
    location_id IN (
      SELECT l.id FROM public.locations l
      JOIN public.warehouses w ON l.warehouse_id = w.id
      WHERE w.tenant_id = public.user_tenant_id()
    )
  );


-- ============================================================
-- SECTION C: trg_locations_capacity_calc — trigger on locations
-- Computes capacity_cuft from dimensions. Does NOT edit existing triggers.
-- ============================================================

CREATE OR REPLACE FUNCTION public.trg_locations_capacity_calc()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.length_in IS NULL OR NEW.width_in IS NULL OR NEW.usable_height_in IS NULL THEN
    NEW.capacity_cuft := NULL;
  ELSE
    -- LOCKED formula: no rounding, no buffer, no stacking adjustments
    NEW.capacity_cuft := (NEW.length_in * NEW.width_in * NEW.usable_height_in) / 1728.0;
  END IF;
  RETURN NEW;
END;
$$;

-- NEW trigger alongside any existing triggers on locations
DROP TRIGGER IF EXISTS trg_locations_capacity ON public.locations;
CREATE TRIGGER trg_locations_capacity
  BEFORE INSERT OR UPDATE ON public.locations
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_locations_capacity_calc();


-- ============================================================
-- SECTION D: fn_update_location_capacity_cache — trigger on items
-- Handles INSERT/DELETE/UPDATE (location_id change or size change)
-- Uses items.size as cubic_ft equivalent (Assumption A1).
-- Concurrency: Row-level locking via SELECT ... FOR UPDATE (Option B).
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_update_location_capacity_cache()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_loc_id        UUID;
  v_cap           NUMERIC;
  v_new_used      NUMERIC;
BEGIN
  -- -------------------------------------------------------
  -- Helper: apply a delta to a single location's cache row.
  -- Upserts the row and clamps values.
  -- Row-level lock on cache row prevents concurrent corruption.
  -- If location.capacity_cuft IS NULL, delete the cache row.
  -- -------------------------------------------------------

  IF TG_OP = 'INSERT' THEN
    -- New item received/created: add its volume to NEW.location_id
    IF NEW.location_id IS NOT NULL THEN
      -- Lock the cache row if it exists
      PERFORM 1 FROM public.location_capacity_cache
        WHERE location_id = NEW.location_id FOR UPDATE;

      SELECT capacity_cuft INTO v_cap
        FROM public.locations WHERE id = NEW.location_id;

      IF v_cap IS NULL THEN
        -- No measured capacity; delete cache row if present
        DELETE FROM public.location_capacity_cache WHERE location_id = NEW.location_id;
      ELSE
        INSERT INTO public.location_capacity_cache (location_id, used_cuft, available_cuft, utilization_pct, updated_at)
        VALUES (
          NEW.location_id,
          COALESCE(NEW.size, 0),
          GREATEST(v_cap - COALESCE(NEW.size, 0), 0),
          LEAST(COALESCE(NEW.size, 0) / NULLIF(v_cap, 0), 1.0),
          now()
        )
        ON CONFLICT (location_id) DO UPDATE SET
          used_cuft       = location_capacity_cache.used_cuft + COALESCE(NEW.size, 0),
          available_cuft  = GREATEST(v_cap - (location_capacity_cache.used_cuft + COALESCE(NEW.size, 0)), 0),
          utilization_pct = LEAST((location_capacity_cache.used_cuft + COALESCE(NEW.size, 0)) / NULLIF(v_cap, 0), 1.0),
          updated_at      = now();
      END IF;
    END IF;

  ELSIF TG_OP = 'DELETE' THEN
    -- Item removed/disposed: subtract its volume from OLD.location_id
    IF OLD.location_id IS NOT NULL THEN
      PERFORM 1 FROM public.location_capacity_cache
        WHERE location_id = OLD.location_id FOR UPDATE;

      SELECT capacity_cuft INTO v_cap
        FROM public.locations WHERE id = OLD.location_id;

      IF v_cap IS NULL THEN
        DELETE FROM public.location_capacity_cache WHERE location_id = OLD.location_id;
      ELSE
        v_new_used := GREATEST(
          COALESCE((SELECT used_cuft FROM public.location_capacity_cache WHERE location_id = OLD.location_id), 0)
          - COALESCE(OLD.size, 0),
          0
        );

        INSERT INTO public.location_capacity_cache (location_id, used_cuft, available_cuft, utilization_pct, updated_at)
        VALUES (
          OLD.location_id,
          v_new_used,
          GREATEST(v_cap - v_new_used, 0),
          LEAST(v_new_used / NULLIF(v_cap, 0), 1.0),
          now()
        )
        ON CONFLICT (location_id) DO UPDATE SET
          used_cuft       = v_new_used,
          available_cuft  = GREATEST(v_cap - v_new_used, 0),
          utilization_pct = LEAST(v_new_used / NULLIF(v_cap, 0), 1.0),
          updated_at      = now();
      END IF;
    END IF;

  ELSIF TG_OP = 'UPDATE' THEN
    -- CASE 1: location changed
    IF OLD.location_id IS DISTINCT FROM NEW.location_id THEN

      -- Decrement old location
      IF OLD.location_id IS NOT NULL THEN
        PERFORM 1 FROM public.location_capacity_cache
          WHERE location_id = OLD.location_id FOR UPDATE;

        SELECT capacity_cuft INTO v_cap
          FROM public.locations WHERE id = OLD.location_id;

        IF v_cap IS NULL THEN
          DELETE FROM public.location_capacity_cache WHERE location_id = OLD.location_id;
        ELSE
          v_new_used := GREATEST(
            COALESCE((SELECT used_cuft FROM public.location_capacity_cache WHERE location_id = OLD.location_id), 0)
            - COALESCE(OLD.size, 0),
            0
          );

          INSERT INTO public.location_capacity_cache (location_id, used_cuft, available_cuft, utilization_pct, updated_at)
          VALUES (
            OLD.location_id,
            v_new_used,
            GREATEST(v_cap - v_new_used, 0),
            LEAST(v_new_used / NULLIF(v_cap, 0), 1.0),
            now()
          )
          ON CONFLICT (location_id) DO UPDATE SET
            used_cuft       = v_new_used,
            available_cuft  = GREATEST(v_cap - v_new_used, 0),
            utilization_pct = LEAST(v_new_used / NULLIF(v_cap, 0), 1.0),
            updated_at      = now();
        END IF;
      END IF;

      -- Increment new location
      IF NEW.location_id IS NOT NULL THEN
        PERFORM 1 FROM public.location_capacity_cache
          WHERE location_id = NEW.location_id FOR UPDATE;

        SELECT capacity_cuft INTO v_cap
          FROM public.locations WHERE id = NEW.location_id;

        IF v_cap IS NULL THEN
          DELETE FROM public.location_capacity_cache WHERE location_id = NEW.location_id;
        ELSE
          INSERT INTO public.location_capacity_cache (location_id, used_cuft, available_cuft, utilization_pct, updated_at)
          VALUES (
            NEW.location_id,
            COALESCE(NEW.size, 0),
            GREATEST(v_cap - COALESCE(NEW.size, 0), 0),
            LEAST(COALESCE(NEW.size, 0) / NULLIF(v_cap, 0), 1.0),
            now()
          )
          ON CONFLICT (location_id) DO UPDATE SET
            used_cuft       = location_capacity_cache.used_cuft + COALESCE(NEW.size, 0),
            available_cuft  = GREATEST(v_cap - (location_capacity_cache.used_cuft + COALESCE(NEW.size, 0)), 0),
            utilization_pct = LEAST((location_capacity_cache.used_cuft + COALESCE(NEW.size, 0)) / NULLIF(v_cap, 0), 1.0),
            updated_at      = now();
        END IF;
      END IF;

    -- CASE 2: same location, size (cubic_ft equivalent) changed
    ELSIF OLD.size IS DISTINCT FROM NEW.size AND NEW.location_id IS NOT NULL THEN
      PERFORM 1 FROM public.location_capacity_cache
        WHERE location_id = NEW.location_id FOR UPDATE;

      SELECT capacity_cuft INTO v_cap
        FROM public.locations WHERE id = NEW.location_id;

      IF v_cap IS NULL THEN
        DELETE FROM public.location_capacity_cache WHERE location_id = NEW.location_id;
      ELSE
        DECLARE
          v_delta NUMERIC := COALESCE(NEW.size, 0) - COALESCE(OLD.size, 0);
        BEGIN
          v_new_used := GREATEST(
            COALESCE((SELECT used_cuft FROM public.location_capacity_cache WHERE location_id = NEW.location_id), 0)
            + v_delta,
            0
          );

          INSERT INTO public.location_capacity_cache (location_id, used_cuft, available_cuft, utilization_pct, updated_at)
          VALUES (
            NEW.location_id,
            v_new_used,
            GREATEST(v_cap - v_new_used, 0),
            LEAST(v_new_used / NULLIF(v_cap, 0), 1.0),
            now()
          )
          ON CONFLICT (location_id) DO UPDATE SET
            used_cuft       = v_new_used,
            available_cuft  = GREATEST(v_cap - v_new_used, 0),
            utilization_pct = LEAST(v_new_used / NULLIF(v_cap, 0), 1.0),
            updated_at      = now();
        END;
      END IF;
    END IF;

  END IF;

  RETURN NULL; -- AFTER trigger, return value is ignored
END;
$$;

-- Triggers on items (NEW, does not replace existing triggers).
-- Split into INSERT/DELETE (always fire) and UPDATE OF (only when relevant columns change).
-- TG_OP is not available in WHEN clause; UPDATE OF restricts to column-level changes.
DROP TRIGGER IF EXISTS trg_update_location_capacity_cache ON public.items;
DROP TRIGGER IF EXISTS trg_capacity_cache_insert ON public.items;
DROP TRIGGER IF EXISTS trg_capacity_cache_delete ON public.items;
DROP TRIGGER IF EXISTS trg_capacity_cache_update ON public.items;

CREATE TRIGGER trg_capacity_cache_insert
  AFTER INSERT ON public.items
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_update_location_capacity_cache();

CREATE TRIGGER trg_capacity_cache_delete
  AFTER DELETE ON public.items
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_update_location_capacity_cache();

CREATE TRIGGER trg_capacity_cache_update
  AFTER UPDATE OF location_id, size ON public.items
  FOR EACH ROW
  WHEN (
    OLD.location_id IS DISTINCT FROM NEW.location_id
    OR OLD.size IS DISTINCT FROM NEW.size
  )
  EXECUTE FUNCTION public.fn_update_location_capacity_cache();


-- ============================================================
-- SECTION E: fn_apply_location_capacity_deltas (REQUIRED)
-- Grouped delta function for batch operations.
-- Concurrency: Row-level locking via SELECT ... FOR UPDATE.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_apply_location_capacity_deltas(
  p_tenant_id UUID,
  p_deltas    JSONB  -- [{"location_id": "...", "delta_used_cuft": <num>}, ...]
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT := 0;
BEGIN
  -- Validate all locations belong to p_tenant_id.
  -- Security gate to prevent cross-tenant cache manipulation.
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_deltas) AS d(location_id UUID, delta_used_cuft NUMERIC)
    WHERE d.location_id NOT IN (
      SELECT l.id FROM public.locations l
      JOIN public.warehouses w ON l.warehouse_id = w.id
      WHERE w.tenant_id = p_tenant_id
    )
  ) THEN
    RAISE EXCEPTION 'TENANT_MISMATCH: One or more locations do not belong to tenant %', p_tenant_id;
  END IF;

  -- Step 1: Lock existing cache rows to prevent concurrent trigger interference.
  -- Consistent with Section D2 (Option B: row-level locking).
  PERFORM 1
  FROM public.location_capacity_cache c
  WHERE c.location_id IN (
    SELECT (d->>'location_id')::UUID FROM jsonb_array_elements(p_deltas) d
  )
  FOR UPDATE;

  -- Step 2: UPSERT cache rows for locations that don't exist yet (first touch).
  -- Initializes with used_cuft = 0 so the delta update in Step 3 works correctly.
  INSERT INTO public.location_capacity_cache (location_id, used_cuft, available_cuft, utilization_pct, updated_at)
  SELECT
    dd.location_id,
    0,  -- Initial used_cuft; delta applied in Step 3
    l.capacity_cuft,  -- Will be recalculated in Step 4
    0,
    now()
  FROM jsonb_to_recordset(p_deltas) AS dd(location_id UUID, delta_used_cuft NUMERIC)
  JOIN public.locations l ON l.id = dd.location_id
  WHERE l.capacity_cuft IS NOT NULL
  ON CONFLICT (location_id) DO NOTHING;

  -- Step 3: SET-BASED delta application (no N+1 loops).
  -- Apply deltas to used_cuft with clamping at zero.
  UPDATE public.location_capacity_cache c
  SET
    used_cuft  = GREATEST(c.used_cuft + dd.delta_used_cuft, 0),
    updated_at = now()
  FROM (
    SELECT d.location_id, d.delta_used_cuft
    FROM jsonb_to_recordset(p_deltas) AS d(location_id UUID, delta_used_cuft NUMERIC)
  ) dd
  WHERE c.location_id = dd.location_id;

  -- Step 4: Recompute available_cuft and utilization_pct from locations.capacity_cuft.
  -- Clamping: available >= 0, utilization <= 1.0.
  UPDATE public.location_capacity_cache c
  SET
    available_cuft  = GREATEST(l.capacity_cuft - c.used_cuft, 0),
    utilization_pct = LEAST(c.used_cuft / NULLIF(l.capacity_cuft, 0), 1.0)
  FROM public.locations l
  WHERE c.location_id = l.id
    AND c.location_id IN (
      SELECT (d->>'location_id')::UUID FROM jsonb_array_elements(p_deltas) d
    );

  -- Return total locations updated
  SELECT count(DISTINCT (d->>'location_id')::UUID) INTO v_count
  FROM jsonb_array_elements(p_deltas) d
  WHERE (d->>'location_id')::UUID IN (SELECT location_id FROM public.location_capacity_cache);

  RETURN v_count;
END;
$$;


-- ============================================================
-- SECTION F: fn_backfill_location_capacity_cache (REQUIRED)
-- Option 1: SECURITY DEFINER function, manual invocation per tenant.
-- Idempotent via ON CONFLICT upsert.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_backfill_location_capacity_cache(
  p_tenant_id    UUID,
  p_warehouse_id UUID DEFAULT NULL
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  -- Backfill cache rows for measured locations (capacity_cuft IS NOT NULL).
  -- Tenant-scoped to avoid RLS and cross-tenant risk.
  -- Idempotent: ON CONFLICT upsert overwrites stale data.
  -- Tenant scoping via warehouses join (locations has no tenant_id).
  WITH location_usage AS (
    SELECT
      l.id AS location_id,
      l.capacity_cuft,
      COALESCE(SUM(COALESCE(i.size, 0)), 0) AS used_cuft
    FROM public.locations l
    JOIN public.warehouses w ON l.warehouse_id = w.id AND w.tenant_id = p_tenant_id
    LEFT JOIN public.items i
      ON i.location_id = l.id
      AND i.tenant_id = p_tenant_id
      AND i.deleted_at IS NULL
    WHERE l.capacity_cuft IS NOT NULL
      AND l.deleted_at IS NULL
      AND (p_warehouse_id IS NULL OR l.warehouse_id = p_warehouse_id)
    GROUP BY l.id, l.capacity_cuft
  )
  INSERT INTO public.location_capacity_cache (location_id, used_cuft, available_cuft, utilization_pct, updated_at)
  SELECT
    lu.location_id,
    lu.used_cuft,
    GREATEST(lu.capacity_cuft - lu.used_cuft, 0),
    LEAST(lu.used_cuft / NULLIF(lu.capacity_cuft, 0), 1.0),
    now()
  FROM location_usage lu
  ON CONFLICT (location_id) DO UPDATE SET
    used_cuft       = EXCLUDED.used_cuft,
    available_cuft  = EXCLUDED.available_cuft,
    utilization_pct = EXCLUDED.utilization_pct,
    updated_at      = EXCLUDED.updated_at;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Also clean up cache rows for locations that lost their capacity measurement
  DELETE FROM public.location_capacity_cache
  WHERE location_id IN (
    SELECT l.id FROM public.locations l
    JOIN public.warehouses w ON l.warehouse_id = w.id AND w.tenant_id = p_tenant_id
    WHERE l.capacity_cuft IS NULL
      AND (p_warehouse_id IS NULL OR l.warehouse_id = p_warehouse_id)
  );

  RETURN v_count;
END;
$$;

-- MANUAL INVOCATION PATTERN (run per tenant after migration):
-- SELECT public.fn_backfill_location_capacity_cache('<tenant_uuid>');
-- SELECT public.fn_backfill_location_capacity_cache('<tenant_uuid>', '<warehouse_uuid>');


-- ============================================================
-- SECTION G: fn_reconcile_location_capacity (REQUIRED)
-- Recomputes used_cuft from base inventory. Tenant + warehouse scoped.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_reconcile_location_capacity(
  p_tenant_id    UUID,
  p_warehouse_id UUID DEFAULT NULL
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_corrected INT := 0;
  v_deleted   INT := 0;
BEGIN
  -- Recompute used_cuft from base inventory (items table).
  -- Scoped to p_tenant_id (via warehouses) and optionally p_warehouse_id.
  WITH location_usage AS (
    SELECT
      l.id AS location_id,
      l.capacity_cuft,
      COALESCE(SUM(COALESCE(i.size, 0)), 0) AS used_cuft
    FROM public.locations l
    JOIN public.warehouses w ON l.warehouse_id = w.id AND w.tenant_id = p_tenant_id
    LEFT JOIN public.items i
      ON i.location_id = l.id
      AND i.tenant_id = p_tenant_id
      AND i.deleted_at IS NULL
    WHERE l.capacity_cuft IS NOT NULL
      AND l.deleted_at IS NULL
      AND (p_warehouse_id IS NULL OR l.warehouse_id = p_warehouse_id)
    GROUP BY l.id, l.capacity_cuft
  )
  INSERT INTO public.location_capacity_cache (location_id, used_cuft, available_cuft, utilization_pct, updated_at)
  SELECT
    lu.location_id,
    lu.used_cuft,
    GREATEST(lu.capacity_cuft - lu.used_cuft, 0),
    LEAST(lu.used_cuft / NULLIF(lu.capacity_cuft, 0), 1.0),
    now()
  FROM location_usage lu
  ON CONFLICT (location_id) DO UPDATE SET
    used_cuft       = EXCLUDED.used_cuft,
    available_cuft  = EXCLUDED.available_cuft,
    utilization_pct = EXCLUDED.utilization_pct,
    updated_at      = EXCLUDED.updated_at;

  GET DIAGNOSTICS v_corrected = ROW_COUNT;

  -- Handle "removed measurements":
  -- If a location has capacity_cuft IS NULL, ensure cache row is removed.
  DELETE FROM public.location_capacity_cache
  WHERE location_id IN (
    SELECT l.id FROM public.locations l
    JOIN public.warehouses w ON l.warehouse_id = w.id AND w.tenant_id = p_tenant_id
    WHERE l.capacity_cuft IS NULL
      AND (p_warehouse_id IS NULL OR l.warehouse_id = p_warehouse_id)
  );

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN v_corrected + v_deleted;
END;
$$;

-- SCHEDULING (pg_cron is available):
-- Uncomment and configure per-tenant nightly reconciliation:
-- SELECT cron.schedule(
--   'reconcile-location-capacity',
--   '0 2 * * *',  -- 2:00 AM daily
--   $$SELECT public.fn_reconcile_location_capacity(t.id)
--     FROM public.tenants t
--     WHERE t.deleted_at IS NULL$$
-- );
--
-- Alternative: app scheduler must call fn_reconcile_location_capacity nightly per tenant.


-- ============================================================
-- SECTION H: rpc_get_location_suggestions (REQUIRED)
-- Returns TOP 3 location suggestions.
-- SECURITY DEFINER to bypass RLS; enforces tenant/warehouse internally.
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
  v_required_volume NUMERIC;
  v_item_account_id UUID;
  v_item_code       TEXT;
  v_item_vendor     TEXT;
  v_eligible_count  INT;
BEGIN
  -- -------------------------------------------------------
  -- PERMISSION VALIDATION (PF7)
  -- -------------------------------------------------------
  IF public.user_tenant_id() IS DISTINCT FROM p_tenant_id THEN
    RAISE EXCEPTION 'TENANT_MISMATCH: Caller tenant does not match p_tenant_id';
  END IF;

  IF NOT public.user_has_warehouse_access(auth.uid(), p_warehouse_id) THEN
    RAISE EXCEPTION 'ACCESS_DENIED: User does not have access to warehouse %', p_warehouse_id;
  END IF;

  -- -------------------------------------------------------
  -- MODE VALIDATION
  -- -------------------------------------------------------
  IF p_mode NOT IN ('single', 'batch') THEN
    RAISE EXCEPTION 'INVALID_MODE: mode must be single or batch, got %', p_mode;
  END IF;

  -- -------------------------------------------------------
  -- COMPUTE REQUIRED VOLUME (LOCKED)
  -- items.size is used as the cubic_ft equivalent (Assumption A1)
  -- -------------------------------------------------------
  IF p_mode = 'single' THEN
    IF p_item_id IS NULL THEN
      RAISE EXCEPTION 'INVALID_INPUT: item_id required for single mode';
    END IF;

    SELECT
      COALESCE(i.size, 0),
      i.account_id,
      i.item_code,
      i.vendor
    INTO v_required_volume, v_item_account_id, v_item_code, v_item_vendor
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

    SELECT
      COALESCE(SUM(COALESCE(i.size, 0)), 0)
    INTO v_required_volume
    FROM public.items i
    WHERE i.id = ANY(p_item_ids)
      AND i.tenant_id = p_tenant_id;

    -- For batch mode, use the first item's account/code/vendor for clustering
    SELECT i.account_id, i.item_code, i.vendor
    INTO v_item_account_id, v_item_code, v_item_vendor
    FROM public.items i
    WHERE i.id = p_item_ids[1]
      AND i.tenant_id = p_tenant_id;
  END IF;

  -- -------------------------------------------------------
  -- CHECK ELIGIBLE LOCATION COUNT
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
    -- Normal path: eligible locations exist
    RETURN QUERY
    WITH account_volume AS (
      -- Pre-aggregate account volume per location (NO N+1)
      -- account_cluster = TRUE if location holds >= 35 cuft from same account
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
    sku_vendor_match AS (
      -- Pre-aggregate sku/vendor matches per location (NO N+1)
      -- items.item_code used as SKU equivalent (Assumption A2)
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
      l.id                                                    AS location_id,
      l.code                                                  AS location_code,
      l.capacity_cuft                                         AS capacity_cuft,
      c.used_cuft                                             AS used_cuft,
      c.available_cuft                                        AS available_cuft,
      c.utilization_pct                                       AS utilization_pct,
      -- flag_compliant: No location capability flags exist (PF6), default TRUE
      TRUE                                                    AS flag_compliant,
      -- account_cluster: >= 35 cuft from same account
      COALESCE(av.acct_vol >= 35, FALSE)                      AS account_cluster,
      -- sku_or_vendor_match
      (svm.loc_id IS NOT NULL)                                AS sku_or_vendor_match,
      -- group_match: No group_code column exists (PF4), default FALSE
      FALSE                                                   AS group_match,
      -- leftover_cuft: best-fit metric
      (c.available_cuft - v_required_volume)                  AS leftover_cuft,
      -- overflow: FALSE for eligible locations
      FALSE                                                   AS overflow
    FROM public.locations l
    JOIN public.location_capacity_cache c ON c.location_id = l.id
    LEFT JOIN account_volume av ON av.loc_id = l.id
    LEFT JOIN sku_vendor_match svm ON svm.loc_id = l.id
    WHERE l.warehouse_id = p_warehouse_id
      AND l.capacity_cuft IS NOT NULL
      AND l.deleted_at IS NULL
      AND c.utilization_pct < 0.90
    ORDER BY
      -- flag_compliant: always TRUE (no location flags framework; PF6). Retained for spec compliance.
      TRUE DESC,
      -- account_cluster: prefer locations with >= 35 cuft from same account
      COALESCE(av.acct_vol >= 35, FALSE) DESC,
      -- sku_or_vendor_match: prefer locations with matching SKU or vendor
      (svm.loc_id IS NOT NULL) DESC,
      -- group_match: always FALSE (no group_code column; PF4). Retained for spec compliance.
      FALSE ASC,
      -- leftover_cuft: smallest positive leftover first (best-fit)
      (c.available_cuft - v_required_volume) ASC,
      -- tiebreak: most available space
      c.available_cuft DESC,
      -- deterministic tiebreak: location UUID
      l.id ASC
    LIMIT 3;

  ELSE
    -- OVERFLOW FALLBACK: no eligible locations meet filters.
    -- Return top 3 by available_cuft DESC with overflow=true.
    RETURN QUERY
    SELECT
      l.id                                                    AS location_id,
      l.code                                                  AS location_code,
      l.capacity_cuft                                         AS capacity_cuft,
      c.used_cuft                                             AS used_cuft,
      c.available_cuft                                        AS available_cuft,
      c.utilization_pct                                       AS utilization_pct,
      TRUE                                                    AS flag_compliant,
      FALSE                                                   AS account_cluster,
      FALSE                                                   AS sku_or_vendor_match,
      FALSE                                                   AS group_match,
      (c.available_cuft - v_required_volume)                  AS leftover_cuft,
      TRUE                                                    AS overflow
    FROM public.locations l
    JOIN public.location_capacity_cache c ON c.location_id = l.id
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


-- ============================================================
-- SECTION I: REQUIRED INDEXES
-- ============================================================

-- 1) For cache trigger lookups on items.location_id
CREATE INDEX IF NOT EXISTS idx_items_location
  ON public.items(location_id);

-- 2) For tenant-scoped aggregations and RPC
CREATE INDEX IF NOT EXISTS idx_items_tenant_location
  ON public.items(tenant_id, location_id);

-- 3) For location filtering by warehouse (locations has no tenant_id; warehouse_id → warehouses.tenant_id)
CREATE INDEX IF NOT EXISTS idx_locations_warehouse
  ON public.locations(warehouse_id);

-- 4) For utilization filtering in RPC
CREATE INDEX IF NOT EXISTS idx_capacity_cache_utilization
  ON public.location_capacity_cache(utilization_pct);


-- ============================================================
-- SECTION J: GRANT EXECUTE on new functions to authenticated
-- ============================================================

GRANT EXECUTE ON FUNCTION public.trg_locations_capacity_calc() TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_update_location_capacity_cache() TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_apply_location_capacity_deltas(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_backfill_location_capacity_cache(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_reconcile_location_capacity(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_get_location_suggestions(UUID, UUID, TEXT, UUID, UUID[]) TO authenticated;
