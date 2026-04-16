-- =============================================================================
-- SAAS SMS Add-On Activation + Terms Acceptance Audit
-- Migration: 20260215013000_saas_sms_addon_activation.sql
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Tenant SMS add-on activation state (one row per tenant)
-- ---------------------------------------------------------------------------
CREATE TABLE public.tenant_sms_addon_activation (
  tenant_id           uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  is_active           boolean NOT NULL DEFAULT false,
  activation_status   text NOT NULL DEFAULT 'not_activated'
                        CHECK (activation_status IN ('not_activated', 'active', 'paused', 'disabled')),
  terms_version       text,
  terms_accepted_at   timestamptz,
  terms_accepted_by   uuid REFERENCES auth.users(id),
  ip_address          text,
  user_agent          text,
  acceptance_source   text,
  activated_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER set_tenant_sms_addon_activation_updated_at
  BEFORE UPDATE ON public.tenant_sms_addon_activation
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.tenant_sms_addon_activation ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_sms_addon_activation_select_own"
  ON public.tenant_sms_addon_activation FOR SELECT
  TO authenticated
  USING (tenant_id = public.user_tenant_id());

-- ---------------------------------------------------------------------------
-- 2) Append-only activation audit log
-- ---------------------------------------------------------------------------
CREATE TABLE public.tenant_sms_addon_activation_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_type        text NOT NULL
                      CHECK (event_type IN ('activated', 'terms_reaccepted', 'deactivated', 'status_changed')),
  terms_version     text,
  accepted_by       uuid REFERENCES auth.users(id),
  ip_address        text,
  user_agent        text,
  acceptance_source text,
  metadata          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sms_addon_activation_log_tenant_created_at
  ON public.tenant_sms_addon_activation_log (tenant_id, created_at DESC);

ALTER TABLE public.tenant_sms_addon_activation_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_sms_addon_activation_log_select_own"
  ON public.tenant_sms_addon_activation_log FOR SELECT
  TO authenticated
  USING (tenant_id = public.user_tenant_id());

-- ---------------------------------------------------------------------------
-- 3) RPC: read my SMS add-on activation state (fail-open defaults)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_get_my_sms_addon_activation()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_row public.tenant_sms_addon_activation%ROWTYPE;
BEGIN
  v_tenant_id := public.user_tenant_id();

  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object(
      'is_active', false,
      'activation_status', 'not_activated',
      'terms_version', NULL,
      'terms_accepted_at', NULL,
      'terms_accepted_by', NULL,
      'ip_address', NULL,
      'user_agent', NULL,
      'acceptance_source', NULL,
      'activated_at', NULL,
      'updated_at', NULL
    );
  END IF;

  SELECT *
    INTO v_row
    FROM public.tenant_sms_addon_activation
   WHERE tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'is_active', false,
      'activation_status', 'not_activated',
      'terms_version', NULL,
      'terms_accepted_at', NULL,
      'terms_accepted_by', NULL,
      'ip_address', NULL,
      'user_agent', NULL,
      'acceptance_source', NULL,
      'activated_at', NULL,
      'updated_at', NULL
    );
  END IF;

  RETURN jsonb_build_object(
    'is_active', v_row.is_active,
    'activation_status', v_row.activation_status,
    'terms_version', v_row.terms_version,
    'terms_accepted_at', v_row.terms_accepted_at,
    'terms_accepted_by', v_row.terms_accepted_by,
    'ip_address', v_row.ip_address,
    'user_agent', v_row.user_agent,
    'acceptance_source', v_row.acceptance_source,
    'activated_at', v_row.activated_at,
    'updated_at', v_row.updated_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_get_my_sms_addon_activation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_get_my_sms_addon_activation() TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) RPC: activate SMS add-on and capture required terms acceptance audit
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_activate_sms_addon(
  p_terms_version text,
  p_acceptance_source text DEFAULT 'settings_sms_activation'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_tenant_id uuid;
  v_user_role text;
  v_headers_raw text;
  v_headers jsonb := '{}'::jsonb;
  v_ip_address text;
  v_user_agent text;
  v_existing_active boolean := false;
  v_event_type text;
  v_row public.tenant_sms_addon_activation%ROWTYPE;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  v_tenant_id := public.user_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Unable to resolve tenant for authenticated user';
  END IF;

  v_user_role := public.get_user_role(v_user_id);
  IF COALESCE(v_user_role, '') NOT IN ('tenant_admin', 'admin', 'admin_dev') THEN
    RAISE EXCEPTION 'Only tenant administrators can activate SMS add-on';
  END IF;

  IF COALESCE(BTRIM(p_terms_version), '') = '' THEN
    RAISE EXCEPTION 'terms_version is required';
  END IF;

  v_headers_raw := current_setting('request.headers', true);
  BEGIN
    IF COALESCE(v_headers_raw, '') <> '' THEN
      v_headers := v_headers_raw::jsonb;
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      v_headers := '{}'::jsonb;
  END;

  v_ip_address := NULLIF(BTRIM(split_part(COALESCE(v_headers->>'x-forwarded-for', ''), ',', 1)), '');
  IF v_ip_address IS NULL THEN
    v_ip_address := NULLIF(BTRIM(v_headers->>'cf-connecting-ip'), '');
  END IF;
  v_user_agent := NULLIF(BTRIM(v_headers->>'user-agent'), '');

  SELECT is_active
    INTO v_existing_active
    FROM public.tenant_sms_addon_activation
   WHERE tenant_id = v_tenant_id;

  INSERT INTO public.tenant_sms_addon_activation (
    tenant_id,
    is_active,
    activation_status,
    terms_version,
    terms_accepted_at,
    terms_accepted_by,
    ip_address,
    user_agent,
    acceptance_source,
    activated_at
  ) VALUES (
    v_tenant_id,
    true,
    'active',
    BTRIM(p_terms_version),
    now(),
    v_user_id,
    v_ip_address,
    v_user_agent,
    NULLIF(BTRIM(p_acceptance_source), ''),
    now()
  )
  ON CONFLICT (tenant_id) DO UPDATE SET
    is_active = true,
    activation_status = 'active',
    terms_version = EXCLUDED.terms_version,
    terms_accepted_at = EXCLUDED.terms_accepted_at,
    terms_accepted_by = EXCLUDED.terms_accepted_by,
    ip_address = COALESCE(EXCLUDED.ip_address, public.tenant_sms_addon_activation.ip_address),
    user_agent = COALESCE(EXCLUDED.user_agent, public.tenant_sms_addon_activation.user_agent),
    acceptance_source = COALESCE(EXCLUDED.acceptance_source, public.tenant_sms_addon_activation.acceptance_source),
    activated_at = COALESCE(public.tenant_sms_addon_activation.activated_at, EXCLUDED.activated_at)
  RETURNING *
    INTO v_row;

  v_event_type := CASE WHEN COALESCE(v_existing_active, false) THEN 'terms_reaccepted' ELSE 'activated' END;

  INSERT INTO public.tenant_sms_addon_activation_log (
    tenant_id,
    event_type,
    terms_version,
    accepted_by,
    ip_address,
    user_agent,
    acceptance_source,
    metadata
  ) VALUES (
    v_tenant_id,
    v_event_type,
    v_row.terms_version,
    v_user_id,
    v_ip_address,
    v_user_agent,
    v_row.acceptance_source,
    jsonb_build_object('performed_by_role', v_user_role)
  );

  RETURN jsonb_build_object(
    'is_active', v_row.is_active,
    'activation_status', v_row.activation_status,
    'terms_version', v_row.terms_version,
    'terms_accepted_at', v_row.terms_accepted_at,
    'terms_accepted_by', v_row.terms_accepted_by,
    'ip_address', v_row.ip_address,
    'user_agent', v_row.user_agent,
    'acceptance_source', v_row.acceptance_source,
    'activated_at', v_row.activated_at,
    'updated_at', v_row.updated_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_activate_sms_addon(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_activate_sms_addon(text, text) TO authenticated;

COMMENT ON TABLE public.tenant_sms_addon_activation IS 'Tenant-level SMS add-on activation status and latest terms acceptance evidence.';
COMMENT ON TABLE public.tenant_sms_addon_activation_log IS 'Append-only SMS add-on activation audit trail.';
COMMENT ON FUNCTION public.rpc_get_my_sms_addon_activation() IS 'Read tenant SMS add-on activation status with fail-open defaults.';
COMMENT ON FUNCTION public.rpc_activate_sms_addon(text, text) IS 'Activate tenant SMS add-on and capture terms acceptance audit fields (version, timestamp, user, IP, user-agent, source).';
