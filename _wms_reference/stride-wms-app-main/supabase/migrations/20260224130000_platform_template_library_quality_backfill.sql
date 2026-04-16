-- ============================================================================
-- Platform template library quality backfill + auto-seed
-- - Ensures every active trigger has email/sms/in_app platform templates
-- - Uses richer module-aware copy (not generic "alert triggered" bodies)
-- - Auto-seeds future catalog inserts/activations
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Rich default builders (platform-level)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._platform_template_default_cta_link(
  p_module_group text,
  p_trigger_key text
) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_module_group = 'shipments' AND (p_trigger_key LIKE 'release.%' OR p_trigger_key LIKE 'will_call_%')
      THEN '[[release_link]]'
    WHEN p_module_group = 'shipments' THEN '[[shipment_link]]'
    WHEN p_module_group = 'tasks' AND p_trigger_key LIKE 'inspection%'
      THEN '[[portal_inspection_url]]'
    WHEN p_module_group = 'tasks' THEN '[[task_link]]'
    WHEN p_module_group = 'claims' THEN '[[portal_claim_url]]'
    WHEN p_module_group = 'quotes' THEN '[[portal_repair_url]]'
    WHEN p_module_group = 'items' THEN '[[item_photos_link]]'
    WHEN p_module_group = 'billing' THEN '[[portal_invoice_url]]'
    WHEN p_module_group = 'onboarding' THEN '[[portal_account_url]]'
    ELSE '[[portal_base_url]]'
  END;
$$;

CREATE OR REPLACE FUNCTION public._platform_template_default_cta_label(
  p_module_group text,
  p_trigger_key text
) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_module_group = 'shipments' AND (p_trigger_key LIKE 'release.%' OR p_trigger_key LIKE 'will_call_%')
      THEN 'View Release'
    WHEN p_module_group = 'shipments' THEN 'View Shipment'
    WHEN p_module_group = 'tasks' THEN 'View Task'
    WHEN p_module_group = 'claims' THEN 'View Claim'
    WHEN p_module_group = 'quotes' THEN 'View Repair'
    WHEN p_module_group = 'items' THEN 'View Item'
    WHEN p_module_group = 'billing' THEN 'View Invoice'
    WHEN p_module_group = 'onboarding' THEN 'View Account'
    ELSE 'View Details'
  END;
$$;

CREATE OR REPLACE FUNCTION public._platform_template_default_subject(
  p_display_name text,
  p_module_group text,
  p_trigger_key text
) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_module_group = 'shipments' AND (p_trigger_key LIKE 'release.%' OR p_trigger_key LIKE 'will_call_%')
      THEN '[[tenant_name]]: ' || COALESCE(p_display_name, p_trigger_key) || ' — [[release_number]]'
    WHEN p_module_group = 'shipments'
      THEN '[[tenant_name]]: ' || COALESCE(p_display_name, p_trigger_key) || ' — [[shipment_number]]'
    WHEN p_module_group = 'tasks'
      THEN '[[tenant_name]]: ' || COALESCE(p_display_name, p_trigger_key) || ' — [[task_title]]'
    WHEN p_module_group = 'claims'
      THEN '[[tenant_name]]: ' || COALESCE(p_display_name, p_trigger_key) || ' — [[claim_reference]]'
    WHEN p_module_group = 'quotes'
      THEN '[[tenant_name]]: ' || COALESCE(p_display_name, p_trigger_key) || ' — [[item_code]]'
    WHEN p_module_group = 'items'
      THEN '[[tenant_name]]: ' || COALESCE(p_display_name, p_trigger_key) || ' — [[item_code]]'
    WHEN p_module_group = 'billing' AND p_trigger_key LIKE 'billing_event.%'
      THEN '[[tenant_name]]: ' || COALESCE(p_display_name, p_trigger_key) || ' — [[service_name]]'
    WHEN p_module_group = 'billing'
      THEN '[[tenant_name]]: ' || COALESCE(p_display_name, p_trigger_key) || ' — [[invoice_number]]'
    WHEN p_module_group = 'onboarding'
      THEN '[[tenant_name]]: ' || COALESCE(p_display_name, p_trigger_key) || ' — [[account_name]]'
    ELSE '[[tenant_name]]: ' || COALESCE(p_display_name, p_trigger_key)
  END;
$$;

CREATE OR REPLACE FUNCTION public._platform_template_default_email_body(
  p_display_name text,
  p_description text,
  p_module_group text,
  p_trigger_key text
) RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_intro text := COALESCE(NULLIF(btrim(p_description), ''), COALESCE(p_display_name, p_trigger_key) || ' notification.');
BEGIN
  IF p_module_group = 'shipments' AND (p_trigger_key LIKE 'release.%' OR p_trigger_key LIKE 'will_call_%') THEN
    RETURN v_intro || E'\n\n' ||
      '**Release:** [[release_number]]' || E'\n' ||
      '**Type:** [[release_type]]' || E'\n' ||
      '**Items:** [[release_items_count]]' || E'\n' ||
      '**Released At:** [[released_at]]' || E'\n' ||
      '**Pickup Hours:** [[pickup_hours]]' || E'\n' ||
      '**Amount Due:** [[amount_due]]' || E'\n' ||
      '**Payment Status:** [[payment_status]]';
  ELSIF p_module_group = 'shipments' AND p_trigger_key LIKE '%unable_to_complete%' THEN
    RETURN v_intro || E'\n\n' ||
      '**Shipment:** [[shipment_number]]' || E'\n' ||
      '**Status:** [[shipment_status]]' || E'\n' ||
      '**Reason:** [[shipment_unable_reason]]' || E'\n' ||
      '**Account:** [[account_name]]';
  ELSIF p_module_group = 'shipments' THEN
    RETURN v_intro || E'\n\n' ||
      '**Shipment:** [[shipment_number]]' || E'\n' ||
      '**Status:** [[shipment_status]]' || E'\n' ||
      '**Account:** [[account_name]]' || E'\n' ||
      '**Expected Date:** [[shipment_expected_date]]' || E'\n' ||
      '**Received Date:** [[shipment_received_date]]' || E'\n' ||
      '**Items:** [[items_count]]';
  ELSIF p_module_group = 'tasks' AND p_trigger_key LIKE '%unable_to_complete%' THEN
    RETURN v_intro || E'\n\n' ||
      '**Task:** [[task_title]]' || E'\n' ||
      '**Type:** [[task_type]]' || E'\n' ||
      '**Assigned To:** [[assigned_to_name]]' || E'\n' ||
      '**Reason:** [[task_unable_reason]]';
  ELSIF p_module_group = 'tasks' AND p_trigger_key LIKE '%overdue%' THEN
    RETURN v_intro || E'\n\n' ||
      '**Task:** [[task_title]]' || E'\n' ||
      '**Due Date:** [[task_due_date]]' || E'\n' ||
      '**Days Overdue:** [[task_days_overdue]]';
  ELSIF p_module_group = 'tasks' AND p_trigger_key LIKE 'inspection%' THEN
    RETURN v_intro || E'\n\n' ||
      '**Inspection:** [[inspection_number]]' || E'\n' ||
      '**Task:** [[task_title]]' || E'\n' ||
      '**Result:** [[inspection_result]]' || E'\n' ||
      '**Issues:** [[inspection_issues_count]]';
  ELSIF p_module_group = 'tasks' THEN
    RETURN v_intro || E'\n\n' ||
      '**Task:** [[task_title]]' || E'\n' ||
      '**Type:** [[task_type]]' || E'\n' ||
      '**Status:** [[task_status]]' || E'\n' ||
      '**Due Date:** [[task_due_date]]';
  ELSIF p_module_group = 'claims' THEN
    RETURN v_intro || E'\n\n' ||
      '**Claim:** [[claim_reference]]' || E'\n' ||
      '**Status:** [[claim_status]]' || E'\n' ||
      '**Amount:** [[claim_amount]]' || E'\n' ||
      '**Offer:** [[offer_amount]]' || E'\n' ||
      '**Account:** [[account_name]]';
  ELSIF p_module_group = 'quotes' THEN
    RETURN v_intro || E'\n\n' ||
      '**Item:** [[item_code]]' || E'\n' ||
      '**Repair Type:** [[repair_type]]' || E'\n' ||
      '**Estimate:** [[repair_estimate_amount]]' || E'\n' ||
      '**Account:** [[account_name]]';
  ELSIF p_module_group = 'items' THEN
    RETURN v_intro || E'\n\n' ||
      '**Item:** [[item_code]]' || E'\n' ||
      '**Description:** [[item_description]]' || E'\n' ||
      '**Location:** [[item_location]]' || E'\n' ||
      '**Received:** [[item_received_date]]';
  ELSIF p_module_group = 'billing' AND p_trigger_key LIKE 'billing_event.%' THEN
    RETURN v_intro || E'\n\n' ||
      '**Service:** [[service_name]]' || E'\n' ||
      '**Code:** [[service_code]]' || E'\n' ||
      '**Amount:** [[service_amount]]' || E'\n' ||
      '**Account:** [[account_name]]';
  ELSIF p_module_group = 'billing' THEN
    RETURN v_intro || E'\n\n' ||
      '**Invoice:** [[invoice_number]]' || E'\n' ||
      '**Amount Due:** [[amount_due]]' || E'\n' ||
      '**Payment Status:** [[payment_status]]' || E'\n' ||
      '**Account:** [[account_name]]';
  ELSIF p_module_group = 'onboarding' THEN
    RETURN v_intro || E'\n\n' ||
      '**Account:** [[account_name]]' || E'\n' ||
      '**Created By:** [[created_by_name]]';
  ELSE
    RETURN v_intro || E'\n\n' ||
      '**Account:** [[account_name]]' || E'\n' ||
      '**Created:** [[created_at]]';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public._platform_template_default_sms_body(
  p_display_name text,
  p_module_group text,
  p_trigger_key text
) RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_name text := COALESCE(p_display_name, p_trigger_key, 'Alert');
BEGIN
  IF p_module_group = 'shipments' AND (p_trigger_key LIKE 'release.%' OR p_trigger_key LIKE 'will_call_%') THEN
    RETURN '[[tenant_name]]: ' || v_name || ' — [[release_number]] ([[release_items_count]] items). [[release_link]]';
  ELSIF p_module_group = 'shipments' THEN
    RETURN '[[tenant_name]]: ' || v_name || ' — [[shipment_number]] ([[shipment_status]]). [[shipment_link]]';
  ELSIF p_module_group = 'tasks' THEN
    RETURN '[[tenant_name]]: ' || v_name || ' — [[task_title]]. [[task_link]]';
  ELSIF p_module_group = 'claims' THEN
    RETURN '[[tenant_name]]: ' || v_name || ' — [[claim_reference]] ([[claim_status]]). [[portal_claim_url]]';
  ELSIF p_module_group = 'quotes' THEN
    RETURN '[[tenant_name]]: ' || v_name || ' — [[item_code]] ([[repair_estimate_amount]]). [[portal_repair_url]]';
  ELSIF p_module_group = 'items' THEN
    RETURN '[[tenant_name]]: ' || v_name || ' — [[item_code]] at [[item_location]]. [[item_photos_link]]';
  ELSIF p_module_group = 'billing' AND p_trigger_key LIKE 'billing_event.%' THEN
    RETURN '[[tenant_name]]: ' || v_name || ' — [[service_name]] [[service_amount]].';
  ELSIF p_module_group = 'billing' THEN
    RETURN '[[tenant_name]]: ' || v_name || ' — [[invoice_number]] [[amount_due]]. [[portal_invoice_url]]';
  ELSIF p_module_group = 'onboarding' THEN
    RETURN '[[tenant_name]]: ' || v_name || ' — [[account_name]]. [[portal_account_url]]';
  ELSE
    RETURN '[[tenant_name]]: ' || v_name || '.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public._platform_template_default_in_app_body(
  p_display_name text,
  p_module_group text,
  p_trigger_key text
) RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_name text := COALESCE(p_display_name, p_trigger_key, 'Alert');
BEGIN
  IF p_module_group = 'shipments' AND (p_trigger_key LIKE 'release.%' OR p_trigger_key LIKE 'will_call_%') THEN
    RETURN v_name || ': [[release_number]] ([[release_items_count]] items)';
  ELSIF p_module_group = 'shipments' THEN
    RETURN v_name || ': [[shipment_number]] ([[shipment_status]])';
  ELSIF p_module_group = 'tasks' THEN
    RETURN v_name || ': [[task_title]]';
  ELSIF p_module_group = 'claims' THEN
    RETURN v_name || ': [[claim_reference]] ([[claim_status]])';
  ELSIF p_module_group = 'quotes' THEN
    RETURN v_name || ': [[item_code]] ([[repair_estimate_amount]])';
  ELSIF p_module_group = 'items' THEN
    RETURN v_name || ': [[item_code]]';
  ELSIF p_module_group = 'billing' AND p_trigger_key LIKE 'billing_event.%' THEN
    RETURN v_name || ': [[service_name]] ([[service_amount]])';
  ELSIF p_module_group = 'billing' THEN
    RETURN v_name || ': [[invoice_number]] ([[amount_due]])';
  ELSE
    RETURN v_name;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2) Upsert platform templates for one catalog trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._upsert_platform_templates_for_trigger(
  p_trigger_key text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_catalog record;
  v_cta_link text;
  v_cta_label text;
  v_subject text;
  v_email_body text;
  v_sms_body text;
  v_in_app_body text;
BEGIN
  SELECT *
  INTO v_catalog
  FROM public.communication_trigger_catalog
  WHERE key = p_trigger_key
    AND is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'trigger_key', p_trigger_key, 'message', 'Trigger inactive or missing');
  END IF;

  v_cta_link := public._platform_template_default_cta_link(v_catalog.module_group, v_catalog.key);
  v_cta_label := public._platform_template_default_cta_label(v_catalog.module_group, v_catalog.key);
  v_subject := public._platform_template_default_subject(v_catalog.display_name, v_catalog.module_group, v_catalog.key);
  v_email_body := public._platform_template_default_email_body(v_catalog.display_name, v_catalog.description, v_catalog.module_group, v_catalog.key);
  v_sms_body := public._platform_template_default_sms_body(v_catalog.display_name, v_catalog.module_group, v_catalog.key);
  v_in_app_body := public._platform_template_default_in_app_body(v_catalog.display_name, v_catalog.module_group, v_catalog.key);

  INSERT INTO public.platform_alert_template_library (
    trigger_event, channel, subject_template, body_template, body_format, editor_json, is_active, updated_at
  ) VALUES (
    v_catalog.key,
    'email',
    v_subject,
    v_email_body,
    'text',
    jsonb_build_object(
      'heading', COALESCE(v_catalog.display_name, v_catalog.key),
      'recipients', '',
      'cta_enabled', true,
      'cta_label', v_cta_label,
      'cta_link', v_cta_link
    ),
    true,
    now()
  )
  ON CONFLICT (trigger_event, channel) DO UPDATE
  SET
    subject_template = EXCLUDED.subject_template,
    body_template = EXCLUDED.body_template,
    body_format = EXCLUDED.body_format,
    editor_json = EXCLUDED.editor_json,
    is_active = true,
    updated_at = now();

  INSERT INTO public.platform_alert_template_library (
    trigger_event, channel, subject_template, body_template, body_format, editor_json, is_active, updated_at
  ) VALUES (
    v_catalog.key,
    'sms',
    NULL,
    v_sms_body,
    'text',
    NULL,
    true,
    now()
  )
  ON CONFLICT (trigger_event, channel) DO UPDATE
  SET
    subject_template = EXCLUDED.subject_template,
    body_template = EXCLUDED.body_template,
    body_format = EXCLUDED.body_format,
    editor_json = EXCLUDED.editor_json,
    is_active = true,
    updated_at = now();

  INSERT INTO public.platform_alert_template_library (
    trigger_event, channel, subject_template, body_template, body_format, editor_json, is_active, updated_at
  ) VALUES (
    v_catalog.key,
    'in_app',
    COALESCE(v_catalog.display_name, v_catalog.key),
    v_in_app_body,
    'text',
    NULL,
    true,
    now()
  )
  ON CONFLICT (trigger_event, channel) DO UPDATE
  SET
    subject_template = EXCLUDED.subject_template,
    body_template = EXCLUDED.body_template,
    body_format = EXCLUDED.body_format,
    editor_json = EXCLUDED.editor_json,
    is_active = true,
    updated_at = now();

  RETURN jsonb_build_object('ok', true, 'trigger_key', v_catalog.key);
END;
$$;

-- ---------------------------------------------------------------------------
-- 3) Auto-seed platform library when catalog trigger is inserted/activated
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._trg_seed_platform_templates_from_catalog()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_active = true THEN
    PERFORM public._upsert_platform_templates_for_trigger(NEW.key);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_platform_templates_insert ON public.communication_trigger_catalog;
CREATE TRIGGER trg_seed_platform_templates_insert
  AFTER INSERT ON public.communication_trigger_catalog
  FOR EACH ROW
  EXECUTE FUNCTION public._trg_seed_platform_templates_from_catalog();

DROP TRIGGER IF EXISTS trg_seed_platform_templates_activate ON public.communication_trigger_catalog;
CREATE TRIGGER trg_seed_platform_templates_activate
  AFTER UPDATE OF is_active ON public.communication_trigger_catalog
  FOR EACH ROW
  WHEN (OLD.is_active = false AND NEW.is_active = true)
  EXECUTE FUNCTION public._trg_seed_platform_templates_from_catalog();

-- ---------------------------------------------------------------------------
-- 4) Backfill all active catalog triggers now
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
    PERFORM public._upsert_platform_templates_for_trigger(v_trigger.key);
  END LOOP;
END $$;

