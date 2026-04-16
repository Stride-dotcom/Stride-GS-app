-- Default-map swap for a warehouse.
-- Only updates rows whose is_default actually changes.

CREATE OR REPLACE FUNCTION public.rpc_set_default_warehouse_map(
  p_warehouse_id UUID,
  p_map_id UUID
)
RETURNS public.warehouse_maps
LANGUAGE plpgsql
AS $$
DECLARE
  v_map public.warehouse_maps;
BEGIN
  -- Validate map belongs to the warehouse + tenant context.
  SELECT *
  INTO v_map
  FROM public.warehouse_maps wm
  WHERE wm.id = p_map_id
    AND wm.warehouse_id = p_warehouse_id
    AND wm.tenant_id = public.user_tenant_id();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Map % not found for warehouse %', p_map_id, p_warehouse_id;
  END IF;

  -- Two-step update avoids partial-unique-index violations that can occur with a single UPDATE.
  UPDATE public.warehouse_maps wm
  SET
    is_default = false,
    updated_by = auth.uid()
  WHERE wm.tenant_id = public.user_tenant_id()
    AND wm.warehouse_id = p_warehouse_id
    AND wm.is_default = true
    AND wm.id <> p_map_id;

  UPDATE public.warehouse_maps wm
  SET
    is_default = true,
    updated_by = auth.uid()
  WHERE wm.tenant_id = public.user_tenant_id()
    AND wm.warehouse_id = p_warehouse_id
    AND wm.id = p_map_id
    AND wm.is_default IS DISTINCT FROM true;

  SELECT *
  INTO v_map
  FROM public.warehouse_maps wm
  WHERE wm.id = p_map_id;

  RETURN v_map;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_set_default_warehouse_map(UUID, UUID) TO authenticated;

