-- =============================================================================
-- Admin Dev System Role and RLS Policies
-- =============================================================================
-- Creates a system-level admin_dev role for internal developer/QA access
-- with proper RLS protection to prevent tenant manipulation of system roles.

-- =============================================================================
-- 1. ADD is_system COLUMN IF NOT EXISTS (some setups may not have it)
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'roles' AND column_name = 'is_system'
  ) THEN
    ALTER TABLE public.roles ADD COLUMN is_system BOOLEAN DEFAULT false;
  END IF;
END $$;

-- =============================================================================
-- 2. CREATE THE ADMIN_DEV SYSTEM ROLE
-- =============================================================================
INSERT INTO public.roles (id, tenant_id, name, description, is_system, permissions)
VALUES (
  'a0000000-0000-0000-0000-000000000001'::uuid,  -- Fixed ID for easy reference
  NULL,  -- NULL tenant_id = system role
  'admin_dev',
  'Internal developer/QA access - system role',
  true,
  '{}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 3. HELPER FUNCTIONS (SECURITY DEFINER)
-- =============================================================================

-- Check if user has admin_dev system role
CREATE OR REPLACE FUNCTION public.user_is_admin_dev(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.roles r ON ur.role_id = r.id
    WHERE ur.user_id = p_user_id
      AND r.name = 'admin_dev'
      AND r.is_system = true
      AND ur.deleted_at IS NULL
      AND r.deleted_at IS NULL
  );
END;
$$;

-- Check if current user has admin_dev system role
CREATE OR REPLACE FUNCTION public.current_user_is_admin_dev()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.user_is_admin_dev(auth.uid());
END;
$$;

-- Get user's access level for a specific account
CREATE OR REPLACE FUNCTION public.user_account_access_level(p_user_id uuid, p_account_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_access_level text;
BEGIN
  SELECT access_level INTO v_access_level
  FROM public.user_accounts
  WHERE user_id = p_user_id
    AND account_id = p_account_id
    AND deleted_at IS NULL;

  RETURN v_access_level;
END;
$$;

-- Check if a role is a system role
CREATE OR REPLACE FUNCTION public.is_system_role(p_role_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.roles
    WHERE id = p_role_id
      AND is_system = true
      AND deleted_at IS NULL
  );
END;
$$;

-- =============================================================================
-- 4. DROP EXISTING RLS POLICIES ON ROLES TABLE
-- =============================================================================
DO $$
DECLARE
  policy_name text;
BEGIN
  -- Drop all existing policies on roles table
  FOR policy_name IN
    SELECT policyname FROM pg_policies WHERE tablename = 'roles' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.roles', policy_name);
  END LOOP;
END $$;

-- =============================================================================
-- 5. CREATE NEW RLS POLICIES FOR ROLES TABLE
-- =============================================================================

-- Enable RLS
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;

-- SELECT: Users can see tenant roles in their tenant, OR system roles if admin_dev
CREATE POLICY "roles_select_policy" ON public.roles
FOR SELECT USING (
  -- Service role can see everything
  (SELECT current_setting('request.jwt.claim.role', true)) = 'service_role'
  OR (
    -- Tenant roles: visible to users in that tenant
    tenant_id IS NOT NULL
    AND tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid())
  )
  OR (
    -- System roles: only visible to admin_dev users
    tenant_id IS NULL
    AND is_system = true
    AND public.current_user_is_admin_dev()
  )
);

-- INSERT: Can only insert tenant roles (system roles blocked unless admin_dev)
CREATE POLICY "roles_insert_policy" ON public.roles
FOR INSERT WITH CHECK (
  -- Service role can insert anything
  (SELECT current_setting('request.jwt.claim.role', true)) = 'service_role'
  OR (
    -- Tenant roles: users in that tenant can insert
    tenant_id IS NOT NULL
    AND tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid())
    AND (is_system IS NULL OR is_system = false)
  )
  OR (
    -- System roles: only admin_dev can insert
    is_system = true
    AND public.current_user_is_admin_dev()
  )
);

-- UPDATE: Can only update tenant roles (system roles blocked unless admin_dev)
CREATE POLICY "roles_update_policy" ON public.roles
FOR UPDATE USING (
  -- Service role can update anything
  (SELECT current_setting('request.jwt.claim.role', true)) = 'service_role'
  OR (
    -- Tenant roles: users in that tenant can update
    tenant_id IS NOT NULL
    AND tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid())
    AND (is_system IS NULL OR is_system = false)
  )
  OR (
    -- System roles: only admin_dev can update
    is_system = true
    AND public.current_user_is_admin_dev()
  )
);

-- DELETE: Can only delete tenant roles (system roles blocked unless admin_dev)
CREATE POLICY "roles_delete_policy" ON public.roles
FOR DELETE USING (
  -- Service role can delete anything
  (SELECT current_setting('request.jwt.claim.role', true)) = 'service_role'
  OR (
    -- Tenant roles: users in that tenant can delete
    tenant_id IS NOT NULL
    AND tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid())
    AND (is_system IS NULL OR is_system = false)
  )
  OR (
    -- System roles: only admin_dev can delete
    is_system = true
    AND public.current_user_is_admin_dev()
  )
);

-- =============================================================================
-- 6. DROP EXISTING RLS POLICIES ON USER_ROLES TABLE
-- =============================================================================
DO $$
DECLARE
  policy_name text;
BEGIN
  FOR policy_name IN
    SELECT policyname FROM pg_policies WHERE tablename = 'user_roles' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.user_roles', policy_name);
  END LOOP;
END $$;

-- =============================================================================
-- 7. CREATE NEW RLS POLICIES FOR USER_ROLES TABLE
-- =============================================================================

-- Enable RLS
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- SELECT: Users can see user_roles for non-system roles in their tenant, or all if admin_dev
CREATE POLICY "user_roles_select_policy" ON public.user_roles
FOR SELECT USING (
  -- Service role can see everything
  (SELECT current_setting('request.jwt.claim.role', true)) = 'service_role'
  OR (
    -- Non-system roles in user's tenant
    NOT public.is_system_role(role_id)
    AND EXISTS (
      SELECT 1 FROM public.users u1
      JOIN public.users u2 ON u1.tenant_id = u2.tenant_id
      WHERE u1.id = user_roles.user_id
        AND u2.id = auth.uid()
    )
  )
  OR (
    -- System roles: only visible to admin_dev users
    public.is_system_role(role_id)
    AND public.current_user_is_admin_dev()
  )
  OR (
    -- Users can always see their own role assignments
    user_id = auth.uid()
  )
);

-- INSERT: Can only assign non-system roles (system roles blocked unless admin_dev)
CREATE POLICY "user_roles_insert_policy" ON public.user_roles
FOR INSERT WITH CHECK (
  -- Service role can insert anything
  (SELECT current_setting('request.jwt.claim.role', true)) = 'service_role'
  OR (
    -- Non-system roles: tenant users can assign
    NOT public.is_system_role(role_id)
    AND EXISTS (
      SELECT 1 FROM public.users u1
      JOIN public.users u2 ON u1.tenant_id = u2.tenant_id
      WHERE u1.id = user_roles.user_id
        AND u2.id = auth.uid()
    )
  )
  OR (
    -- System roles: only admin_dev can assign
    public.is_system_role(role_id)
    AND public.current_user_is_admin_dev()
  )
);

-- UPDATE: Can only update non-system role assignments (system roles blocked unless admin_dev)
CREATE POLICY "user_roles_update_policy" ON public.user_roles
FOR UPDATE USING (
  -- Service role can update anything
  (SELECT current_setting('request.jwt.claim.role', true)) = 'service_role'
  OR (
    -- Non-system roles: tenant users can update
    NOT public.is_system_role(role_id)
    AND EXISTS (
      SELECT 1 FROM public.users u1
      JOIN public.users u2 ON u1.tenant_id = u2.tenant_id
      WHERE u1.id = user_roles.user_id
        AND u2.id = auth.uid()
    )
  )
  OR (
    -- System roles: only admin_dev can update
    public.is_system_role(role_id)
    AND public.current_user_is_admin_dev()
  )
);

-- DELETE: Can only delete non-system role assignments (system roles blocked unless admin_dev)
CREATE POLICY "user_roles_delete_policy" ON public.user_roles
FOR DELETE USING (
  -- Service role can delete anything
  (SELECT current_setting('request.jwt.claim.role', true)) = 'service_role'
  OR (
    -- Non-system roles: tenant users can delete
    NOT public.is_system_role(role_id)
    AND EXISTS (
      SELECT 1 FROM public.users u1
      JOIN public.users u2 ON u1.tenant_id = u2.tenant_id
      WHERE u1.id = user_roles.user_id
        AND u2.id = auth.uid()
    )
  )
  OR (
    -- System roles: only admin_dev can delete
    public.is_system_role(role_id)
    AND public.current_user_is_admin_dev()
  )
);

-- =============================================================================
-- 8. GRANT EXECUTE ON HELPER FUNCTIONS
-- =============================================================================
GRANT EXECUTE ON FUNCTION public.user_is_admin_dev(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_is_admin_dev() TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_account_access_level(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_system_role(uuid) TO authenticated;

-- =============================================================================
-- 9. CREATE INDEX FOR PERFORMANCE
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_roles_is_system ON public.roles(is_system) WHERE is_system = true;
CREATE INDEX IF NOT EXISTS idx_roles_tenant_id_null ON public.roles(id) WHERE tenant_id IS NULL;

-- =============================================================================
-- 10. ADD COMMENTS
-- =============================================================================
COMMENT ON FUNCTION public.user_is_admin_dev(uuid) IS 'Check if a user has the admin_dev system role';
COMMENT ON FUNCTION public.current_user_is_admin_dev() IS 'Check if the current authenticated user has the admin_dev system role';
COMMENT ON FUNCTION public.user_account_access_level(uuid, uuid) IS 'Get user access level for a specific account';
COMMENT ON FUNCTION public.is_system_role(uuid) IS 'Check if a role is a system role (tenant_id IS NULL and is_system = true)';
