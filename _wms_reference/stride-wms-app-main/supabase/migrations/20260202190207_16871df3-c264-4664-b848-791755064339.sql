-- Allow NULL tenant_id for system roles
ALTER TABLE public.roles ALTER COLUMN tenant_id DROP NOT NULL;

-- Insert the admin_dev system role
INSERT INTO public.roles (id, name, description, is_system, tenant_id, permissions)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'admin_dev',
  'System administrator role for development and QA access',
  true,
  NULL,
  '["*"]'::jsonb
)
ON CONFLICT (id) DO NOTHING;

-- Create the user_is_admin_dev function used by the useAdminDev hook
CREATE OR REPLACE FUNCTION public.user_is_admin_dev(p_user_id uuid)
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
    WHERE ur.user_id = p_user_id
      AND r.name = 'admin_dev'
      AND r.is_system = true
      AND ur.deleted_at IS NULL
  )
$$;