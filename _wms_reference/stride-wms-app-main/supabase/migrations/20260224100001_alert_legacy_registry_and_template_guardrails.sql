-- ============================================================================
-- Alert system hardening:
-- 1) Legacy trigger registry + catalog metadata
-- 2) Emergency admin_dev override reset procedure
-- 3) Server-side template edit boundary enforcement
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Mark and track legacy triggers explicitly in catalog
-- ---------------------------------------------------------------------------
ALTER TABLE public.communication_trigger_catalog
  ADD COLUMN IF NOT EXISTS is_legacy boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS legacy_replacement_key text;

COMMENT ON COLUMN public.communication_trigger_catalog.is_legacy
  IS 'True when trigger is legacy/deprecated and kept for compatibility.';
COMMENT ON COLUMN public.communication_trigger_catalog.legacy_replacement_key
  IS 'Preferred modern trigger key for migration guidance (best-effort).';

UPDATE public.communication_trigger_catalog
SET is_legacy = true
WHERE is_legacy = false
  AND (
    lower(display_name) LIKE '%(legacy)%'
    OR lower(coalesce(description, '')) LIKE 'legacy trigger:%'
  );

WITH replacements(legacy_key, replacement_key) AS (
  VALUES
    ('task_assigned', 'task.assigned'),
    ('task_completed', 'task.completed'),
    ('task_overdue', 'task.overdue')
)
UPDATE public.communication_trigger_catalog c
SET legacy_replacement_key = r.replacement_key
FROM replacements r
WHERE c.key = r.legacy_key
  AND c.legacy_replacement_key IS DISTINCT FROM r.replacement_key;

-- ---------------------------------------------------------------------------
-- 1b) Dedicated legacy registry table (append/update catalog snapshot)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.communication_legacy_trigger_registry (
  key text PRIMARY KEY,
  replacement_key text,
  description text,
  catalog_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.communication_legacy_trigger_registry ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read legacy trigger registry"
  ON public.communication_legacy_trigger_registry;
CREATE POLICY "Authenticated users can read legacy trigger registry"
  ON public.communication_legacy_trigger_registry
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "admin_dev can manage legacy trigger registry"
  ON public.communication_legacy_trigger_registry;
CREATE POLICY "admin_dev can manage legacy trigger registry"
  ON public.communication_legacy_trigger_registry
  FOR ALL
  TO authenticated
  USING (public.current_user_is_admin_dev())
  WITH CHECK (public.current_user_is_admin_dev());

CREATE OR REPLACE FUNCTION public._trg_touch_legacy_trigger_registry_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_legacy_trigger_registry_updated_at
  ON public.communication_legacy_trigger_registry;
CREATE TRIGGER trg_touch_legacy_trigger_registry_updated_at
  BEFORE UPDATE ON public.communication_legacy_trigger_registry
  FOR EACH ROW
  EXECUTE FUNCTION public._trg_touch_legacy_trigger_registry_updated_at();

CREATE OR REPLACE FUNCTION public.rpc_admin_refresh_legacy_trigger_registry()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows integer := 0;
BEGIN
  IF NOT public.current_user_is_admin_dev() THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  INSERT INTO public.communication_legacy_trigger_registry (
    key,
    replacement_key,
    description,
    catalog_snapshot
  )
  SELECT
    c.key,
    c.legacy_replacement_key,
    c.description,
    to_jsonb(c)
  FROM public.communication_trigger_catalog c
  WHERE c.is_legacy = true
  ON CONFLICT (key)
  DO UPDATE
  SET
    replacement_key = EXCLUDED.replacement_key,
    description = EXCLUDED.description,
    catalog_snapshot = EXCLUDED.catalog_snapshot,
    updated_at = now();

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_admin_refresh_legacy_trigger_registry() TO authenticated;

INSERT INTO public.communication_legacy_trigger_registry (
  key,
  replacement_key,
  description,
  catalog_snapshot
)
SELECT
  c.key,
  c.legacy_replacement_key,
  c.description,
  to_jsonb(c)
FROM public.communication_trigger_catalog c
WHERE c.is_legacy = true
ON CONFLICT (key)
DO UPDATE
SET
  replacement_key = EXCLUDED.replacement_key,
  description = EXCLUDED.description,
  catalog_snapshot = EXCLUDED.catalog_snapshot,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- 2) Emergency force-reset helper for one tenant
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._ensure_catalog_trigger_for_tenant(
  p_tenant_id uuid,
  p_trigger_key text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_catalog record;
  v_alert record;
  v_alert_id uuid;
  v_alert_key_base text;
  v_alert_key text;
  v_key_suffix int;
  v_channels jsonb;
  v_cta_link text;
  v_subject text;
  v_email_body text;
  v_sms_body text;
  v_in_app_body text;
  v_in_app_recipients text;
  v_templates_created int := 0;
  v_alerts_created int := 0;
  v_lib record;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant id is required';
  END IF;

  SELECT c.*
  INTO v_catalog
  FROM public.communication_trigger_catalog c
  WHERE c.key = p_trigger_key
    AND c.is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'trigger_key', p_trigger_key,
      'alerts_created', 0,
      'templates_created', 0,
      'message', 'Trigger not active or not found'
    );
  END IF;

  v_cta_link := public._catalog_default_cta_link(v_catalog.module_group);
  v_subject := '[[tenant_name]]: ' || COALESCE(v_catalog.display_name, v_catalog.key);
  v_email_body := public._catalog_default_email_body(v_catalog.display_name, v_catalog.module_group);
  v_sms_body := public._catalog_default_sms_body(v_catalog.display_name, v_catalog.module_group);
  v_in_app_body := public._catalog_default_in_app_body(v_catalog.display_name, v_catalog.module_group);
  v_in_app_recipients := public._catalog_default_in_app_recipients(v_catalog.audience);
  v_channels := jsonb_build_object(
    'email',   COALESCE(v_catalog.default_channels @> ARRAY['email']::text[], true),
    'sms',     COALESCE(v_catalog.default_channels @> ARRAY['sms']::text[], false),
    'in_app',  COALESCE(v_catalog.default_channels @> ARRAY['in_app']::text[], false)
  );

  SELECT a.id, a.key
  INTO v_alert
  FROM public.communication_alerts a
  WHERE a.tenant_id = p_tenant_id
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
      WHERE k.tenant_id = p_tenant_id
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
      p_tenant_id,
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
    SELECT 1
    FROM public.communication_templates et
    WHERE et.alert_id = v_alert_id
      AND et.channel = 'email'
  ) THEN
    SELECT subject_template, body_template, body_format, editor_json
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
      p_tenant_id,
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
          'cta_label', 'View Details',
          'cta_link', v_cta_link
        )
      )
    );

    v_templates_created := v_templates_created + 1;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.communication_templates st
    WHERE st.alert_id = v_alert_id
      AND st.channel = 'sms'
  ) THEN
    SELECT subject_template, body_template, body_format
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
      p_tenant_id,
      v_alert_id,
      'sms',
      NULL,
      COALESCE(v_lib.body_template, v_sms_body),
      COALESCE(v_lib.body_format, 'text')
    );

    v_templates_created := v_templates_created + 1;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.communication_templates it
    WHERE it.alert_id = v_alert_id
      AND it.channel = 'in_app'
  ) THEN
    SELECT subject_template, body_template, body_format, editor_json
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
      p_tenant_id,
      v_alert_id,
      'in_app',
      COALESCE(v_lib.subject_template, COALESCE(v_catalog.display_name, v_catalog.key)),
      COALESCE(v_lib.body_template, v_in_app_body),
      COALESCE(v_lib.body_format, 'text'),
      v_in_app_recipients
    );

    v_templates_created := v_templates_created + 1;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'trigger_key', p_trigger_key,
    'tenant_id', p_tenant_id,
    'alerts_created', v_alerts_created,
    'templates_created', v_templates_created
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_admin_force_reset_tenant_alert_templates(
  p_tenant_id uuid,
  p_override_token text,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_required_token text := 'FORCE_RESET_ALERT_TEMPLATES_V1';
  v_trigger record;
  v_result jsonb;
  v_deleted_alerts integer := 0;
  v_deleted_templates integer := 0;
  v_alerts_created integer := 0;
  v_templates_created integer := 0;
BEGIN
  IF NOT public.current_user_is_admin_dev() THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant id is required';
  END IF;

  IF COALESCE(btrim(p_override_token), '') <> v_required_token THEN
    RAISE EXCEPTION 'INVALID_OVERRIDE_TOKEN';
  END IF;

  DELETE FROM public.communication_templates
  WHERE tenant_id = p_tenant_id;
  GET DIAGNOSTICS v_deleted_templates = ROW_COUNT;

  DELETE FROM public.communication_alerts
  WHERE tenant_id = p_tenant_id;
  GET DIAGNOSTICS v_deleted_alerts = ROW_COUNT;

  FOR v_trigger IN
    SELECT key
    FROM public.communication_trigger_catalog
    WHERE is_active = true
    ORDER BY key
  LOOP
    v_result := public._ensure_catalog_trigger_for_tenant(p_tenant_id, v_trigger.key);
    v_alerts_created := v_alerts_created + COALESCE((v_result->>'alerts_created')::int, 0);
    v_templates_created := v_templates_created + COALESCE((v_result->>'templates_created')::int, 0);
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'tenant_id', p_tenant_id,
    'deleted_alerts', v_deleted_alerts,
    'deleted_templates', v_deleted_templates,
    'alerts_created', v_alerts_created,
    'templates_created', v_templates_created,
    'override_token_hint', v_required_token,
    'reason', COALESCE(p_reason, '')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_admin_force_reset_tenant_alert_templates(uuid, text, text) TO authenticated;

COMMENT ON FUNCTION public.rpc_admin_force_reset_tenant_alert_templates(uuid, text, text)
IS 'Emergency admin_dev override to discard tenant alert/template customizations and re-provision from active trigger catalog. Requires explicit override token.';

-- ---------------------------------------------------------------------------
-- 3) Hard enforcement: tenant template updates may only touch editable fields
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_communication_template_edit_boundaries()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  -- Service role/background jobs and admin_dev can perform full updates.
  IF v_actor IS NULL OR public.current_user_is_admin_dev() THEN
    RETURN NEW;
  END IF;

  IF
    NEW.id IS DISTINCT FROM OLD.id
    OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    OR NEW.alert_id IS DISTINCT FROM OLD.alert_id
    OR NEW.channel IS DISTINCT FROM OLD.channel
    OR NEW.from_name IS DISTINCT FROM OLD.from_name
    OR NEW.from_email IS DISTINCT FROM OLD.from_email
    OR NEW.sms_sender_id IS DISTINCT FROM OLD.sms_sender_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'Only subject/body/tokens/recipients are tenant-editable for communication templates'
      USING ERRCODE = '42501';
  END IF;

  -- Allow body_format migration from html -> text; block any other format mutation.
  IF NEW.body_format IS DISTINCT FROM OLD.body_format THEN
    IF NOT (OLD.body_format = 'html' AND NEW.body_format = 'text') THEN
      RAISE EXCEPTION 'Template body_format is platform-managed'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_communication_template_edit_boundaries
  ON public.communication_templates;
CREATE TRIGGER trg_enforce_communication_template_edit_boundaries
  BEFORE UPDATE ON public.communication_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_communication_template_edit_boundaries();

COMMENT ON FUNCTION public.enforce_communication_template_edit_boundaries()
IS 'Prevents non-admin_dev users from mutating platform-managed communication_templates fields.';
