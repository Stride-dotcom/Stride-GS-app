-- =============================================================================
-- Put Away configuration foundations
-- - Warehouse-scoped excluded suggestion locations
-- - Per-flag special storage toggle
-- - Role policy cleanup (remove deprecated tenant_admin from put-away config)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Warehouse-scoped excluded suggestion locations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.put_away_excluded_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT put_away_excluded_locations_unique_wh_loc UNIQUE (warehouse_id, location_id)
);

CREATE INDEX IF NOT EXISTS idx_put_away_excluded_locations_tenant_wh
  ON public.put_away_excluded_locations(tenant_id, warehouse_id);

CREATE INDEX IF NOT EXISTS idx_put_away_excluded_locations_location
  ON public.put_away_excluded_locations(location_id);

ALTER TABLE public.put_away_excluded_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "put_away_excluded_locations_tenant_select" ON public.put_away_excluded_locations;
CREATE POLICY "put_away_excluded_locations_tenant_select"
  ON public.put_away_excluded_locations
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
        AND l.warehouse_id = public.put_away_excluded_locations.warehouse_id
    )
  );

DROP POLICY IF EXISTS "put_away_excluded_locations_tenant_modify" ON public.put_away_excluded_locations;
CREATE POLICY "put_away_excluded_locations_tenant_modify"
  ON public.put_away_excluded_locations
  FOR ALL
  USING (
    tenant_id = public.user_tenant_id()
    AND (
      public.has_role(auth.uid(), 'admin')
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
        AND l.warehouse_id = public.put_away_excluded_locations.warehouse_id
    )
  )
  WITH CHECK (
    tenant_id = public.user_tenant_id()
    AND (
      public.has_role(auth.uid(), 'admin')
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
        AND l.warehouse_id = public.put_away_excluded_locations.warehouse_id
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.put_away_excluded_locations TO authenticated;

-- ---------------------------------------------------------------------------
-- 2) Per-flag special storage requirement toggle
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.put_away_flag_storage_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  charge_type_id UUID NULL REFERENCES public.charge_types(id) ON DELETE SET NULL,
  service_code TEXT NOT NULL,
  requires_special_storage BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT put_away_flag_storage_requirements_unique_service UNIQUE (tenant_id, service_code)
);

CREATE INDEX IF NOT EXISTS idx_put_away_flag_storage_requirements_tenant
  ON public.put_away_flag_storage_requirements(tenant_id, requires_special_storage);

ALTER TABLE public.put_away_flag_storage_requirements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "put_away_flag_storage_requirements_tenant_select" ON public.put_away_flag_storage_requirements;
CREATE POLICY "put_away_flag_storage_requirements_tenant_select"
  ON public.put_away_flag_storage_requirements
  FOR SELECT
  USING (tenant_id = public.user_tenant_id());

DROP POLICY IF EXISTS "put_away_flag_storage_requirements_tenant_modify" ON public.put_away_flag_storage_requirements;
CREATE POLICY "put_away_flag_storage_requirements_tenant_modify"
  ON public.put_away_flag_storage_requirements
  FOR ALL
  USING (
    tenant_id = public.user_tenant_id()
    AND (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'manager')
      OR public.has_role(auth.uid(), 'admin_dev')
    )
  )
  WITH CHECK (
    tenant_id = public.user_tenant_id()
    AND (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'manager')
      OR public.has_role(auth.uid(), 'admin_dev')
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.put_away_flag_storage_requirements TO authenticated;

-- Keep updated_at in sync for edits.
CREATE OR REPLACE FUNCTION public.trg_put_away_flag_storage_requirements_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_put_away_flag_storage_requirements_touch_updated_at
  ON public.put_away_flag_storage_requirements;
CREATE TRIGGER trg_put_away_flag_storage_requirements_touch_updated_at
  BEFORE UPDATE ON public.put_away_flag_storage_requirements
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_put_away_flag_storage_requirements_touch_updated_at();

GRANT EXECUTE ON FUNCTION public.trg_put_away_flag_storage_requirements_touch_updated_at() TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) Remove deprecated tenant_admin from put-away source location policy
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "put_away_source_locations_tenant_modify" ON public.put_away_source_locations;
CREATE POLICY "put_away_source_locations_tenant_modify"
  ON public.put_away_source_locations
  FOR ALL
  USING (
    tenant_id = public.user_tenant_id()
    AND (
      public.has_role(auth.uid(), 'admin')
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

-- ---------------------------------------------------------------------------
-- 4) Warehouse access function should not include deprecated tenant_admin role
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_has_warehouse_access(
  p_user_id uuid,
  p_warehouse_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM warehouse_permissions wp
    WHERE wp.user_id = p_user_id
      AND wp.warehouse_id = p_warehouse_id
      AND wp.deleted_at IS NULL
  ) OR EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.user_id = p_user_id
      AND r.name IN ('admin', 'admin_dev', 'manager')
      AND r.deleted_at IS NULL
      AND ur.deleted_at IS NULL
  );
END;
$$;
