-- Drop and recreate UPDATE policy to include admin_dev
DROP POLICY IF EXISTS service_categories_tenant_update ON public.service_categories;
CREATE POLICY service_categories_tenant_update ON public.service_categories
  FOR UPDATE
  USING (
    tenant_id = (SELECT u.tenant_id FROM users u WHERE u.id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid()
        AND r.name IN ('admin', 'admin_dev')
        AND ur.deleted_at IS NULL
    )
  );

-- Drop and recreate DELETE policy to include admin_dev
DROP POLICY IF EXISTS service_categories_tenant_delete ON public.service_categories;
CREATE POLICY service_categories_tenant_delete ON public.service_categories
  FOR DELETE
  USING (
    tenant_id = (SELECT u.tenant_id FROM users u WHERE u.id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid()
        AND r.name IN ('admin', 'admin_dev')
        AND ur.deleted_at IS NULL
    )
  );

-- Drop and recreate INSERT policy to include admin_dev
DROP POLICY IF EXISTS service_categories_tenant_insert ON public.service_categories;
CREATE POLICY service_categories_tenant_insert ON public.service_categories
  FOR INSERT
  WITH CHECK (
    tenant_id = (SELECT u.tenant_id FROM users u WHERE u.id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid()
        AND r.name IN ('admin', 'admin_dev')
        AND ur.deleted_at IS NULL
    )
  );