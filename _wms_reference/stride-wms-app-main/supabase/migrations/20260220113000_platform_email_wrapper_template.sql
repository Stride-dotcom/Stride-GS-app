-- =============================================================================
-- Platform Email Wrapper Template (Super Admin configurable)
-- =============================================================================

ALTER TABLE public.platform_email_settings
ADD COLUMN IF NOT EXISTS wrapper_html_template TEXT;

COMMENT ON COLUMN public.platform_email_settings.wrapper_html_template
IS 'Optional global HTML wrapper override used for branded email rendering. Must include {{content}} placeholder.';

DROP FUNCTION IF EXISTS public.rpc_admin_get_platform_email_settings();
DROP FUNCTION IF EXISTS public.rpc_admin_set_platform_email_settings(TEXT, TEXT, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS public.rpc_admin_set_platform_email_settings(TEXT, TEXT, TEXT, BOOLEAN, TEXT);

CREATE OR REPLACE FUNCTION public.rpc_admin_get_platform_email_settings()
RETURNS TABLE (
  default_from_email TEXT,
  default_from_name TEXT,
  default_reply_to_email TEXT,
  is_active BOOLEAN,
  wrapper_html_template TEXT,
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
  p_wrapper_html_template TEXT DEFAULT NULL
)
RETURNS TABLE (
  default_from_email TEXT,
  default_from_name TEXT,
  default_reply_to_email TEXT,
  is_active BOOLEAN,
  wrapper_html_template TEXT,
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

  INSERT INTO public.platform_email_settings (
    id,
    default_from_email,
    default_from_name,
    default_reply_to_email,
    is_active,
    wrapper_html_template,
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
    v_user_id,
    v_user_id
  )
  ON CONFLICT (id) DO UPDATE SET
    default_from_email = EXCLUDED.default_from_email,
    default_from_name = EXCLUDED.default_from_name,
    default_reply_to_email = EXCLUDED.default_reply_to_email,
    is_active = EXCLUDED.is_active,
    wrapper_html_template = EXCLUDED.wrapper_html_template,
    updated_at = now(),
    updated_by = v_user_id;

  RETURN QUERY
  SELECT
    s.default_from_email,
    s.default_from_name,
    s.default_reply_to_email,
    s.is_active,
    s.wrapper_html_template,
    s.updated_at
  FROM public.platform_email_settings s
  WHERE s.id = 1;
END;
$$;

-- Backwards-compatible overload for clients that still call the 4-arg RPC.
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
    NULL
  );
$$;

GRANT EXECUTE ON FUNCTION public.rpc_admin_get_platform_email_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_set_platform_email_settings(TEXT, TEXT, TEXT, BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_set_platform_email_settings(TEXT, TEXT, TEXT, BOOLEAN) TO authenticated;
