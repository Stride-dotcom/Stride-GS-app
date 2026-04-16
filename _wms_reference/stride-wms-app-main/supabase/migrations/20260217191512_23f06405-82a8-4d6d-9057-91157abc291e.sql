CREATE POLICY "roles_system_visible"
ON public.roles
FOR SELECT
TO authenticated
USING (tenant_id IS NULL AND is_system = true);