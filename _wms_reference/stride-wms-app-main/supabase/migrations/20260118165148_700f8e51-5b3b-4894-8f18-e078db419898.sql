-- Drop existing restrictive RLS policies for locations
DROP POLICY IF EXISTS "locations_staff_write" ON public.locations;
DROP POLICY IF EXISTS "locations_warehouse_access" ON public.locations;

-- Create simpler tenant-based policies for locations
-- SELECT: Tenant admins can see all locations in their tenant's warehouses
CREATE POLICY "Users can view locations in their tenant warehouses"
ON public.locations
FOR SELECT
USING (
  warehouse_id IN (
    SELECT w.id FROM warehouses w 
    WHERE w.tenant_id IN (
      SELECT u.tenant_id FROM users u WHERE u.id = auth.uid()
    )
  )
);

-- INSERT: Tenant admins and users with warehouse access can insert locations
CREATE POLICY "Users can insert locations in their tenant warehouses"
ON public.locations
FOR INSERT
WITH CHECK (
  warehouse_id IN (
    SELECT w.id FROM warehouses w 
    WHERE w.tenant_id IN (
      SELECT u.tenant_id FROM users u WHERE u.id = auth.uid()
    )
  )
);

-- UPDATE: Similar access for updates
CREATE POLICY "Users can update locations in their tenant warehouses"
ON public.locations
FOR UPDATE
USING (
  warehouse_id IN (
    SELECT w.id FROM warehouses w 
    WHERE w.tenant_id IN (
      SELECT u.tenant_id FROM users u WHERE u.id = auth.uid()
    )
  )
);

-- DELETE: Allow soft delete for tenant locations
CREATE POLICY "Users can delete locations in their tenant warehouses"
ON public.locations
FOR DELETE
USING (
  warehouse_id IN (
    SELECT w.id FROM warehouses w 
    WHERE w.tenant_id IN (
      SELECT u.tenant_id FROM users u WHERE u.id = auth.uid()
    )
  )
);