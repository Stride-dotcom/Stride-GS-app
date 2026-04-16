-- =============================================================================
-- Admin Alert Template Ops (admin_dev only)
-- - Global template library
-- - Wrapper versions
-- - Rollout scheduling + execution
-- - Tenant admin notice helpers (email recipients + in-app alerts)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) GLOBAL TEMPLATE LIBRARY (platform scope)
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
  UNIQUE(trigger_event, channel)
);

CREATE INDEX IF NOT EXISTS idx_platform_alert_template_library_trigger_channel
  ON public.platform_alert_template_library(trigger_event, channel);

ALTER TABLE public.platform_alert_template_library ENABLE ROW LEVEL SECURITY;

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

-- ---------------------------------------------------------------------------
-- 2) WRAPPER VERSIONS (platform scope)
-- ---------------------------------------------------------------------------
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

CREATE INDEX IF NOT EXISTS idx_platform_email_wrapper_versions_active
  ON public.platform_email_wrapper_versions(is_active)
  WHERE is_active = true;

ALTER TABLE public.platform_email_wrapper_versions ENABLE ROW LEVEL SECURITY;

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

-- ---------------------------------------------------------------------------
-- 3) ROLLOUT PREFERENCES (tenant scope opt-out for non-critical updates)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenant_template_rollout_preferences (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  opt_out_non_critical boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id)
);

ALTER TABLE public.tenant_template_rollout_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_template_rollout_preferences_select" ON public.tenant_template_rollout_preferences;
CREATE POLICY "tenant_template_rollout_preferences_select"
  ON public.tenant_template_rollout_preferences
  FOR SELECT
  TO authenticated
  USING (
    (SELECT current_setting('request.jwt.claim.role', true)) = 'service_role'
    OR public.current_user_is_admin_dev()
    OR tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "tenant_template_rollout_preferences_update" ON public.tenant_template_rollout_preferences;
CREATE POLICY "tenant_template_rollout_preferences_update"
  ON public.tenant_template_rollout_preferences
  FOR ALL
  TO authenticated
  USING (
    (SELECT current_setting('request.jwt.claim.role', true)) = 'service_role'
    OR public.current_user_is_admin_dev()
    OR tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid())
  )
  WITH CHECK (
    (SELECT current_setting('request.jwt.claim.role', true)) = 'service_role'
    OR public.current_user_is_admin_dev()
    OR tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 4) ROLLOUTS + AUDIT
-- ---------------------------------------------------------------------------
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
  launched_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_platform_template_rollouts_status_scheduled
  ON public.platform_template_rollouts(status, scheduled_for);

ALTER TABLE public.platform_template_rollouts ENABLE ROW LEVEL SECURITY;

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

CREATE INDEX IF NOT EXISTS idx_platform_template_rollout_audit_rollout
  ON public.platform_template_rollout_audit(rollout_id, created_at DESC);

ALTER TABLE public.platform_template_rollout_audit ENABLE ROW LEVEL SECURITY;

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

-- ---------------------------------------------------------------------------
-- 5) RPCs
-- ---------------------------------------------------------------------------
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
  ON CONFLICT (trigger_event, channel) DO UPDATE SET
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

CREATE OR REPLACE FUNCTION public.rpc_admin_schedule_template_rollout(
  p_name text,
  p_notes text DEFAULT NULL,
  p_scheduled_for timestamptz DEFAULT now(),
  p_update_mode text DEFAULT 'layout_only',
  p_preserve_subject boolean DEFAULT true,
  p_preserve_body_text boolean DEFAULT true,
  p_allow_tenant_opt_out boolean DEFAULT true,
  p_include_triggers text[] DEFAULT NULL,
  p_wrapper_version_id uuid DEFAULT NULL
)
RETURNS public.platform_template_rollouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_row public.platform_template_rollouts;
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
    created_by,
    updated_by
  ) VALUES (
    btrim(p_name),
    NULLIF(btrim(p_notes), ''),
    COALESCE(p_scheduled_for, now()),
    'scheduled',
    p_update_mode,
    COALESCE(p_preserve_subject, true),
    COALESCE(p_preserve_body_text, true),
    COALESCE(p_allow_tenant_opt_out, true),
    p_include_triggers,
    p_wrapper_version_id,
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
    u.id AS user_id,
    lower(u.email) AS email,
    t.id AS tenant_id,
    t.name AS tenant_name,
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
      NOT COALESCE(v_rollout.allow_tenant_opt_out, true)
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

  RETURN jsonb_build_object(
    'ok', true,
    'inserted', v_inserted
  );
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

  IF v_rollout.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Rollout is cancelled');
  END IF;

  -- Apply selected wrapper globally (layout updates happen at render time)
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
      v_opt_out := false;
      IF v_rollout.allow_tenant_opt_out THEN
        SELECT COALESCE(opt_out_non_critical, false)
        INTO v_opt_out
        FROM public.tenant_template_rollout_preferences
        WHERE tenant_id = v_alert.tenant_id;
      END IF;

      IF v_opt_out THEN
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
          '{}'::jsonb,
          v_actor
        );
      ELSE
        v_is_customized := v_existing.updated_at > v_existing.created_at;

        IF v_is_customized AND v_rollout.update_mode = 'do_not_update' THEN
          v_skipped := v_skipped + 1;
          INSERT INTO public.platform_template_rollout_audit (
            rollout_id, tenant_id, trigger_event, channel, action, details, created_by
          ) VALUES (
            v_rollout.id, v_alert.tenant_id, v_lib.trigger_event, v_lib.channel, 'skipped_customized',
            '{}'::jsonb,
            v_actor
          );
          CONTINUE;
        END IF;

        IF v_is_customized AND v_rollout.update_mode = 'layout_only' THEN
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
            '{}'::jsonb,
            v_actor
          );
          CONTINUE;
        END IF;

        UPDATE public.communication_templates
        SET
          subject_template = CASE
            WHEN v_rollout.preserve_subject THEN public.communication_templates.subject_template
            ELSE v_lib.subject_template
          END,
          body_template = CASE
            WHEN v_rollout.preserve_body_text THEN public.communication_templates.body_template
            ELSE v_lib.body_template
          END,
          body_format = CASE
            WHEN v_rollout.preserve_body_text THEN public.communication_templates.body_format
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
            'preserve_subject', v_rollout.preserve_subject,
            'preserve_body_text', v_rollout.preserve_body_text
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
    'skipped', v_skipped
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 6) GRANTS
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.rpc_admin_list_platform_alert_templates(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_upsert_platform_alert_template(text, text, text, text, text, jsonb, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_list_platform_wrapper_versions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_upsert_platform_wrapper_version(uuid, text, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_activate_platform_wrapper_version(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_schedule_template_rollout(text, text, timestamptz, text, boolean, boolean, boolean, text[], uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_list_rollout_notice_recipients(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_create_rollout_in_app_notifications(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_execute_template_rollout(uuid) TO authenticated;

