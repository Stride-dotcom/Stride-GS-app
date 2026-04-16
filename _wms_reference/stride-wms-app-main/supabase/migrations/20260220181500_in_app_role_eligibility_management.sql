-- =============================================================================
-- In-app alert role eligibility management (tenant scoped)
-- - Tenant admins can control which role tokens are eligible to receive in-app alerts
-- - send-alerts resolves role tokens and filters against this policy
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tenant_in_app_role_eligibility (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  role_name text NOT NULL,
  is_eligible boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id),
  PRIMARY KEY (tenant_id, role_name)
);

CREATE INDEX IF NOT EXISTS idx_tenant_in_app_role_eligibility_tenant
  ON public.tenant_in_app_role_eligibility(tenant_id);

ALTER TABLE public.tenant_in_app_role_eligibility ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_in_app_role_eligibility_select" ON public.tenant_in_app_role_eligibility;
CREATE POLICY "tenant_in_app_role_eligibility_select"
  ON public.tenant_in_app_role_eligibility
  FOR SELECT
  TO authenticated
  USING (
    (SELECT current_setting('request.jwt.claim.role', true)) = 'service_role'
    OR public.current_user_is_admin_dev()
    OR tenant_id = public.user_tenant_id()
  );

DROP POLICY IF EXISTS "tenant_in_app_role_eligibility_write" ON public.tenant_in_app_role_eligibility;
CREATE POLICY "tenant_in_app_role_eligibility_write"
  ON public.tenant_in_app_role_eligibility
  FOR ALL
  TO authenticated
  USING (
    (SELECT current_setting('request.jwt.claim.role', true)) = 'service_role'
    OR public.current_user_is_admin_dev()
    OR tenant_id = public.user_tenant_id()
  )
  WITH CHECK (
    (SELECT current_setting('request.jwt.claim.role', true)) = 'service_role'
    OR public.current_user_is_admin_dev()
    OR tenant_id = public.user_tenant_id()
  );

-- ---------------------------------------------------------------------------
-- Tenant RPC: list my role eligibility for in-app alerts
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_get_my_in_app_role_eligibility()
RETURNS TABLE (
  role_name text,
  role_description text,
  is_system boolean,
  is_eligible boolean,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid := public.user_tenant_id();
BEGIN
  IF auth.uid() IS NULL OR v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  RETURN QUERY
  SELECT
    lower(r.name) AS role_name,
    r.description AS role_description,
    COALESCE(r.is_system, false) AS is_system,
    COALESCE(e.is_eligible, true) AS is_eligible,
    e.updated_at
  FROM public.roles r
  LEFT JOIN public.tenant_in_app_role_eligibility e
    ON e.tenant_id = r.tenant_id
   AND e.role_name = lower(r.name)
  WHERE r.tenant_id = v_tenant_id
    AND r.deleted_at IS NULL
  ORDER BY
    CASE lower(r.name)
      WHEN 'tenant_admin' THEN 1
      WHEN 'admin' THEN 2
      WHEN 'manager' THEN 3
      WHEN 'warehouse' THEN 4
      WHEN 'warehouse_staff' THEN 5
      WHEN 'client_user' THEN 6
      ELSE 100
    END,
    lower(r.name);
END;
$$;

-- ---------------------------------------------------------------------------
-- Tenant RPC: set one role eligibility entry
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_set_my_in_app_role_eligibility(
  p_role_name text,
  p_is_eligible boolean
)
RETURNS TABLE (
  role_name text,
  is_eligible boolean,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid := public.user_tenant_id();
  v_role_name text := lower(btrim(COALESCE(p_role_name, '')));
BEGIN
  IF auth.uid() IS NULL OR v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  IF v_role_name = '' THEN
    RAISE EXCEPTION 'p_role_name is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.roles r
    WHERE r.tenant_id = v_tenant_id
      AND r.deleted_at IS NULL
      AND lower(r.name) = v_role_name
  ) THEN
    RAISE EXCEPTION 'Role not found for tenant: %', v_role_name;
  END IF;

  RETURN QUERY
  INSERT INTO public.tenant_in_app_role_eligibility (
    tenant_id,
    role_name,
    is_eligible,
    updated_at,
    updated_by
  )
  VALUES (
    v_tenant_id,
    v_role_name,
    COALESCE(p_is_eligible, true),
    now(),
    auth.uid()
  )
  ON CONFLICT (tenant_id, role_name) DO UPDATE
  SET
    is_eligible = EXCLUDED.is_eligible,
    updated_at = now(),
    updated_by = auth.uid()
  RETURNING
    tenant_in_app_role_eligibility.role_name,
    tenant_in_app_role_eligibility.is_eligible,
    tenant_in_app_role_eligibility.updated_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_get_my_in_app_role_eligibility() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_set_my_in_app_role_eligibility(text, boolean) TO authenticated;
