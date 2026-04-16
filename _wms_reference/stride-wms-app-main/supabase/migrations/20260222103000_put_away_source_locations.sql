-- =============================================================================
-- Put Away source locations (tenant-wide per warehouse)
-- -----------------------------------------------------------------------------
-- Stores additional source locations for the Put Away assistant.
-- - Default receiving location remains warehouse-owned and always included in UI.
-- - This table stores ONLY additional source locations configured by admins/managers.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.put_away_source_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT put_away_source_locations_unique_wh_loc UNIQUE (warehouse_id, location_id)
);

CREATE INDEX IF NOT EXISTS idx_put_away_source_locations_tenant_wh
  ON public.put_away_source_locations(tenant_id, warehouse_id);

CREATE INDEX IF NOT EXISTS idx_put_away_source_locations_location
  ON public.put_away_source_locations(location_id);

ALTER TABLE public.put_away_source_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "put_away_source_locations_tenant_select" ON public.put_away_source_locations;
CREATE POLICY "put_away_source_locations_tenant_select"
  ON public.put_away_source_locations
  FOR SELECT
  USING (
    tenant_id = public.user_tenant_id()
    AND warehouse_id IN (
      SELECT w.id
      FROM public.warehouses w
      WHERE w.tenant_id = public.user_tenant_id()
    )
    AND location_id IN (
      SELECT l.id
      FROM public.locations l
      JOIN public.warehouses w ON w.id = l.warehouse_id
      WHERE w.tenant_id = public.user_tenant_id()
        AND l.warehouse_id = public.put_away_source_locations.warehouse_id
    )
  );

DROP POLICY IF EXISTS "put_away_source_locations_tenant_modify" ON public.put_away_source_locations;
CREATE POLICY "put_away_source_locations_tenant_modify"
  ON public.put_away_source_locations
  FOR ALL
  USING (
    tenant_id = public.user_tenant_id()
    AND (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'tenant_admin')
      OR public.has_role(auth.uid(), 'manager')
      OR public.has_role(auth.uid(), 'admin_dev')
    )
    AND warehouse_id IN (
      SELECT w.id
      FROM public.warehouses w
      WHERE w.tenant_id = public.user_tenant_id()
    )
    AND location_id IN (
      SELECT l.id
      FROM public.locations l
      JOIN public.warehouses w ON w.id = l.warehouse_id
      WHERE w.tenant_id = public.user_tenant_id()
        AND l.warehouse_id = public.put_away_source_locations.warehouse_id
    )
  )
  WITH CHECK (
    tenant_id = public.user_tenant_id()
    AND (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'tenant_admin')
      OR public.has_role(auth.uid(), 'manager')
      OR public.has_role(auth.uid(), 'admin_dev')
    )
    AND warehouse_id IN (
      SELECT w.id
      FROM public.warehouses w
      WHERE w.tenant_id = public.user_tenant_id()
    )
    AND location_id IN (
      SELECT l.id
      FROM public.locations l
      JOIN public.warehouses w ON w.id = l.warehouse_id
      WHERE w.tenant_id = public.user_tenant_id()
        AND l.warehouse_id = public.put_away_source_locations.warehouse_id
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.put_away_source_locations TO authenticated;
