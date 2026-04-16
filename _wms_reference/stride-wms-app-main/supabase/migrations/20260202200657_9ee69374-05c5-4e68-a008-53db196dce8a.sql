-- Provide a safe way for the frontend to fetch the CURRENT user's roles + permissions
-- without needing direct SELECT access to public.roles (avoids RLS join returning roles:null).

CREATE OR REPLACE FUNCTION public.get_my_roles()
RETURNS TABLE (
  id uuid,
  name varchar,
  permissions jsonb,
  is_system boolean,
  tenant_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    r.id,
    r.name,
    r.permissions,
    r.is_system,
    r.tenant_id
  FROM public.user_roles ur
  JOIN public.roles r ON r.id = ur.role_id
  WHERE ur.user_id = auth.uid()
    AND ur.deleted_at IS NULL
    AND r.deleted_at IS NULL;
$$;

-- Tighten function execution permissions
REVOKE ALL ON FUNCTION public.get_my_roles() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_roles() TO authenticated;
