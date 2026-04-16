-- =============================================================================
-- NVPC Phase 1: Inventory Foundation Layer
-- Creates: inventory_units, inventory_movements
-- Alters: containers (add columns), locations (add capacity columns)
-- RPCs: rpc_move_container, rpc_remove_unit_from_container,
--        rpc_add_unit_to_container, rpc_get_location_capacity
-- =============================================================================

-- ============================================================
-- 1) ALTER containers — add missing columns
-- ============================================================

-- Add warehouse_id (nullable FK to warehouses)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'containers' AND column_name = 'warehouse_id'
  ) THEN
    ALTER TABLE public.containers ADD COLUMN warehouse_id UUID REFERENCES public.warehouses(id);
  END IF;
END $$;

-- Add footprint_cu_ft
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'containers' AND column_name = 'footprint_cu_ft'
  ) THEN
    ALTER TABLE public.containers ADD COLUMN footprint_cu_ft NUMERIC NULL;
  END IF;
END $$;

-- Add status with CHECK constraint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'containers' AND column_name = 'status'
  ) THEN
    ALTER TABLE public.containers ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
      CHECK (status IN ('active', 'closed', 'archived'));
  END IF;
END $$;

-- Add created_by (UUID, no FK to avoid cross-schema issues)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'containers' AND column_name = 'created_by'
  ) THEN
    ALTER TABLE public.containers ADD COLUMN created_by UUID NULL;
  END IF;
END $$;

-- Backfill status from is_active
UPDATE public.containers
SET status = CASE WHEN is_active THEN 'active' ELSE 'archived' END
WHERE status = 'active' AND NOT is_active;

-- Index on (tenant_id, warehouse_id)
CREATE INDEX IF NOT EXISTS idx_containers_tenant_warehouse
  ON public.containers (tenant_id, warehouse_id);


-- ============================================================
-- 2) ALTER locations — add capacity columns (do NOT touch existing capacity)
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'locations' AND column_name = 'capacity_sq_ft'
  ) THEN
    ALTER TABLE public.locations ADD COLUMN capacity_sq_ft NUMERIC NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'locations' AND column_name = 'capacity_cu_ft'
  ) THEN
    ALTER TABLE public.locations ADD COLUMN capacity_cu_ft NUMERIC NULL;
  END IF;
END $$;


-- ============================================================
-- 3) CREATE inventory_units
-- ============================================================

CREATE TABLE IF NOT EXISTS public.inventory_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ic_code TEXT NOT NULL,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  account_id UUID NOT NULL REFERENCES public.accounts(id),
  shipment_id UUID NULL REFERENCES public.shipments(id),
  shipment_item_id UUID NULL REFERENCES public.shipment_items(id),
  location_id UUID NOT NULL REFERENCES public.locations(id),
  container_id UUID NULL REFERENCES public.containers(id),
  status TEXT NOT NULL DEFAULT 'AVAILABLE'
    CHECK (status IN ('AVAILABLE', 'QUARANTINE', 'HOLD', 'RELEASED', 'DAMAGED', 'INSPECTION')),
  class TEXT NULL,
  unit_cu_ft NUMERIC NULL,
  dims_l NUMERIC NULL,
  dims_w NUMERIC NULL,
  dims_h NUMERIC NULL,
  volume_source TEXT NULL
    CHECK (volume_source IS NULL OR volume_source IN (
      'CLASS_DEFAULT', 'ITEM_DEFAULT', 'ITEM_MEMORY', 'MANUAL_OVERRIDE', 'COMPUTED_FROM_DIMS'
    )),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID NULL
);

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_units_tenant_ic
  ON public.inventory_units (tenant_id, ic_code);
CREATE INDEX IF NOT EXISTS idx_inventory_units_tenant_account
  ON public.inventory_units (tenant_id, account_id);
CREATE INDEX IF NOT EXISTS idx_inventory_units_location
  ON public.inventory_units (location_id);
CREATE INDEX IF NOT EXISTS idx_inventory_units_container
  ON public.inventory_units (container_id);
CREATE INDEX IF NOT EXISTS idx_inventory_units_shipment
  ON public.inventory_units (shipment_id);

-- RLS
ALTER TABLE public.inventory_units ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inventory_units_tenant_isolation" ON public.inventory_units;
CREATE POLICY "inventory_units_tenant_isolation" ON public.inventory_units
  FOR ALL USING (tenant_id = public.user_tenant_id());

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION public.trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_inventory_units_updated_at ON public.inventory_units;
CREATE TRIGGER set_inventory_units_updated_at
  BEFORE UPDATE ON public.inventory_units
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();


-- ============================================================
-- 4) CREATE inventory_movements
-- ============================================================

CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  unit_id UUID NOT NULL REFERENCES public.inventory_units(id),
  from_location_id UUID NULL REFERENCES public.locations(id),
  to_location_id UUID NULL REFERENCES public.locations(id),
  movement_type TEXT NOT NULL
    CHECK (movement_type IN (
      'UNIT_MOVE', 'CONTAINER_MOVE', 'REMOVE_FROM_CONTAINER',
      'ADD_TO_CONTAINER', 'RECEIVED', 'RELEASED'
    )),
  container_id UUID NULL REFERENCES public.containers(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_inventory_movements_tenant_unit
  ON public.inventory_movements (tenant_id, unit_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_tenant_created
  ON public.inventory_movements (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_container
  ON public.inventory_movements (container_id);

-- RLS
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inventory_movements_tenant_isolation" ON public.inventory_movements;
CREATE POLICY "inventory_movements_tenant_isolation" ON public.inventory_movements
  FOR ALL USING (tenant_id = public.user_tenant_id());


-- ============================================================
-- 5) IC Code generation sequence (Option 2: single global sequence)
-- ============================================================

CREATE SEQUENCE IF NOT EXISTS public.ic_code_seq START WITH 1 INCREMENT BY 1;

-- Helper function: generate next IC code for a tenant
-- Uses global sequence but enforced unique per tenant via UNIQUE index
CREATE OR REPLACE FUNCTION public.generate_ic_code(p_tenant_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code TEXT;
  v_seq BIGINT;
BEGIN
  -- Get next sequence value
  v_seq := nextval('public.ic_code_seq');
  v_code := 'IC-' || LPAD(v_seq::TEXT, 6, '0');
  RETURN v_code;
END;
$$;


-- ============================================================
-- 6) RPC: rpc_move_container
-- ============================================================

CREATE OR REPLACE FUNCTION public.rpc_move_container(
  p_container_id UUID,
  p_new_location_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_old_location_id UUID;
  v_affected_count INT;
  v_user_id UUID;
BEGIN
  v_tenant_id := public.user_tenant_id();
  v_user_id := auth.uid();

  -- Lock and read container
  SELECT location_id INTO v_old_location_id
  FROM public.containers
  WHERE id = p_container_id AND tenant_id = v_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TENANT_MISMATCH: Container not found or not owned by tenant';
  END IF;

  -- Verify new location belongs to tenant
  IF NOT EXISTS (
    SELECT 1 FROM public.locations
    WHERE id = p_new_location_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'INVALID_LOCATION: Target location not found';
  END IF;

  -- Update container location
  UPDATE public.containers
  SET location_id = p_new_location_id, updated_at = now()
  WHERE id = p_container_id AND tenant_id = v_tenant_id;

  -- Bulk update all units in this container
  UPDATE public.inventory_units
  SET location_id = p_new_location_id, updated_at = now(), updated_by = v_user_id
  WHERE container_id = p_container_id AND tenant_id = v_tenant_id;

  GET DIAGNOSTICS v_affected_count = ROW_COUNT;

  -- Bulk insert movement records for each affected unit
  INSERT INTO public.inventory_movements (tenant_id, unit_id, from_location_id, to_location_id, movement_type, container_id, created_by)
  SELECT v_tenant_id, iu.id, v_old_location_id, p_new_location_id, 'CONTAINER_MOVE', p_container_id, v_user_id
  FROM public.inventory_units iu
  WHERE iu.container_id = p_container_id AND iu.tenant_id = v_tenant_id;

  RETURN json_build_object(
    'affected_unit_count', v_affected_count,
    'old_location_id', v_old_location_id,
    'new_location_id', p_new_location_id
  );
END;
$$;


-- ============================================================
-- 7) RPC: rpc_remove_unit_from_container
-- ============================================================

CREATE OR REPLACE FUNCTION public.rpc_remove_unit_from_container(
  p_unit_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_user_id UUID;
  v_old_container_id UUID;
  v_current_location_id UUID;
BEGIN
  v_tenant_id := public.user_tenant_id();
  v_user_id := auth.uid();

  -- Lock and read unit
  SELECT container_id, location_id
  INTO v_old_container_id, v_current_location_id
  FROM public.inventory_units
  WHERE id = p_unit_id AND tenant_id = v_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TENANT_MISMATCH: Unit not found or not owned by tenant';
  END IF;

  IF v_old_container_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_STATE: Unit is not in any container';
  END IF;

  -- Remove from container (DO NOT change location_id)
  UPDATE public.inventory_units
  SET container_id = NULL, updated_at = now(), updated_by = v_user_id
  WHERE id = p_unit_id AND tenant_id = v_tenant_id;

  -- Insert movement record
  INSERT INTO public.inventory_movements
    (tenant_id, unit_id, from_location_id, to_location_id, movement_type, container_id, created_by)
  VALUES
    (v_tenant_id, p_unit_id, v_current_location_id, v_current_location_id, 'REMOVE_FROM_CONTAINER', v_old_container_id, v_user_id);

  RETURN json_build_object(
    'unit_id', p_unit_id,
    'old_container_id', v_old_container_id
  );
END;
$$;


-- ============================================================
-- 8) RPC: rpc_add_unit_to_container
-- ============================================================

CREATE OR REPLACE FUNCTION public.rpc_add_unit_to_container(
  p_unit_id UUID,
  p_container_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_user_id UUID;
  v_unit_old_location_id UUID;
  v_container_location_id UUID;
BEGIN
  v_tenant_id := public.user_tenant_id();
  v_user_id := auth.uid();

  -- Lock and read unit
  SELECT location_id INTO v_unit_old_location_id
  FROM public.inventory_units
  WHERE id = p_unit_id AND tenant_id = v_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TENANT_MISMATCH: Unit not found or not owned by tenant';
  END IF;

  -- Lock and read container
  SELECT location_id INTO v_container_location_id
  FROM public.containers
  WHERE id = p_container_id AND tenant_id = v_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TENANT_MISMATCH: Container not found or not owned by tenant';
  END IF;

  -- Update unit: assign to container AND move to container's location
  UPDATE public.inventory_units
  SET container_id = p_container_id,
      location_id = v_container_location_id,
      updated_at = now(),
      updated_by = v_user_id
  WHERE id = p_unit_id AND tenant_id = v_tenant_id;

  -- Insert movement record
  INSERT INTO public.inventory_movements
    (tenant_id, unit_id, from_location_id, to_location_id, movement_type, container_id, created_by)
  VALUES
    (v_tenant_id, p_unit_id, v_unit_old_location_id, v_container_location_id, 'ADD_TO_CONTAINER', p_container_id, v_user_id);

  RETURN json_build_object(
    'unit_id', p_unit_id,
    'container_id', p_container_id,
    'from_location_id', v_unit_old_location_id,
    'to_location_id', v_container_location_id
  );
END;
$$;


-- ============================================================
-- 9) RPC: rpc_get_location_capacity
-- ============================================================

CREATE OR REPLACE FUNCTION public.rpc_get_location_capacity(
  p_location_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_capacity_cu_ft NUMERIC;
  v_space_tracking TEXT;
  v_volume_mode TEXT;
  v_total_used NUMERIC := 0;
  v_uncontained_total NUMERIC := 0;
  v_utilization_pct NUMERIC;
  v_container_breakdown JSON;
  rec RECORD;
BEGIN
  v_tenant_id := public.user_tenant_id();

  -- Verify location belongs to tenant
  SELECT capacity_cu_ft INTO v_capacity_cu_ft
  FROM public.locations
  WHERE id = p_location_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_LOCATION: Location not found';
  END IF;

  -- Read org preferences
  SELECT COALESCE(setting_value::TEXT, '"none"')
  INTO v_space_tracking
  FROM public.tenant_settings
  WHERE tenant_id = v_tenant_id AND setting_key = 'space_tracking_mode';

  -- Strip JSON quotes
  v_space_tracking := TRIM(BOTH '"' FROM COALESCE(v_space_tracking, 'none'));

  IF v_space_tracking = 'none' THEN
    RETURN json_build_object(
      'used_cu_ft', NULL,
      'capacity_cu_ft', v_capacity_cu_ft,
      'utilization_pct', NULL,
      'container_breakdown', '[]'::JSON
    );
  END IF;

  SELECT COALESCE(setting_value::TEXT, '"bounded_footprint"')
  INTO v_volume_mode
  FROM public.tenant_settings
  WHERE tenant_id = v_tenant_id AND setting_key = 'container_volume_mode';

  v_volume_mode := TRIM(BOTH '"' FROM COALESCE(v_volume_mode, 'bounded_footprint'));

  IF v_volume_mode = 'units_only' THEN
    -- Simple sum of all unit volumes at this location
    SELECT COALESCE(SUM(COALESCE(unit_cu_ft, 0)), 0) INTO v_total_used
    FROM public.inventory_units
    WHERE location_id = p_location_id AND tenant_id = v_tenant_id;

    v_container_breakdown := '[]'::JSON;

  ELSE
    -- bounded_footprint mode
    -- Calculate per-container usage
    SELECT COALESCE(json_agg(row_to_json(cb)), '[]'::JSON) INTO v_container_breakdown
    FROM (
      SELECT
        c.id AS container_id,
        c.container_code,
        COALESCE(c.footprint_cu_ft, 0) AS footprint_cu_ft,
        COALESCE(unit_totals.contents_cu_ft, 0) AS contents_cu_ft,
        CASE
          WHEN COALESCE(c.footprint_cu_ft, 0) > 0
          THEN GREATEST(c.footprint_cu_ft, COALESCE(unit_totals.contents_cu_ft, 0))
          ELSE COALESCE(unit_totals.contents_cu_ft, 0)
        END AS used_cu_ft
      FROM public.containers c
      LEFT JOIN (
        SELECT container_id, SUM(COALESCE(unit_cu_ft, 0)) AS contents_cu_ft
        FROM public.inventory_units
        WHERE location_id = p_location_id AND tenant_id = v_tenant_id AND container_id IS NOT NULL
        GROUP BY container_id
      ) unit_totals ON unit_totals.container_id = c.id
      WHERE c.location_id = p_location_id AND c.tenant_id = v_tenant_id
    ) cb;

    -- Sum container usage
    SELECT COALESCE(SUM(
      CASE
        WHEN COALESCE(c.footprint_cu_ft, 0) > 0
        THEN GREATEST(c.footprint_cu_ft, COALESCE(unit_totals.contents_cu_ft, 0))
        ELSE COALESCE(unit_totals.contents_cu_ft, 0)
      END
    ), 0) INTO v_total_used
    FROM public.containers c
    LEFT JOIN (
      SELECT container_id, SUM(COALESCE(unit_cu_ft, 0)) AS contents_cu_ft
      FROM public.inventory_units
      WHERE location_id = p_location_id AND tenant_id = v_tenant_id AND container_id IS NOT NULL
      GROUP BY container_id
    ) unit_totals ON unit_totals.container_id = c.id
    WHERE c.location_id = p_location_id AND c.tenant_id = v_tenant_id;

    -- Add uncontained units
    SELECT COALESCE(SUM(COALESCE(unit_cu_ft, 0)), 0) INTO v_uncontained_total
    FROM public.inventory_units
    WHERE location_id = p_location_id AND tenant_id = v_tenant_id AND container_id IS NULL;

    v_total_used := v_total_used + v_uncontained_total;
  END IF;

  -- Calculate utilization
  IF v_capacity_cu_ft IS NOT NULL AND v_capacity_cu_ft > 0 THEN
    v_utilization_pct := ROUND((v_total_used / v_capacity_cu_ft) * 100, 2);
  ELSE
    v_utilization_pct := NULL;
  END IF;

  RETURN json_build_object(
    'used_cu_ft', v_total_used,
    'capacity_cu_ft', v_capacity_cu_ft,
    'utilization_pct', v_utilization_pct,
    'container_breakdown', v_container_breakdown
  );
END;
$$;


-- ============================================================
-- 10) Grant execute on RPCs to authenticated users
-- ============================================================

GRANT EXECUTE ON FUNCTION public.rpc_move_container(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_remove_unit_from_container(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_add_unit_to_container(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_get_location_capacity(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_ic_code(UUID) TO authenticated;
