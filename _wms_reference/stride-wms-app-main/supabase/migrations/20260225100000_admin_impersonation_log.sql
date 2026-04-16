-- =============================================================================
-- Admin impersonation audit log & tenant listing RPC
-- Supports admin_dev tenant switcher / role simulation feature
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Audit log table for impersonation sessions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_impersonation_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL REFERENCES public.users(id),
  target_tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  simulated_role text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_impersonation_log_admin
  ON public.admin_impersonation_log(admin_user_id);

CREATE INDEX IF NOT EXISTS idx_admin_impersonation_log_tenant
  ON public.admin_impersonation_log(target_tenant_id);

ALTER TABLE public.admin_impersonation_log ENABLE ROW LEVEL SECURITY;

-- Only admin_dev users (or service_role) can read/write the log
DROP POLICY IF EXISTS "admin_impersonation_log_admin_dev" ON public.admin_impersonation_log;
CREATE POLICY "admin_impersonation_log_admin_dev"
  ON public.admin_impersonation_log
  FOR ALL
  TO authenticated
  USING (
    (SELECT current_setting('request.jwt.claim.role', true)) = 'service_role'
    OR public.current_user_is_admin_dev()
  )
  WITH CHECK (
    (SELECT current_setting('request.jwt.claim.role', true)) = 'service_role'
    OR public.current_user_is_admin_dev()
  );

-- ---------------------------------------------------------------------------
-- 2. RPC: list all tenants (admin_dev only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_list_all_tenants()
RETURNS TABLE (
  id uuid,
  name text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.current_user_is_admin_dev() THEN
    RAISE EXCEPTION 'FORBIDDEN: admin_dev only';
  END IF;

  RETURN QUERY
  SELECT t.id, t.name::text, t.created_at
  FROM public.tenants t
  ORDER BY t.name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_list_all_tenants() TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. RPC: list users for a given tenant (admin_dev only)
--    Used by impersonation to browse tenant users (informational only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_list_tenant_users(p_tenant_id uuid)
RETURNS TABLE (
  id uuid,
  email text,
  first_name text,
  last_name text,
  status text,
  role_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.current_user_is_admin_dev() THEN
    RAISE EXCEPTION 'FORBIDDEN: admin_dev only';
  END IF;

  RETURN QUERY
  SELECT
    u.id,
    u.email::text,
    u.first_name::text,
    u.last_name::text,
    u.status::text,
    public.get_user_role(u.id)::text AS role_name
  FROM public.users u
  WHERE u.tenant_id = p_tenant_id
    AND u.deleted_at IS NULL
  ORDER BY u.email;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_list_tenant_users(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. RPC: log impersonation start (admin_dev only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_log_impersonation_start(
  p_target_tenant_id uuid,
  p_simulated_role text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_log_id uuid;
BEGIN
  IF NOT public.current_user_is_admin_dev() THEN
    RAISE EXCEPTION 'FORBIDDEN: admin_dev only';
  END IF;

  INSERT INTO public.admin_impersonation_log (
    admin_user_id,
    target_tenant_id,
    simulated_role
  )
  VALUES (
    auth.uid(),
    p_target_tenant_id,
    lower(btrim(p_simulated_role))
  )
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_log_impersonation_start(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. RPC: log impersonation end (admin_dev only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_log_impersonation_end(p_log_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.current_user_is_admin_dev() THEN
    RAISE EXCEPTION 'FORBIDDEN: admin_dev only';
  END IF;

  UPDATE public.admin_impersonation_log
  SET ended_at = now()
  WHERE id = p_log_id
    AND admin_user_id = auth.uid()
    AND ended_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_log_impersonation_end(uuid) TO authenticated;
