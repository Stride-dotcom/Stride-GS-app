-- ============================================
-- ROLES: Create 4 standard user roles
-- ============================================

-- Create app_role enum type if not exists (for type safety)
DO $$ BEGIN
    CREATE TYPE public.app_role AS ENUM ('admin', 'manager', 'warehouse', 'client_user');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create has_role function for RLS policies
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.roles r ON ur.role_id = r.id
    WHERE ur.user_id = _user_id
      AND r.name = _role
      AND ur.deleted_at IS NULL
      AND r.deleted_at IS NULL
  )
$$;

-- Create function to get user's role name
CREATE OR REPLACE FUNCTION public.get_user_role(_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.name
  FROM public.user_roles ur
  JOIN public.roles r ON ur.role_id = r.id
  WHERE ur.user_id = _user_id
    AND ur.deleted_at IS NULL
    AND r.deleted_at IS NULL
  ORDER BY 
    CASE r.name 
      WHEN 'admin' THEN 1 
      WHEN 'tenant_admin' THEN 2
      WHEN 'manager' THEN 3 
      WHEN 'warehouse' THEN 4 
      WHEN 'client_user' THEN 5 
      ELSE 6 
    END
  LIMIT 1
$$;

-- ============================================
-- LOCATIONS: Add is_active column for soft archive
-- ============================================
ALTER TABLE public.locations ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;

-- Create index for faster location searches
CREATE INDEX IF NOT EXISTS idx_locations_code_search ON public.locations (code varchar_pattern_ops);
CREATE INDEX IF NOT EXISTS idx_locations_is_active ON public.locations (is_active) WHERE is_active = true;

-- ============================================
-- USER_ACCOUNTS: Link client users to accounts
-- ============================================
CREATE TABLE IF NOT EXISTS public.user_accounts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    access_level text DEFAULT 'read_only' CHECK (access_level IN ('read_only', 'read_write', 'admin')),
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    deleted_at timestamptz,
    UNIQUE(user_id, account_id)
);

-- Enable RLS on user_accounts
ALTER TABLE public.user_accounts ENABLE ROW LEVEL SECURITY;

-- RLS policies for user_accounts
CREATE POLICY "Users can view their own account assignments"
ON public.user_accounts FOR SELECT
USING (
    user_id = auth.uid() 
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'tenant_admin')
    OR public.has_role(auth.uid(), 'manager')
);

CREATE POLICY "Admins can manage user account assignments"
ON public.user_accounts FOR ALL
USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'tenant_admin')
);

-- ============================================
-- INVENTORY COLUMN CONFIG: Configurable columns per tenant/account
-- ============================================
CREATE TABLE IF NOT EXISTS public.inventory_column_configs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    account_id uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
    column_key text NOT NULL,
    display_label text NOT NULL,
    is_visible boolean DEFAULT true,
    is_required boolean DEFAULT false,
    sort_order integer DEFAULT 0,
    column_width integer,
    data_type text DEFAULT 'text',
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE(tenant_id, account_id, column_key)
);

-- Enable RLS
ALTER TABLE public.inventory_column_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their tenant column configs"
ON public.inventory_column_configs FOR SELECT
USING (tenant_id = public.user_tenant_id());

CREATE POLICY "Admins can manage column configs"
ON public.inventory_column_configs FOR ALL
USING (
    tenant_id = public.user_tenant_id() 
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'tenant_admin'))
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_inventory_column_configs_tenant ON public.inventory_column_configs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_user_accounts_user ON public.user_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_user_accounts_account ON public.user_accounts(account_id);