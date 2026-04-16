-- =============================================================================
-- Admin SMS Sender Ops RPCs + Admin Select Policies
-- Migration: 20260215060000_admin_sms_sender_ops_views.sql
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0) Defensive bootstrap (avoid hard failures if base tables are missing)
-- ---------------------------------------------------------------------------
-- Some environments may attempt to apply this migration without having run the
-- base sender lifecycle migration first. Create the required tables if missing
-- so the admin policies/RPCs below can be installed.
--
-- NOTE: The canonical definitions live in:
--   20260215030000_platform_managed_sms_sender.sql
-- This is a minimal, compatible subset that is safe to run multiple times.

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

ALTER TABLE public.tenant_sms_sender_profiles ENABLE ROW LEVEL SECURITY;

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

-- ---------------------------------------------------------------------------
-- 1) Allow admin_dev read access to sender profile tables
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "tenant_sms_sender_profiles_select_admin_dev" ON public.tenant_sms_sender_profiles;
CREATE POLICY "tenant_sms_sender_profiles_select_admin_dev"
  ON public.tenant_sms_sender_profiles FOR SELECT
  TO authenticated
  USING (public.current_user_is_admin_dev());

DROP POLICY IF EXISTS "tenant_sms_sender_profile_log_select_admin_dev" ON public.tenant_sms_sender_profile_log;
CREATE POLICY "tenant_sms_sender_profile_log_select_admin_dev"
  ON public.tenant_sms_sender_profile_log FOR SELECT
  TO authenticated
  USING (public.current_user_is_admin_dev());

-- ---------------------------------------------------------------------------
-- 2) Admin RPC: list sender profiles with tenant/company context
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_admin_list_sms_sender_profiles(
  p_status text DEFAULT NULL
)
RETURNS TABLE (
  tenant_id uuid,
  tenant_name text,
  company_name text,
  company_email text,
  app_subdomain text,
  sender_type text,
  provisioning_status text,
  twilio_phone_number_sid text,
  twilio_phone_number_e164 text,
  requested_at timestamptz,
  verification_submitted_at timestamptz,
  verification_approved_at timestamptz,
  verification_rejected_at timestamptz,
  billing_start_at timestamptz,
  last_error text,
  sms_addon_active boolean,
  sms_addon_status text,
  sms_enabled boolean,
  profile_updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.current_user_is_admin_dev() THEN
    RAISE EXCEPTION 'Only admin_dev users can access sender ops list';
  END IF;

  RETURN QUERY
  SELECT
    t.id AS tenant_id,
    t.name AS tenant_name,
    tcs.company_name,
    tcs.company_email,
    tcs.app_subdomain,
    sp.sender_type,
    sp.provisioning_status,
    sp.twilio_phone_number_sid,
    sp.twilio_phone_number_e164,
    sp.requested_at,
    sp.verification_submitted_at,
    sp.verification_approved_at,
    sp.verification_rejected_at,
    sp.billing_start_at,
    sp.last_error,
    COALESCE(sa.is_active, false) AS sms_addon_active,
    COALESCE(sa.activation_status, 'not_activated') AS sms_addon_status,
    COALESCE(tcs.sms_enabled, false) AS sms_enabled,
    sp.updated_at AS profile_updated_at
  FROM public.tenant_sms_sender_profiles sp
  JOIN public.tenants t
    ON t.id = sp.tenant_id
  LEFT JOIN public.tenant_company_settings tcs
    ON tcs.tenant_id = sp.tenant_id
  LEFT JOIN public.tenant_sms_addon_activation sa
    ON sa.tenant_id = sp.tenant_id
  WHERE p_status IS NULL OR p_status = '' OR sp.provisioning_status = p_status
  ORDER BY
    sp.requested_at DESC NULLS LAST,
    sp.updated_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_admin_list_sms_sender_profiles(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_admin_list_sms_sender_profiles(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_list_sms_sender_profiles(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) Admin RPC: sender profile event history per tenant
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_admin_get_sms_sender_profile_log(
  p_tenant_id uuid,
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  event_type text,
  actor_user_id uuid,
  status_from text,
  status_to text,
  notes text,
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
    RAISE EXCEPTION 'Only admin_dev users can access sender ops history';
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
    l.status_from,
    l.status_to,
    l.notes,
    l.metadata,
    l.created_at
  FROM public.tenant_sms_sender_profile_log l
  WHERE l.tenant_id = p_tenant_id
  ORDER BY l.created_at DESC
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_admin_get_sms_sender_profile_log(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_admin_get_sms_sender_profile_log(uuid, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_get_sms_sender_profile_log(uuid, integer) TO authenticated;

COMMENT ON FUNCTION public.rpc_admin_list_sms_sender_profiles(text) IS
'Admin-dev sender ops queue list with tenant/company context and activation/readiness fields.';
COMMENT ON FUNCTION public.rpc_admin_get_sms_sender_profile_log(uuid, integer) IS
'Admin-dev sender profile audit events for a tenant.';

