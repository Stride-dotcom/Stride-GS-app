-- Phase 3: Create receiving dock function for automatic location assignment

-- Function to get or create receiving dock for a warehouse
CREATE OR REPLACE FUNCTION public.get_or_create_receiving_dock(p_warehouse_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_dock_id UUID;
  v_tenant_id UUID;
BEGIN
  -- Get the warehouse's tenant_id
  SELECT tenant_id INTO v_tenant_id
  FROM warehouses
  WHERE id = p_warehouse_id AND deleted_at IS NULL;
  
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Warehouse not found or deleted';
  END IF;
  
  -- Try to find existing receiving dock
  SELECT id INTO v_dock_id
  FROM locations
  WHERE warehouse_id = p_warehouse_id
    AND type = 'receiving'
    AND deleted_at IS NULL
  LIMIT 1;
  
  IF v_dock_id IS NOT NULL THEN
    RETURN v_dock_id;
  END IF;
  
  -- Create new receiving dock
  INSERT INTO locations (tenant_id, warehouse_id, code, name, type, location_type, is_active)
  VALUES (v_tenant_id, p_warehouse_id, 'RECV-DOCK', 'Receiving Dock', 'receiving', 'storage', true)
  RETURNING id INTO v_dock_id;
  
  RETURN v_dock_id;
END;
$$;

-- Backfill existing warehouses with receiving docks
DO $$
DECLARE
  w_id UUID;
BEGIN
  FOR w_id IN SELECT id FROM warehouses WHERE deleted_at IS NULL LOOP
    PERFORM public.get_or_create_receiving_dock(w_id);
  END LOOP;
END;
$$;