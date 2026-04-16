-- =============================================================================
-- HMV-P1: Zone-level location capacity drill-down (on-demand)
-- =============================================================================
-- Adds:
-- - RPC: public.rpc_get_warehouse_zone_location_capacity(p_map_id uuid, p_zone_id uuid)
--
-- Rationale:
-- - Zone aggregation must load via a single RPC (rpc_get_warehouse_map_zone_capacity).
-- - Location drill-down should be fetched on-demand for the selected zone to avoid
--   transferring large datasets on initial page load.
-- - Math aligns with rpc_get_location_capacity (inventory_units + containers).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.rpc_get_warehouse_zone_location_capacity(
  p_map_id UUID,
  p_zone_id UUID
)
RETURNS TABLE (
  location_id UUID,
  location_code TEXT,
  zone_id UUID,
  used_cu_ft NUMERIC,
  capacity_cu_ft NUMERIC,
  free_cu_ft NUMERIC,
  utilization_pct NUMERIC
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
  v_zone_on_map BOOLEAN;
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

  -- Only allow drilling into zones that are present on the map.
  SELECT EXISTS (
    SELECT 1
    FROM public.warehouse_map_nodes n
    WHERE n.warehouse_map_id = p_map_id
      AND n.zone_id = p_zone_id
  )
  INTO v_zone_on_map;

  IF NOT v_zone_on_map THEN
    RETURN;
  END IF;

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
    locs AS (
      SELECT
        l.id AS location_id,
        l.code AS location_code,
        l.zone_id,
        COALESCE(l.capacity_cu_ft, l.capacity_cuft, 0) AS capacity_cu_ft
      FROM public.locations l
      WHERE l.warehouse_id = v_warehouse_id
        AND l.deleted_at IS NULL
        AND l.zone_id = p_zone_id
    ),
    used_units_only AS (
      SELECT
        iu.location_id,
        COALESCE(SUM(COALESCE(iu.unit_cu_ft, 0)), 0) AS used_cu_ft
      FROM public.inventory_units iu
      WHERE iu.tenant_id = v_tenant_id
        AND iu.location_id IN (SELECT location_id FROM locs)
      GROUP BY iu.location_id
    ),
    container_contents AS (
      SELECT
        iu.container_id,
        COALESCE(SUM(COALESCE(iu.unit_cu_ft, 0)), 0) AS contents_cu_ft
      FROM public.inventory_units iu
      JOIN public.containers c ON c.id = iu.container_id
      WHERE iu.tenant_id = v_tenant_id
        AND iu.container_id IS NOT NULL
        AND c.location_id IN (SELECT location_id FROM locs)
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
        AND c.location_id IN (SELECT location_id FROM locs)
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
        AND iu.location_id IN (SELECT location_id FROM locs)
      GROUP BY iu.location_id
    ),
    used_bounded_footprint AS (
      SELECT
        locs.location_id,
        COALESCE(lcu.used_cu_ft, 0) + COALESCE(luu.used_cu_ft, 0) AS used_cu_ft
      FROM locs
      LEFT JOIN location_container_used lcu ON lcu.location_id = locs.location_id
      LEFT JOIN location_uncontained_used luu ON luu.location_id = locs.location_id
    )
  SELECT
    locs.location_id,
    locs.location_code,
    locs.zone_id,
    CASE
      WHEN v_space_tracking = 'none' THEN NULL
      WHEN v_volume_mode = 'units_only' THEN COALESCE(uuo.used_cu_ft, 0)
      ELSE COALESCE(ubf.used_cu_ft, 0)
    END AS used_cu_ft,
    locs.capacity_cu_ft,
    CASE
      WHEN v_space_tracking = 'none' THEN NULL
      ELSE GREATEST(
        locs.capacity_cu_ft
        - CASE
            WHEN v_volume_mode = 'units_only' THEN COALESCE(uuo.used_cu_ft, 0)
            ELSE COALESCE(ubf.used_cu_ft, 0)
          END,
        0
      )
    END AS free_cu_ft,
    CASE
      WHEN v_space_tracking = 'none' THEN NULL
      WHEN locs.capacity_cu_ft > 0 THEN ROUND(
        (
          CASE
            WHEN v_volume_mode = 'units_only' THEN COALESCE(uuo.used_cu_ft, 0)
            ELSE COALESCE(ubf.used_cu_ft, 0)
          END
        / NULLIF(locs.capacity_cu_ft, 0)) * 100,
        2
      )
      ELSE NULL
    END AS utilization_pct
  FROM locs
  LEFT JOIN used_units_only uuo ON uuo.location_id = locs.location_id
  LEFT JOIN used_bounded_footprint ubf ON ubf.location_id = locs.location_id
  ORDER BY locs.location_code;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_get_warehouse_zone_location_capacity(UUID, UUID) TO authenticated;

