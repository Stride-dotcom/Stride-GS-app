-- =============================================================================
-- Restore missing platform alert template subsystem objects
-- -----------------------------------------------------------------------------
-- Production drift audit showed migration history marked as applied while the
-- following objects were absent in the live database:
-- - platform_alert_template_library
-- - platform_email_wrapper_versions
-- - tenant_template_rollout_preferences
-- - platform_template_rollouts
-- - platform_template_rollout_audit
-- - tenant_template_rollout_decisions
-- - helper/admin RPCs that operate on the above
--
-- This is a forward-only remediation migration that safely recreates the
-- subsystem using IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / OR REPLACE.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0) Repair drifted base platform email settings shape
-- ---------------------------------------------------------------------------
ALTER TABLE public.platform_email_settings
  ADD COLUMN IF NOT EXISTS wrapper_html_template text;

-- ---------------------------------------------------------------------------
-- 1) Core platform tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_alert_template_library (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_event text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('email', 'sms', 'in_app')),
  subject_template text,
  body_template text NOT NULL,
  body_format text NOT NULL DEFAULT 'text' CHECK (body_format IN ('text', 'html')),
  editor_json jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id),
  UNIQUE (trigger_event, channel)
);

CREATE TABLE IF NOT EXISTS public.platform_email_wrapper_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  wrapper_html_template text NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id),
  CONSTRAINT platform_email_wrapper_versions_content_placeholder
    CHECK (position('{{content}}' in wrapper_html_template) > 0)
);

CREATE TABLE IF NOT EXISTS public.tenant_template_rollout_preferences (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  opt_out_non_critical boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id)
);

CREATE TABLE IF NOT EXISTS public.platform_template_rollouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  notes text,
  scheduled_for timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('draft', 'scheduled', 'launched', 'cancelled')),
  update_mode text NOT NULL DEFAULT 'layout_only'
    CHECK (update_mode IN ('replace_all', 'layout_only', 'do_not_update')),
  preserve_subject boolean NOT NULL DEFAULT true,
  preserve_body_text boolean NOT NULL DEFAULT true,
  allow_tenant_opt_out boolean NOT NULL DEFAULT true,
  include_triggers text[],
  wrapper_version_id uuid REFERENCES public.platform_email_wrapper_versions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id),
  launched_at timestamptz,
  is_security_critical boolean NOT NULL DEFAULT false,
  security_grace_hours integer NOT NULL DEFAULT 72
    CHECK (security_grace_hours >= 0 AND security_grace_hours <= 8760),
  security_grace_until timestamptz
);

ALTER TABLE public.platform_template_rollouts
  ADD COLUMN IF NOT EXISTS is_security_critical boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS security_grace_hours integer NOT NULL DEFAULT 72
    CHECK (security_grace_hours >= 0 AND security_grace_hours <= 8760),
  ADD COLUMN IF NOT EXISTS security_grace_until timestamptz;

UPDATE public.platform_template_rollouts
SET security_grace_until = scheduled_for + make_interval(hours => COALESCE(security_grace_hours, 72))
WHERE is_security_critical = true
  AND security_grace_until IS NULL;

CREATE TABLE IF NOT EXISTS public.platform_template_rollout_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rollout_id uuid NOT NULL REFERENCES public.platform_template_rollouts(id) ON DELETE CASCADE,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  trigger_event text,
  channel text,
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.users(id)
);

CREATE TABLE IF NOT EXISTS public.tenant_template_rollout_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rollout_id uuid NOT NULL REFERENCES public.platform_template_rollouts(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  decision text NOT NULL CHECK (decision IN ('replace_all', 'layout_only', 'do_not_update')),
  decided_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rollout_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_platform_alert_template_library_trigger_channel
  ON public.platform_alert_template_library(trigger_event, channel);

CREATE INDEX IF NOT EXISTS idx_platform_email_wrapper_versions_active
  ON public.platform_email_wrapper_versions(is_active)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_platform_template_rollouts_status_scheduled
  ON public.platform_template_rollouts(status, scheduled_for);

CREATE INDEX IF NOT EXISTS idx_platform_template_rollout_audit_rollout
  ON public.platform_template_rollout_audit(rollout_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tenant_template_rollout_decisions_tenant_rollout
  ON public.tenant_template_rollout_decisions(tenant_id, rollout_id);

-- ---------------------------------------------------------------------------
-- 2) RLS / policies
-- ---------------------------------------------------------------------------
ALTER TABLE public.platform_alert_template_library ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_email_wrapper_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_template_rollout_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_template_rollouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_template_rollout_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_template_rollout_decisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "platform_alert_template_library_admin_dev_all" ON public.platform_alert_template_library;
CREATE POLICY "platform_alert_template_library_admin_dev_all"
  ON public.platform_alert_template_library
  FOR ALL
  TO authenticated
  USING (
    (SELECT current_setting('request.jwt.claim.role', true)) = 'service_role'
    OR public.current_user_is_admin_dev()
  )
  WITH CHECK (
    (SELECT current_setting('request.jwt.claim.role', true)) = 'service_role'
    OR public.current_user_is_admin_dev()
  );

DROP POLICY IF EXISTS "platform_email_wrapper_versions_admin_dev_all" ON public.platform_email_wrapper_versions;
CREATE POLICY "platform_email_wrapper_versions_admin_dev_all"
  ON public.platform_email_wrapper_versions
  FOR ALL
  TO authenticated
  USING (
    (SELECT current_setting('request.jwt.claim.role', true)) = 'service_role'
    OR public.current_user_is_admin_dev()
  )
  WITH CHECK (
    (SELECT current_setting('request.jwt.claim.role', true)) = 'service_role'
    OR public.current_user_is_admin_dev()
  );

DROP POLICY IF EXISTS "tenant_template_rollout_preferences_select" ON public.tenant_template_rollout_preferences;
CREATE POLICY "tenant_template_rollout_preferences_select"
  ON public.tenant_template_rollout_preferences
  FOR SELECT
  TO authenticated
  USING (
    (SELECT current_setting('request.jwt.claim.role', true)) = 'service_role'
    OR public.current_user_is_admin_dev()
    OR tenant_id = public.user_tenant_id()
  );

DROP POLICY IF EXISTS "tenant_template_rollout_preferences_update" ON public.tenant_template_rollout_preferences;
CREATE POLICY "tenant_template_rollout_preferences_update"
  ON public.tenant_template_rollout_preferences
  FOR ALL
  TO authenticated
  USING (
    (SELECT current_setting('request.jwt.claim.role', true)) = 'service_role'
    OR public.current_user_is_admin_dev()
    OR tenant_id = public.user_tenant_id()
  )
  WITH CHECK (
    (SELECT current_setting('request.jwt.claim.role', true)) = 'service_role'
    OR public.current_user_is_admin_dev()
    OR tenant_id = public.user_tenant_id()
  );

DROP POLICY IF EXISTS "platform_template_rollouts_admin_dev_all" ON public.platform_template_rollouts;
CREATE POLICY "platform_template_rollouts_admin_dev_all"
  ON public.platform_template_rollouts
  FOR ALL
  TO authenticated
  USING (
    (SELECT current_setting('request.jwt.claim.role', true)) = 'service_role'
    OR public.current_user_is_admin_dev()
  )
  WITH CHECK (
    (SELECT current_setting('request.jwt.claim.role', true)) = 'service_role'
    OR public.current_user_is_admin_dev()
  );

DROP POLICY IF EXISTS "platform_template_rollout_audit_admin_dev_select" ON public.platform_template_rollout_audit;
CREATE POLICY "platform_template_rollout_audit_admin_dev_select"
  ON public.platform_template_rollout_audit
  FOR SELECT
  TO authenticated
  USING (
    (SELECT current_setting('request.jwt.claim.role', true)) = 'service_role'
    OR public.current_user_is_admin_dev()
  );

DROP POLICY IF EXISTS "platform_template_rollout_audit_admin_dev_insert" ON public.platform_template_rollout_audit;
CREATE POLICY "platform_template_rollout_audit_admin_dev_insert"
  ON public.platform_template_rollout_audit
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT current_setting('request.jwt.claim.role', true)) = 'service_role'
    OR public.current_user_is_admin_dev()
  );

DROP POLICY IF EXISTS "tenant_template_rollout_decisions_select" ON public.tenant_template_rollout_decisions;
CREATE POLICY "tenant_template_rollout_decisions_select"
  ON public.tenant_template_rollout_decisions
  FOR SELECT
  TO authenticated
  USING (
    (SELECT current_setting('request.jwt.claim.role', true)) = 'service_role'
    OR public.current_user_is_admin_dev()
    OR tenant_id = public.user_tenant_id()
  );

DROP POLICY IF EXISTS "tenant_template_rollout_decisions_write" ON public.tenant_template_rollout_decisions;
CREATE POLICY "tenant_template_rollout_decisions_write"
  ON public.tenant_template_rollout_decisions
  FOR ALL
  TO authenticated
  USING (
    (SELECT current_setting('request.jwt.claim.role', true)) = 'service_role'
    OR public.current_user_is_admin_dev()
    OR tenant_id = public.user_tenant_id()
  )
  WITH CHECK (
    (SELECT current_setting('request.jwt.claim.role', true)) = 'service_role'
    OR public.current_user_is_admin_dev()
    OR tenant_id = public.user_tenant_id()
  );

-- ---------------------------------------------------------------------------
-- 3) Catalog helper functions + platform library seed
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._catalog_default_cta_link(
  p_module_group text
) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_module_group
    WHEN 'shipments' THEN '[[shipment_link]]'
    WHEN 'tasks' THEN '[[task_link]]'
    WHEN 'claims' THEN '[[portal_claim_url]]'
    WHEN 'quotes' THEN '[[portal_repair_url]]'
    WHEN 'items' THEN '[[item_photos_link]]'
    WHEN 'billing' THEN '[[portal_invoice_url]]'
    ELSE '[[portal_base_url]]'
  END;
$$;

CREATE OR REPLACE FUNCTION public._catalog_default_cta_label(
  p_module_group text
) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_module_group
    WHEN 'shipments' THEN 'View Shipment'
    WHEN 'tasks' THEN 'View Task'
    WHEN 'claims' THEN 'View Claim'
    WHEN 'quotes' THEN 'View Repair'
    WHEN 'items' THEN 'View Item'
    WHEN 'billing' THEN 'View Invoice'
    ELSE 'View Details'
  END;
$$;

CREATE OR REPLACE FUNCTION public._catalog_default_email_body(
  p_display_name text,
  p_module_group text
) RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  CASE p_module_group
    WHEN 'shipments' THEN
      RETURN
        'A shipment alert has been triggered.' || E'\n\n' ||
        '**Shipment:** [[shipment_number]]' || E'\n' ||
        '**Status:** [[shipment_status]]' || E'\n' ||
        '**Account:** [[account_name]]';
    WHEN 'tasks' THEN
      RETURN
        'A task alert has been triggered.' || E'\n\n' ||
        '**Task:** [[task_title]]' || E'\n' ||
        '**Type:** [[task_type]]' || E'\n' ||
        '**Due Date:** [[task_due_date]]';
    WHEN 'claims' THEN
      RETURN
        'A claim alert has been triggered.' || E'\n\n' ||
        '**Claim:** [[claim_reference]]' || E'\n' ||
        '**Account:** [[account_name]]';
    WHEN 'quotes' THEN
      RETURN
        'A quote or repair alert has been triggered.' || E'\n\n' ||
        '**Item:** [[item_code]]' || E'\n' ||
        '**Repair Type:** [[repair_type]]' || E'\n' ||
        '**Account:** [[account_name]]';
    WHEN 'items' THEN
      RETURN
        'An item alert has been triggered.' || E'\n\n' ||
        '**Item:** [[item_code]]' || E'\n' ||
        '**Description:** [[item_description]]' || E'\n' ||
        '**Location:** [[item_location]]';
    WHEN 'billing' THEN
      RETURN
        'A billing alert has been triggered.' || E'\n\n' ||
        '**Account:** [[account_name]]' || E'\n' ||
        '**Service:** [[service_name]]' || E'\n' ||
        '**Amount:** [[service_amount]]';
    ELSE
      RETURN
        'A "' || COALESCE(p_display_name, 'Notification') || '" alert has been triggered.' || E'\n\n' ||
        '**Account:** [[account_name]]' || E'\n' ||
        '**Date:** [[created_at]]';
  END CASE;
END;
$$;

CREATE OR REPLACE FUNCTION public._catalog_default_sms_body(
  p_display_name text,
  p_module_group text
) RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  CASE p_module_group
    WHEN 'shipments' THEN
      RETURN '[[tenant_name]]: ' || COALESCE(p_display_name, 'Shipment alert') || ' — [[shipment_number]]. [[shipment_link]]';
    WHEN 'tasks' THEN
      RETURN '[[tenant_name]]: ' || COALESCE(p_display_name, 'Task alert') || ' — [[task_title]]. [[task_link]]';
    WHEN 'claims' THEN
      RETURN '[[tenant_name]]: ' || COALESCE(p_display_name, 'Claim alert') || ' — [[claim_reference]]. [[portal_claim_url]]';
    WHEN 'quotes' THEN
      RETURN '[[tenant_name]]: ' || COALESCE(p_display_name, 'Repair alert') || ' — [[item_code]]. [[portal_repair_url]]';
    WHEN 'items' THEN
      RETURN '[[tenant_name]]: ' || COALESCE(p_display_name, 'Item alert') || ' — [[item_code]]. [[item_photos_link]]';
    WHEN 'billing' THEN
      RETURN '[[tenant_name]]: ' || COALESCE(p_display_name, 'Billing alert') || ' — [[account_name]]. [[portal_invoice_url]]';
    ELSE
      RETURN '[[tenant_name]]: ' || COALESCE(p_display_name, 'Alert notification') || '.';
  END CASE;
END;
$$;

CREATE OR REPLACE FUNCTION public._catalog_default_in_app_body(
  p_display_name text,
  p_module_group text
) RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  CASE p_module_group
    WHEN 'shipments' THEN
      RETURN COALESCE(p_display_name, 'Shipment alert') || ': [[shipment_number]] ([[shipment_status]])';
    WHEN 'tasks' THEN
      RETURN COALESCE(p_display_name, 'Task alert') || ': [[task_title]]';
    WHEN 'claims' THEN
      RETURN COALESCE(p_display_name, 'Claim alert') || ': [[claim_reference]]';
    WHEN 'quotes' THEN
      RETURN COALESCE(p_display_name, 'Repair alert') || ': [[item_code]]';
    WHEN 'items' THEN
      RETURN COALESCE(p_display_name, 'Item alert') || ': [[item_code]]';
    WHEN 'billing' THEN
      RETURN COALESCE(p_display_name, 'Billing alert') || ': [[account_name]]';
    ELSE
      RETURN COALESCE(p_display_name, 'Alert notification');
  END CASE;
END;
$$;

CREATE OR REPLACE FUNCTION public._catalog_default_in_app_recipients(
  p_audience text
) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_audience
    WHEN 'client' THEN '[[client_user_role]]'
    WHEN 'both' THEN '[[manager_role]], [[client_user_role]]'
    ELSE '[[admin_role]], [[manager_role]]'
  END;
$$;

INSERT INTO public.platform_alert_template_library (
  trigger_event,
  channel,
  subject_template,
  body_template,
  body_format,
  editor_json,
  is_active
)
SELECT
  c.key,
  'email',
  '[[tenant_name]]: ' || COALESCE(c.display_name, c.key),
  public._catalog_default_email_body(c.display_name, c.module_group),
  'text',
  jsonb_build_object(
    'heading', COALESCE(c.display_name, c.key),
    'recipients', '',
    'cta_enabled', true,
    'cta_label', public._catalog_default_cta_label(c.module_group),
    'cta_link', public._catalog_default_cta_link(c.module_group)
  ),
  true
FROM public.communication_trigger_catalog c
WHERE c.is_active = true
ON CONFLICT (trigger_event, channel) DO NOTHING;

INSERT INTO public.platform_alert_template_library (
  trigger_event,
  channel,
  subject_template,
  body_template,
  body_format,
  editor_json,
  is_active
)
SELECT
  c.key,
  'sms',
  NULL,
  public._catalog_default_sms_body(c.display_name, c.module_group),
  'text',
  NULL,
  true
FROM public.communication_trigger_catalog c
WHERE c.is_active = true
ON CONFLICT (trigger_event, channel) DO NOTHING;

INSERT INTO public.platform_alert_template_library (
  trigger_event,
  channel,
  subject_template,
  body_template,
  body_format,
  editor_json,
  is_active
)
SELECT
  c.key,
  'in_app',
  COALESCE(c.display_name, c.key),
  public._catalog_default_in_app_body(c.display_name, c.module_group),
  'text',
  jsonb_build_object(
    'in_app_recipients', public._catalog_default_in_app_recipients(c.audience)
  ),
  true
FROM public.communication_trigger_catalog c
WHERE c.is_active = true
ON CONFLICT (trigger_event, channel) DO NOTHING;

INSERT INTO public.platform_email_wrapper_versions (
  name,
  description,
  wrapper_html_template,
  is_active
)
SELECT
  'Recovered active wrapper',
  'Seeded from platform_email_settings during subsystem remediation',
  s.wrapper_html_template,
  true
FROM public.platform_email_settings s
WHERE s.id = 1
  AND s.wrapper_html_template IS NOT NULL
  AND btrim(s.wrapper_html_template) <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM public.platform_email_wrapper_versions
  );

-- ---------------------------------------------------------------------------
-- 4) Admin list/upsert wrapper + template RPCs
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.rpc_admin_list_platform_alert_templates(text);
CREATE OR REPLACE FUNCTION public.rpc_admin_list_platform_alert_templates(
  p_search text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  trigger_event text,
  channel text,
  subject_template text,
  body_template text,
  body_format text,
  editor_json jsonb,
  is_active boolean,
  updated_at timestamptz
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
    t.id,
    t.trigger_event,
    t.channel,
    t.subject_template,
    t.body_template,
    t.body_format,
    t.editor_json,
    t.is_active,
    t.updated_at
  FROM public.platform_alert_template_library t
  WHERE p_search IS NULL
     OR p_search = ''
     OR t.trigger_event ILIKE '%' || p_search || '%'
     OR COALESCE(t.subject_template, '') ILIKE '%' || p_search || '%'
  ORDER BY t.trigger_event, t.channel;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_admin_upsert_platform_alert_template(
  p_trigger_event text,
  p_channel text,
  p_subject_template text DEFAULT NULL,
  p_body_template text DEFAULT '',
  p_body_format text DEFAULT 'text',
  p_editor_json jsonb DEFAULT NULL,
  p_is_active boolean DEFAULT true
)
RETURNS public.platform_alert_template_library
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_row public.platform_alert_template_library;
BEGIN
  IF NOT public.current_user_is_admin_dev() THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF p_trigger_event IS NULL OR btrim(p_trigger_event) = '' THEN
    RAISE EXCEPTION 'p_trigger_event is required';
  END IF;
  IF p_channel NOT IN ('email', 'sms', 'in_app') THEN
    RAISE EXCEPTION 'Invalid channel: %', p_channel;
  END IF;
  IF p_body_format NOT IN ('text', 'html') THEN
    RAISE EXCEPTION 'Invalid body_format: %', p_body_format;
  END IF;
  IF p_body_template IS NULL OR btrim(p_body_template) = '' THEN
    RAISE EXCEPTION 'p_body_template is required';
  END IF;

  INSERT INTO public.platform_alert_template_library (
    trigger_event,
    channel,
    subject_template,
    body_template,
    body_format,
    editor_json,
    is_active,
    created_by,
    updated_by
  )
  VALUES (
    btrim(p_trigger_event),
    p_channel,
    NULLIF(p_subject_template, ''),
    p_body_template,
    p_body_format,
    p_editor_json,
    COALESCE(p_is_active, true),
    v_user_id,
    v_user_id
  )
  ON CONFLICT (trigger_event, channel) DO UPDATE
  SET
    subject_template = EXCLUDED.subject_template,
    body_template = EXCLUDED.body_template,
    body_format = EXCLUDED.body_format,
    editor_json = EXCLUDED.editor_json,
    is_active = EXCLUDED.is_active,
    updated_at = now(),
    updated_by = v_user_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

DROP FUNCTION IF EXISTS public.rpc_admin_list_platform_wrapper_versions();
CREATE OR REPLACE FUNCTION public.rpc_admin_list_platform_wrapper_versions()
RETURNS TABLE (
  id uuid,
  name text,
  description text,
  wrapper_html_template text,
  is_active boolean,
  updated_at timestamptz
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
    w.id,
    w.name,
    w.description,
    w.wrapper_html_template,
    w.is_active,
    w.updated_at
  FROM public.platform_email_wrapper_versions w
  ORDER BY w.is_active DESC, w.updated_at DESC, w.name ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_admin_upsert_platform_wrapper_version(
  p_id uuid DEFAULT NULL,
  p_name text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_wrapper_html_template text DEFAULT '',
  p_is_active boolean DEFAULT false
)
RETURNS public.platform_email_wrapper_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_row public.platform_email_wrapper_versions;
BEGIN
  IF NOT public.current_user_is_admin_dev() THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF p_wrapper_html_template IS NULL OR btrim(p_wrapper_html_template) = '' THEN
    RAISE EXCEPTION 'wrapper_html_template is required';
  END IF;
  IF position('{{content}}' in p_wrapper_html_template) = 0 THEN
    RAISE EXCEPTION 'wrapper_html_template must include {{content}} placeholder';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.platform_email_wrapper_versions (
      name,
      description,
      wrapper_html_template,
      is_active,
      created_by,
      updated_by
    ) VALUES (
      COALESCE(NULLIF(btrim(p_name), ''), 'Wrapper ' || to_char(now(), 'YYYY-MM-DD HH24:MI')),
      NULLIF(btrim(p_description), ''),
      p_wrapper_html_template,
      COALESCE(p_is_active, false),
      v_user_id,
      v_user_id
    )
    RETURNING * INTO v_row;
  ELSE
    UPDATE public.platform_email_wrapper_versions
    SET
      name = COALESCE(NULLIF(btrim(p_name), ''), name),
      description = CASE WHEN p_description IS NULL THEN description ELSE NULLIF(btrim(p_description), '') END,
      wrapper_html_template = p_wrapper_html_template,
      is_active = COALESCE(p_is_active, is_active),
      updated_at = now(),
      updated_by = v_user_id
    WHERE id = p_id
    RETURNING * INTO v_row;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Wrapper version not found: %', p_id;
    END IF;
  END IF;

  IF v_row.is_active THEN
    UPDATE public.platform_email_wrapper_versions
    SET is_active = false, updated_at = now(), updated_by = v_user_id
    WHERE id <> v_row.id AND is_active = true;

    UPDATE public.platform_email_wrapper_versions
    SET is_active = true, updated_at = now(), updated_by = v_user_id
    WHERE id = v_row.id;

    UPDATE public.platform_email_settings
    SET wrapper_html_template = v_row.wrapper_html_template, updated_at = now(), updated_by = v_user_id
    WHERE id = 1;
  END IF;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_admin_activate_platform_wrapper_version(
  p_id uuid
)
RETURNS public.platform_email_wrapper_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_row public.platform_email_wrapper_versions;
BEGIN
  IF NOT public.current_user_is_admin_dev() THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  SELECT * INTO v_row
  FROM public.platform_email_wrapper_versions
  WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wrapper version not found: %', p_id;
  END IF;

  UPDATE public.platform_email_wrapper_versions
  SET is_active = false, updated_at = now(), updated_by = v_user_id
  WHERE is_active = true;

  UPDATE public.platform_email_wrapper_versions
  SET is_active = true, updated_at = now(), updated_by = v_user_id
  WHERE id = p_id
  RETURNING * INTO v_row;

  UPDATE public.platform_email_settings
  SET wrapper_html_template = v_row.wrapper_html_template, updated_at = now(), updated_by = v_user_id
  WHERE id = 1;

  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5) Trigger catalog provisioning helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._ensure_catalog_trigger_for_all_tenants(
  p_trigger_key text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_catalog record;
  v_tenant record;
  v_alert record;
  v_alert_id uuid;
  v_alert_key_base text;
  v_alert_key text;
  v_key_suffix int;
  v_channels jsonb;
  v_cta_link text;
  v_cta_label text;
  v_subject text;
  v_email_body text;
  v_sms_body text;
  v_in_app_body text;
  v_in_app_recipients text;
  v_templates_created int := 0;
  v_alerts_created int := 0;
  v_lib public.platform_alert_template_library%ROWTYPE;
BEGIN
  SELECT c.*
  INTO v_catalog
  FROM public.communication_trigger_catalog c
  WHERE c.key = p_trigger_key
    AND c.is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'trigger_key', p_trigger_key, 'alerts_created', 0, 'templates_created', 0, 'message', 'Trigger not active or not found');
  END IF;

  v_cta_link := public._catalog_default_cta_link(v_catalog.module_group);
  v_cta_label := public._catalog_default_cta_label(v_catalog.module_group);
  v_subject := '[[tenant_name]]: ' || COALESCE(v_catalog.display_name, v_catalog.key);
  v_email_body := public._catalog_default_email_body(v_catalog.display_name, v_catalog.module_group);
  v_sms_body := public._catalog_default_sms_body(v_catalog.display_name, v_catalog.module_group);
  v_in_app_body := public._catalog_default_in_app_body(v_catalog.display_name, v_catalog.module_group);
  v_in_app_recipients := public._catalog_default_in_app_recipients(v_catalog.audience);
  v_channels := jsonb_build_object(
    'email', COALESCE(v_catalog.default_channels @> ARRAY['email']::text[], true),
    'sms', COALESCE(v_catalog.default_channels @> ARRAY['sms']::text[], false),
    'in_app', COALESCE(v_catalog.default_channels @> ARRAY['in_app']::text[], false)
  );

  FOR v_tenant IN
    SELECT t.id
    FROM public.tenants t
  LOOP
    SELECT a.id, a.key
    INTO v_alert
    FROM public.communication_alerts a
    WHERE a.tenant_id = v_tenant.id
      AND a.trigger_event = v_catalog.key
    ORDER BY a.created_at
    LIMIT 1;

    IF NOT FOUND THEN
      v_alert_key_base := regexp_replace(lower(v_catalog.key), '[^a-z0-9]+', '_', 'g');
      v_alert_key_base := regexp_replace(v_alert_key_base, '^_+|_+$', '', 'g');
      IF v_alert_key_base = '' THEN
        v_alert_key_base := 'trigger_alert';
      END IF;
      v_alert_key := v_alert_key_base;
      v_key_suffix := 1;

      WHILE EXISTS (
        SELECT 1
        FROM public.communication_alerts k
        WHERE k.tenant_id = v_tenant.id
          AND k.key = v_alert_key
      ) LOOP
        v_alert_key := v_alert_key_base || '_' || v_key_suffix::text;
        v_key_suffix := v_key_suffix + 1;
      END LOOP;

      INSERT INTO public.communication_alerts (
        tenant_id,
        name,
        key,
        description,
        is_enabled,
        channels,
        trigger_event,
        timing_rule
      ) VALUES (
        v_tenant.id,
        COALESCE(v_catalog.display_name, v_catalog.key),
        v_alert_key,
        COALESCE(v_catalog.description, 'Auto-provisioned from trigger catalog'),
        true,
        v_channels,
        v_catalog.key,
        'immediate'
      )
      RETURNING id INTO v_alert_id;

      v_alerts_created := v_alerts_created + 1;
    ELSE
      v_alert_id := v_alert.id;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.communication_templates et
      WHERE et.alert_id = v_alert_id
        AND et.channel = 'email'
    ) THEN
      SELECT *
      INTO v_lib
      FROM public.platform_alert_template_library l
      WHERE l.trigger_event = v_catalog.key
        AND l.channel = 'email'
        AND l.is_active = true
      LIMIT 1;

      INSERT INTO public.communication_templates (
        tenant_id,
        alert_id,
        channel,
        subject_template,
        body_template,
        body_format,
        editor_json
      ) VALUES (
        v_tenant.id,
        v_alert_id,
        'email',
        COALESCE(v_lib.subject_template, v_subject),
        COALESCE(v_lib.body_template, v_email_body),
        COALESCE(v_lib.body_format, 'text'),
        COALESCE(
          v_lib.editor_json,
          jsonb_build_object(
            'heading', COALESCE(v_catalog.display_name, v_catalog.key),
            'recipients', '',
            'cta_enabled', true,
            'cta_label', v_cta_label,
            'cta_link', v_cta_link
          )
        )
      );

      v_templates_created := v_templates_created + 1;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.communication_templates st
      WHERE st.alert_id = v_alert_id
        AND st.channel = 'sms'
    ) THEN
      SELECT *
      INTO v_lib
      FROM public.platform_alert_template_library l
      WHERE l.trigger_event = v_catalog.key
        AND l.channel = 'sms'
        AND l.is_active = true
      LIMIT 1;

      INSERT INTO public.communication_templates (
        tenant_id,
        alert_id,
        channel,
        subject_template,
        body_template,
        body_format
      ) VALUES (
        v_tenant.id,
        v_alert_id,
        'sms',
        NULL,
        COALESCE(v_lib.body_template, v_sms_body),
        COALESCE(v_lib.body_format, 'text')
      );

      v_templates_created := v_templates_created + 1;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.communication_templates it
      WHERE it.alert_id = v_alert_id
        AND it.channel = 'in_app'
    ) THEN
      SELECT *
      INTO v_lib
      FROM public.platform_alert_template_library l
      WHERE l.trigger_event = v_catalog.key
        AND l.channel = 'in_app'
        AND l.is_active = true
      LIMIT 1;

      INSERT INTO public.communication_templates (
        tenant_id,
        alert_id,
        channel,
        subject_template,
        body_template,
        body_format,
        in_app_recipients
      ) VALUES (
        v_tenant.id,
        v_alert_id,
        'in_app',
        COALESCE(v_lib.subject_template, COALESCE(v_catalog.display_name, v_catalog.key)),
        COALESCE(v_lib.body_template, v_in_app_body),
        COALESCE(v_lib.body_format, 'text'),
        COALESCE(v_lib.editor_json ->> 'in_app_recipients', v_in_app_recipients)
      );

      v_templates_created := v_templates_created + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'trigger_key', p_trigger_key,
    'alerts_created', v_alerts_created,
    'templates_created', v_templates_created
  );
END;
$$;

CREATE OR REPLACE FUNCTION public._trg_sync_catalog_trigger_to_tenants()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_active = true THEN
    PERFORM public._ensure_catalog_trigger_for_all_tenants(NEW.key);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_catalog_trigger_insert ON public.communication_trigger_catalog;
CREATE TRIGGER trg_sync_catalog_trigger_insert
  AFTER INSERT ON public.communication_trigger_catalog
  FOR EACH ROW
  EXECUTE FUNCTION public._trg_sync_catalog_trigger_to_tenants();

DROP TRIGGER IF EXISTS trg_sync_catalog_trigger_activate ON public.communication_trigger_catalog;
CREATE TRIGGER trg_sync_catalog_trigger_activate
  AFTER UPDATE OF is_active ON public.communication_trigger_catalog
  FOR EACH ROW
  WHEN (OLD.is_active = false AND NEW.is_active = true)
  EXECUTE FUNCTION public._trg_sync_catalog_trigger_to_tenants();

CREATE OR REPLACE FUNCTION public.rpc_admin_sync_trigger_catalog_to_tenants(
  p_trigger_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_result jsonb;
  v_total_alerts int := 0;
  v_total_templates int := 0;
BEGIN
  IF NOT public.current_user_is_admin_dev() THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  IF p_trigger_key IS NOT NULL AND btrim(p_trigger_key) <> '' THEN
    v_result := public._ensure_catalog_trigger_for_all_tenants(btrim(p_trigger_key));
    RETURN jsonb_build_object('ok', true, 'mode', 'single', 'result', v_result);
  END IF;

  FOR v_row IN
    SELECT key
    FROM public.communication_trigger_catalog
    WHERE is_active = true
    ORDER BY key
  LOOP
    v_result := public._ensure_catalog_trigger_for_all_tenants(v_row.key);
    v_total_alerts := v_total_alerts + COALESCE((v_result->>'alerts_created')::int, 0);
    v_total_templates := v_total_templates + COALESCE((v_result->>'templates_created')::int, 0);
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'mode', 'all_active',
    'alerts_created', v_total_alerts,
    'templates_created', v_total_templates
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 6) Rollout decision / tenant preference RPCs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_get_my_template_rollout_preference()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid := public.user_tenant_id();
  v_opt_out boolean := false;
BEGIN
  IF auth.uid() IS NULL OR v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  SELECT COALESCE(opt_out_non_critical, false)
  INTO v_opt_out
  FROM public.tenant_template_rollout_preferences
  WHERE tenant_id = v_tenant_id;

  RETURN COALESCE(v_opt_out, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_set_my_template_rollout_preference(
  p_opt_out_non_critical boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid := public.user_tenant_id();
  v_value boolean;
BEGIN
  IF auth.uid() IS NULL OR v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  INSERT INTO public.tenant_template_rollout_preferences (
    tenant_id,
    opt_out_non_critical,
    updated_at,
    updated_by
  )
  VALUES (
    v_tenant_id,
    COALESCE(p_opt_out_non_critical, false),
    now(),
    auth.uid()
  )
  ON CONFLICT (tenant_id) DO UPDATE
  SET
    opt_out_non_critical = EXCLUDED.opt_out_non_critical,
    updated_at = now(),
    updated_by = auth.uid()
  RETURNING opt_out_non_critical INTO v_value;

  RETURN COALESCE(v_value, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_list_my_pending_template_rollouts()
RETURNS TABLE (
  rollout_id uuid,
  name text,
  notes text,
  scheduled_for timestamptz,
  status text,
  update_mode text,
  preserve_subject boolean,
  preserve_body_text boolean,
  allow_tenant_opt_out boolean,
  is_security_critical boolean,
  security_grace_until timestamptz,
  tenant_decision text,
  decision_locked boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid := public.user_tenant_id();
BEGIN
  IF auth.uid() IS NULL OR v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  RETURN QUERY
  SELECT
    r.id,
    r.name,
    r.notes,
    r.scheduled_for,
    r.status,
    r.update_mode,
    r.preserve_subject,
    r.preserve_body_text,
    r.allow_tenant_opt_out,
    r.is_security_critical,
    r.security_grace_until,
    d.decision,
    (
      r.status <> 'scheduled'
      OR NOT COALESCE(r.allow_tenant_opt_out, true)
      OR (
        COALESCE(r.is_security_critical, false)
        AND now() >= COALESCE(r.security_grace_until, r.scheduled_for)
      )
    ) AS decision_locked
  FROM public.platform_template_rollouts r
  LEFT JOIN public.tenant_template_rollout_decisions d
    ON d.rollout_id = r.id
   AND d.tenant_id = v_tenant_id
  WHERE r.status = 'scheduled'
  ORDER BY r.scheduled_for ASC, r.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_set_my_template_rollout_decision(
  p_rollout_id uuid,
  p_decision text
)
RETURNS public.tenant_template_rollout_decisions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid := public.user_tenant_id();
  v_rollout public.platform_template_rollouts%ROWTYPE;
  v_row public.tenant_template_rollout_decisions;
BEGIN
  IF auth.uid() IS NULL OR v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF p_rollout_id IS NULL THEN
    RAISE EXCEPTION 'p_rollout_id is required';
  END IF;
  IF p_decision NOT IN ('replace_all', 'layout_only', 'do_not_update') THEN
    RAISE EXCEPTION 'Invalid decision: %', p_decision;
  END IF;

  SELECT * INTO v_rollout
  FROM public.platform_template_rollouts
  WHERE id = p_rollout_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rollout not found: %', p_rollout_id;
  END IF;
  IF v_rollout.status <> 'scheduled' THEN
    RAISE EXCEPTION 'Rollout is no longer editable: %', v_rollout.status;
  END IF;
  IF NOT COALESCE(v_rollout.allow_tenant_opt_out, true) THEN
    RAISE EXCEPTION 'Tenant decisions are disabled for this rollout';
  END IF;
  IF COALESCE(v_rollout.is_security_critical, false)
     AND now() >= COALESCE(v_rollout.security_grace_until, v_rollout.scheduled_for) THEN
    RAISE EXCEPTION 'Security-critical grace window elapsed; decision is locked';
  END IF;

  INSERT INTO public.tenant_template_rollout_decisions (
    rollout_id,
    tenant_id,
    decision,
    decided_at,
    decided_by,
    updated_at
  ) VALUES (
    p_rollout_id,
    v_tenant_id,
    p_decision,
    now(),
    auth.uid(),
    now()
  )
  ON CONFLICT (rollout_id, tenant_id) DO UPDATE
  SET
    decision = EXCLUDED.decision,
    decided_at = now(),
    decided_by = auth.uid(),
    updated_at = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7) Rollout admin / execution / processor
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_admin_schedule_template_rollout(
  p_name text,
  p_notes text DEFAULT NULL,
  p_scheduled_for timestamptz DEFAULT now(),
  p_update_mode text DEFAULT 'layout_only',
  p_preserve_subject boolean DEFAULT true,
  p_preserve_body_text boolean DEFAULT true,
  p_allow_tenant_opt_out boolean DEFAULT true,
  p_include_triggers text[] DEFAULT NULL,
  p_wrapper_version_id uuid DEFAULT NULL,
  p_is_security_critical boolean DEFAULT false,
  p_security_grace_hours integer DEFAULT 72
)
RETURNS public.platform_template_rollouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_row public.platform_template_rollouts;
  v_scheduled_for timestamptz := COALESCE(p_scheduled_for, now());
  v_grace_hours integer := LEAST(GREATEST(COALESCE(p_security_grace_hours, 72), 0), 8760);
BEGIN
  IF NOT public.current_user_is_admin_dev() THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'p_name is required';
  END IF;
  IF p_update_mode NOT IN ('replace_all', 'layout_only', 'do_not_update') THEN
    RAISE EXCEPTION 'Invalid update mode: %', p_update_mode;
  END IF;

  INSERT INTO public.platform_template_rollouts (
    name,
    notes,
    scheduled_for,
    status,
    update_mode,
    preserve_subject,
    preserve_body_text,
    allow_tenant_opt_out,
    include_triggers,
    wrapper_version_id,
    is_security_critical,
    security_grace_hours,
    security_grace_until,
    created_by,
    updated_by
  ) VALUES (
    btrim(p_name),
    NULLIF(btrim(p_notes), ''),
    v_scheduled_for,
    'scheduled',
    p_update_mode,
    COALESCE(p_preserve_subject, true),
    COALESCE(p_preserve_body_text, true),
    COALESCE(p_allow_tenant_opt_out, true),
    p_include_triggers,
    p_wrapper_version_id,
    COALESCE(p_is_security_critical, false),
    v_grace_hours,
    CASE
      WHEN COALESCE(p_is_security_critical, false)
      THEN v_scheduled_for + make_interval(hours => v_grace_hours)
      ELSE NULL
    END,
    v_user_id,
    v_user_id
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_admin_list_rollout_notice_recipients(
  p_rollout_id uuid
)
RETURNS TABLE (
  user_id uuid,
  email text,
  tenant_id uuid,
  tenant_name text,
  company_name text,
  app_base_url text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rollout public.platform_template_rollouts%ROWTYPE;
BEGIN
  IF NOT public.current_user_is_admin_dev() THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  SELECT * INTO v_rollout
  FROM public.platform_template_rollouts
  WHERE id = p_rollout_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rollout not found: %', p_rollout_id;
  END IF;

  RETURN QUERY
  SELECT DISTINCT
    u.id,
    lower(u.email),
    t.id,
    t.name,
    tcs.company_name,
    tcs.app_base_url
  FROM public.users u
  JOIN public.user_roles ur
    ON ur.user_id = u.id
   AND ur.deleted_at IS NULL
  JOIN public.roles r
    ON r.id = ur.role_id
   AND r.deleted_at IS NULL
   AND r.tenant_id = u.tenant_id
   AND r.name IN ('tenant_admin', 'admin')
  JOIN public.tenants t
    ON t.id = u.tenant_id
  LEFT JOIN public.tenant_company_settings tcs
    ON tcs.tenant_id = t.id
  LEFT JOIN public.tenant_template_rollout_preferences pref
    ON pref.tenant_id = t.id
  WHERE u.deleted_at IS NULL
    AND u.email IS NOT NULL
    AND btrim(u.email) <> ''
    AND (
      COALESCE(v_rollout.is_security_critical, false)
      OR NOT COALESCE(v_rollout.allow_tenant_opt_out, true)
      OR COALESCE(pref.opt_out_non_critical, false) = false
    )
  ORDER BY t.name, lower(u.email);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_admin_create_rollout_in_app_notifications(
  p_rollout_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rollout public.platform_template_rollouts%ROWTYPE;
  v_inserted integer := 0;
  v_title text;
  v_body text;
BEGIN
  IF NOT public.current_user_is_admin_dev() THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  SELECT * INTO v_rollout
  FROM public.platform_template_rollouts
  WHERE id = p_rollout_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rollout not found: %', p_rollout_id;
  END IF;

  v_title := 'Scheduled Alert Template Update';
  v_body := format(
    'An alert template update "%s" is scheduled for %s. Mode: %s. Subject/body customizations are preserved unless explicitly replaced.',
    v_rollout.name,
    to_char(v_rollout.scheduled_for, 'YYYY-MM-DD HH24:MI TZ'),
    v_rollout.update_mode
  );

  INSERT INTO public.in_app_notifications (
    tenant_id,
    user_id,
    title,
    body,
    icon,
    category,
    related_entity_type,
    related_entity_id,
    action_url,
    is_read,
    priority
  )
  SELECT
    r.tenant_id,
    r.user_id,
    v_title,
    v_body,
    'notifications',
    'system',
    'template_rollout',
    p_rollout_id,
    '/settings',
    false,
    'normal'
  FROM public.rpc_admin_list_rollout_notice_recipients(p_rollout_id) r;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'inserted', v_inserted);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_admin_execute_template_rollout(
  p_rollout_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rollout public.platform_template_rollouts%ROWTYPE;
  v_wrapper public.platform_email_wrapper_versions%ROWTYPE;
  v_lib public.platform_alert_template_library%ROWTYPE;
  v_alert record;
  v_existing public.communication_templates%ROWTYPE;
  v_is_customized boolean;
  v_opt_out boolean;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_actor uuid := auth.uid();
  v_is_service_role boolean := (SELECT current_setting('request.jwt.claim.role', true)) = 'service_role';
  v_force_security boolean := false;
  v_tenant_decision text;
  v_effective_mode text;
  v_effective_preserve_subject boolean;
  v_effective_preserve_body_text boolean;
BEGIN
  IF NOT (v_is_service_role OR public.current_user_is_admin_dev()) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  SELECT * INTO v_rollout
  FROM public.platform_template_rollouts
  WHERE id = p_rollout_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rollout not found: %', p_rollout_id;
  END IF;
  IF v_rollout.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Rollout is cancelled');
  END IF;
  IF v_rollout.status = 'launched' THEN
    RETURN jsonb_build_object('ok', true, 'message', 'Rollout already launched');
  END IF;

  v_force_security := COALESCE(v_rollout.is_security_critical, false)
    AND now() >= COALESCE(v_rollout.security_grace_until, v_rollout.scheduled_for);

  IF v_rollout.wrapper_version_id IS NOT NULL THEN
    SELECT * INTO v_wrapper
    FROM public.platform_email_wrapper_versions
    WHERE id = v_rollout.wrapper_version_id;

    IF FOUND THEN
      UPDATE public.platform_email_wrapper_versions
      SET is_active = (id = v_wrapper.id), updated_at = now(), updated_by = v_actor
      WHERE is_active = true OR id = v_wrapper.id;

      UPDATE public.platform_email_settings
      SET wrapper_html_template = v_wrapper.wrapper_html_template, updated_at = now(), updated_by = v_actor
      WHERE id = 1;
    END IF;
  END IF;

  FOR v_lib IN
    SELECT *
    FROM public.platform_alert_template_library
    WHERE is_active = true
      AND (
        COALESCE(array_length(v_rollout.include_triggers, 1), 0) = 0
        OR trigger_event = ANY(v_rollout.include_triggers)
      )
    ORDER BY trigger_event, channel
  LOOP
    FOR v_alert IN
      SELECT id, tenant_id, trigger_event
      FROM public.communication_alerts
      WHERE trigger_event = v_lib.trigger_event
    LOOP
      v_tenant_decision := NULL;
      SELECT d.decision
      INTO v_tenant_decision
      FROM public.tenant_template_rollout_decisions d
      WHERE d.rollout_id = v_rollout.id
        AND d.tenant_id = v_alert.tenant_id;

      v_opt_out := false;
      IF NOT v_force_security AND v_rollout.allow_tenant_opt_out THEN
        SELECT COALESCE(opt_out_non_critical, false)
        INTO v_opt_out
        FROM public.tenant_template_rollout_preferences
        WHERE tenant_id = v_alert.tenant_id;
      END IF;

      IF v_opt_out AND v_tenant_decision IS NULL THEN
        v_skipped := v_skipped + 1;
        INSERT INTO public.platform_template_rollout_audit (
          rollout_id, tenant_id, trigger_event, channel, action, details, created_by
        ) VALUES (
          v_rollout.id, v_alert.tenant_id, v_lib.trigger_event, v_lib.channel, 'skipped_opt_out',
          jsonb_build_object('reason', 'tenant_opt_out_non_critical'),
          v_actor
        );
        CONTINUE;
      END IF;

      IF v_force_security THEN
        v_effective_mode := 'replace_all';
        v_effective_preserve_subject := false;
        v_effective_preserve_body_text := false;
      ELSE
        v_effective_mode := COALESCE(v_tenant_decision, v_rollout.update_mode);
        IF v_effective_mode = 'replace_all' THEN
          v_effective_preserve_subject := COALESCE(v_rollout.preserve_subject, true);
          v_effective_preserve_body_text := COALESCE(v_rollout.preserve_body_text, true);
        ELSE
          v_effective_preserve_subject := true;
          v_effective_preserve_body_text := true;
        END IF;
      END IF;

      SELECT *
      INTO v_existing
      FROM public.communication_templates
      WHERE alert_id = v_alert.id
        AND channel = v_lib.channel;

      IF NOT FOUND THEN
        INSERT INTO public.communication_templates (
          tenant_id,
          alert_id,
          channel,
          subject_template,
          body_template,
          body_format,
          editor_json
        ) VALUES (
          v_alert.tenant_id,
          v_alert.id,
          v_lib.channel,
          v_lib.subject_template,
          v_lib.body_template,
          v_lib.body_format,
          v_lib.editor_json
        );
        v_inserted := v_inserted + 1;
        INSERT INTO public.platform_template_rollout_audit (
          rollout_id, tenant_id, trigger_event, channel, action, details, created_by
        ) VALUES (
          v_rollout.id, v_alert.tenant_id, v_lib.trigger_event, v_lib.channel, 'inserted_missing_template',
          jsonb_build_object('effective_mode', v_effective_mode, 'force_security', v_force_security),
          v_actor
        );
      ELSE
        v_is_customized := v_existing.updated_at > v_existing.created_at;

        IF v_is_customized AND v_effective_mode = 'do_not_update' THEN
          v_skipped := v_skipped + 1;
          INSERT INTO public.platform_template_rollout_audit (
            rollout_id, tenant_id, trigger_event, channel, action, details, created_by
          ) VALUES (
            v_rollout.id, v_alert.tenant_id, v_lib.trigger_event, v_lib.channel, 'skipped_customized',
            jsonb_build_object('effective_mode', v_effective_mode),
            v_actor
          );
          CONTINUE;
        END IF;

        IF v_effective_mode = 'layout_only' THEN
          UPDATE public.communication_templates
          SET
            editor_json = COALESCE(v_lib.editor_json, editor_json),
            updated_at = now()
          WHERE id = v_existing.id;

          v_updated := v_updated + 1;
          INSERT INTO public.platform_template_rollout_audit (
            rollout_id, tenant_id, trigger_event, channel, action, details, created_by
          ) VALUES (
            v_rollout.id, v_alert.tenant_id, v_lib.trigger_event, v_lib.channel, 'updated_layout_only',
            jsonb_build_object('customized', v_is_customized, 'effective_mode', v_effective_mode),
            v_actor
          );
          CONTINUE;
        END IF;

        UPDATE public.communication_templates
        SET
          subject_template = CASE
            WHEN v_effective_preserve_subject THEN public.communication_templates.subject_template
            ELSE v_lib.subject_template
          END,
          body_template = CASE
            WHEN v_effective_preserve_body_text THEN public.communication_templates.body_template
            ELSE v_lib.body_template
          END,
          body_format = CASE
            WHEN v_effective_preserve_body_text THEN public.communication_templates.body_format
            ELSE v_lib.body_format
          END,
          editor_json = COALESCE(v_lib.editor_json, public.communication_templates.editor_json),
          updated_at = now()
        WHERE id = v_existing.id;

        v_updated := v_updated + 1;
        INSERT INTO public.platform_template_rollout_audit (
          rollout_id, tenant_id, trigger_event, channel, action, details, created_by
        ) VALUES (
          v_rollout.id, v_alert.tenant_id, v_lib.trigger_event, v_lib.channel, 'updated_template',
          jsonb_build_object(
            'customized', v_is_customized,
            'effective_mode', v_effective_mode,
            'preserve_subject', v_effective_preserve_subject,
            'preserve_body_text', v_effective_preserve_body_text,
            'force_security', v_force_security
          ),
          v_actor
        );
      END IF;
    END LOOP;
  END LOOP;

  UPDATE public.platform_template_rollouts
  SET
    status = 'launched',
    launched_at = now(),
    updated_at = now(),
    updated_by = v_actor
  WHERE id = v_rollout.id
    AND status <> 'cancelled';

  RETURN jsonb_build_object(
    'ok', true,
    'rollout_id', v_rollout.id,
    'inserted', v_inserted,
    'updated', v_updated,
    'skipped', v_skipped,
    'force_security', v_force_security
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_process_due_template_rollouts(
  p_limit integer DEFAULT 25
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_service_role boolean := (SELECT current_setting('request.jwt.claim.role', true)) = 'service_role';
  v_is_scheduler_role boolean := current_user IN ('postgres', 'supabase_admin');
  v_rollout public.platform_template_rollouts%ROWTYPE;
  v_results jsonb := '[]'::jsonb;
  v_processed integer := 0;
  v_errors integer := 0;
  v_exec jsonb;
BEGIN
  IF NOT (v_is_service_role OR v_is_scheduler_role) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  FOR v_rollout IN
    SELECT *
    FROM public.platform_template_rollouts r
    WHERE r.status = 'scheduled'
      AND (
        (COALESCE(r.is_security_critical, false) = false AND r.scheduled_for <= now())
        OR (
          COALESCE(r.is_security_critical, false) = true
          AND COALESCE(r.security_grace_until, r.scheduled_for) <= now()
        )
      )
    ORDER BY r.scheduled_for ASC, r.created_at ASC
    LIMIT GREATEST(COALESCE(p_limit, 25), 1)
  LOOP
    BEGIN
      SELECT public.rpc_admin_execute_template_rollout(v_rollout.id) INTO v_exec;
      v_processed := v_processed + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object('rollout_id', v_rollout.id, 'ok', true, 'result', v_exec));
    EXCEPTION
      WHEN OTHERS THEN
        v_errors := v_errors + 1;
        v_results := v_results || jsonb_build_array(jsonb_build_object('rollout_id', v_rollout.id, 'ok', false, 'error', SQLERRM));
        INSERT INTO public.platform_template_rollout_audit (
          rollout_id, tenant_id, trigger_event, channel, action, details, created_by
        ) VALUES (
          v_rollout.id, NULL, NULL, NULL, 'processor_error', jsonb_build_object('error', SQLERRM), NULL
        );
    END;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'processed', v_processed, 'errors', v_errors, 'results', v_results);
END;
$$;

DO $$
DECLARE
  v_job_id bigint;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron not available; skipping template rollout scheduler registration';
    RETURN;
  END IF;

  FOR v_job_id IN
    SELECT jobid
    FROM cron.job
    WHERE command ILIKE '%rpc_process_due_template_rollouts%'
  LOOP
    PERFORM cron.unschedule(v_job_id);
  END LOOP;

  PERFORM cron.schedule(
    '*/5 * * * *',
    $cmd$SELECT public.rpc_process_due_template_rollouts(50);$cmd$
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 8) Append-only rollout audit protections
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_platform_template_rollout_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'platform_template_rollout_audit is append-only; % is not allowed', TG_OP
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_platform_template_rollout_audit_update
  ON public.platform_template_rollout_audit;
CREATE TRIGGER trg_prevent_platform_template_rollout_audit_update
  BEFORE UPDATE ON public.platform_template_rollout_audit
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_platform_template_rollout_audit_mutation();

DROP TRIGGER IF EXISTS trg_prevent_platform_template_rollout_audit_delete
  ON public.platform_template_rollout_audit;
CREATE TRIGGER trg_prevent_platform_template_rollout_audit_delete
  BEFORE DELETE ON public.platform_template_rollout_audit
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_platform_template_rollout_audit_mutation();

COMMENT ON TABLE public.platform_template_rollout_audit IS
'Append-only audit log for platform template rollout actions by tenant/trigger/channel.';

-- ---------------------------------------------------------------------------
-- 9) Grants
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.rpc_admin_list_platform_alert_templates(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_upsert_platform_alert_template(text, text, text, text, text, jsonb, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_list_platform_wrapper_versions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_upsert_platform_wrapper_version(uuid, text, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_activate_platform_wrapper_version(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_schedule_template_rollout(text, text, timestamptz, text, boolean, boolean, boolean, text[], uuid, boolean, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_list_rollout_notice_recipients(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_create_rollout_in_app_notifications(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_execute_template_rollout(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_process_due_template_rollouts(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_sync_trigger_catalog_to_tenants(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_get_my_template_rollout_preference() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_set_my_template_rollout_preference(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_list_my_pending_template_rollouts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_set_my_template_rollout_decision(uuid, text) TO authenticated;
