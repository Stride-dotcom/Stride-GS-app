-- Create a function to seed standard roles for a tenant
CREATE OR REPLACE FUNCTION public.seed_standard_roles(p_tenant_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    '["items.read", "items.create", "items.update", "items.move", "accounts.read", "accounts.create", "accounts.update", "billing.read", "billing.create", "tasks.read", "tasks.create", "tasks.update", "tasks.assign", "reports.read", "reports.create", "notes.create", "notes.read", "movements.read", "attachments.create"]'::jsonb, true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.roles WHERE tenant_id = p_tenant_id AND name = 'manager' AND deleted_at IS NULL
  );

  -- Insert Warehouse role if not exists
  INSERT INTO public.roles (tenant_id, name, description, permissions, is_system)
  SELECT p_tenant_id, 'warehouse', 'Warehouse operations - receiving, picking, moving inventory', 
    '["items.read", "items.create", "items.update", "items.move", "tasks.read", "tasks.update", "notes.create", "notes.read", "movements.read", "attachments.create"]'::jsonb, true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.roles WHERE tenant_id = p_tenant_id AND name = 'warehouse' AND deleted_at IS NULL
  );

  -- Insert Client User role if not exists
  INSERT INTO public.roles (tenant_id, name, description, permissions, is_system)
  SELECT p_tenant_id, 'client_user', 'Client access - view own account inventory and orders only', 
    '["items.read", "orders.read", "orders.create", "notes.read"]'::jsonb, true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.roles WHERE tenant_id = p_tenant_id AND name = 'client_user' AND deleted_at IS NULL
  );
END;
$$;

-- Seed roles for all existing tenants
DO $$
DECLARE
  t_id UUID;
BEGIN
  FOR t_id IN SELECT id FROM public.tenants WHERE deleted_at IS NULL
  LOOP
    PERFORM public.seed_standard_roles(t_id);
  END LOOP;
END;
$$;

-- Create trigger to auto-seed roles when new tenant is created
CREATE OR REPLACE FUNCTION public.auto_seed_tenant_roles()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.seed_standard_roles(NEW.id);
  RETURN NEW;
END;
$$;

-- Drop trigger if exists and recreate
DROP TRIGGER IF EXISTS seed_tenant_roles ON public.tenants;
CREATE TRIGGER seed_tenant_roles
  AFTER INSERT ON public.tenants
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_seed_tenant_roles();