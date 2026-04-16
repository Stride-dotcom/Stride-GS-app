-- =============================================================================
-- SAAS SMS Add-On Deactivation Guard Patch
-- Migration: 20260215022000_sms_addon_deactivate_active_guard.sql
-- =============================================================================
-- Purpose:
--   Prevent duplicate deactivation audit rows and record mutation when the add-on
--   is already inactive. Deactivation RPC is now idempotent for inactive state.

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

  -- Idempotency guard: if already inactive/disabled, do not mutate evidence
  -- fields and do not append duplicate deactivation log entries.
  IF v_row.is_active IS NOT TRUE THEN
    -- Disabling the add-on should also stop outbound SMS deliveries.
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

  -- Disabling the add-on should also stop outbound SMS deliveries.
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
'Deactivate tenant SMS add-on as tenant admin; idempotent when already inactive to protect audit trail integrity.';
