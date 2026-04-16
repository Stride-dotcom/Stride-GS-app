
-- ============================================
-- STRIDE WMS REBUILD - PHASE 1: CORE FOUNDATION
-- ============================================

-- 1. CREATE ENUM TYPES
-- ============================================

-- User status enum
DO $$ BEGIN
  CREATE TYPE user_status AS ENUM ('pending', 'active', 'inactive');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Coverage type enum (for items later, but define now)
DO $$ BEGIN
  CREATE TYPE coverage_type AS ENUM ('standard', 'enhanced', 'full', 'pending');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. SIDEMARKS TABLE (Critical new table)
-- ============================================
CREATE TABLE IF NOT EXISTS public.sidemarks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  sidemark_code TEXT NOT NULL,
  sidemark_name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  
  -- Unique sidemark code per tenant
  CONSTRAINT sidemarks_tenant_code_unique UNIQUE (tenant_id, sidemark_code)
);

-- Indexes for sidemarks
CREATE INDEX IF NOT EXISTS idx_sidemarks_tenant_id ON public.sidemarks(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sidemarks_account_id ON public.sidemarks(account_id);
CREATE INDEX IF NOT EXISTS idx_sidemarks_active ON public.sidemarks(tenant_id, is_active) WHERE deleted_at IS NULL;

-- RLS for sidemarks
ALTER TABLE public.sidemarks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sidemarks_tenant_isolation" ON public.sidemarks
  FOR ALL USING (tenant_id = public.user_tenant_id());

-- Trigger for updated_at
CREATE TRIGGER update_sidemarks_updated_at
  BEFORE UPDATE ON public.sidemarks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. CONTAINERS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS public.containers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  location_id UUID REFERENCES public.locations(id) ON DELETE SET NULL,
  container_code TEXT NOT NULL,
  container_type TEXT, -- pallet, crate, bin, etc.
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  
  CONSTRAINT containers_tenant_code_unique UNIQUE (tenant_id, container_code)
);

-- Indexes for containers
CREATE INDEX IF NOT EXISTS idx_containers_tenant_id ON public.containers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_containers_location_id ON public.containers(location_id);

-- RLS for containers
ALTER TABLE public.containers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "containers_tenant_isolation" ON public.containers
  FOR ALL USING (tenant_id = public.user_tenant_id());

-- Trigger for updated_at
CREATE TRIGGER update_containers_updated_at
  BEFORE UPDATE ON public.containers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. ROLE_PERMISSIONS TABLE (granular permissions)
-- ============================================
CREATE TABLE IF NOT EXISTS public.role_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL,
  allowed BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT role_permissions_unique UNIQUE (role_id, permission_key)
);

-- Index for role_permissions
CREATE INDEX IF NOT EXISTS idx_role_permissions_role_id ON public.role_permissions(role_id);

-- RLS for role_permissions (inherits from roles table tenant scope)
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "role_permissions_via_role" ON public.role_permissions
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.roles r 
      WHERE r.id = role_permissions.role_id 
      AND r.tenant_id = public.user_tenant_id()
    )
  );

-- 5. ADD sidemark_id TO ACCOUNTS (for default sidemark)
-- ============================================
ALTER TABLE public.accounts 
  ADD COLUMN IF NOT EXISTS default_sidemark_id UUID REFERENCES public.sidemarks(id) ON DELETE SET NULL;

-- 6. TENANT_SETTINGS TABLE (key-value config)
-- ============================================
CREATE TABLE IF NOT EXISTS public.tenant_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  setting_key TEXT NOT NULL,
  setting_value JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES public.users(id),
  
  CONSTRAINT tenant_settings_unique UNIQUE (tenant_id, setting_key)
);

-- Index for tenant_settings
CREATE INDEX IF NOT EXISTS idx_tenant_settings_tenant_id ON public.tenant_settings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_settings_key ON public.tenant_settings(tenant_id, setting_key);

-- RLS for tenant_settings
ALTER TABLE public.tenant_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_settings_tenant_isolation" ON public.tenant_settings
  FOR ALL USING (tenant_id = public.user_tenant_id());

-- Trigger for updated_at
CREATE TRIGGER update_tenant_settings_updated_at
  BEFORE UPDATE ON public.tenant_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 7. ADD LOCATION TYPE COLUMN (for receiving dock, storage, release areas)
-- ============================================
ALTER TABLE public.locations 
  ADD COLUMN IF NOT EXISTS location_type TEXT DEFAULT 'storage';

-- Add check constraint for location types
ALTER TABLE public.locations 
  DROP CONSTRAINT IF EXISTS locations_type_check;
  
ALTER TABLE public.locations 
  ADD CONSTRAINT locations_type_check 
  CHECK (location_type IN ('receiving', 'storage', 'staging', 'release', 'quarantine'));

-- 8. UPDATE WAREHOUSES TABLE (ensure required columns exist)
-- ============================================
ALTER TABLE public.warehouses 
  ADD COLUMN IF NOT EXISTS address_line1 TEXT,
  ADD COLUMN IF NOT EXISTS address_line2 TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS postal_code TEXT,
  ADD COLUMN IF NOT EXISTS country TEXT DEFAULT 'US',
  ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'America/New_York';

-- 9. HELPER FUNCTION: Get sidemark display name (Account : Project)
-- ============================================
CREATE OR REPLACE FUNCTION public.get_sidemark_display(p_sidemark_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_display TEXT;
BEGIN
  SELECT a.account_name || ' : ' || s.sidemark_name INTO v_display
  FROM sidemarks s
  JOIN accounts a ON s.account_id = a.id
  WHERE s.id = p_sidemark_id;
  
  RETURN v_display;
END;
$$;

-- 10. HELPER FUNCTION: Check if user can access sidemark
-- ============================================
CREATE OR REPLACE FUNCTION public.user_can_access_sidemark(p_user_id UUID, p_sidemark_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_tenant_id UUID;
  v_sidemark_tenant_id UUID;
  v_user_role TEXT;
  v_user_account_id UUID;
  v_sidemark_account_id UUID;
BEGIN
  -- Get user's tenant
  SELECT tenant_id INTO v_user_tenant_id FROM users WHERE id = p_user_id;
  
  -- Get sidemark's tenant and account
  SELECT tenant_id, account_id INTO v_sidemark_tenant_id, v_sidemark_account_id 
  FROM sidemarks WHERE id = p_sidemark_id;
  
  -- Must be same tenant
  IF v_user_tenant_id != v_sidemark_tenant_id THEN
    RETURN FALSE;
  END IF;
  
  -- Get user's role
  v_user_role := public.get_user_role(p_user_id);
  
  -- Staff roles can access all sidemarks in tenant
  IF v_user_role IN ('admin', 'tenant_admin', 'manager', 'warehouse') THEN
    RETURN TRUE;
  END IF;
  
  -- Client users can only access their own account's sidemarks
  IF v_user_role = 'client_user' THEN
    SELECT account_id INTO v_user_account_id FROM users WHERE id = p_user_id;
    RETURN v_user_account_id = v_sidemark_account_id;
  END IF;
  
  RETURN FALSE;
END;
$$;

-- 11. ADD technician ROLE TO SEED FUNCTION
-- ============================================
CREATE OR REPLACE FUNCTION public.seed_standard_roles(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Insert Admin role if not exists
  INSERT INTO public.roles (tenant_id, name, description, permissions, is_system)
  SELECT p_tenant_id, 'admin', 'Full administrative access to all resources', '["*"]'::jsonb, true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.roles WHERE tenant_id = p_tenant_id AND name = 'admin' AND deleted_at IS NULL
  );

  -- Insert Manager role if not exists
  INSERT INTO public.roles (tenant_id, name, description, permissions, is_system)
  SELECT p_tenant_id, 'manager', 'Manage operations, billing, accounts, and warehouse staff', 
    '["items.read", "items.create", "items.update", "items.move", "accounts.read", "accounts.create", "accounts.update", "billing.read", "billing.create", "tasks.read", "tasks.create", "tasks.update", "tasks.assign", "reports.read", "reports.create", "notes.create", "notes.read", "movements.read", "attachments.create", "sidemarks.read", "sidemarks.create", "sidemarks.update"]'::jsonb, true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.roles WHERE tenant_id = p_tenant_id AND name = 'manager' AND deleted_at IS NULL
  );

  -- Insert Warehouse role if not exists
  INSERT INTO public.roles (tenant_id, name, description, permissions, is_system)
  SELECT p_tenant_id, 'warehouse', 'Warehouse operations - receiving, picking, moving inventory', 
    '["items.read", "items.create", "items.update", "items.move", "tasks.read", "tasks.update", "notes.create", "notes.read", "movements.read", "attachments.create", "sidemarks.read"]'::jsonb, true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.roles WHERE tenant_id = p_tenant_id AND name = 'warehouse' AND deleted_at IS NULL
  );

  -- Insert Technician role (for repair quotes)
  INSERT INTO public.roles (tenant_id, name, description, permissions, is_system)
  SELECT p_tenant_id, 'technician', 'External repair technician - limited access for quote submission', 
    '["quotes.read", "quotes.submit", "items.read", "attachments.create"]'::jsonb, true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.roles WHERE tenant_id = p_tenant_id AND name = 'technician' AND deleted_at IS NULL
  );

  -- Insert Client User role if not exists
  INSERT INTO public.roles (tenant_id, name, description, permissions, is_system)
  SELECT p_tenant_id, 'client_user', 'Client access - view own account inventory and orders only', 
    '["items.read", "orders.read", "orders.create", "notes.read", "sidemarks.read", "quotes.request"]'::jsonb, true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.roles WHERE tenant_id = p_tenant_id AND name = 'client_user' AND deleted_at IS NULL
  );
END;
$function$;

-- 12. ADD account_id TO USERS (for client users)
-- ============================================
ALTER TABLE public.users 
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_account_id ON public.users(account_id);

-- 13. GRANT PERMISSIONS
-- ============================================
GRANT ALL ON public.sidemarks TO authenticated;
GRANT ALL ON public.containers TO authenticated;
GRANT ALL ON public.role_permissions TO authenticated;
GRANT ALL ON public.tenant_settings TO authenticated;
