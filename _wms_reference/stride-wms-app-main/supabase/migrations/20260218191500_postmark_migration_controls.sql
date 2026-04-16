-- =============================================================================
-- Postmark migration controls (keep Resend active during cutover)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Outbound provider routing controls on platform_email_settings
-- ---------------------------------------------------------------------------
ALTER TABLE public.platform_email_settings
  ADD COLUMN IF NOT EXISTS outbound_primary_provider TEXT NOT NULL DEFAULT 'resend',
  ADD COLUMN IF NOT EXISTS outbound_fallback_provider TEXT NOT NULL DEFAULT 'none';

ALTER TABLE public.platform_email_settings
  DROP CONSTRAINT IF EXISTS platform_email_settings_outbound_primary_provider_check;

ALTER TABLE public.platform_email_settings
  ADD CONSTRAINT platform_email_settings_outbound_primary_provider_check
  CHECK (outbound_primary_provider IN ('resend', 'postmark'));

ALTER TABLE public.platform_email_settings
  DROP CONSTRAINT IF EXISTS platform_email_settings_outbound_fallback_provider_check;

ALTER TABLE public.platform_email_settings
  ADD CONSTRAINT platform_email_settings_outbound_fallback_provider_check
  CHECK (
    outbound_fallback_provider IN ('none', 'resend', 'postmark')
    AND outbound_fallback_provider <> outbound_primary_provider
    OR outbound_fallback_provider = 'none'
  );

-- ---------------------------------------------------------------------------
-- 2) Expand inbound provider enum/check from mailgun-only to mailgun|postmark
-- ---------------------------------------------------------------------------
ALTER TABLE public.platform_inbound_email_settings
  DROP CONSTRAINT IF EXISTS platform_inbound_email_settings_provider_check;

ALTER TABLE public.platform_inbound_email_settings
  ADD CONSTRAINT platform_inbound_email_settings_provider_check
  CHECK (provider IN ('mailgun', 'postmark'));

-- ---------------------------------------------------------------------------
-- 3) Update admin RPCs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_admin_get_platform_email_settings()
RETURNS TABLE (
  default_from_email TEXT,
  default_from_name TEXT,
  default_reply_to_email TEXT,
  is_active BOOLEAN,
  outbound_primary_provider TEXT,
  outbound_fallback_provider TEXT,
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
  SELECT
    s.default_from_email,
    s.default_from_name,
    s.default_reply_to_email,
    s.is_active,
    COALESCE(s.outbound_primary_provider, 'resend') AS outbound_primary_provider,
    COALESCE(s.outbound_fallback_provider, 'none') AS outbound_fallback_provider,
    s.updated_at
  FROM public.platform_email_settings s
  WHERE s.id = 1;
END;
$$;

DROP FUNCTION IF EXISTS public.rpc_admin_set_platform_email_settings(TEXT, TEXT, TEXT, BOOLEAN);
CREATE OR REPLACE FUNCTION public.rpc_admin_set_platform_email_settings(
  p_default_from_email TEXT,
  p_default_from_name TEXT DEFAULT NULL,
  p_default_reply_to_email TEXT DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT true,
  p_outbound_primary_provider TEXT DEFAULT NULL,
  p_outbound_fallback_provider TEXT DEFAULT NULL
)
RETURNS TABLE (
  default_from_email TEXT,
  default_from_name TEXT,
  default_reply_to_email TEXT,
  is_active BOOLEAN,
  outbound_primary_provider TEXT,
  outbound_fallback_provider TEXT,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_primary_provider TEXT;
  v_fallback_provider TEXT;
BEGIN
  IF NOT public.current_user_is_admin_dev() THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  IF p_default_from_email IS NULL OR btrim(p_default_from_email) = '' THEN
    RAISE EXCEPTION 'default_from_email is required';
  END IF;

  v_primary_provider := lower(COALESCE(NULLIF(btrim(p_outbound_primary_provider), ''), 'resend'));
  v_fallback_provider := lower(COALESCE(NULLIF(btrim(p_outbound_fallback_provider), ''), 'none'));

  IF v_primary_provider NOT IN ('resend', 'postmark') THEN
    RAISE EXCEPTION 'Invalid outbound primary provider: %', v_primary_provider;
  END IF;
  IF v_fallback_provider NOT IN ('none', 'resend', 'postmark') THEN
    RAISE EXCEPTION 'Invalid outbound fallback provider: %', v_fallback_provider;
  END IF;
  IF v_fallback_provider = v_primary_provider THEN
    RAISE EXCEPTION 'Outbound fallback provider must be different from primary (or "none")';
  END IF;

  INSERT INTO public.platform_email_settings (
    id,
    default_from_email,
    default_from_name,
    default_reply_to_email,
    is_active,
    outbound_primary_provider,
    outbound_fallback_provider,
    created_by,
    updated_by
  )
  VALUES (
    1,
    btrim(p_default_from_email),
    NULLIF(btrim(p_default_from_name), ''),
    NULLIF(btrim(p_default_reply_to_email), ''),
    COALESCE(p_is_active, true),
    v_primary_provider,
    v_fallback_provider,
    v_user_id,
    v_user_id
  )
  ON CONFLICT (id) DO UPDATE SET
    default_from_email = EXCLUDED.default_from_email,
    default_from_name = EXCLUDED.default_from_name,
    default_reply_to_email = EXCLUDED.default_reply_to_email,
    is_active = EXCLUDED.is_active,
    outbound_primary_provider = EXCLUDED.outbound_primary_provider,
    outbound_fallback_provider = EXCLUDED.outbound_fallback_provider,
    updated_at = now(),
    updated_by = v_user_id;

  RETURN QUERY
  SELECT
    s.default_from_email,
    s.default_from_name,
    s.default_reply_to_email,
    s.is_active,
    COALESCE(s.outbound_primary_provider, 'resend') AS outbound_primary_provider,
    COALESCE(s.outbound_fallback_provider, 'none') AS outbound_fallback_provider,
    s.updated_at
  FROM public.platform_email_settings s
  WHERE s.id = 1;
END;
$$;

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
  v_provider TEXT;
BEGIN
  IF NOT public.current_user_is_admin_dev() THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  v_provider := lower(COALESCE(NULLIF(BTRIM(p_provider), ''), 'mailgun'));
  IF v_provider NOT IN ('mailgun', 'postmark') THEN
    RAISE EXCEPTION 'Only mailgun or postmark provider is supported';
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
    v_provider,
    NULLIF(BTRIM(p_reply_domain), ''),
    COALESCE(p_is_active, false),
    v_user_id,
    v_user_id
  )
  ON CONFLICT (id) DO UPDATE SET
    provider = EXCLUDED.provider,
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

REVOKE ALL ON FUNCTION public.rpc_admin_set_platform_email_settings(TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_admin_set_platform_email_settings(TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_set_platform_email_settings(TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT) TO authenticated;

