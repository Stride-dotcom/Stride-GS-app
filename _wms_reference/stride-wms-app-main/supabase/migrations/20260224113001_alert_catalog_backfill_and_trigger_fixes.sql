-- ============================================================================
-- Alert catalog parity + provisioning hardening
-- - Adds missing launch triggers
-- - Removes test duplicate trigger/template rows
-- - Ensures every tenant is fully provisioned from active trigger catalog
-- - Ensures new tenants auto-provision on insert
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Add missing trigger catalog rows required by launch scope
-- ---------------------------------------------------------------------------
INSERT INTO public.communication_trigger_catalog
  (key, display_name, description, module_group, audience, default_channels, severity, is_active)
VALUES
  (
    'task.unable_to_complete',
    'Task Unable to Complete',
    'A task was marked unable to complete and requires follow-up.',
    'tasks',
    'internal',
    ARRAY['email','in_app'],
    'warn',
    true
  ),
  (
    'task_unable_to_complete',
    'Task Unable to Complete (legacy)',
    'Legacy trigger: task unable to complete.',
    'tasks',
    'internal',
    ARRAY['email','in_app'],
    'warn',
    true
  ),
  (
    'shipment.partial_completed',
    'Partial Shipment Completed',
    'A shipment completed partially and some items were removed/restored.',
    'shipments',
    'both',
    ARRAY['email','in_app'],
    'warn',
    true
  ),
  (
    'shipment.unable_to_complete',
    'Shipment Unable to Complete',
    'A shipment was marked unable to complete (cancelled/blocked).',
    'shipments',
    'internal',
    ARRAY['email','in_app'],
    'warn',
    true
  )
ON CONFLICT (key) DO UPDATE
SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  module_group = EXCLUDED.module_group,
  audience = EXCLUDED.audience,
  default_channels = EXCLUDED.default_channels,
  severity = EXCLUDED.severity,
  is_active = true;

-- Seed platform defaults so catalog provisioning creates useful templates.
INSERT INTO public.platform_alert_template_library
  (trigger_event, channel, subject_template, body_template, body_format, editor_json, is_active)
VALUES
  (
    'task.unable_to_complete',
    'email',
    '[[tenant_name]]: Task Unable to Complete — [[task_title]]',
    E'A task was marked unable to complete and requires follow-up.\n\n**Task:** [[task_title]]\n**Type:** [[task_type]]\n**Assigned To:** [[assigned_to_name]]\n**Reason:** [[task_unable_reason]]',
    'text',
    '{"heading":"Task Unable to Complete","recipients":"","cta_enabled":true,"cta_label":"Review Task","cta_link":"[[task_link]]"}'::jsonb,
    true
  ),
  (
    'task.unable_to_complete',
    'sms',
    NULL,
    '[[tenant_name]]: Task "[[task_title]]" unable to complete. Reason: [[task_unable_reason]]. View: [[task_link]]',
    'text',
    NULL,
    true
  ),
  (
    'task.unable_to_complete',
    'in_app',
    'Task Unable to Complete',
    'Task "[[task_title]]" marked unable to complete. Reason: [[task_unable_reason]].',
    'text',
    NULL,
    true
  ),
  (
    'task_unable_to_complete',
    'email',
    '[[tenant_name]]: Task Unable to Complete — [[task_title]]',
    E'A task was marked unable to complete and requires follow-up.\n\n**Task:** [[task_title]]\n**Type:** [[task_type]]\n**Assigned To:** [[assigned_to_name]]\n**Reason:** [[task_unable_reason]]',
    'text',
    '{"heading":"Task Unable to Complete","recipients":"","cta_enabled":true,"cta_label":"Review Task","cta_link":"[[task_link]]"}'::jsonb,
    true
  ),
  (
    'shipment.partial_completed',
    'email',
    '[[tenant_name]]: Partial Shipment Completed — [[shipment_number]]',
    E'A shipment was partially completed. Some items were released and some were restored to storage.\n\n**Shipment:** [[shipment_number]]\n**Released Items:** [[items_count]]\n**Partial Adjustment:** [[shipment_unable_reason]]',
    'text',
    '{"heading":"Partial Shipment Completed","recipients":"","cta_enabled":true,"cta_label":"View Shipment","cta_link":"[[shipment_link]]"}'::jsonb,
    true
  ),
  (
    'shipment.partial_completed',
    'sms',
    NULL,
    '[[tenant_name]]: Shipment [[shipment_number]] partially completed. Review details: [[shipment_link]]',
    'text',
    NULL,
    true
  ),
  (
    'shipment.partial_completed',
    'in_app',
    'Partial Shipment Completed',
    'Shipment [[shipment_number]] partially completed. Review shipment notes for details.',
    'text',
    NULL,
    true
  ),
  (
    'shipment.unable_to_complete',
    'email',
    '[[tenant_name]]: Shipment Unable to Complete — [[shipment_number]]',
    E'A shipment was marked unable to complete and needs review.\n\n**Shipment:** [[shipment_number]]\n**Status:** [[shipment_status]]\n**Reason:** [[shipment_unable_reason]]',
    'text',
    '{"heading":"Shipment Unable to Complete","recipients":"","cta_enabled":true,"cta_label":"Review Shipment","cta_link":"[[shipment_link]]"}'::jsonb,
    true
  ),
  (
    'shipment.unable_to_complete',
    'sms',
    NULL,
    '[[tenant_name]]: Shipment [[shipment_number]] unable to complete. Reason: [[shipment_unable_reason]]. [[shipment_link]]',
    'text',
    NULL,
    true
  ),
  (
    'shipment.unable_to_complete',
    'in_app',
    'Shipment Unable to Complete',
    'Shipment [[shipment_number]] marked unable to complete. Reason: [[shipment_unable_reason]].',
    'text',
    NULL,
    true
  )
ON CONFLICT (trigger_event, channel) DO UPDATE
SET
  subject_template = EXCLUDED.subject_template,
  body_template = EXCLUDED.body_template,
  body_format = EXCLUDED.body_format,
  editor_json = EXCLUDED.editor_json,
  is_active = true;

-- ---------------------------------------------------------------------------
-- 2) Remove test duplicate trigger/template rows from system data
-- ---------------------------------------------------------------------------
DELETE FROM public.communication_templates ct
USING public.communication_alerts ca
WHERE ct.alert_id = ca.id
  AND (
    ca.trigger_event = 'test_shipment_status_update'
    OR lower(ca.key) LIKE '%test_shipment_status_update%'
  );

DELETE FROM public.communication_alerts
WHERE trigger_event = 'test_shipment_status_update'
   OR lower(key) LIKE '%test_shipment_status_update%';

DELETE FROM public.platform_alert_template_library
WHERE trigger_event = 'test_shipment_status_update';

DELETE FROM public.communication_trigger_catalog
WHERE key = 'test_shipment_status_update';

-- ---------------------------------------------------------------------------
-- 3) Helper: provision all active catalog triggers for one tenant
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._seed_catalog_alerts_for_tenant(
  p_tenant_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trigger record;
  v_rows integer := 0;
  v_has_per_tenant_helper boolean := false;
  v_has_all_tenants_helper boolean := false;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant id is required';
  END IF;

  v_has_per_tenant_helper := to_regprocedure('public._ensure_catalog_trigger_for_tenant(uuid,text)') IS NOT NULL;
  v_has_all_tenants_helper := to_regprocedure('public._ensure_catalog_trigger_for_all_tenants(text)') IS NOT NULL;

  IF NOT v_has_per_tenant_helper AND NOT v_has_all_tenants_helper THEN
    RAISE EXCEPTION 'No catalog provisioning helper is available';
  END IF;

  FOR v_trigger IN
    SELECT key
    FROM public.communication_trigger_catalog
    WHERE is_active = true
    ORDER BY key
  LOOP
    IF v_has_per_tenant_helper THEN
      PERFORM public._ensure_catalog_trigger_for_tenant(p_tenant_id, v_trigger.key);
    ELSE
      -- Fallback compatibility path: provisions all tenants.
      PERFORM public._ensure_catalog_trigger_for_all_tenants(v_trigger.key);
    END IF;
    v_rows := v_rows + 1;
  END LOOP;

  RETURN v_rows;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4) Trigger: auto-provision full alert catalog for new tenants
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._trg_seed_catalog_alerts_for_new_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._seed_catalog_alerts_for_tenant(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_catalog_alerts_for_new_tenant ON public.tenants;
CREATE TRIGGER trg_seed_catalog_alerts_for_new_tenant
  AFTER INSERT ON public.tenants
  FOR EACH ROW
  EXECUTE FUNCTION public._trg_seed_catalog_alerts_for_new_tenant();

-- ---------------------------------------------------------------------------
-- 5) Backfill all existing tenants (ensures 50+ alerts become available)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_tenant record;
BEGIN
  FOR v_tenant IN
    SELECT id
    FROM public.tenants
  LOOP
    PERFORM public._seed_catalog_alerts_for_tenant(v_tenant.id);
  END LOOP;
END $$;
