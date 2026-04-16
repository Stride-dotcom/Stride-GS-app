-- =============================================================================
-- Inbound Email Reply Forwarding (Platform-managed)
-- Migration: 20260218143000_inbound_email_reply_forwarding.sql
-- =============================================================================
-- Goal:
-- - Allow Stride (platform) to receive replies at:
--     <tenant_id>@<reply_domain> (e.g., 4b...@replies.stridewms.com)
-- - Forward those replies to a tenant-configured inbox address (forward-only).
--
-- Notes:
-- - This migration stores ONLY configuration and minimal logs.
-- - Provider secrets (e.g., Mailgun signing key / Resend API key) remain in
--   Edge Function secrets, not in the DB.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Platform inbound email settings (singleton)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_inbound_email_settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  provider TEXT NOT NULL DEFAULT 'mailgun' CHECK (provider IN ('mailgun')),
  reply_domain TEXT,
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES public.users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES public.users(id),
  CONSTRAINT platform_inbound_email_settings_singleton CHECK (id = 1)
);

ALTER TABLE public.platform_inbound_email_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "platform_inbound_email_settings_select_admin_dev" ON public.platform_inbound_email_settings;
CREATE POLICY "platform_inbound_email_settings_select_admin_dev"
ON public.platform_inbound_email_settings
FOR SELECT
USING (
  (SELECT current_setting('request.jwt.claim.role', true)) = 'service_role'
  OR public.current_user_is_admin_dev()
);

DROP POLICY IF EXISTS "platform_inbound_email_settings_write_admin_dev" ON public.platform_inbound_email_settings;
CREATE POLICY "platform_inbound_email_settings_write_admin_dev"
ON public.platform_inbound_email_settings
FOR ALL
USING (
  (SELECT current_setting('request.jwt.claim.role', true)) = 'service_role'
  OR public.current_user_is_admin_dev()
)
WITH CHECK (
  (SELECT current_setting('request.jwt.claim.role', true)) = 'service_role'
  OR public.current_user_is_admin_dev()
);

-- ---------------------------------------------------------------------------
-- 2) Tenant inbound forwarding settings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenant_inbound_email_settings (
  tenant_id UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  forward_to_email TEXT,
  is_enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES public.users(id)
);

ALTER TABLE public.tenant_inbound_email_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_inbound_email_settings_select_admin_manager" ON public.tenant_inbound_email_settings;
CREATE POLICY "tenant_inbound_email_settings_select_admin_manager"
ON public.tenant_inbound_email_settings
FOR SELECT
USING (
  (SELECT current_setting('request.jwt.claim.role', true)) = 'service_role'
  OR public.current_user_is_admin_dev()
  OR (
    tenant_id = public.user_tenant_id()
    AND (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'manager')
    )
  )
);

DROP POLICY IF EXISTS "tenant_inbound_email_settings_write_admin_manager" ON public.tenant_inbound_email_settings;
CREATE POLICY "tenant_inbound_email_settings_write_admin_manager"
ON public.tenant_inbound_email_settings
FOR INSERT
WITH CHECK (
  (SELECT current_setting('request.jwt.claim.role', true)) = 'service_role'
  OR public.current_user_is_admin_dev()
  OR (
    tenant_id = public.user_tenant_id()
    AND (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'manager')
    )
  )
);

DROP POLICY IF EXISTS "tenant_inbound_email_settings_update_admin_manager" ON public.tenant_inbound_email_settings;
CREATE POLICY "tenant_inbound_email_settings_update_admin_manager"
ON public.tenant_inbound_email_settings
FOR UPDATE
USING (
  (SELECT current_setting('request.jwt.claim.role', true)) = 'service_role'
  OR public.current_user_is_admin_dev()
  OR (
    tenant_id = public.user_tenant_id()
    AND (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'manager')
    )
  )
);

-- ---------------------------------------------------------------------------
-- 3) Minimal inbound email forwarding log (for debugging)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenant_inbound_email_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
  provider TEXT NOT NULL DEFAULT 'mailgun',
  to_address TEXT,
  from_address TEXT,
  subject TEXT,
  forwarded_to TEXT,
  forward_status TEXT NOT NULL DEFAULT 'received' CHECK (forward_status IN ('received', 'forwarded', 'ignored', 'failed')),
  error_message TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_tenant_inbound_email_events_tenant_received
  ON public.tenant_inbound_email_events (tenant_id, received_at DESC);

ALTER TABLE public.tenant_inbound_email_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_inbound_email_events_select_admin_only" ON public.tenant_inbound_email_events;
CREATE POLICY "tenant_inbound_email_events_select_admin_only"
ON public.tenant_inbound_email_events
FOR SELECT
USING (
  (SELECT current_setting('request.jwt.claim.role', true)) = 'service_role'
  OR public.current_user_is_admin_dev()
  OR (
    tenant_id = public.user_tenant_id()
    AND (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'manager')
    )
  )
);

-- Inserts come from service role / Edge Functions only
DROP POLICY IF EXISTS "tenant_inbound_email_events_insert_service_role" ON public.tenant_inbound_email_events;
CREATE POLICY "tenant_inbound_email_events_insert_service_role"
ON public.tenant_inbound_email_events
FOR INSERT
WITH CHECK (
  (SELECT current_setting('request.jwt.claim.role', true)) = 'service_role'
);

-- ---------------------------------------------------------------------------
-- 4) Public + admin RPCs
-- ---------------------------------------------------------------------------

-- Admin-dev: get platform inbound settings
CREATE OR REPLACE FUNCTION public.rpc_admin_get_platform_inbound_email_settings()
RETURNS TABLE (
  provider TEXT,
  reply_domain TEXT,
  is_active BOOLEAN,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.current_user_is_admin_dev() THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  RETURN QUERY
  SELECT s.provider, s.reply_domain, s.is_active, s.updated_at
  FROM public.platform_inbound_email_settings s
  WHERE s.id = 1;
END;
$$;

-- Admin-dev: set platform inbound settings
CREATE OR REPLACE FUNCTION public.rpc_admin_set_platform_inbound_email_settings(
  p_provider TEXT DEFAULT 'mailgun',
  p_reply_domain TEXT DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT false
)
RETURNS TABLE (
  provider TEXT,
  reply_domain TEXT,
  is_active BOOLEAN,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF NOT public.current_user_is_admin_dev() THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  IF COALESCE(BTRIM(p_provider), '') = '' THEN
    p_provider := 'mailgun';
  END IF;
  IF p_provider <> 'mailgun' THEN
    RAISE EXCEPTION 'Only mailgun provider is supported in this rollout';
  END IF;

  INSERT INTO public.platform_inbound_email_settings (
    id,
    provider,
    reply_domain,
    is_active,
    created_by,
    updated_by
  ) VALUES (
    1,
    'mailgun',
    NULLIF(BTRIM(p_reply_domain), ''),
    COALESCE(p_is_active, false),
    v_user_id,
    v_user_id
  )
  ON CONFLICT (id) DO UPDATE SET
    provider = 'mailgun',
    reply_domain = EXCLUDED.reply_domain,
    is_active = EXCLUDED.is_active,
    updated_at = now(),
    updated_by = v_user_id;

  RETURN QUERY
  SELECT s.provider, s.reply_domain, s.is_active, s.updated_at
  FROM public.platform_inbound_email_settings s
  WHERE s.id = 1;
END;
$$;

-- Tenant-safe public read: whether reply forwarding is available, and what domain
CREATE OR REPLACE FUNCTION public.rpc_get_platform_inbound_email_public()
RETURNS TABLE (
  provider TEXT,
  reply_domain TEXT,
  is_active BOOLEAN,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT s.provider, s.reply_domain, s.is_active, s.updated_at
  FROM public.platform_inbound_email_settings s
  WHERE s.id = 1;
END;
$$;

-- Tenant: get my reply forwarding settings (includes computed reply-to address)
CREATE OR REPLACE FUNCTION public.rpc_get_my_inbound_email_settings()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_platform public.platform_inbound_email_settings%ROWTYPE;
  v_row public.tenant_inbound_email_settings%ROWTYPE;
  v_reply_to TEXT;
BEGIN
  v_tenant_id := public.user_tenant_id();
  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object(
      'tenant_id', NULL,
      'reply_to_email', NULL,
      'forward_to_email', NULL,
      'is_enabled', false,
      'platform', jsonb_build_object('is_active', false, 'reply_domain', NULL, 'provider', 'mailgun')
    );
  END IF;

  SELECT *
    INTO v_platform
    FROM public.platform_inbound_email_settings
   WHERE id = 1;

  SELECT *
    INTO v_row
    FROM public.tenant_inbound_email_settings
   WHERE tenant_id = v_tenant_id;

  IF v_platform.is_active IS TRUE AND COALESCE(BTRIM(v_platform.reply_domain), '') <> '' THEN
    v_reply_to := v_tenant_id::text || '@' || BTRIM(v_platform.reply_domain);
  ELSE
    v_reply_to := NULL;
  END IF;

  RETURN jsonb_build_object(
    'tenant_id', v_tenant_id,
    'reply_to_email', v_reply_to,
    'forward_to_email', v_row.forward_to_email,
    'is_enabled', COALESCE(v_row.is_enabled, false),
    'updated_at', v_row.updated_at,
    'platform', jsonb_build_object(
      'provider', COALESCE(v_platform.provider, 'mailgun'),
      'reply_domain', v_platform.reply_domain,
      'is_active', COALESCE(v_platform.is_active, false),
      'updated_at', v_platform.updated_at
    )
  );
END;
$$;

-- Tenant: set my forwarding destination + toggle
CREATE OR REPLACE FUNCTION public.rpc_set_my_inbound_email_settings(
  p_forward_to_email TEXT,
  p_is_enabled BOOLEAN DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_tenant_id UUID;
  v_role TEXT;
  v_row public.tenant_inbound_email_settings%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  v_tenant_id := public.user_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Unable to resolve tenant for authenticated user';
  END IF;

  v_role := public.get_user_role(v_user_id);
  IF COALESCE(v_role, '') NOT IN ('admin', 'manager', 'admin_dev') THEN
    RAISE EXCEPTION 'Only tenant admins/managers can update reply forwarding';
  END IF;

  INSERT INTO public.tenant_inbound_email_settings (
    tenant_id,
    forward_to_email,
    is_enabled,
    updated_by
  ) VALUES (
    v_tenant_id,
    NULLIF(BTRIM(p_forward_to_email), ''),
    COALESCE(p_is_enabled, true),
    v_user_id
  )
  ON CONFLICT (tenant_id) DO UPDATE SET
    forward_to_email = EXCLUDED.forward_to_email,
    is_enabled = EXCLUDED.is_enabled,
    updated_at = now(),
    updated_by = v_user_id
  RETURNING *
    INTO v_row;

  RETURN jsonb_build_object(
    'tenant_id', v_row.tenant_id,
    'forward_to_email', v_row.forward_to_email,
    'is_enabled', v_row.is_enabled,
    'updated_at', v_row.updated_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_admin_get_platform_inbound_email_settings() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_admin_get_platform_inbound_email_settings() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_get_platform_inbound_email_settings() TO authenticated;

REVOKE ALL ON FUNCTION public.rpc_admin_set_platform_inbound_email_settings(TEXT, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_admin_set_platform_inbound_email_settings(TEXT, TEXT, BOOLEAN) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_set_platform_inbound_email_settings(TEXT, TEXT, BOOLEAN) TO authenticated;

REVOKE ALL ON FUNCTION public.rpc_get_platform_inbound_email_public() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_get_platform_inbound_email_public() TO authenticated;

REVOKE ALL ON FUNCTION public.rpc_get_my_inbound_email_settings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_get_my_inbound_email_settings() TO authenticated;

REVOKE ALL ON FUNCTION public.rpc_set_my_inbound_email_settings(TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_set_my_inbound_email_settings(TEXT, BOOLEAN) TO authenticated;

