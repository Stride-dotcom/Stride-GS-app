-- =============================================================================
-- SaaS Ops Email Consolidation
-- Migration: 20260225120000_saas_ops_email_consolidation.sql
-- =============================================================================
-- Adds:
-- - Platform fallback sender domain config
-- - Tenant reply-to + DMARC status fields
-- - Email-domain cleanup queue + logs
-- - Admin email-ops tenant status + cleanup log RPCs
-- - Tenant-safe public/default sender RPCs
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) platform_email_settings: fallback sender domain (domain-only)
-- ---------------------------------------------------------------------------
ALTER TABLE public.platform_email_settings
  ADD COLUMN IF NOT EXISTS fallback_sender_domain TEXT;

COMMENT ON COLUMN public.platform_email_settings.fallback_sender_domain IS
'Domain/subdomain used to build platform fallback from addresses as {tenant_slug}@{fallback_sender_domain}.';

-- ---------------------------------------------------------------------------
-- 2) communication_brand_settings: explicit tenant reply-to + DMARC state
-- ---------------------------------------------------------------------------
ALTER TABLE public.communication_brand_settings
  ADD COLUMN IF NOT EXISTS reply_to_email TEXT,
  ADD COLUMN IF NOT EXISTS dmarc_status TEXT NOT NULL DEFAULT 'missing';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'communication_brand_settings_dmarc_status_check'
  ) THEN
    ALTER TABLE public.communication_brand_settings
      ADD CONSTRAINT communication_brand_settings_dmarc_status_check
      CHECK (dmarc_status IN ('unknown', 'missing', 'monitoring', 'enforced'));
  END IF;
END $$;

COMMENT ON COLUMN public.communication_brand_settings.reply_to_email IS
'Tenant-configured inbox for reply routing. Used as preferred Reply-To for outbound email.';
COMMENT ON COLUMN public.communication_brand_settings.dmarc_status IS
'Deliverability posture for tenant custom sender domain: unknown, missing, monitoring (p=none), enforced.';

-- ---------------------------------------------------------------------------
-- 3) Cleanup queue + logs (for nightly domain cleanup worker)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_domain_cleanup_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  resend_domain_id TEXT,
  domain_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'succeeded', 'failed', 'cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  requested_by UUID REFERENCES public.users(id),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  last_error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_email_domain_cleanup_queue_status_requested
  ON public.email_domain_cleanup_queue(status, requested_at ASC);

CREATE INDEX IF NOT EXISTS idx_email_domain_cleanup_queue_tenant
  ON public.email_domain_cleanup_queue(tenant_id, requested_at DESC);

CREATE TABLE IF NOT EXISTS public.email_domain_cleanup_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id UUID REFERENCES public.email_domain_cleanup_queue(id) ON DELETE SET NULL,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
  resend_domain_id TEXT,
  domain_name TEXT,
  status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed')),
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_email_domain_cleanup_logs_attempted
  ON public.email_domain_cleanup_logs(attempted_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_domain_cleanup_logs_tenant
  ON public.email_domain_cleanup_logs(tenant_id, attempted_at DESC);

ALTER TABLE public.email_domain_cleanup_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_domain_cleanup_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "email_domain_cleanup_queue_select_admin_dev" ON public.email_domain_cleanup_queue;
CREATE POLICY "email_domain_cleanup_queue_select_admin_dev"
ON public.email_domain_cleanup_queue
FOR SELECT
USING (
  (SELECT current_setting('request.jwt.claim.role', true)) = 'service_role'
  OR public.current_user_is_admin_dev()
);

DROP POLICY IF EXISTS "email_domain_cleanup_queue_write_admin_dev_or_service" ON public.email_domain_cleanup_queue;
CREATE POLICY "email_domain_cleanup_queue_write_admin_dev_or_service"
ON public.email_domain_cleanup_queue
FOR ALL
USING (
  (SELECT current_setting('request.jwt.claim.role', true)) = 'service_role'
  OR public.current_user_is_admin_dev()
)
WITH CHECK (
  (SELECT current_setting('request.jwt.claim.role', true)) = 'service_role'
  OR public.current_user_is_admin_dev()
);

DROP POLICY IF EXISTS "email_domain_cleanup_logs_select_admin_dev" ON public.email_domain_cleanup_logs;
CREATE POLICY "email_domain_cleanup_logs_select_admin_dev"
ON public.email_domain_cleanup_logs
FOR SELECT
USING (
  (SELECT current_setting('request.jwt.claim.role', true)) = 'service_role'
  OR public.current_user_is_admin_dev()
);

DROP POLICY IF EXISTS "email_domain_cleanup_logs_insert_admin_dev_or_service" ON public.email_domain_cleanup_logs;
CREATE POLICY "email_domain_cleanup_logs_insert_admin_dev_or_service"
ON public.email_domain_cleanup_logs
FOR INSERT
WITH CHECK (
  (SELECT current_setting('request.jwt.claim.role', true)) = 'service_role'
  OR public.current_user_is_admin_dev()
);

-- ---------------------------------------------------------------------------
-- 4) Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.slugify_email_local_part(p_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    NULLIF(
      BTRIM(
        REGEXP_REPLACE(
          LOWER(COALESCE(p_value, 'tenant')),
          '[^a-z0-9]+',
          '-',
          'g'
        ),
        '-'
      ),
      ''
    ),
    'tenant'
  );
$$;

COMMENT ON FUNCTION public.slugify_email_local_part(TEXT) IS
'Slugifies text for safe email local-part usage (lowercase alphanumeric + dashes).';

-- ---------------------------------------------------------------------------
-- 5) Admin RPCs for platform email settings (expanded return payload)
-- ---------------------------------------------------------------------------
-- Existing environments may already have these function signatures with
-- different TABLE return shapes. Drop first so recreate can change output.
DROP FUNCTION IF EXISTS public.rpc_admin_get_platform_email_settings();
DROP FUNCTION IF EXISTS public.rpc_admin_set_platform_email_settings(TEXT, TEXT, TEXT, BOOLEAN, TEXT);

CREATE OR REPLACE FUNCTION public.rpc_admin_get_platform_email_settings()
RETURNS TABLE (
  default_from_email TEXT,
  default_from_name TEXT,
  default_reply_to_email TEXT,
  fallback_sender_domain TEXT,
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
    s.fallback_sender_domain,
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
  p_is_active BOOLEAN DEFAULT true,
  p_fallback_sender_domain TEXT DEFAULT NULL
)
RETURNS TABLE (
  default_from_email TEXT,
  default_from_name TEXT,
  default_reply_to_email TEXT,
  fallback_sender_domain TEXT,
  is_active BOOLEAN,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_fallback_domain TEXT := NULLIF(LOWER(BTRIM(p_fallback_sender_domain)), '');
BEGIN
  IF NOT public.current_user_is_admin_dev() THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  IF p_default_from_email IS NULL OR BTRIM(p_default_from_email) = '' THEN
    RAISE EXCEPTION 'default_from_email is required';
  END IF;

  IF v_fallback_domain IS NOT NULL AND v_fallback_domain !~ '^[a-z0-9.-]+\.[a-z]{2,}$' THEN
    RAISE EXCEPTION 'fallback_sender_domain must be a valid domain or subdomain';
  END IF;

  INSERT INTO public.platform_email_settings (
    id,
    default_from_email,
    default_from_name,
    default_reply_to_email,
    fallback_sender_domain,
    is_active,
    created_by,
    updated_by
  )
  VALUES (
    1,
    BTRIM(p_default_from_email),
    NULLIF(BTRIM(p_default_from_name), ''),
    NULLIF(BTRIM(p_default_reply_to_email), ''),
    v_fallback_domain,
    COALESCE(p_is_active, true),
    v_user_id,
    v_user_id
  )
  ON CONFLICT (id) DO UPDATE SET
    default_from_email = EXCLUDED.default_from_email,
    default_from_name = EXCLUDED.default_from_name,
    default_reply_to_email = EXCLUDED.default_reply_to_email,
    fallback_sender_domain = EXCLUDED.fallback_sender_domain,
    is_active = EXCLUDED.is_active,
    updated_at = now(),
    updated_by = v_user_id;

  RETURN QUERY
  SELECT
    s.default_from_email,
    s.default_from_name,
    s.default_reply_to_email,
    s.fallback_sender_domain,
    s.is_active,
    s.updated_at
  FROM public.platform_email_settings s
  WHERE s.id = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_admin_get_platform_email_settings() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_admin_get_platform_email_settings() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_get_platform_email_settings() TO authenticated;

REVOKE ALL ON FUNCTION public.rpc_admin_set_platform_email_settings(TEXT, TEXT, TEXT, BOOLEAN, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_admin_set_platform_email_settings(TEXT, TEXT, TEXT, BOOLEAN, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_set_platform_email_settings(TEXT, TEXT, TEXT, BOOLEAN, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6) Tenant-safe platform email defaults + fallback sender preview
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_get_platform_email_public_settings()
RETURNS TABLE (
  default_from_email TEXT,
  fallback_sender_domain TEXT,
  is_active BOOLEAN,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.default_from_email,
    s.fallback_sender_domain,
    s.is_active,
    s.updated_at
  FROM public.platform_email_settings s
  WHERE s.id = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_get_platform_email_public_settings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_get_platform_email_public_settings() TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_get_my_email_sender_defaults()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID := public.user_tenant_id();
  v_tenant_name TEXT;
  v_app_subdomain TEXT;
  v_slug TEXT;
  v_default_from_email TEXT;
  v_fallback_sender_domain TEXT;
  v_platform_sender_email TEXT;
BEGIN
  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object(
      'tenant_id', NULL,
      'tenant_slug', NULL,
      'default_from_email', NULL,
      'fallback_sender_domain', NULL,
      'platform_sender_email', NULL
    );
  END IF;

  SELECT t.name, tcs.app_subdomain
    INTO v_tenant_name, v_app_subdomain
    FROM public.tenants t
    LEFT JOIN public.tenant_company_settings tcs
      ON tcs.tenant_id = t.id
   WHERE t.id = v_tenant_id;

  v_slug := public.slugify_email_local_part(COALESCE(NULLIF(BTRIM(v_app_subdomain), ''), v_tenant_name));

  SELECT s.default_from_email, s.fallback_sender_domain
    INTO v_default_from_email, v_fallback_sender_domain
    FROM public.platform_email_settings s
   WHERE s.id = 1;

  v_platform_sender_email := CASE
    WHEN COALESCE(BTRIM(v_fallback_sender_domain), '') <> '' THEN v_slug || '@' || BTRIM(v_fallback_sender_domain)
    ELSE v_default_from_email
  END;

  RETURN jsonb_build_object(
    'tenant_id', v_tenant_id,
    'tenant_slug', v_slug,
    'default_from_email', v_default_from_email,
    'fallback_sender_domain', v_fallback_sender_domain,
    'platform_sender_email', v_platform_sender_email
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_get_my_email_sender_defaults() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_get_my_email_sender_defaults() TO authenticated;

-- ---------------------------------------------------------------------------
-- 7) Tenant RPC: request custom-domain cleanup (nightly worker queue)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_request_my_email_domain_cleanup(
  p_resend_domain_id TEXT DEFAULT NULL,
  p_domain_name TEXT DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_tenant_id UUID := public.user_tenant_id();
  v_role TEXT;
  v_queue_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Unable to resolve tenant for authenticated user';
  END IF;

  v_role := public.get_user_role(v_user_id);
  IF NOT (
    public.current_user_is_admin_dev()
    OR COALESCE(v_role, '') IN ('admin', 'tenant_admin')
  ) THEN
    RAISE EXCEPTION 'Only tenant administrators can request domain cleanup';
  END IF;

  IF NULLIF(BTRIM(COALESCE(p_resend_domain_id, '')), '') IS NULL
     AND NULLIF(BTRIM(COALESCE(p_domain_name, '')), '') IS NULL THEN
    RETURN jsonb_build_object(
      'queued', false,
      'reason', 'missing_domain_identifiers'
    );
  END IF;

  INSERT INTO public.email_domain_cleanup_queue (
    tenant_id,
    resend_domain_id,
    domain_name,
    status,
    requested_by,
    metadata
  )
  VALUES (
    v_tenant_id,
    NULLIF(BTRIM(p_resend_domain_id), ''),
    NULLIF(LOWER(BTRIM(p_domain_name)), ''),
    'pending',
    v_user_id,
    jsonb_build_object('source', 'tenant_toggle_off_custom_sender')
  )
  RETURNING id INTO v_queue_id;

  RETURN jsonb_build_object(
    'queued', true,
    'queue_id', v_queue_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_request_my_email_domain_cleanup(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_request_my_email_domain_cleanup(TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 8) Admin RPC: Email Ops tenant status rows
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_admin_list_email_ops_tenants(
  p_search TEXT DEFAULT NULL
)
RETURNS TABLE (
  tenant_id UUID,
  tenant_name TEXT,
  tenant_slug TEXT,
  company_email TEXT,
  reply_to_effective TEXT,
  use_default_email BOOLEAN,
  custom_from_email TEXT,
  custom_email_domain TEXT,
  email_domain_verified BOOLEAN,
  dkim_verified BOOLEAN,
  spf_verified BOOLEAN,
  dmarc_status TEXT,
  platform_sender_email TEXT,
  sender_type TEXT,
  status TEXT,
  issue_badges JSONB,
  warning_badges JSONB,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_search TEXT := NULLIF(BTRIM(COALESCE(p_search, '')), '');
  v_default_from_email TEXT;
  v_fallback_sender_domain TEXT;
  r RECORD;
  v_slug TEXT;
  v_use_custom BOOLEAN;
  v_reply_to_effective TEXT;
  v_admin_reply_to TEXT;
  v_custom_from TEXT;
  v_platform_sender_email TEXT;
  v_sender_type TEXT;
  v_status TEXT;
  v_issue_badges TEXT[];
  v_warning_badges TEXT[];
BEGIN
  IF NOT public.current_user_is_admin_dev() THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  SELECT s.default_from_email, s.fallback_sender_domain
    INTO v_default_from_email, v_fallback_sender_domain
    FROM public.platform_email_settings s
   WHERE s.id = 1;

  FOR r IN
    SELECT
      t.id AS tenant_id,
      t.name AS tenant_name,
      tcs.company_email,
      tcs.app_subdomain,
      cbs.use_default_email,
      cbs.from_email,
      cbs.custom_email_domain,
      cbs.reply_to_email,
      cbs.email_domain_verified,
      cbs.dkim_verified,
      cbs.spf_verified,
      cbs.dmarc_status,
      cbs.updated_at
    FROM public.tenants t
    LEFT JOIN public.tenant_company_settings tcs
      ON tcs.tenant_id = t.id
    LEFT JOIN public.communication_brand_settings cbs
      ON cbs.tenant_id = t.id
    WHERE (
      v_search IS NULL
      OR LOWER(COALESCE(t.name, '')) LIKE '%' || LOWER(v_search) || '%'
      OR LOWER(COALESCE(tcs.company_email, '')) LIKE '%' || LOWER(v_search) || '%'
      OR LOWER(COALESCE(tcs.app_subdomain, '')) LIKE '%' || LOWER(v_search) || '%'
    )
    ORDER BY t.name ASC
  LOOP
    v_slug := public.slugify_email_local_part(COALESCE(NULLIF(BTRIM(r.app_subdomain), ''), r.tenant_name));
    v_use_custom := COALESCE(r.use_default_email, true) = false;
    v_custom_from := COALESCE(NULLIF(BTRIM(r.from_email), ''), NULLIF(BTRIM(r.custom_email_domain), ''));

    SELECT u.email
      INTO v_admin_reply_to
      FROM public.users u
     WHERE u.tenant_id = r.tenant_id
       AND u.deleted_at IS NULL
       AND COALESCE(u.status, '') IN ('active', 'pending', 'invited')
       AND NULLIF(BTRIM(u.email), '') IS NOT NULL
       AND EXISTS (
         SELECT 1
           FROM public.user_roles ur
          WHERE ur.user_id = u.id
            AND ur.role IN ('admin', 'tenant_admin')
       )
     ORDER BY u.created_at ASC
     LIMIT 1;

    IF v_admin_reply_to IS NULL THEN
      SELECT u.email
        INTO v_admin_reply_to
        FROM public.users u
       WHERE u.tenant_id = r.tenant_id
         AND u.deleted_at IS NULL
         AND COALESCE(u.status, '') IN ('active', 'pending', 'invited')
         AND NULLIF(BTRIM(u.email), '') IS NOT NULL
       ORDER BY u.created_at ASC
       LIMIT 1;
    END IF;

    v_reply_to_effective := COALESCE(
      NULLIF(BTRIM(r.reply_to_email), ''),
      NULLIF(BTRIM(v_admin_reply_to), ''),
      NULLIF(BTRIM(r.company_email), '')
    );
    v_issue_badges := ARRAY[]::TEXT[];
    v_warning_badges := ARRAY[]::TEXT[];

    IF COALESCE(BTRIM(v_fallback_sender_domain), '') <> '' THEN
      v_platform_sender_email := v_slug || '@' || BTRIM(v_fallback_sender_domain);
    ELSE
      v_platform_sender_email := v_default_from_email;
    END IF;

    IF v_use_custom THEN
      IF v_custom_from IS NULL THEN
        v_issue_badges := array_append(v_issue_badges, 'Missing custom From email');
      END IF;

      IF COALESCE(r.email_domain_verified, false) = false THEN
        v_issue_badges := array_append(v_issue_badges, 'Pending DNS');
      END IF;

      IF v_reply_to_effective IS NULL THEN
        v_issue_badges := array_append(v_issue_badges, 'Missing Reply-To inbox');
      END IF;

      IF COALESCE(r.dkim_verified, false) = false THEN
        v_warning_badges := array_append(v_warning_badges, 'DKIM not verified');
      END IF;
      IF COALESCE(r.spf_verified, false) = false THEN
        v_warning_badges := array_append(v_warning_badges, 'SPF not verified');
      END IF;

      CASE COALESCE(r.dmarc_status, 'missing')
        WHEN 'missing' THEN
          v_warning_badges := array_append(v_warning_badges, 'DMARC missing');
        WHEN 'monitoring' THEN
          v_warning_badges := array_append(v_warning_badges, 'DMARC monitoring only (p=none)');
        ELSE
          NULL;
      END CASE;
    ELSE
      IF v_reply_to_effective IS NULL THEN
        v_issue_badges := array_append(v_issue_badges, 'Missing Reply-To inbox');
      END IF;
      IF COALESCE(BTRIM(COALESCE(v_fallback_sender_domain, '')), '') = ''
         AND COALESCE(BTRIM(COALESCE(v_default_from_email, '')), '') = '' THEN
        v_issue_badges := array_append(v_issue_badges, 'Platform sender domain not configured');
      END IF;
    END IF;

    IF v_use_custom AND COALESCE(r.email_domain_verified, false) = true THEN
      v_sender_type := 'Custom sender (verified)';
    ELSIF v_use_custom THEN
      v_sender_type := 'Custom sender (pending)';
    ELSE
      v_sender_type := 'Platform sender';
    END IF;

    IF array_position(v_issue_badges, 'Missing custom From email') IS NOT NULL
       OR array_position(v_issue_badges, 'Platform sender domain not configured') IS NOT NULL THEN
      v_status := 'Error (misconfigured)';
    ELSIF v_use_custom AND COALESCE(r.email_domain_verified, false) = false THEN
      v_status := 'Pending (waiting on tenant DNS)';
    ELSIF array_position(v_issue_badges, 'Missing Reply-To inbox') IS NOT NULL THEN
      v_status := 'Action needed (set Reply-To inbox)';
    ELSIF COALESCE(array_length(v_warning_badges, 1), 0) > 0 THEN
      v_status := 'Warning (deliverability risk)';
    ELSE
      v_status := 'Ready';
    END IF;

    RETURN QUERY
    SELECT
      r.tenant_id,
      r.tenant_name,
      v_slug,
      r.company_email,
      v_reply_to_effective,
      COALESCE(r.use_default_email, true),
      r.from_email,
      r.custom_email_domain,
      COALESCE(r.email_domain_verified, false),
      COALESCE(r.dkim_verified, false),
      COALESCE(r.spf_verified, false),
      COALESCE(r.dmarc_status, 'missing'),
      v_platform_sender_email,
      v_sender_type,
      v_status,
      to_jsonb(v_issue_badges),
      to_jsonb(v_warning_badges),
      r.updated_at;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_admin_list_email_ops_tenants(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_admin_list_email_ops_tenants(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_list_email_ops_tenants(TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 9) Admin RPC: Cleanup logs table output (failures-only default in UI)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_admin_list_email_cleanup_logs(
  p_include_successes BOOLEAN DEFAULT false,
  p_limit INTEGER DEFAULT 100,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  attempted_at TIMESTAMPTZ,
  tenant_id UUID,
  client_account TEXT,
  domain_name TEXT,
  resend_domain_id TEXT,
  status TEXT,
  error_message TEXT,
  attempts INTEGER,
  metadata JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
  v_offset INTEGER := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  IF NOT public.current_user_is_admin_dev() THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  RETURN QUERY
  SELECT
    l.id,
    l.attempted_at,
    l.tenant_id,
    COALESCE(tcs.company_name, t.name) AS client_account,
    l.domain_name,
    l.resend_domain_id,
    l.status,
    l.error_message,
    COALESCE(q.attempts, 0) AS attempts,
    l.metadata
  FROM public.email_domain_cleanup_logs l
  LEFT JOIN public.email_domain_cleanup_queue q
    ON q.id = l.queue_id
  LEFT JOIN public.tenants t
    ON t.id = l.tenant_id
  LEFT JOIN public.tenant_company_settings tcs
    ON tcs.tenant_id = l.tenant_id
  WHERE (
    p_include_successes = true
    OR l.status = 'failed'
  )
  ORDER BY l.attempted_at DESC
  LIMIT v_limit
  OFFSET v_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_admin_list_email_cleanup_logs(BOOLEAN, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_admin_list_email_cleanup_logs(BOOLEAN, INTEGER, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_list_email_cleanup_logs(BOOLEAN, INTEGER, INTEGER) TO authenticated;
