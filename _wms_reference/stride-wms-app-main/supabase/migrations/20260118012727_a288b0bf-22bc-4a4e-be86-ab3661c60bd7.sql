-- Fix is_tenant_admin() function with search_path (no drop needed, use CREATE OR REPLACE)
CREATE OR REPLACE FUNCTION public.is_tenant_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
    RETURN EXISTS (
        SELECT 1
        FROM public.user_roles ur
        JOIN public.roles r ON r.id = ur.role_id
        JOIN public.users u ON u.id = ur.user_id
        WHERE u.id = auth.uid()
        AND r.name = 'admin'
        AND u.tenant_id = public.get_current_user_tenant_id()
        AND ur.deleted_at IS NULL
    );
END;
$function$;