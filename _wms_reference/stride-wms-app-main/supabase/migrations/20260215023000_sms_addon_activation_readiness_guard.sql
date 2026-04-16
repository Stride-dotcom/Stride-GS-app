-- =============================================================================
-- SAAS SMS Add-On Activation Readiness Guard Patch
-- Migration: 20260215023000_sms_addon_activation_readiness_guard.sql
-- =============================================================================
-- Purpose:
--   Enforce required SMS onboarding readiness server-side so direct RPC calls
--   cannot bypass form requirements that are currently enforced in UI.

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
  v_settings public.tenant_company_settings%ROWTYPE;
  v_missing_fields text[] := ARRAY[]::text[];
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

  SELECT *
    INTO v_settings
    FROM public.tenant_company_settings
   WHERE tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tenant settings row missing; complete organization setup before activating SMS add-on';
  END IF;

  -- Required sender + readiness fields (mirrors UI checklist) enforced server-side.
  IF v_settings.sms_enabled IS DISTINCT FROM true THEN
    v_missing_fields := array_append(v_missing_fields, 'sms_enabled');
  END IF;
  IF COALESCE(BTRIM(v_settings.twilio_account_sid), '') = '' THEN
    v_missing_fields := array_append(v_missing_fields, 'twilio_account_sid');
  END IF;
  IF COALESCE(BTRIM(v_settings.twilio_messaging_service_sid), '') = ''
     AND COALESCE(BTRIM(v_settings.twilio_from_phone), '') = '' THEN
    v_missing_fields := array_append(v_missing_fields, 'twilio_messaging_service_sid_or_twilio_from_phone');
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

COMMENT ON FUNCTION public.rpc_activate_sms_addon(text, text) IS
'Activate tenant SMS add-on with server-side readiness validation and terms acceptance audit fields (version, timestamp, user, IP, user-agent, source).';
