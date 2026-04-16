
-- MIGRATION 1 of 5: Location Capacity & Suggestion Engine

-- SECTION A: ALTER locations — add 4 NEW NULLABLE columns
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

-- SECTION B: CREATE location_capacity_cache TABLE + RLS
CREATE TABLE IF NOT EXISTS public.location_capacity_cache (
  location_id   UUID PRIMARY KEY REFERENCES public.locations(id) ON DELETE CASCADE,
  used_cuft     NUMERIC NOT NULL DEFAULT 0,
  available_cuft NUMERIC NOT NULL DEFAULT 0,
  utilization_pct NUMERIC NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.location_capacity_cache ENABLE ROW LEVEL SECURITY;

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

-- SECTION C: trg_locations_capacity_calc
CREATE OR REPLACE FUNCTION public.trg_locations_capacity_calc()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.length_in IS NULL OR NEW.width_in IS NULL OR NEW.usable_height_in IS NULL THEN
    NEW.capacity_cuft := NULL;
  ELSE
    NEW.capacity_cuft := (NEW.length_in * NEW.width_in * NEW.usable_height_in) / 1728.0;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_locations_capacity ON public.locations;
CREATE TRIGGER trg_locations_capacity
  BEFORE INSERT OR UPDATE ON public.locations
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_locations_capacity_calc();

-- SECTION D: fn_update_location_capacity_cache
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
  IF TG_OP = 'INSERT' THEN
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

  ELSIF TG_OP = 'DELETE' THEN
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
    IF OLD.location_id IS DISTINCT FROM NEW.location_id THEN
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

  RETURN NULL;
END;
$$;

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

-- SECTION E: fn_apply_location_capacity_deltas
CREATE OR REPLACE FUNCTION public.fn_apply_location_capacity_deltas(
  p_tenant_id UUID,
  p_deltas    JSONB
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT := 0;
BEGIN
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

  PERFORM 1
  FROM public.location_capacity_cache c
  WHERE c.location_id IN (
    SELECT (d->>'location_id')::UUID FROM jsonb_array_elements(p_deltas) d
  )
  FOR UPDATE;

  INSERT INTO public.location_capacity_cache (location_id, used_cuft, available_cuft, utilization_pct, updated_at)
  SELECT
    dd.location_id,
    0,
    l.capacity_cuft,
    0,
    now()
  FROM jsonb_to_recordset(p_deltas) AS dd(location_id UUID, delta_used_cuft NUMERIC)
  JOIN public.locations l ON l.id = dd.location_id
  WHERE l.capacity_cuft IS NOT NULL
  ON CONFLICT (location_id) DO NOTHING;

  UPDATE public.location_capacity_cache c
  SET
    used_cuft  = GREATEST(c.used_cuft + dd.delta_used_cuft, 0),
    updated_at = now()
  FROM (
    SELECT d.location_id, d.delta_used_cuft
    FROM jsonb_to_recordset(p_deltas) AS d(location_id UUID, delta_used_cuft NUMERIC)
  ) dd
  WHERE c.location_id = dd.location_id;

  UPDATE public.location_capacity_cache c
  SET
    available_cuft  = GREATEST(l.capacity_cuft - c.used_cuft, 0),
    utilization_pct = LEAST(c.used_cuft / NULLIF(l.capacity_cuft, 0), 1.0)
  FROM public.locations l
  WHERE c.location_id = l.id
    AND c.location_id IN (
      SELECT (d->>'location_id')::UUID FROM jsonb_array_elements(p_deltas) d
    );

  SELECT count(DISTINCT (d->>'location_id')::UUID) INTO v_count
  FROM jsonb_array_elements(p_deltas) d
  WHERE (d->>'location_id')::UUID IN (SELECT location_id FROM public.location_capacity_cache);

  RETURN v_count;
END;
$$;

-- SECTION F: fn_backfill_location_capacity_cache
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

-- SECTION G: fn_reconcile_location_capacity
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

-- SECTION H: rpc_get_location_suggestions
CREATE OR REPLACE FUNCTION public.rpc_get_location_suggestions(
  p_tenant_id    UUID,
  p_warehouse_id UUID,
  p_mode         TEXT,
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
  IF public.user_tenant_id() IS DISTINCT FROM p_tenant_id THEN
    RAISE EXCEPTION 'TENANT_MISMATCH: Caller tenant does not match p_tenant_id';
  END IF;

  IF NOT public.user_has_warehouse_access(auth.uid(), p_warehouse_id) THEN
    RAISE EXCEPTION 'ACCESS_DENIED: User does not have access to warehouse %', p_warehouse_id;
  END IF;

  IF p_mode NOT IN ('single', 'batch') THEN
    RAISE EXCEPTION 'INVALID_MODE: mode must be single or batch, got %', p_mode;
  END IF;

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

    SELECT i.account_id, i.item_code, i.vendor
    INTO v_item_account_id, v_item_code, v_item_vendor
    FROM public.items i
    WHERE i.id = p_item_ids[1]
      AND i.tenant_id = p_tenant_id;
  END IF;

  SELECT count(*) INTO v_eligible_count
  FROM public.locations l
  JOIN public.location_capacity_cache c ON c.location_id = l.id
  WHERE l.warehouse_id = p_warehouse_id
    AND l.capacity_cuft IS NOT NULL
    AND l.deleted_at IS NULL
    AND c.utilization_pct < 0.90;

  IF v_eligible_count > 0 THEN
    RETURN QUERY
    WITH account_volume AS (
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
      l.id AS location_id,
      l.code AS location_code,
      l.capacity_cuft,
      c.used_cuft,
      c.available_cuft,
      c.utilization_pct,
      TRUE AS flag_compliant,
      COALESCE(av.acct_vol >= 35, FALSE) AS account_cluster,
      (svm.loc_id IS NOT NULL) AS sku_or_vendor_match,
      FALSE AS group_match,
      (c.available_cuft - v_required_volume) AS leftover_cuft,
      FALSE AS overflow
    FROM public.locations l
    JOIN public.location_capacity_cache c ON c.location_id = l.id
    LEFT JOIN account_volume av ON av.loc_id = l.id
    LEFT JOIN sku_vendor_match svm ON svm.loc_id = l.id
    WHERE l.warehouse_id = p_warehouse_id
      AND l.capacity_cuft IS NOT NULL
      AND l.deleted_at IS NULL
      AND c.utilization_pct < 0.90
    ORDER BY
      TRUE DESC,
      COALESCE(av.acct_vol >= 35, FALSE) DESC,
      (svm.loc_id IS NOT NULL) DESC,
      FALSE ASC,
      (c.available_cuft - v_required_volume) ASC,
      c.available_cuft DESC,
      l.id ASC
    LIMIT 3;
  ELSE
    RETURN QUERY
    SELECT
      l.id AS location_id,
      l.code AS location_code,
      l.capacity_cuft,
      c.used_cuft,
      c.available_cuft,
      c.utilization_pct,
      TRUE AS flag_compliant,
      FALSE AS account_cluster,
      FALSE AS sku_or_vendor_match,
      FALSE AS group_match,
      (c.available_cuft - v_required_volume) AS leftover_cuft,
      TRUE AS overflow
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

-- SECTION I: INDEXES
CREATE INDEX IF NOT EXISTS idx_items_location
  ON public.items(location_id);

CREATE INDEX IF NOT EXISTS idx_items_tenant_location
  ON public.items(tenant_id, location_id);

CREATE INDEX IF NOT EXISTS idx_locations_warehouse
  ON public.locations(warehouse_id);

CREATE INDEX IF NOT EXISTS idx_capacity_cache_utilization
  ON public.location_capacity_cache(utilization_pct);

-- SECTION J: GRANTS
GRANT EXECUTE ON FUNCTION public.trg_locations_capacity_calc() TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_update_location_capacity_cache() TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_apply_location_capacity_deltas(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_backfill_location_capacity_cache(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_reconcile_location_capacity(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_get_location_suggestions(UUID, UUID, TEXT, UUID, UUID[]) TO authenticated;
