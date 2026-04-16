-- =============================================================================
-- Auto-provision alert + templates when new trigger is added to catalog
-- =============================================================================
-- Goal:
-- - Any new active row in communication_trigger_catalog should automatically
--   create a tenant alert and default templates (email/sms/in_app) for every
--   tenant that does not already have that trigger.
-- - Never overwrite existing tenant templates.
-- - Allow manual backfill via admin_dev RPC.

-- ---------------------------------------------------------------------------
-- Helper: default CTA link token by module
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._catalog_default_cta_link(
  p_module_group text
) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_module_group
    WHEN 'shipments'  THEN '[[shipment_link]]'
    WHEN 'tasks'      THEN '[[task_link]]'
    WHEN 'claims'     THEN '[[portal_claim_url]]'
    WHEN 'quotes'     THEN '[[portal_repair_url]]'
    WHEN 'items'      THEN '[[item_photos_link]]'
    WHEN 'billing'    THEN '[[portal_invoice_url]]'
    ELSE '[[portal_base_url]]'
  END;
$$;

-- ---------------------------------------------------------------------------
-- Helper: default email body by module
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Helper: default SMS body by module
-- ---------------------------------------------------------------------------
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
      RETURN '[[tenant_name]]: ' || COALESCE(p_display_name, 'Shipment alert') ||
        ' — [[shipment_number]]. [[shipment_link]]';
    WHEN 'tasks' THEN
      RETURN '[[tenant_name]]: ' || COALESCE(p_display_name, 'Task alert') ||
        ' — [[task_title]]. [[task_link]]';
    WHEN 'claims' THEN
      RETURN '[[tenant_name]]: ' || COALESCE(p_display_name, 'Claim alert') ||
        ' — [[claim_reference]]. [[portal_claim_url]]';
    WHEN 'quotes' THEN
      RETURN '[[tenant_name]]: ' || COALESCE(p_display_name, 'Repair alert') ||
        ' — [[item_code]]. [[portal_repair_url]]';
    WHEN 'items' THEN
      RETURN '[[tenant_name]]: ' || COALESCE(p_display_name, 'Item alert') ||
        ' — [[item_code]]. [[item_photos_link]]';
    WHEN 'billing' THEN
      RETURN '[[tenant_name]]: ' || COALESCE(p_display_name, 'Billing alert') ||
        ' — [[account_name]]. [[portal_invoice_url]]';
    ELSE
      RETURN '[[tenant_name]]: ' || COALESCE(p_display_name, 'Alert notification') || '.';
  END CASE;
END;
$$;

-- ---------------------------------------------------------------------------
-- Helper: default in-app body by module
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Helper: default in-app recipients by audience
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._catalog_default_in_app_recipients(
  p_audience text
) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_audience
    WHEN 'client' THEN '[[client_user_role]]'
    WHEN 'both'   THEN '[[manager_role]], [[client_user_role]]'
    ELSE '[[admin_role]], [[manager_role]]'
  END;
$$;

-- ---------------------------------------------------------------------------
-- Main helper: ensure one trigger exists for all tenants
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
  v_subject text;
  v_email_body text;
  v_sms_body text;
  v_in_app_body text;
  v_in_app_recipients text;
  v_templates_created int := 0;
  v_alerts_created int := 0;
  v_lib record;
BEGIN
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

  FOR v_tenant IN
    SELECT t.id
    FROM public.tenants t
  LOOP
    -- 1) Ensure alert row exists (by trigger_event)
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

    -- 2) Ensure email template exists
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
            'cta_label', 'View Details',
            'cta_link', v_cta_link
          )
        )
      );

      v_templates_created := v_templates_created + 1;
    END IF;

    -- 3) Ensure sms template exists
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
        v_tenant.id,
        v_alert_id,
        'sms',
        NULL,
        COALESCE(v_lib.body_template, v_sms_body),
        COALESCE(v_lib.body_format, 'text')
      );

      v_templates_created := v_templates_created + 1;
    END IF;

    -- 4) Ensure in-app template exists
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
        v_tenant.id,
        v_alert_id,
        'in_app',
        COALESCE(v_lib.subject_template, COALESCE(v_catalog.display_name, v_catalog.key)),
        COALESCE(v_lib.body_template, v_in_app_body),
        COALESCE(v_lib.body_format, 'text'),
        v_in_app_recipients
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

-- ---------------------------------------------------------------------------
-- Trigger function: auto-sync on catalog insert / activation
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Admin RPC: manual backfill sync (one trigger or all active triggers)
-- ---------------------------------------------------------------------------
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
    RETURN jsonb_build_object(
      'ok', true,
      'mode', 'single',
      'result', v_result
    );
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

GRANT EXECUTE ON FUNCTION public.rpc_admin_sync_trigger_catalog_to_tenants(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- One-time backfill on migration apply: ensure all active catalog triggers
-- are provisioned for all tenants without overwriting existing templates.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_trigger record;
BEGIN
  FOR v_trigger IN
    SELECT key
    FROM public.communication_trigger_catalog
    WHERE is_active = true
    ORDER BY key
  LOOP
    PERFORM public._ensure_catalog_trigger_for_all_tenants(v_trigger.key);
  END LOOP;
END $$;

