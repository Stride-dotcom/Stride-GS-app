-- =============================================================================
-- Multi-tenant comped billing overrides (DL-2026-02-14-087)
-- Migration: 20260215073000_comped_billing_overrides.sql
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Tenant billing override state + audit log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenant_billing_overrides (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  is_comped boolean NOT NULL DEFAULT false,
  comped_reason text,
  comped_note text,
  expires_at timestamptz,
  comped_at timestamptz,
  comped_by uuid,
  removed_at timestamptz,
  removed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS set_tenant_billing_overrides_updated_at ON public.tenant_billing_overrides;
CREATE TRIGGER set_tenant_billing_overrides_updated_at
  BEFORE UPDATE ON public.tenant_billing_overrides
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.tenant_billing_override_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  actor_user_id uuid,
  is_comped boolean NOT NULL,
  reason text,
  note text,
  expires_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 2) RLS policies
-- ---------------------------------------------------------------------------
ALTER TABLE public.tenant_billing_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_billing_override_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_billing_overrides_select_own_or_admin_dev" ON public.tenant_billing_overrides;
CREATE POLICY "tenant_billing_overrides_select_own_or_admin_dev"
  ON public.tenant_billing_overrides FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.user_tenant_id()
    OR public.current_user_is_admin_dev()
  );

DROP POLICY IF EXISTS "tenant_billing_overrides_write_admin_dev" ON public.tenant_billing_overrides;
CREATE POLICY "tenant_billing_overrides_write_admin_dev"
  ON public.tenant_billing_overrides FOR ALL
  TO authenticated
  USING (public.current_user_is_admin_dev())
  WITH CHECK (public.current_user_is_admin_dev());

DROP POLICY IF EXISTS "tenant_billing_override_log_select_own_or_admin_dev" ON public.tenant_billing_override_log;
CREATE POLICY "tenant_billing_override_log_select_own_or_admin_dev"
  ON public.tenant_billing_override_log FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.user_tenant_id()
    OR public.current_user_is_admin_dev()
  );

DROP POLICY IF EXISTS "tenant_billing_override_log_insert_admin_dev" ON public.tenant_billing_override_log;
CREATE POLICY "tenant_billing_override_log_insert_admin_dev"
  ON public.tenant_billing_override_log FOR INSERT
  TO authenticated
  WITH CHECK (public.current_user_is_admin_dev());

-- ---------------------------------------------------------------------------
-- 3) Tenant RPC: read own billing override
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_get_my_billing_override()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_row public.tenant_billing_overrides%ROWTYPE;
  v_is_comped_active boolean := false;
BEGIN
  v_tenant_id := public.user_tenant_id();

  SELECT *
    INTO v_row
    FROM public.tenant_billing_overrides bo
   WHERE bo.tenant_id = v_tenant_id;

  IF FOUND THEN
    v_is_comped_active := COALESCE(v_row.is_comped, false)
      AND (v_row.expires_at IS NULL OR v_row.expires_at > now());
  END IF;

  RETURN jsonb_build_object(
    'tenant_id', v_tenant_id,
    'is_comped', v_is_comped_active,
    'raw_is_comped', COALESCE(v_row.is_comped, false),
    'comped_reason', v_row.comped_reason,
    'comped_note', v_row.comped_note,
    'expires_at', v_row.expires_at,
    'comped_at', v_row.comped_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_get_my_billing_override() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_get_my_billing_override() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_get_my_billing_override() TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) Override existing subscription gate RPC to include comped bypass
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_get_my_subscription_gate()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_status text;
  v_grace timestamptz;
  v_comped_raw boolean;
  v_comped_expires timestamptz;
  v_is_comped_active boolean := false;
BEGIN
  v_tenant_id := public.user_tenant_id();

  SELECT bo.is_comped, bo.expires_at
    INTO v_comped_raw, v_comped_expires
    FROM public.tenant_billing_overrides bo
   WHERE bo.tenant_id = v_tenant_id;

  v_is_comped_active := COALESCE(v_comped_raw, false)
    AND (v_comped_expires IS NULL OR v_comped_expires > now());

  IF v_is_comped_active THEN
    RETURN jsonb_build_object(
      'status', 'comped',
      'is_active', true,
      'is_in_grace', false,
      'is_restricted', false,
      'is_comped', true,
      'comp_expires_at', v_comped_expires
    );
  END IF;

  SELECT ts.status, ts.grace_until
    INTO v_status, v_grace
    FROM public.tenant_subscriptions ts
   WHERE ts.tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status', 'none',
      'is_active', true,
      'is_in_grace', false,
      'is_restricted', false,
      'is_comped', false
    );
  END IF;

  IF v_status = 'active' THEN
    RETURN jsonb_build_object(
      'status', v_status,
      'is_active', true,
      'is_in_grace', false,
      'is_restricted', false,
      'is_comped', false
    );
  END IF;

  IF v_grace IS NOT NULL AND v_grace > now() THEN
    RETURN jsonb_build_object(
      'status', v_status,
      'is_active', true,
      'is_in_grace', true,
      'is_restricted', false,
      'grace_until', v_grace,
      'is_comped', false
    );
  END IF;

  RETURN jsonb_build_object(
    'status', v_status,
    'is_active', false,
    'is_in_grace', false,
    'is_restricted', true,
    'is_comped', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_get_my_subscription_gate() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_get_my_subscription_gate() TO authenticated;

-- ---------------------------------------------------------------------------
-- 5) Admin RPC: list tenant billing overrides
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_admin_list_tenant_billing_overrides(
  p_filter text DEFAULT 'all'
)
RETURNS TABLE (
  tenant_id uuid,
  tenant_name text,
  company_name text,
  company_email text,
  app_subdomain text,
  tenant_status text,
  subscription_status text,
  stripe_subscription_id text,
  stripe_customer_id text,
  is_comped boolean,
  comped_reason text,
  comped_note text,
  expires_at timestamptz,
  comped_at timestamptz,
  comped_by uuid,
  removed_at timestamptz,
  removed_by uuid,
  override_updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_filter text := COALESCE(NULLIF(lower(trim(p_filter)), ''), 'all');
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.current_user_is_admin_dev() THEN
    RAISE EXCEPTION 'Only admin_dev users can list billing overrides';
  END IF;

  RETURN QUERY
  SELECT
    t.id AS tenant_id,
    t.name AS tenant_name,
    tcs.company_name,
    tcs.company_email,
    tcs.app_subdomain,
    t.status AS tenant_status,
    COALESCE(ts.status, 'none') AS subscription_status,
    ts.stripe_subscription_id,
    ts.stripe_customer_id,
    (
      COALESCE(bo.is_comped, false)
      AND (bo.expires_at IS NULL OR bo.expires_at > now())
    ) AS is_comped,
    bo.comped_reason,
    bo.comped_note,
    bo.expires_at,
    bo.comped_at,
    bo.comped_by,
    bo.removed_at,
    bo.removed_by,
    bo.updated_at AS override_updated_at
  FROM public.tenants t
  LEFT JOIN public.tenant_company_settings tcs
    ON tcs.tenant_id = t.id
  LEFT JOIN public.tenant_subscriptions ts
    ON ts.tenant_id = t.id
  LEFT JOIN public.tenant_billing_overrides bo
    ON bo.tenant_id = t.id
  WHERE t.deleted_at IS NULL
    AND (
      v_filter = 'all'
      OR (
        v_filter = 'comped'
        AND COALESCE(bo.is_comped, false)
        AND (bo.expires_at IS NULL OR bo.expires_at > now())
      )
      OR (
        v_filter = 'not_comped'
        AND NOT (
          COALESCE(bo.is_comped, false)
          AND (bo.expires_at IS NULL OR bo.expires_at > now())
        )
      )
    )
  ORDER BY
    (
      COALESCE(bo.is_comped, false)
      AND (bo.expires_at IS NULL OR bo.expires_at > now())
    ) DESC,
    bo.updated_at DESC NULLS LAST,
    t.name ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_admin_list_tenant_billing_overrides(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_admin_list_tenant_billing_overrides(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_list_tenant_billing_overrides(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6) Admin RPC: set tenant comped override + audit event
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_admin_set_tenant_billing_override(
  p_tenant_id uuid,
  p_is_comped boolean,
  p_reason text DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev public.tenant_billing_overrides%ROWTYPE;
  v_row public.tenant_billing_overrides%ROWTYPE;
  v_actor uuid := auth.uid();
  v_reason text := NULLIF(trim(p_reason), '');
  v_note text := NULLIF(trim(p_note), '');
  v_event_type text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.current_user_is_admin_dev() THEN
    RAISE EXCEPTION 'Only admin_dev users can set billing overrides';
  END IF;

  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'p_tenant_id is required';
  END IF;

  SELECT *
    INTO v_prev
    FROM public.tenant_billing_overrides bo
   WHERE bo.tenant_id = p_tenant_id;

  INSERT INTO public.tenant_billing_overrides (
    tenant_id,
    is_comped,
    comped_reason,
    comped_note,
    expires_at,
    comped_at,
    comped_by,
    removed_at,
    removed_by,
    updated_at
  )
  VALUES (
    p_tenant_id,
    p_is_comped,
    CASE WHEN p_is_comped THEN v_reason ELSE NULL END,
    v_note,
    CASE WHEN p_is_comped THEN p_expires_at ELSE NULL END,
    CASE WHEN p_is_comped THEN now() ELSE v_prev.comped_at END,
    CASE WHEN p_is_comped THEN v_actor ELSE v_prev.comped_by END,
    CASE WHEN p_is_comped THEN NULL ELSE now() END,
    CASE WHEN p_is_comped THEN NULL ELSE v_actor END,
    now()
  )
  ON CONFLICT (tenant_id)
  DO UPDATE SET
    is_comped = EXCLUDED.is_comped,
    comped_reason = EXCLUDED.comped_reason,
    comped_note = EXCLUDED.comped_note,
    expires_at = EXCLUDED.expires_at,
    comped_at = EXCLUDED.comped_at,
    comped_by = EXCLUDED.comped_by,
    removed_at = EXCLUDED.removed_at,
    removed_by = EXCLUDED.removed_by,
    updated_at = now()
  RETURNING *
  INTO v_row;

  IF p_is_comped THEN
    IF v_prev.tenant_id IS NULL OR COALESCE(v_prev.is_comped, false) = false THEN
      v_event_type := 'override_enabled';
    ELSE
      v_event_type := 'override_updated';
    END IF;
  ELSE
    IF COALESCE(v_prev.is_comped, false) = true THEN
      v_event_type := 'override_disabled';
    ELSE
      v_event_type := 'override_updated';
    END IF;
  END IF;

  INSERT INTO public.tenant_billing_override_log (
    tenant_id,
    event_type,
    actor_user_id,
    is_comped,
    reason,
    note,
    expires_at,
    metadata
  )
  VALUES (
    p_tenant_id,
    v_event_type,
    v_actor,
    p_is_comped,
    CASE WHEN p_is_comped THEN v_reason ELSE NULL END,
    v_note,
    CASE WHEN p_is_comped THEN p_expires_at ELSE NULL END,
    jsonb_build_object(
      'previous_is_comped', COALESCE(v_prev.is_comped, false),
      'new_is_comped', p_is_comped,
      'previous_expires_at', v_prev.expires_at
    )
  );

  RETURN jsonb_build_object(
    'tenant_id', v_row.tenant_id,
    'is_comped', (
      COALESCE(v_row.is_comped, false)
      AND (v_row.expires_at IS NULL OR v_row.expires_at > now())
    ),
    'raw_is_comped', v_row.is_comped,
    'comped_reason', v_row.comped_reason,
    'comped_note', v_row.comped_note,
    'expires_at', v_row.expires_at,
    'comped_at', v_row.comped_at,
    'updated_at', v_row.updated_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_admin_set_tenant_billing_override(uuid, boolean, text, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_admin_set_tenant_billing_override(uuid, boolean, text, text, timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_set_tenant_billing_override(uuid, boolean, text, text, timestamptz) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7) Admin RPC: read billing override audit history
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_admin_get_tenant_billing_override_log(
  p_tenant_id uuid,
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  event_type text,
  actor_user_id uuid,
  is_comped boolean,
  reason text,
  note text,
  expires_at timestamptz,
  metadata jsonb,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.current_user_is_admin_dev() THEN
    RAISE EXCEPTION 'Only admin_dev users can view override history';
  END IF;

  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'p_tenant_id is required';
  END IF;

  v_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);

  RETURN QUERY
  SELECT
    l.id,
    l.tenant_id,
    l.event_type,
    l.actor_user_id,
    l.is_comped,
    l.reason,
    l.note,
    l.expires_at,
    l.metadata,
    l.created_at
  FROM public.tenant_billing_override_log l
  WHERE l.tenant_id = p_tenant_id
  ORDER BY l.created_at DESC
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_admin_get_tenant_billing_override_log(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_admin_get_tenant_billing_override_log(uuid, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_get_tenant_billing_override_log(uuid, integer) TO authenticated;

COMMENT ON TABLE public.tenant_billing_overrides IS
'Tenant-level billing override state; comped tenants bypass Stripe checkout/paywall and are excluded from billed targeting.';
COMMENT ON TABLE public.tenant_billing_override_log IS
'Append-only audit trail of admin comped billing override changes.';
COMMENT ON FUNCTION public.rpc_get_my_billing_override() IS
'Returns current tenant billing override state, including whether comped is currently active.';
COMMENT ON FUNCTION public.rpc_admin_list_tenant_billing_overrides(text) IS
'Admin-dev list of tenants with subscription context and comped override status.';
COMMENT ON FUNCTION public.rpc_admin_set_tenant_billing_override(uuid, boolean, text, text, timestamptz) IS
'Admin-dev setter for tenant comped override state with append-only audit logging.';
COMMENT ON FUNCTION public.rpc_admin_get_tenant_billing_override_log(uuid, integer) IS
'Admin-dev read access to tenant comped override history.';
