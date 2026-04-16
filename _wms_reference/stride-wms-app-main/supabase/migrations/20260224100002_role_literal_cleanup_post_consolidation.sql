-- =============================================================================
-- Post-consolidation role literal cleanup
-- -----------------------------------------------------------------------------
-- Goal:
--   Remove remaining references to deprecated roles in live SQL objects
--   (tenant_admin, warehouse_staff) without introducing any new roles.
-- =============================================================================

-- Normalize any lingering role values in role-scoped data.
DO $$
BEGIN
  IF to_regclass('public.tenant_in_app_role_eligibility') IS NOT NULL THEN
    INSERT INTO public.tenant_in_app_role_eligibility (tenant_id, role_name, is_eligible, updated_at, updated_by)
    SELECT
      tenant_id,
      'admin',
      is_eligible,
      updated_at,
      updated_by
    FROM public.tenant_in_app_role_eligibility
    WHERE role_name = 'tenant_admin'
    ON CONFLICT (tenant_id, role_name) DO UPDATE
    SET
      is_eligible = EXCLUDED.is_eligible,
      updated_at = GREATEST(public.tenant_in_app_role_eligibility.updated_at, EXCLUDED.updated_at),
      updated_by = COALESCE(EXCLUDED.updated_by, public.tenant_in_app_role_eligibility.updated_by);

    DELETE FROM public.tenant_in_app_role_eligibility
    WHERE role_name = 'tenant_admin';

    INSERT INTO public.tenant_in_app_role_eligibility (tenant_id, role_name, is_eligible, updated_at, updated_by)
    SELECT
      tenant_id,
      'warehouse',
      is_eligible,
      updated_at,
      updated_by
    FROM public.tenant_in_app_role_eligibility
    WHERE role_name = 'warehouse_staff'
    ON CONFLICT (tenant_id, role_name) DO UPDATE
    SET
      is_eligible = EXCLUDED.is_eligible,
      updated_at = GREATEST(public.tenant_in_app_role_eligibility.updated_at, EXCLUDED.updated_at),
      updated_by = COALESCE(EXCLUDED.updated_by, public.tenant_in_app_role_eligibility.updated_by);

    DELETE FROM public.tenant_in_app_role_eligibility
    WHERE role_name = 'warehouse_staff';
  END IF;
END
$$;

UPDATE public.app_issues
SET user_role = 'admin'
WHERE user_role = 'tenant_admin';

UPDATE public.app_issues
SET user_role = 'warehouse'
WHERE user_role = 'warehouse_staff';

-- Keep deprecated roles soft-deleted if they still exist.
UPDATE public.roles
SET deleted_at = COALESCE(deleted_at, now())
WHERE name IN ('tenant_admin', 'warehouse_staff')
  AND deleted_at IS NULL;

-- Rewrite live public functions to replace deprecated role literals.
DO $$
DECLARE
  v_oid oid;
  v_def text;
  v_new_def text;
BEGIN
  FOR v_oid IN
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
  LOOP
    v_def := pg_get_functiondef(v_oid);
    IF v_def LIKE '%''tenant_admin''%' OR v_def LIKE '%''warehouse_staff''%' THEN
      v_new_def := replace(
        replace(v_def, '''tenant_admin''', '''admin'''),
        '''warehouse_staff''',
        '''warehouse'''
      );
      IF v_new_def <> v_def THEN
        EXECUTE v_new_def;
      END IF;
    END IF;
  END LOOP;
END
$$;

-- Rewrite live public RLS policies to replace deprecated role literals.
DO $$
DECLARE
  p record;
  v_using text;
  v_check text;
  v_cmd text;
  v_roles text;
  v_sql text;
BEGIN
  FOR p IN
    SELECT
      pol.polname,
      pol.polcmd,
      pol.polpermissive,
      pol.polroles,
      pol.polqual,
      pol.polwithcheck,
      pol.polrelid,
      n.nspname,
      c.relname
    FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND (
        COALESCE(pg_get_expr(pol.polqual, pol.polrelid), '') LIKE '%''tenant_admin''%'
        OR COALESCE(pg_get_expr(pol.polqual, pol.polrelid), '') LIKE '%''warehouse_staff''%'
        OR COALESCE(pg_get_expr(pol.polwithcheck, pol.polrelid), '') LIKE '%''tenant_admin''%'
        OR COALESCE(pg_get_expr(pol.polwithcheck, pol.polrelid), '') LIKE '%''warehouse_staff''%'
      )
  LOOP
    v_using := replace(
      replace(COALESCE(pg_get_expr(p.polqual, p.polrelid), ''), '''tenant_admin''', '''admin'''),
      '''warehouse_staff''',
      '''warehouse'''
    );
    v_check := replace(
      replace(COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), ''), '''tenant_admin''', '''admin'''),
      '''warehouse_staff''',
      '''warehouse'''
    );

    v_cmd := CASE p.polcmd
      WHEN 'r' THEN 'SELECT'
      WHEN 'a' THEN 'INSERT'
      WHEN 'w' THEN 'UPDATE'
      WHEN 'd' THEN 'DELETE'
      ELSE 'ALL'
    END;

    SELECT COALESCE(string_agg(quote_ident(r.rolname), ', '), 'PUBLIC')
    INTO v_roles
    FROM pg_roles r
    WHERE r.oid = ANY (p.polroles);

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', p.polname, p.nspname, p.relname);

    v_sql := format(
      'CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s',
      p.polname,
      p.nspname,
      p.relname,
      CASE WHEN p.polpermissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
      v_cmd,
      v_roles
    );

    IF v_using <> '' THEN
      v_sql := v_sql || format(' USING (%s)', v_using);
    END IF;
    IF v_check <> '' THEN
      v_sql := v_sql || format(' WITH CHECK (%s)', v_check);
    END IF;

    EXECUTE v_sql;
  END LOOP;
END
$$;

-- Keep role ordering aligned with current role model.
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

  IF to_regclass('public.tenant_in_app_role_eligibility') IS NULL THEN
    RETURN QUERY
    SELECT
      lower(r.name) AS role_name,
      r.description AS role_description,
      COALESCE(r.is_system, false) AS is_system,
      true AS is_eligible,
      NULL::timestamptz AS updated_at
    FROM public.roles r
    WHERE r.tenant_id = v_tenant_id
      AND r.deleted_at IS NULL
    ORDER BY
      CASE lower(r.name)
        WHEN 'admin' THEN 1
        WHEN 'manager' THEN 2
        WHEN 'billing_manager' THEN 3
        WHEN 'warehouse' THEN 4
        WHEN 'technician' THEN 5
        WHEN 'client_user' THEN 6
        ELSE 100
      END,
      lower(r.name);
  ELSE
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
        WHEN 'admin' THEN 1
        WHEN 'manager' THEN 2
        WHEN 'billing_manager' THEN 3
        WHEN 'warehouse' THEN 4
        WHEN 'technician' THEN 5
        WHEN 'client_user' THEN 6
        ELSE 100
      END,
      lower(r.name);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_get_my_in_app_role_eligibility() TO authenticated;
