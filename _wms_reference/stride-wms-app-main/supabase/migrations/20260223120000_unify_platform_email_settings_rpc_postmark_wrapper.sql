-- =============================================================================
-- Unify platform email RPCs:
-- - Wrapper template support
-- - Outbound provider primary/fallback support
-- =============================================================================

-- Ensure provider routing columns exist (idempotent safety)
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
    (
      outbound_fallback_provider IN ('none', 'resend', 'postmark')
      AND outbound_fallback_provider <> outbound_primary_provider
    )
    OR outbound_fallback_provider = 'none'
  );

DROP FUNCTION IF EXISTS public.rpc_admin_get_platform_email_settings();
DROP FUNCTION IF EXISTS public.rpc_admin_set_platform_email_settings(TEXT, TEXT, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS public.rpc_admin_set_platform_email_settings(TEXT, TEXT, TEXT, BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.rpc_admin_set_platform_email_settings(TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.rpc_admin_set_platform_email_settings(TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.rpc_admin_get_platform_email_settings()
RETURNS TABLE (
  default_from_email TEXT,
  default_from_name TEXT,
  default_reply_to_email TEXT,
  is_active BOOLEAN,
  wrapper_html_template TEXT,
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
    s.wrapper_html_template,
    COALESCE(s.outbound_primary_provider, 'resend'),
    COALESCE(s.outbound_fallback_provider, 'none'),
    s.updated_at
  FROM public.platform_email_settings s
  WHERE s.id = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_admin_set_platform_email_settings(
  p_default_from_email TEXT,
  p_default_from_name TEXT DEFAULT NULL,
  p_default_reply_to_email TEXT DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT true,
  p_wrapper_html_template TEXT DEFAULT NULL,
  p_outbound_primary_provider TEXT DEFAULT NULL,
  p_outbound_fallback_provider TEXT DEFAULT NULL
)
RETURNS TABLE (
  default_from_email TEXT,
  default_from_name TEXT,
  default_reply_to_email TEXT,
  is_active BOOLEAN,
  wrapper_html_template TEXT,
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
  v_wrapper_html_template TEXT := CASE
    WHEN p_wrapper_html_template IS NULL OR btrim(p_wrapper_html_template) = '' THEN NULL
    ELSE p_wrapper_html_template
  END;
  v_primary_provider TEXT := lower(COALESCE(NULLIF(btrim(p_outbound_primary_provider), ''), 'resend'));
  v_fallback_provider TEXT := lower(COALESCE(NULLIF(btrim(p_outbound_fallback_provider), ''), 'none'));
BEGIN
  IF NOT public.current_user_is_admin_dev() THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  IF p_default_from_email IS NULL OR btrim(p_default_from_email) = '' THEN
    RAISE EXCEPTION 'default_from_email is required';
  END IF;

  IF v_wrapper_html_template IS NOT NULL
     AND position('{{content}}' in v_wrapper_html_template) = 0 THEN
    RAISE EXCEPTION 'wrapper_html_template must include {{content}} placeholder';
  END IF;

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
    wrapper_html_template,
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
    v_wrapper_html_template,
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
    wrapper_html_template = EXCLUDED.wrapper_html_template,
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
    s.wrapper_html_template,
    COALESCE(s.outbound_primary_provider, 'resend'),
    COALESCE(s.outbound_fallback_provider, 'none'),
    s.updated_at
  FROM public.platform_email_settings s
  WHERE s.id = 1;
END;
$$;

-- Wrapper-only overload (backward compatibility with 5-arg callers)
CREATE OR REPLACE FUNCTION public.rpc_admin_set_platform_email_settings(
  p_default_from_email TEXT,
  p_default_from_name TEXT DEFAULT NULL,
  p_default_reply_to_email TEXT DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT true,
  p_wrapper_html_template TEXT DEFAULT NULL
)
RETURNS TABLE (
  default_from_email TEXT,
  default_from_name TEXT,
  default_reply_to_email TEXT,
  is_active BOOLEAN,
  wrapper_html_template TEXT,
  outbound_primary_provider TEXT,
  outbound_fallback_provider TEXT,
  updated_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM public.rpc_admin_set_platform_email_settings(
    p_default_from_email,
    p_default_from_name,
    p_default_reply_to_email,
    p_is_active,
    p_wrapper_html_template,
    NULL,
    NULL
  );
$$;

-- Legacy overload (4-arg callers)
CREATE OR REPLACE FUNCTION public.rpc_admin_set_platform_email_settings(
  p_default_from_email TEXT,
  p_default_from_name TEXT DEFAULT NULL,
  p_default_reply_to_email TEXT DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT true
)
RETURNS TABLE (
  default_from_email TEXT,
  default_from_name TEXT,
  default_reply_to_email TEXT,
  is_active BOOLEAN,
  wrapper_html_template TEXT,
  outbound_primary_provider TEXT,
  outbound_fallback_provider TEXT,
  updated_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM public.rpc_admin_set_platform_email_settings(
    p_default_from_email,
    p_default_from_name,
    p_default_reply_to_email,
    p_is_active,
    NULL,
    NULL,
    NULL
  );
$$;

REVOKE ALL ON FUNCTION public.rpc_admin_get_platform_email_settings() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_admin_get_platform_email_settings() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_get_platform_email_settings() TO authenticated;

REVOKE ALL ON FUNCTION public.rpc_admin_set_platform_email_settings(TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_admin_set_platform_email_settings(TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_set_platform_email_settings(TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.rpc_admin_set_platform_email_settings(TEXT, TEXT, TEXT, BOOLEAN, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_admin_set_platform_email_settings(TEXT, TEXT, TEXT, BOOLEAN, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_set_platform_email_settings(TEXT, TEXT, TEXT, BOOLEAN, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.rpc_admin_set_platform_email_settings(TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_admin_set_platform_email_settings(TEXT, TEXT, TEXT, BOOLEAN) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_set_platform_email_settings(TEXT, TEXT, TEXT, BOOLEAN) TO authenticated;

