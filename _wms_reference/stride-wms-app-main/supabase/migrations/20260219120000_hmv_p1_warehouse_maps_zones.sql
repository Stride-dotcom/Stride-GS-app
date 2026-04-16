-- =============================================================================
-- HMV-P1 (Heat Map & Visualization — Phase 1)
-- Warehouse Maps + Zones foundation
-- =============================================================================
-- Adds:
-- - public.warehouse_zones
-- - public.warehouse_maps
-- - public.warehouse_map_nodes
-- - public.locations.zone_id (FK -> warehouse_zones)
-- - RPC: public.rpc_get_warehouse_map_zone_capacity(p_map_id uuid)
--
-- Notes:
-- - Zone-level notification alerts are intentionally out of scope (DL-2026-02-18-010).
-- - Heat Map Viewer renders the warehouse Default Map (DL-2026-02-18-011); first map auto-default is handled in app logic (DL-2026-02-18-012).
-- - Capacity math is derived from existing location capacity primitives (inventory_units + containers) to match rpc_get_location_capacity.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) warehouse_zones
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.warehouse_zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  zone_code TEXT NOT NULL,
  description TEXT NULL,
  sort_order INTEGER NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NULL REFERENCES public.users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID NULL REFERENCES public.users(id)
);

ALTER TABLE IF EXISTS public.warehouse_zones
  ADD COLUMN IF NOT EXISTS tenant_id UUID,
  ADD COLUMN IF NOT EXISTS warehouse_id UUID,
  ADD COLUMN IF NOT EXISTS zone_code TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS sort_order INTEGER,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_by UUID,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_by UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_warehouse_zones_tenant_wh_code
  ON public.warehouse_zones (tenant_id, warehouse_id, zone_code);
CREATE INDEX IF NOT EXISTS idx_warehouse_zones_warehouse
  ON public.warehouse_zones (warehouse_id);

ALTER TABLE public.warehouse_zones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "warehouse_zones_tenant_isolation" ON public.warehouse_zones;
CREATE POLICY "warehouse_zones_tenant_isolation"
  ON public.warehouse_zones
  FOR ALL
  USING (tenant_id = public.user_tenant_id())
  WITH CHECK (tenant_id = public.user_tenant_id());

GRANT ALL ON TABLE public.warehouse_zones TO authenticated;

DROP TRIGGER IF EXISTS trg_warehouse_zones_updated_at ON public.warehouse_zones;
CREATE TRIGGER trg_warehouse_zones_updated_at
  BEFORE UPDATE ON public.warehouse_zones
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2) locations.zone_id (FK -> warehouse_zones)
-- -----------------------------------------------------------------------------

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'locations'
      AND column_name = 'zone_id'
  ) THEN
    ALTER TABLE public.locations
      ADD COLUMN zone_id UUID NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints tc
    WHERE tc.constraint_schema = 'public'
      AND tc.table_name = 'locations'
      AND tc.constraint_type = 'FOREIGN KEY'
      AND tc.constraint_name = 'locations_zone_id_fkey'
  ) THEN
    ALTER TABLE public.locations
      ADD CONSTRAINT locations_zone_id_fkey
      FOREIGN KEY (zone_id) REFERENCES public.warehouse_zones(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_locations_zone_id ON public.locations(zone_id);

-- -----------------------------------------------------------------------------
-- 3) warehouse_maps
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.warehouse_maps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  width INTEGER NOT NULL DEFAULT 2000,
  height INTEGER NOT NULL DEFAULT 1200,
  grid_size INTEGER NOT NULL DEFAULT 20,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NULL REFERENCES public.users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID NULL REFERENCES public.users(id)
);

ALTER TABLE IF EXISTS public.warehouse_maps
  ADD COLUMN IF NOT EXISTS tenant_id UUID,
  ADD COLUMN IF NOT EXISTS warehouse_id UUID,
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS width INTEGER,
  ADD COLUMN IF NOT EXISTS height INTEGER,
  ADD COLUMN IF NOT EXISTS grid_size INTEGER,
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_by UUID,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_by UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_warehouse_maps_tenant_wh_name
  ON public.warehouse_maps (tenant_id, warehouse_id, name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_warehouse_maps_one_default_per_wh
  ON public.warehouse_maps (tenant_id, warehouse_id)
  WHERE is_default = true;
CREATE INDEX IF NOT EXISTS idx_warehouse_maps_warehouse
  ON public.warehouse_maps (warehouse_id);

ALTER TABLE public.warehouse_maps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "warehouse_maps_tenant_isolation" ON public.warehouse_maps;
CREATE POLICY "warehouse_maps_tenant_isolation"
  ON public.warehouse_maps
  FOR ALL
  USING (tenant_id = public.user_tenant_id())
  WITH CHECK (tenant_id = public.user_tenant_id());

GRANT ALL ON TABLE public.warehouse_maps TO authenticated;

DROP TRIGGER IF EXISTS trg_warehouse_maps_updated_at ON public.warehouse_maps;
CREATE TRIGGER trg_warehouse_maps_updated_at
  BEFORE UPDATE ON public.warehouse_maps
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 4) warehouse_map_nodes
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.warehouse_map_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_map_id UUID NOT NULL REFERENCES public.warehouse_maps(id) ON DELETE CASCADE,
  zone_id UUID NULL REFERENCES public.warehouse_zones(id) ON DELETE SET NULL,
  x INTEGER NOT NULL DEFAULT 0,
  y INTEGER NOT NULL DEFAULT 0,
  width INTEGER NOT NULL DEFAULT 100,
  height INTEGER NOT NULL DEFAULT 100,
  label TEXT NULL,
  sort_order INTEGER NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NULL REFERENCES public.users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID NULL REFERENCES public.users(id)
);

ALTER TABLE IF EXISTS public.warehouse_map_nodes
  ADD COLUMN IF NOT EXISTS warehouse_map_id UUID,
  ADD COLUMN IF NOT EXISTS zone_id UUID,
  ADD COLUMN IF NOT EXISTS x INTEGER,
  ADD COLUMN IF NOT EXISTS y INTEGER,
  ADD COLUMN IF NOT EXISTS width INTEGER,
  ADD COLUMN IF NOT EXISTS height INTEGER,
  ADD COLUMN IF NOT EXISTS label TEXT,
  ADD COLUMN IF NOT EXISTS sort_order INTEGER,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_by UUID,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_by UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_warehouse_map_nodes_map_zone_unique
  ON public.warehouse_map_nodes (warehouse_map_id, zone_id)
  WHERE zone_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_warehouse_map_nodes_map
  ON public.warehouse_map_nodes (warehouse_map_id);

ALTER TABLE public.warehouse_map_nodes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "warehouse_map_nodes_tenant_select" ON public.warehouse_map_nodes;
CREATE POLICY "warehouse_map_nodes_tenant_select"
  ON public.warehouse_map_nodes
  FOR SELECT
  USING (
    warehouse_map_id IN (
      SELECT wm.id
      FROM public.warehouse_maps wm
      WHERE wm.tenant_id = public.user_tenant_id()
    )
  );

DROP POLICY IF EXISTS "warehouse_map_nodes_tenant_modify" ON public.warehouse_map_nodes;
CREATE POLICY "warehouse_map_nodes_tenant_modify"
  ON public.warehouse_map_nodes
  FOR ALL
  USING (
    warehouse_map_id IN (
      SELECT wm.id
      FROM public.warehouse_maps wm
      WHERE wm.tenant_id = public.user_tenant_id()
    )
  )
  WITH CHECK (
    warehouse_map_id IN (
      SELECT wm.id
      FROM public.warehouse_maps wm
      WHERE wm.tenant_id = public.user_tenant_id()
    )
  );

GRANT ALL ON TABLE public.warehouse_map_nodes TO authenticated;

DROP TRIGGER IF EXISTS trg_warehouse_map_nodes_updated_at ON public.warehouse_map_nodes;
CREATE TRIGGER trg_warehouse_map_nodes_updated_at
  BEFORE UPDATE ON public.warehouse_map_nodes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 5) RPC: rpc_get_warehouse_map_zone_capacity(p_map_id uuid)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rpc_get_warehouse_map_zone_capacity(
  p_map_id UUID
)
RETURNS TABLE (
  zone_id UUID,
  zone_code TEXT,
  zone_description TEXT,
  node_id UUID,
  node_label TEXT,
  x INTEGER,
  y INTEGER,
  width INTEGER,
  height INTEGER,
  used_cu_ft NUMERIC,
  capacity_cu_ft NUMERIC,
  free_cu_ft NUMERIC,
  utilization_pct NUMERIC,
  state TEXT,
  location_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_warehouse_id UUID;
  v_space_tracking TEXT;
  v_volume_mode TEXT;
BEGIN
  v_tenant_id := public.user_tenant_id();

  SELECT wm.warehouse_id
  INTO v_warehouse_id
  FROM public.warehouse_maps wm
  WHERE wm.id = p_map_id
    AND wm.tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TENANT_MISMATCH_OR_NOT_FOUND';
  END IF;

  IF NOT public.user_has_warehouse_access(auth.uid(), v_warehouse_id) THEN
    RAISE EXCEPTION 'ACCESS_DENIED: User does not have access to warehouse %', v_warehouse_id;
  END IF;

  -- Keep math aligned with rpc_get_location_capacity by using the same preference keys.
  SELECT COALESCE(setting_value::TEXT, '"none"')
  INTO v_space_tracking
  FROM public.tenant_settings
  WHERE tenant_id = v_tenant_id AND setting_key = 'space_tracking_mode';
  v_space_tracking := TRIM(BOTH '"' FROM COALESCE(v_space_tracking, 'none'));

  SELECT COALESCE(setting_value::TEXT, '"bounded_footprint"')
  INTO v_volume_mode
  FROM public.tenant_settings
  WHERE tenant_id = v_tenant_id AND setting_key = 'container_volume_mode';
  v_volume_mode := TRIM(BOTH '"' FROM COALESCE(v_volume_mode, 'bounded_footprint'));

  RETURN QUERY
  WITH
    map_nodes AS (
      SELECT
        n.id AS node_id,
        n.zone_id,
        n.label AS node_label,
        n.x,
        n.y,
        n.width,
        n.height
      FROM public.warehouse_map_nodes n
      WHERE n.warehouse_map_id = p_map_id
    ),
    zone_locs AS (
      SELECT
        l.id AS location_id,
        l.zone_id,
        COALESCE(l.capacity_cu_ft, l.capacity_cuft, 0) AS capacity_cu_ft
      FROM public.locations l
      WHERE l.warehouse_id = v_warehouse_id
        AND l.deleted_at IS NULL
        AND l.zone_id IS NOT NULL
    ),
    -- units-only: sum all unit volumes per location
    used_units_only AS (
      SELECT
        iu.location_id,
        COALESCE(SUM(COALESCE(iu.unit_cu_ft, 0)), 0) AS used_cu_ft
      FROM public.inventory_units iu
      WHERE iu.tenant_id = v_tenant_id
      GROUP BY iu.location_id
    ),
    -- bounded_footprint: per-container used = max(footprint, contents)
    container_contents AS (
      SELECT
        iu.container_id,
        COALESCE(SUM(COALESCE(iu.unit_cu_ft, 0)), 0) AS contents_cu_ft
      FROM public.inventory_units iu
      WHERE iu.tenant_id = v_tenant_id
        AND iu.container_id IS NOT NULL
      GROUP BY iu.container_id
    ),
    container_used AS (
      SELECT
        c.location_id,
        CASE
          WHEN COALESCE(c.footprint_cu_ft, 0) > 0
            THEN GREATEST(COALESCE(c.footprint_cu_ft, 0), COALESCE(cc.contents_cu_ft, 0))
          ELSE COALESCE(cc.contents_cu_ft, 0)
        END AS used_cu_ft
      FROM public.containers c
      LEFT JOIN container_contents cc ON cc.container_id = c.id
      WHERE c.tenant_id = v_tenant_id
        AND c.location_id IS NOT NULL
    ),
    location_container_used AS (
      SELECT
        cu.location_id,
        COALESCE(SUM(cu.used_cu_ft), 0) AS used_cu_ft
      FROM container_used cu
      GROUP BY cu.location_id
    ),
    location_uncontained_used AS (
      SELECT
        iu.location_id,
        COALESCE(SUM(COALESCE(iu.unit_cu_ft, 0)), 0) AS used_cu_ft
      FROM public.inventory_units iu
      WHERE iu.tenant_id = v_tenant_id
        AND iu.container_id IS NULL
      GROUP BY iu.location_id
    ),
    used_bounded_footprint AS (
      SELECT
        l.id AS location_id,
        COALESCE(lcu.used_cu_ft, 0) + COALESCE(luu.used_cu_ft, 0) AS used_cu_ft
      FROM public.locations l
      LEFT JOIN location_container_used lcu ON lcu.location_id = l.id
      LEFT JOIN location_uncontained_used luu ON luu.location_id = l.id
      WHERE l.warehouse_id = v_warehouse_id
        AND l.deleted_at IS NULL
    ),
    used_by_location AS (
      SELECT
        zl.location_id,
        zl.zone_id,
        zl.capacity_cu_ft,
        CASE
          WHEN v_space_tracking = 'none' THEN NULL
          WHEN v_volume_mode = 'units_only' THEN COALESCE(uuo.used_cu_ft, 0)
          ELSE COALESCE(ubf.used_cu_ft, 0)
        END AS used_cu_ft
      FROM zone_locs zl
      LEFT JOIN used_units_only uuo ON uuo.location_id = zl.location_id
      LEFT JOIN used_bounded_footprint ubf ON ubf.location_id = zl.location_id
    )
  SELECT
    z.id AS zone_id,
    z.zone_code,
    z.description AS zone_description,
    mn.node_id,
    mn.node_label,
    mn.x,
    mn.y,
    mn.width,
    mn.height,
    CASE
      WHEN v_space_tracking = 'none' THEN NULL
      ELSE COALESCE(SUM(ubl.used_cu_ft), 0)
    END AS used_cu_ft,
    COALESCE(SUM(ubl.capacity_cu_ft), 0) AS capacity_cu_ft,
    CASE
      WHEN v_space_tracking = 'none' THEN NULL
      ELSE GREATEST(COALESCE(SUM(ubl.capacity_cu_ft), 0) - COALESCE(SUM(ubl.used_cu_ft), 0), 0)
    END AS free_cu_ft,
    CASE
      WHEN v_space_tracking = 'none' THEN NULL
      WHEN COALESCE(SUM(ubl.capacity_cu_ft), 0) > 0
        THEN ROUND((COALESCE(SUM(ubl.used_cu_ft), 0) / NULLIF(COALESCE(SUM(ubl.capacity_cu_ft), 0), 0)) * 100, 2)
      ELSE NULL
    END AS utilization_pct,
    CASE
      WHEN v_space_tracking = 'none' THEN 'NO_TRACKING'
      WHEN COALESCE(SUM(ubl.capacity_cu_ft), 0) <= 0 THEN 'NO_CAPACITY'
      WHEN ((COALESCE(SUM(ubl.used_cu_ft), 0) / NULLIF(COALESCE(SUM(ubl.capacity_cu_ft), 0), 0)) * 100) >= 100 THEN 'CRITICAL'
      WHEN ((COALESCE(SUM(ubl.used_cu_ft), 0) / NULLIF(COALESCE(SUM(ubl.capacity_cu_ft), 0), 0)) * 100) >= 80 THEN 'WARNING'
      ELSE 'NORMAL'
    END AS state,
    COALESCE(COUNT(ubl.location_id), 0)::INTEGER AS location_count
  FROM map_nodes mn
  LEFT JOIN public.warehouse_zones z
    ON z.id = mn.zone_id
   AND z.tenant_id = v_tenant_id
   AND z.warehouse_id = v_warehouse_id
  LEFT JOIN used_by_location ubl
    ON ubl.zone_id = z.id
  GROUP BY
    z.id, z.zone_code, z.description,
    mn.node_id, mn.node_label,
    mn.x, mn.y, mn.width, mn.height
  ORDER BY
    z.zone_code NULLS LAST,
    mn.node_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_get_warehouse_map_zone_capacity(UUID) TO authenticated;

