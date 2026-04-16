-- Fix remaining function search path
CREATE OR REPLACE FUNCTION public.user_tenant_id()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
    v_tenant_id UUID;
BEGIN
    SELECT tenant_id INTO v_tenant_id
    FROM public.users
    WHERE id = auth.uid()
    AND deleted_at IS NULL;
    
    RETURN v_tenant_id;
EXCEPTION
    WHEN OTHERS THEN
        RETURN NULL;
END;
$function$;