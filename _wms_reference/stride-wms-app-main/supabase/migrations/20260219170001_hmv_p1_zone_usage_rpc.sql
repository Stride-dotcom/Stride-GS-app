-- =============================================================================
-- HMV-P1: Zone usage counts (locations assigned + map nodes bound)
-- =============================================================================
-- Adds:
-- - RPC: public.rpc_get_warehouse_zone_usage(p_warehouse_id uuid)
--
-- Purpose:
-- - Zones manager UI needs to show impact counts without N+1 queries:
--   - number of locations assigned to each zone
--   - number of map nodes bound to each zone (across all maps for the warehouse)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.rpc_get_warehouse_zone_usage(
  p_warehouse_id UUID
)
RETURNS TABLE (
  zone_id UUID,
  location_count INTEGER,
  node_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
BEGIN
  v_tenant_id := public.user_tenant_id();

  IF NOT EXISTS (
    SELECT 1
    FROM public.warehouses w
    WHERE w.id = p_warehouse_id
      AND w.tenant_id = v_tenant_id
      AND w.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'TENANT_MISMATCH_OR_NOT_FOUND';
  END IF;

  IF NOT public.user_has_warehouse_access(auth.uid(), p_warehouse_id) THEN
    RAISE EXCEPTION 'ACCESS_DENIED: User does not have access to warehouse %', p_warehouse_id;
  END IF;

  RETURN QUERY
  WITH map_ids AS (
    SELECT wm.id
    FROM public.warehouse_maps wm
    WHERE wm.tenant_id = v_tenant_id
      AND wm.warehouse_id = p_warehouse_id
  )
  SELECT
    z.id AS zone_id,
    COUNT(DISTINCT l.id)::INT AS location_count,
    COUNT(DISTINCT n.id)::INT AS node_count
  FROM public.warehouse_zones z
  LEFT JOIN public.locations l
    ON l.zone_id = z.id
   AND l.warehouse_id = p_warehouse_id
   AND l.deleted_at IS NULL
  LEFT JOIN public.warehouse_map_nodes n
    ON n.zone_id = z.id
   AND n.warehouse_map_id IN (SELECT id FROM map_ids)
  WHERE z.tenant_id = v_tenant_id
    AND z.warehouse_id = p_warehouse_id
  GROUP BY z.id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_get_warehouse_zone_usage(UUID) TO authenticated;

