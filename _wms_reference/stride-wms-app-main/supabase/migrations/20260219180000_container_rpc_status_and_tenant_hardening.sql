-- ============================================================================
-- Container RPC hardening (status rules + tenant isolation)
-- ============================================================================
-- Changes:
--  - rpc_add_unit_to_container:
--      * disallow adding units into closed/archived containers
--      * require containers have a location before accepting units
--  - rpc_move_container:
--      * disallow moving archived containers
--      * ensure the target location belongs to the caller's tenant
--  - rpc_get_location_capacity:
--      * ensure requested location belongs to the caller's tenant
--
-- Why:
--  - These functions are SECURITY DEFINER and must enforce tenant boundaries.
--  - Closed/archived containers should not accept new units.
-- ============================================================================

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
  v_container_status TEXT;
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

  -- Lock and read container (status + location)
  SELECT location_id, status
  INTO v_container_location_id, v_container_status
  FROM public.containers
  WHERE id = p_container_id AND tenant_id = v_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TENANT_MISMATCH: Container not found or not owned by tenant';
  END IF;

  IF v_container_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'INVALID_STATE: Container is not active';
  END IF;

  -- inventory_units.location_id is NOT NULL; adding to a location-less container would fail anyway,
  -- but we return a clearer error message here.
  IF v_container_location_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_STATE: Container has no location';
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
  v_container_status TEXT;
  v_new_warehouse_id UUID;
  v_affected_count INT;
  v_user_id UUID;
BEGIN
  v_tenant_id := public.user_tenant_id();
  v_user_id := auth.uid();

  -- Lock and read container
  SELECT location_id, status INTO v_old_location_id, v_container_status
  FROM public.containers
  WHERE id = p_container_id AND tenant_id = v_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TENANT_MISMATCH: Container not found or not owned by tenant';
  END IF;

  IF v_container_status = 'archived' THEN
    RAISE EXCEPTION 'INVALID_STATE: Cannot move an archived container';
  END IF;

  -- Verify new location belongs to tenant (locations has no tenant_id; scope via warehouses.tenant_id)
  SELECT l.warehouse_id
  INTO v_new_warehouse_id
  FROM public.locations l
  JOIN public.warehouses w ON w.id = l.warehouse_id
  WHERE l.id = p_new_location_id
    AND l.deleted_at IS NULL
    AND w.tenant_id = v_tenant_id
    AND w.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_LOCATION: Target location not found or not owned by tenant';
  END IF;

  -- Update container location
  UPDATE public.containers
  SET location_id = p_new_location_id,
      warehouse_id = v_new_warehouse_id,
      updated_at = now()
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

  -- Verify location belongs to tenant (locations has no tenant_id; scope via warehouses.tenant_id)
  SELECT l.capacity_cu_ft
  INTO v_capacity_cu_ft
  FROM public.locations l
  JOIN public.warehouses w ON w.id = l.warehouse_id
  WHERE l.id = p_location_id
    AND l.deleted_at IS NULL
    AND w.tenant_id = v_tenant_id
    AND w.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_LOCATION: Location not found or not owned by tenant';
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

GRANT EXECUTE ON FUNCTION public.rpc_move_container(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_remove_unit_from_container(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_add_unit_to_container(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_get_location_capacity(UUID) TO authenticated;

