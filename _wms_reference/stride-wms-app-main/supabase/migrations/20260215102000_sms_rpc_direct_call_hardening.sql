-- =============================================================================
-- SMS RPC direct-call hardening (idempotency, race safety, audit integrity)
-- Migration: 20260215102000_sms_rpc_direct_call_hardening.sql
-- =============================================================================
-- Purpose:
--   1) Serialize tenant-scoped SMS state transitions to prevent race anomalies.
--   2) Re-enforce server-side activation readiness under platform-managed sender model.
--   3) Keep activation/provisioning audit logs transition-accurate under direct RPC calls.

-- ---------------------------------------------------------------------------
-- 1) Harden tenant activation RPC
--    - server-side readiness checks (sender approved + compliance fields)
--    - advisory lock for per-tenant race safety
--    - deterministic event classification for audit integrity
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
  v_event_type text;
  v_row public.tenant_sms_addon_activation%ROWTYPE;
  v_existing_row public.tenant_sms_addon_activation%ROWTYPE;
  v_settings public.tenant_company_settings%ROWTYPE;
  v_missing_fields text[] := ARRAY[]::text[];
  v_sender_status text;
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

  -- Serialize tenant-level SMS transitions across activation/deactivation/provisioning RPCs.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_tenant_id::text, 0));

  SELECT *
    INTO v_settings
    FROM public.tenant_company_settings
   WHERE tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tenant settings row missing; complete organization setup before activating SMS add-on';
  END IF;

  SELECT provisioning_status
    INTO v_sender_status
    FROM public.tenant_sms_sender_profiles
   WHERE tenant_id = v_tenant_id;

  IF COALESCE(v_sender_status, 'not_requested') <> 'approved' THEN
    v_missing_fields := array_append(v_missing_fields, 'sender_profile_approved');
  END IF;

  IF COALESCE(BTRIM(v_settings.sms_proof_of_consent_url), '') = ''
     OR v_settings.sms_proof_of_consent_url !~* '^https://.+' THEN
    v_missing_fields := array_append(v_missing_fields, 'sms_proof_of_consent_url_https');
  END IF;
  IF COALESCE(BTRIM(v_settings.sms_privacy_policy_url), '') = ''
     OR v_settings.sms_privacy_policy_url !~* '^https://.+' THEN
    v_missing_fields := array_append(v_missing_fields, 'sms_privacy_policy_url_https');
  END IF;
  IF COALESCE(BTRIM(v_settings.sms_terms_conditions_url), '') = ''
     OR v_settings.sms_terms_conditions_url !~* '^https://.+' THEN
    v_missing_fields := array_append(v_missing_fields, 'sms_terms_conditions_url_https');
  END IF;
  IF COALESCE(BTRIM(v_settings.sms_opt_in_message), '') = '' THEN
    v_missing_fields := array_append(v_missing_fields, 'sms_opt_in_message');
  END IF;
  IF COALESCE(BTRIM(v_settings.sms_help_message), '') = '' THEN
    v_missing_fields := array_append(v_missing_fields, 'sms_help_message');
  END IF;
  IF COALESCE(BTRIM(v_settings.sms_stop_message), '') = '' THEN
    v_missing_fields := array_append(v_missing_fields, 'sms_stop_message');
  END IF;
  IF COALESCE(BTRIM(v_settings.sms_use_case_description), '') = '' THEN
    v_missing_fields := array_append(v_missing_fields, 'sms_use_case_description');
  END IF;
  IF COALESCE(BTRIM(v_settings.sms_sample_message), '') = '' THEN
    v_missing_fields := array_append(v_missing_fields, 'sms_sample_message');
  END IF;

  IF array_length(v_missing_fields, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'SMS activation readiness check failed. Missing/invalid: %', array_to_string(v_missing_fields, ', ');
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

  SELECT *
    INTO v_existing_row
    FROM public.tenant_sms_addon_activation
   WHERE tenant_id = v_tenant_id
   FOR UPDATE;

  v_event_type := CASE
    WHEN FOUND AND v_existing_row.is_active IS TRUE THEN 'terms_reaccepted'
    ELSE 'activated'
  END;

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
    COALESCE(NULLIF(BTRIM(p_acceptance_source), ''), 'settings_sms_activation'),
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
    activated_at = CASE
      WHEN public.tenant_sms_addon_activation.activated_at IS NULL THEN EXCLUDED.activated_at
      WHEN public.tenant_sms_addon_activation.is_active IS TRUE THEN public.tenant_sms_addon_activation.activated_at
      ELSE EXCLUDED.activated_at
    END
  RETURNING *
    INTO v_row;

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

  -- Sender is approved at this point (readiness check), so activation enables SMS.
  UPDATE public.tenant_company_settings
     SET sms_enabled = true
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

COMMENT ON FUNCTION public.rpc_activate_sms_addon(text, text) IS
'Activate SMS add-on with server-side readiness checks and tenant-scoped transition serialization for audit-safe direct RPC calls.';

-- ---------------------------------------------------------------------------
-- 2) Harden tenant deactivation RPC
--    - advisory lock for race safety with concurrent activation/provisioning
--    - keep existing idempotency guard for inactive state
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_deactivate_sms_addon(
  p_reason text DEFAULT 'self_service',
  p_acceptance_source text DEFAULT 'settings_sms_activation_card'
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
  v_reason text;
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
    RAISE EXCEPTION 'Only tenant administrators can deactivate SMS add-on';
  END IF;

  -- Serialize tenant-level SMS transitions across activation/deactivation/provisioning RPCs.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_tenant_id::text, 0));

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
  v_reason := NULLIF(BTRIM(p_reason), '');

  SELECT *
    INTO v_row
    FROM public.tenant_sms_addon_activation
   WHERE tenant_id = v_tenant_id
   FOR UPDATE;

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

  -- Idempotency guard: if already inactive/disabled, do not mutate evidence fields
  -- and do not append duplicate deactivation log entries.
  IF v_row.is_active IS NOT TRUE THEN
    UPDATE public.tenant_company_settings
       SET sms_enabled = false
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
  END IF;

  UPDATE public.tenant_sms_addon_activation
     SET is_active = false,
         activation_status = 'disabled',
         ip_address = COALESCE(v_ip_address, ip_address),
         user_agent = COALESCE(v_user_agent, user_agent),
         acceptance_source = COALESCE(NULLIF(BTRIM(p_acceptance_source), ''), acceptance_source)
   WHERE tenant_id = v_tenant_id
  RETURNING *
    INTO v_row;

  UPDATE public.tenant_company_settings
     SET sms_enabled = false
   WHERE tenant_id = v_tenant_id;

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
    'deactivated',
    v_row.terms_version,
    v_user_id,
    v_ip_address,
    v_user_agent,
    COALESCE(NULLIF(BTRIM(p_acceptance_source), ''), v_row.acceptance_source),
    jsonb_build_object(
      'reason', COALESCE(v_reason, 'self_service'),
      'performed_by_role', v_user_role
    )
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

COMMENT ON FUNCTION public.rpc_deactivate_sms_addon(text, text) IS
'Deactivate SMS add-on with idempotent inactive-state guard and tenant-scoped transition serialization for audit-safe direct RPC calls.';

-- ---------------------------------------------------------------------------
-- 3) Harden provisioning request RPC
--    - advisory lock for race safety
--    - idempotent no-op return for in-flight/approved states
--    - transition-accurate log rows for fresh requests/retries
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
  v_existing_row public.tenant_sms_sender_profiles%ROWTYPE;
  v_status_from text := 'not_requested';
  v_request_source text;
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

  -- Serialize tenant-level SMS transitions across activation/deactivation/provisioning RPCs.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_tenant_id::text, 0));

  v_request_source := COALESCE(NULLIF(BTRIM(p_request_source), ''), 'settings_sms_activation_card');

  SELECT *
    INTO v_existing_row
    FROM public.tenant_sms_sender_profiles
   WHERE tenant_id = v_tenant_id
   FOR UPDATE;

  IF FOUND THEN
    v_status_from := COALESCE(v_existing_row.provisioning_status, 'not_requested');

    IF COALESCE(v_existing_row.provisioning_status, '') IN ('requested', 'provisioning', 'pending_verification', 'approved') THEN
      RETURN jsonb_build_object(
        'tenant_id', v_existing_row.tenant_id,
        'sender_type', v_existing_row.sender_type,
        'provisioning_status', v_existing_row.provisioning_status,
        'twilio_phone_number_sid', v_existing_row.twilio_phone_number_sid,
        'twilio_phone_number_e164', v_existing_row.twilio_phone_number_e164,
        'requested_at', v_existing_row.requested_at,
        'verification_submitted_at', v_existing_row.verification_submitted_at,
        'verification_approved_at', v_existing_row.verification_approved_at,
        'verification_rejected_at', v_existing_row.verification_rejected_at,
        'billing_start_at', v_existing_row.billing_start_at,
        'last_error', v_existing_row.last_error,
        'updated_at', v_existing_row.updated_at
      );
    END IF;
  END IF;

  INSERT INTO public.tenant_sms_sender_profiles (
    tenant_id,
    sender_type,
    provisioning_status,
    requested_at,
    requested_by,
    verification_submitted_at,
    verification_rejected_at,
    last_error
  ) VALUES (
    v_tenant_id,
    'toll_free',
    'requested',
    now(),
    v_user_id,
    NULL,
    NULL,
    NULL
  )
  ON CONFLICT (tenant_id) DO UPDATE SET
    sender_type = 'toll_free',
    provisioning_status = 'requested',
    requested_at = now(),
    requested_by = v_user_id,
    verification_submitted_at = NULL,
    verification_rejected_at = NULL,
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
    COALESCE(v_status_from, 'not_requested'),
    'requested',
    'Tenant admin requested platform-managed toll-free sender provisioning',
    jsonb_build_object(
      'request_source', v_request_source,
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

COMMENT ON FUNCTION public.rpc_request_sms_sender_provisioning(text, text) IS
'Request platform-managed sender provisioning with tenant-scoped transition serialization and idempotent in-flight returns.';
