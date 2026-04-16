-- =============================================================================
-- Platform Email Settings (Singleton)
-- =============================================================================
-- Stores the platform-level default email sender used when a tenant chooses
-- "Use default sender" (no custom domain/DNS setup).
--
-- IMPORTANT:
-- - This does NOT provision/verify domains in Resend.
-- - The configured from address MUST be verified in Resend or sends will fail.
-- - RESEND_API_KEY remains an Edge Function secret (not stored here).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.platform_email_settings (
  -- Singleton row
  id INTEGER PRIMARY KEY DEFAULT 1,
  default_from_email TEXT NOT NULL,
  default_from_name TEXT,
  default_reply_to_email TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES public.users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES public.users(id),
  CONSTRAINT platform_email_settings_singleton CHECK (id = 1)
);

ALTER TABLE public.platform_email_settings ENABLE ROW LEVEL SECURITY;

-- Admin-dev (system role) + service_role only
CREATE POLICY "platform_email_settings_select_admin_dev"
ON public.platform_email_settings
FOR SELECT
USING (
  (SELECT current_setting('request.jwt.claim.role', true)) = 'service_role'
  OR public.current_user_is_admin_dev()
);

CREATE POLICY "platform_email_settings_insert_admin_dev"
ON public.platform_email_settings
FOR INSERT
WITH CHECK (
  (SELECT current_setting('request.jwt.claim.role', true)) = 'service_role'
  OR public.current_user_is_admin_dev()
);

CREATE POLICY "platform_email_settings_update_admin_dev"
ON public.platform_email_settings
FOR UPDATE
USING (
  (SELECT current_setting('request.jwt.claim.role', true)) = 'service_role'
  OR public.current_user_is_admin_dev()
);

CREATE POLICY "platform_email_settings_delete_admin_dev"
ON public.platform_email_settings
FOR DELETE
USING (
  (SELECT current_setting('request.jwt.claim.role', true)) = 'service_role'
  OR public.current_user_is_admin_dev()
);

-- Keep updated_at fresh
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'update_updated_at_column'
      AND pg_function_is_visible(oid)
  ) THEN
    -- Drop/recreate so the migration is idempotent
    DROP TRIGGER IF EXISTS update_platform_email_settings_updated_at ON public.platform_email_settings;
    CREATE TRIGGER update_platform_email_settings_updated_at
      BEFORE UPDATE ON public.platform_email_settings
      FOR EACH ROW
      EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;

-- =============================================================================
-- Admin RPCs
-- =============================================================================

CREATE OR REPLACE FUNCTION public.rpc_admin_get_platform_email_settings()
RETURNS TABLE (
  default_from_email TEXT,
  default_from_name TEXT,
  default_reply_to_email TEXT,
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
  SELECT
    s.default_from_email,
    s.default_from_name,
    s.default_reply_to_email,
    s.is_active,
    s.updated_at
  FROM public.platform_email_settings s
  WHERE s.id = 1;
END;
$$;

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

  IF p_default_from_email IS NULL OR btrim(p_default_from_email) = '' THEN
    RAISE EXCEPTION 'default_from_email is required';
  END IF;

  INSERT INTO public.platform_email_settings (
    id,
    default_from_email,
    default_from_name,
    default_reply_to_email,
    is_active,
    created_by,
    updated_by
  )
  VALUES (
    1,
    btrim(p_default_from_email),
    NULLIF(btrim(p_default_from_name), ''),
    NULLIF(btrim(p_default_reply_to_email), ''),
    COALESCE(p_is_active, true),
    v_user_id,
    v_user_id
  )
  ON CONFLICT (id) DO UPDATE SET
    default_from_email = EXCLUDED.default_from_email,
    default_from_name = EXCLUDED.default_from_name,
    default_reply_to_email = EXCLUDED.default_reply_to_email,
    is_active = EXCLUDED.is_active,
    updated_at = now(),
    updated_by = v_user_id;

  RETURN QUERY
  SELECT
    s.default_from_email,
    s.default_from_name,
    s.default_reply_to_email,
    s.is_active,
    s.updated_at
  FROM public.platform_email_settings s
  WHERE s.id = 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_admin_get_platform_email_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_set_platform_email_settings(TEXT, TEXT, TEXT, BOOLEAN) TO authenticated;

