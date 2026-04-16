-- =============================================================================
-- Platform-managed SMS sender lifecycle (toll-free default)
-- Migration: 20260215030000_platform_managed_sms_sender.sql
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Tenant sender profile (one row per tenant)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenant_sms_sender_profiles (
  tenant_id                  uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  sender_type                text NOT NULL DEFAULT 'toll_free'
                               CHECK (sender_type IN ('toll_free')),
  provisioning_status        text NOT NULL DEFAULT 'not_requested'
                               CHECK (
                                 provisioning_status IN (
                                   'not_requested',
                                   'requested',
                                   'provisioning',
                                   'pending_verification',
                                   'approved',
                                   'rejected',
                                   'disabled'
                                 )
                               ),
  twilio_phone_number_sid    text,
  twilio_phone_number_e164   text,
  requested_at               timestamptz,
  requested_by               uuid REFERENCES auth.users(id),
  verification_submitted_at  timestamptz,
  verification_approved_at   timestamptz,
  verification_rejected_at   timestamptz,
  billing_start_at           timestamptz,
  last_error                 text,
  metadata                   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS set_tenant_sms_sender_profiles_updated_at ON public.tenant_sms_sender_profiles;
CREATE TRIGGER set_tenant_sms_sender_profiles_updated_at
  BEFORE UPDATE ON public.tenant_sms_sender_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.tenant_sms_sender_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_sms_sender_profiles_select_own" ON public.tenant_sms_sender_profiles;
CREATE POLICY "tenant_sms_sender_profiles_select_own"
  ON public.tenant_sms_sender_profiles FOR SELECT
  TO authenticated
  USING (tenant_id = public.user_tenant_id());

-- ---------------------------------------------------------------------------
-- 2) Append-only sender lifecycle audit log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenant_sms_sender_profile_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_type     text NOT NULL
                   CHECK (
                     event_type IN (
                       'requested',
                       'status_changed',
                       'verification_approved',
                       'verification_rejected',
                       'number_assigned'
                     )
                   ),
  actor_user_id  uuid REFERENCES auth.users(id),
  status_from    text,
  status_to      text,
  notes          text,
  metadata       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenant_sms_sender_profile_log_tenant_created_at
  ON public.tenant_sms_sender_profile_log (tenant_id, created_at DESC);

ALTER TABLE public.tenant_sms_sender_profile_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_sms_sender_profile_log_select_own" ON public.tenant_sms_sender_profile_log;
CREATE POLICY "tenant_sms_sender_profile_log_select_own"
  ON public.tenant_sms_sender_profile_log FOR SELECT
  TO authenticated
  USING (tenant_id = public.user_tenant_id());

-- ---------------------------------------------------------------------------
-- 3) RPC: read my sender profile (fail-open defaults)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_get_my_sms_sender_profile()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_row public.tenant_sms_sender_profiles%ROWTYPE;
BEGIN
  v_tenant_id := public.user_tenant_id();

  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object(
      'tenant_id', NULL,
      'sender_type', 'toll_free',
      'provisioning_status', 'not_requested',
      'twilio_phone_number_sid', NULL,
      'twilio_phone_number_e164', NULL,
      'requested_at', NULL,
      'verification_submitted_at', NULL,
      'verification_approved_at', NULL,
      'verification_rejected_at', NULL,
      'billing_start_at', NULL,
      'last_error', NULL,
      'updated_at', NULL
    );
  END IF;

  SELECT *
    INTO v_row
    FROM public.tenant_sms_sender_profiles
   WHERE tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'tenant_id', v_tenant_id,
      'sender_type', 'toll_free',
      'provisioning_status', 'not_requested',
      'twilio_phone_number_sid', NULL,
      'twilio_phone_number_e164', NULL,
      'requested_at', NULL,
      'verification_submitted_at', NULL,
      'verification_approved_at', NULL,
      'verification_rejected_at', NULL,
      'billing_start_at', NULL,
      'last_error', NULL,
      'updated_at', NULL
    );
  END IF;

  RETURN jsonb_build_object(
    'tenant_id', v_row.tenant_id,
    'sender_type', v_row.sender_type,
    'provisioning_status', v_row.provisioning_status,
    'twilio_phone_number_sid', v_row.twilio_phone_number_sid,
    'twilio_phone_number_e164', v_row.twilio_phone_number_e164,
    'requested_at', v_row.requested_at,
    'verification_submitted_at', v_row.verification_submitted_at,
    'verification_approved_at', v_row.verification_approved_at,
    'verification_rejected_at', v_row.verification_rejected_at,
    'billing_start_at', v_row.billing_start_at,
    'last_error', v_row.last_error,
    'updated_at', v_row.updated_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_get_my_sms_sender_profile() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_get_my_sms_sender_profile() TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) RPC: tenant-admin request for platform-managed toll-free sender
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_request_sms_sender_provisioning(
  p_sender_type text DEFAULT 'toll_free',
  p_request_source text DEFAULT 'settings_sms_activation_card'
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
  v_existing_status text;
  v_row public.tenant_sms_sender_profiles%ROWTYPE;
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
    RAISE EXCEPTION 'Only tenant administrators can request SMS provisioning';
  END IF;

  IF COALESCE(BTRIM(p_sender_type), '') <> 'toll_free' THEN
    RAISE EXCEPTION 'Only toll_free sender_type is supported in this rollout';
  END IF;

  SELECT provisioning_status
    INTO v_existing_status
    FROM public.tenant_sms_sender_profiles
   WHERE tenant_id = v_tenant_id;

  IF COALESCE(v_existing_status, '') IN ('requested', 'provisioning', 'pending_verification', 'approved') THEN
    SELECT *
      INTO v_row
      FROM public.tenant_sms_sender_profiles
     WHERE tenant_id = v_tenant_id;

    RETURN jsonb_build_object(
      'tenant_id', v_row.tenant_id,
      'sender_type', v_row.sender_type,
      'provisioning_status', v_row.provisioning_status,
      'twilio_phone_number_sid', v_row.twilio_phone_number_sid,
      'twilio_phone_number_e164', v_row.twilio_phone_number_e164,
      'requested_at', v_row.requested_at,
      'verification_submitted_at', v_row.verification_submitted_at,
      'verification_approved_at', v_row.verification_approved_at,
      'verification_rejected_at', v_row.verification_rejected_at,
      'billing_start_at', v_row.billing_start_at,
      'last_error', v_row.last_error,
      'updated_at', v_row.updated_at
    );
  END IF;

  INSERT INTO public.tenant_sms_sender_profiles (
    tenant_id,
    sender_type,
    provisioning_status,
    requested_at,
    requested_by,
    last_error
  ) VALUES (
    v_tenant_id,
    'toll_free',
    'requested',
    now(),
    v_user_id,
    NULL
  )
  ON CONFLICT (tenant_id) DO UPDATE SET
    sender_type = 'toll_free',
    provisioning_status = 'requested',
    requested_at = now(),
    requested_by = v_user_id,
    last_error = NULL
  RETURNING *
    INTO v_row;

  INSERT INTO public.tenant_sms_sender_profile_log (
    tenant_id,
    event_type,
    actor_user_id,
    status_from,
    status_to,
    notes,
    metadata
  ) VALUES (
    v_tenant_id,
    'requested',
    v_user_id,
    COALESCE(v_existing_status, 'not_requested'),
    'requested',
    'Tenant admin requested platform-managed toll-free sender provisioning',
    jsonb_build_object(
      'request_source', NULLIF(BTRIM(p_request_source), ''),
      'performed_by_role', v_user_role
    )
  );

  RETURN jsonb_build_object(
    'tenant_id', v_row.tenant_id,
    'sender_type', v_row.sender_type,
    'provisioning_status', v_row.provisioning_status,
    'twilio_phone_number_sid', v_row.twilio_phone_number_sid,
    'twilio_phone_number_e164', v_row.twilio_phone_number_e164,
    'requested_at', v_row.requested_at,
    'verification_submitted_at', v_row.verification_submitted_at,
    'verification_approved_at', v_row.verification_approved_at,
    'verification_rejected_at', v_row.verification_rejected_at,
    'billing_start_at', v_row.billing_start_at,
    'last_error', v_row.last_error,
    'updated_at', v_row.updated_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_request_sms_sender_provisioning(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_request_sms_sender_provisioning(text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5) RPC: admin-dev status update for sender lifecycle
--    - keeps SMS disabled until status=approved
--    - sets billing_start_at at first approval
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_admin_set_sms_sender_status(
  p_tenant_id uuid,
  p_status text,
  p_twilio_phone_number_sid text DEFAULT NULL,
  p_twilio_phone_number_e164 text DEFAULT NULL,
  p_error text DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_user_role text;
  v_existing_status text;
  v_event_type text;
  v_sms_addon_active boolean := false;
  v_enable_sms boolean := false;
  v_row public.tenant_sms_sender_profiles%ROWTYPE;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  v_user_role := public.get_user_role(v_user_id);
  IF COALESCE(v_user_role, '') <> 'admin_dev' THEN
    RAISE EXCEPTION 'Only admin_dev users can update sender lifecycle status';
  END IF;

  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'p_tenant_id is required';
  END IF;

  IF COALESCE(BTRIM(p_status), '') NOT IN ('requested', 'provisioning', 'pending_verification', 'approved', 'rejected', 'disabled') THEN
    RAISE EXCEPTION 'Invalid sender status';
  END IF;

  SELECT provisioning_status
    INTO v_existing_status
    FROM public.tenant_sms_sender_profiles
   WHERE tenant_id = p_tenant_id;

  INSERT INTO public.tenant_sms_sender_profiles (
    tenant_id,
    sender_type,
    provisioning_status,
    requested_at,
    requested_by,
    twilio_phone_number_sid,
    twilio_phone_number_e164,
    verification_submitted_at,
    verification_approved_at,
    verification_rejected_at,
    billing_start_at,
    last_error
  ) VALUES (
    p_tenant_id,
    'toll_free',
    BTRIM(p_status),
    CASE WHEN BTRIM(p_status) = 'requested' THEN now() ELSE NULL END,
    CASE WHEN BTRIM(p_status) = 'requested' THEN v_user_id ELSE NULL END,
    NULLIF(BTRIM(p_twilio_phone_number_sid), ''),
    NULLIF(BTRIM(p_twilio_phone_number_e164), ''),
    CASE WHEN BTRIM(p_status) = 'pending_verification' THEN now() ELSE NULL END,
    CASE WHEN BTRIM(p_status) = 'approved' THEN now() ELSE NULL END,
    CASE WHEN BTRIM(p_status) = 'rejected' THEN now() ELSE NULL END,
    CASE WHEN BTRIM(p_status) = 'approved' THEN now() ELSE NULL END,
    CASE WHEN BTRIM(p_status) = 'rejected' THEN NULLIF(BTRIM(p_error), '') ELSE NULL END
  )
  ON CONFLICT (tenant_id) DO UPDATE SET
    provisioning_status = BTRIM(p_status),
    twilio_phone_number_sid = COALESCE(NULLIF(BTRIM(p_twilio_phone_number_sid), ''), public.tenant_sms_sender_profiles.twilio_phone_number_sid),
    twilio_phone_number_e164 = COALESCE(NULLIF(BTRIM(p_twilio_phone_number_e164), ''), public.tenant_sms_sender_profiles.twilio_phone_number_e164),
    verification_submitted_at = CASE
      WHEN BTRIM(p_status) = 'pending_verification' THEN COALESCE(public.tenant_sms_sender_profiles.verification_submitted_at, now())
      ELSE public.tenant_sms_sender_profiles.verification_submitted_at
    END,
    verification_approved_at = CASE
      WHEN BTRIM(p_status) = 'approved' THEN COALESCE(public.tenant_sms_sender_profiles.verification_approved_at, now())
      ELSE public.tenant_sms_sender_profiles.verification_approved_at
    END,
    verification_rejected_at = CASE
      WHEN BTRIM(p_status) = 'rejected' THEN now()
      ELSE public.tenant_sms_sender_profiles.verification_rejected_at
    END,
    billing_start_at = CASE
      WHEN BTRIM(p_status) = 'approved' THEN COALESCE(public.tenant_sms_sender_profiles.billing_start_at, now())
      ELSE public.tenant_sms_sender_profiles.billing_start_at
    END,
    last_error = CASE
      WHEN BTRIM(p_status) = 'rejected' THEN COALESCE(NULLIF(BTRIM(p_error), ''), public.tenant_sms_sender_profiles.last_error)
      WHEN BTRIM(p_status) = 'approved' THEN NULL
      ELSE public.tenant_sms_sender_profiles.last_error
    END
  RETURNING *
    INTO v_row;

  SELECT COALESCE(is_active, false)
    INTO v_sms_addon_active
    FROM public.tenant_sms_addon_activation
   WHERE tenant_id = p_tenant_id;

  v_enable_sms := (BTRIM(p_status) = 'approved' AND COALESCE(v_sms_addon_active, false));

  UPDATE public.tenant_company_settings
     SET sms_enabled = v_enable_sms
   WHERE tenant_id = p_tenant_id;

  v_event_type := CASE
    WHEN BTRIM(p_status) = 'approved' THEN 'verification_approved'
    WHEN BTRIM(p_status) = 'rejected' THEN 'verification_rejected'
    WHEN COALESCE(NULLIF(BTRIM(p_twilio_phone_number_e164), ''), NULLIF(BTRIM(p_twilio_phone_number_sid), '')) IS NOT NULL THEN 'number_assigned'
    ELSE 'status_changed'
  END;

  INSERT INTO public.tenant_sms_sender_profile_log (
    tenant_id,
    event_type,
    actor_user_id,
    status_from,
    status_to,
    notes,
    metadata
  ) VALUES (
    p_tenant_id,
    v_event_type,
    v_user_id,
    COALESCE(v_existing_status, 'not_requested'),
    v_row.provisioning_status,
    NULLIF(BTRIM(p_note), ''),
    jsonb_build_object(
      'performed_by_role', v_user_role,
      'sms_addon_active', v_sms_addon_active,
      'sms_enabled_set_to', v_enable_sms,
      'error', NULLIF(BTRIM(p_error), '')
    )
  );

  RETURN jsonb_build_object(
    'tenant_id', v_row.tenant_id,
    'sender_type', v_row.sender_type,
    'provisioning_status', v_row.provisioning_status,
    'twilio_phone_number_sid', v_row.twilio_phone_number_sid,
    'twilio_phone_number_e164', v_row.twilio_phone_number_e164,
    'requested_at', v_row.requested_at,
    'verification_submitted_at', v_row.verification_submitted_at,
    'verification_approved_at', v_row.verification_approved_at,
    'verification_rejected_at', v_row.verification_rejected_at,
    'billing_start_at', v_row.billing_start_at,
    'last_error', v_row.last_error,
    'updated_at', v_row.updated_at,
    'sms_enabled', v_enable_sms
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_admin_set_sms_sender_status(uuid, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_admin_set_sms_sender_status(uuid, text, text, text, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6) Keep sms_enabled aligned on add-on activation (approval-gated)
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
  v_sender_approved boolean := false;
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

  SELECT EXISTS (
    SELECT 1
      FROM public.tenant_sms_sender_profiles p
     WHERE p.tenant_id = v_tenant_id
       AND p.provisioning_status = 'approved'
  ) INTO v_sender_approved;

  UPDATE public.tenant_company_settings
     SET sms_enabled = v_sender_approved
   WHERE tenant_id = v_tenant_id;

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

COMMENT ON TABLE public.tenant_sms_sender_profiles IS 'Platform-managed sender lifecycle and Twilio verification status per tenant.';
COMMENT ON TABLE public.tenant_sms_sender_profile_log IS 'Append-only sender provisioning and verification audit history.';
COMMENT ON FUNCTION public.rpc_get_my_sms_sender_profile() IS 'Returns tenant sender lifecycle status; defaults to not_requested.';
COMMENT ON FUNCTION public.rpc_request_sms_sender_provisioning(text, text) IS 'Tenant-admin request to provision platform-managed toll-free sender.';
COMMENT ON FUNCTION public.rpc_admin_set_sms_sender_status(uuid, text, text, text, text, text) IS 'Admin-dev sender lifecycle updates; auto-gates sms_enabled until approved.';
