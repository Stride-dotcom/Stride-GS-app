
-- =============================================
-- A) SIDEMARKS UNIQUENESS + SCOPE
-- =============================================

-- Drop the old unique constraint on sidemark_code (we want uniqueness on name per account)
ALTER TABLE public.sidemarks DROP CONSTRAINT IF EXISTS sidemarks_tenant_code_unique;

-- Create partial unique index for unique active sidemark_name per (tenant_id, account_id), case-insensitive
-- This only applies to non-archived sidemarks (where deleted_at IS NULL)
CREATE UNIQUE INDEX IF NOT EXISTS sidemarks_tenant_account_name_unique 
  ON public.sidemarks (tenant_id, account_id, LOWER(sidemark_name))
  WHERE deleted_at IS NULL;

-- Keep a non-unique index on sidemark_code for lookups (optional but helpful)
CREATE INDEX IF NOT EXISTS sidemarks_tenant_code_idx 
  ON public.sidemarks (tenant_id, sidemark_code)
  WHERE deleted_at IS NULL AND sidemark_code IS NOT NULL;

-- Make sidemark_code nullable (no longer required)
ALTER TABLE public.sidemarks ALTER COLUMN sidemark_code DROP NOT NULL;

-- =============================================
-- B) CLIENT SIDEMARK MODE - TENANT SETTINGS
-- =============================================

-- Insert default tenant setting for client_sidemark_mode if not exists
-- Modes: 'off' | 'view' | 'edit' | 'create' (default: 'view')
INSERT INTO public.tenant_settings (tenant_id, setting_key, setting_value)
SELECT id, 'client_sidemark_mode', '"view"'::jsonb
FROM public.tenants
WHERE NOT EXISTS (
  SELECT 1 FROM public.tenant_settings ts 
  WHERE ts.tenant_id = tenants.id 
    AND ts.setting_key = 'client_sidemark_mode'
);

-- =============================================
-- B) CLIENT SIDEMARK MODE - ACCOUNT OVERRIDE
-- =============================================

-- Add per-account override column for client sidemark mode
-- NULL means use tenant default, otherwise: 'off' | 'view' | 'edit' | 'create'
ALTER TABLE public.accounts 
  ADD COLUMN IF NOT EXISTS client_sidemark_mode TEXT DEFAULT NULL;

-- Add check constraint to validate the enum values
ALTER TABLE public.accounts
  DROP CONSTRAINT IF EXISTS accounts_client_sidemark_mode_check;

ALTER TABLE public.accounts
  ADD CONSTRAINT accounts_client_sidemark_mode_check 
  CHECK (client_sidemark_mode IS NULL OR client_sidemark_mode IN ('off', 'view', 'edit', 'create'));

-- =============================================
-- B) CLIENT SIDEMARK RLS POLICIES
-- =============================================

-- Helper function to get effective client sidemark mode for an account
CREATE OR REPLACE FUNCTION public.get_client_sidemark_mode(p_account_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_mode TEXT;
  v_tenant_id UUID;
  v_tenant_mode TEXT;
BEGIN
  -- Get account's override and tenant_id
  SELECT client_sidemark_mode, tenant_id INTO v_account_mode, v_tenant_id
  FROM accounts WHERE id = p_account_id;
  
  -- If account has override, use it
  IF v_account_mode IS NOT NULL THEN
    RETURN v_account_mode;
  END IF;
  
  -- Otherwise get tenant default
  SELECT COALESCE(setting_value::text, '"view"')::text INTO v_tenant_mode
  FROM tenant_settings 
  WHERE tenant_id = v_tenant_id AND setting_key = 'client_sidemark_mode';
  
  -- Remove JSON quotes and return
  RETURN COALESCE(TRIM(BOTH '"' FROM v_tenant_mode), 'view');
END;
$$;

-- Drop existing policy to replace with more granular ones
DROP POLICY IF EXISTS sidemarks_tenant_isolation ON public.sidemarks;

-- Policy: Staff (admin, manager, warehouse) can do everything within tenant
CREATE POLICY sidemarks_staff_all ON public.sidemarks
FOR ALL
TO authenticated
USING (
  tenant_id = public.user_tenant_id()
  AND public.get_user_role(auth.uid()) IN ('admin', 'tenant_admin', 'manager', 'warehouse')
)
WITH CHECK (
  tenant_id = public.user_tenant_id()
  AND public.get_user_role(auth.uid()) IN ('admin', 'tenant_admin', 'manager', 'warehouse')
);

-- Policy: Client users can SELECT sidemarks for their account if mode != 'off'
CREATE POLICY sidemarks_client_select ON public.sidemarks
FOR SELECT
TO authenticated
USING (
  tenant_id = public.user_tenant_id()
  AND public.get_user_role(auth.uid()) = 'client_user'
  AND account_id = (SELECT account_id FROM users WHERE id = auth.uid())
  AND public.get_client_sidemark_mode(account_id) != 'off'
  AND deleted_at IS NULL
);

-- Policy: Client users can INSERT if mode = 'create'
CREATE POLICY sidemarks_client_insert ON public.sidemarks
FOR INSERT
TO authenticated
WITH CHECK (
  tenant_id = public.user_tenant_id()
  AND public.get_user_role(auth.uid()) = 'client_user'
  AND account_id = (SELECT account_id FROM users WHERE id = auth.uid())
  AND public.get_client_sidemark_mode(account_id) = 'create'
);

-- Policy: Client users can UPDATE if mode = 'edit' or 'create'
CREATE POLICY sidemarks_client_update ON public.sidemarks
FOR UPDATE
TO authenticated
USING (
  tenant_id = public.user_tenant_id()
  AND public.get_user_role(auth.uid()) = 'client_user'
  AND account_id = (SELECT account_id FROM users WHERE id = auth.uid())
  AND public.get_client_sidemark_mode(account_id) IN ('edit', 'create')
  AND deleted_at IS NULL
)
WITH CHECK (
  tenant_id = public.user_tenant_id()
  AND public.get_user_role(auth.uid()) = 'client_user'
  AND account_id = (SELECT account_id FROM users WHERE id = auth.uid())
  AND public.get_client_sidemark_mode(account_id) IN ('edit', 'create')
);
