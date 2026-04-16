-- =============================================================================
-- Add return shipment communication triggers + tenant defaults
-- - shipment.return_created (internal)
-- - shipment.return_processed (client-facing)
-- =============================================================================

-- Ensure trigger catalog rows exist and remain active.
INSERT INTO public.communication_trigger_catalog
  (key, display_name, description, module_group, audience, default_channels, severity, is_active)
VALUES
  (
    'shipment.return_created',
    'Return Shipment Created',
    'A return shipment has been created.',
    'shipments',
    'internal',
    ARRAY['email','in_app'],
    'info',
    true
  ),
  (
    'shipment.return_processed',
    'Return Shipment Processed',
    'Returned items have been received back at the warehouse and processed.',
    'shipments',
    'client',
    ARRAY['email','in_app'],
    'info',
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

DO $$
DECLARE
  v_tenant RECORD;
BEGIN
  FOR v_tenant IN (SELECT id FROM public.tenants) LOOP
    -- 1) Return created alert
    INSERT INTO public.communication_alerts
      (tenant_id, name, key, description, trigger_event, channels, is_enabled, timing_rule)
    VALUES (
      v_tenant.id,
      'Return Shipment Created',
      'SHIPMENT_RETURN_CREATED',
      'Sent when a return shipment is created.',
      'shipment.return_created',
      '{"email": true, "sms": false, "in_app": true}'::jsonb,
      true,
      'immediate'
    )
    ON CONFLICT (tenant_id, key) DO UPDATE SET
      trigger_event = EXCLUDED.trigger_event,
      description = EXCLUDED.description;

    -- 2) Return processed alert
    INSERT INTO public.communication_alerts
      (tenant_id, name, key, description, trigger_event, channels, is_enabled, timing_rule)
    VALUES (
      v_tenant.id,
      'Return Shipment Processed',
      'SHIPMENT_RETURN_PROCESSED',
      'Sent when returned items are processed at the warehouse.',
      'shipment.return_processed',
      '{"email": true, "sms": false, "in_app": true}'::jsonb,
      true,
      'immediate'
    )
    ON CONFLICT (tenant_id, key) DO UPDATE SET
      trigger_event = EXCLUDED.trigger_event,
      description = EXCLUDED.description;
  END LOOP;
END;
$$;

-- Seed default templates for the two return triggers.
INSERT INTO public.communication_templates
  (tenant_id, alert_id, channel, subject_template, body_template, body_format, in_app_recipients)
SELECT
  ca.tenant_id,
  ca.id,
  'email',
  '[[tenant_name]]: Return Shipment Created — [[shipment_number]]',
  'A return shipment has been created and is ready for intake processing.

**Shipment:** [[shipment_number]]
**Account:** [[account_name]]
**Status:** [[shipment_status]]

<a href="[[shipment_link]]" style="display:inline-block;padding:10px 14px;border-radius:8px;background:#111827;color:#ffffff;text-decoration:none;font-weight:600;">View Shipment in Portal</a>',
  'text',
  NULL
FROM public.communication_alerts ca
WHERE ca.key = 'SHIPMENT_RETURN_CREATED'
ON CONFLICT (alert_id, channel) DO NOTHING;

INSERT INTO public.communication_templates
  (tenant_id, alert_id, channel, subject_template, body_template, body_format, in_app_recipients)
SELECT
  ca.tenant_id,
  ca.id,
  'sms',
  NULL,
  '[[tenant_name]]: Return shipment [[shipment_number]] created. View: [[shipment_link]]',
  'text',
  NULL
FROM public.communication_alerts ca
WHERE ca.key = 'SHIPMENT_RETURN_CREATED'
ON CONFLICT (alert_id, channel) DO NOTHING;

INSERT INTO public.communication_templates
  (tenant_id, alert_id, channel, subject_template, body_template, body_format, in_app_recipients)
SELECT
  ca.tenant_id,
  ca.id,
  'in_app',
  'Return Shipment Created',
  'Return shipment [[shipment_number]] created.',
  'text',
  '[[manager_role]], [[warehouse_role]]'
FROM public.communication_alerts ca
WHERE ca.key = 'SHIPMENT_RETURN_CREATED'
ON CONFLICT (alert_id, channel) DO NOTHING;

INSERT INTO public.communication_templates
  (tenant_id, alert_id, channel, subject_template, body_template, body_format, in_app_recipients)
SELECT
  ca.tenant_id,
  ca.id,
  'email',
  '[[tenant_name]]: Return Processed — [[shipment_number]]',
  'Your returned items have been received back at our warehouse and processed.

**Shipment:** [[shipment_number]]
**Account:** [[account_name]]
**Status:** [[shipment_status]]
**Items:** [[items_count]]

[[items_table_html]]

<a href="[[shipment_link]]" style="display:inline-block;padding:10px 14px;border-radius:8px;background:#111827;color:#ffffff;text-decoration:none;font-weight:600;">View Shipment in Portal</a>',
  'text',
  NULL
FROM public.communication_alerts ca
WHERE ca.key = 'SHIPMENT_RETURN_PROCESSED'
ON CONFLICT (alert_id, channel) DO NOTHING;

INSERT INTO public.communication_templates
  (tenant_id, alert_id, channel, subject_template, body_template, body_format, in_app_recipients)
SELECT
  ca.tenant_id,
  ca.id,
  'sms',
  NULL,
  '[[tenant_name]]: Return shipment [[shipment_number]] processed. View: [[shipment_link]]',
  'text',
  NULL
FROM public.communication_alerts ca
WHERE ca.key = 'SHIPMENT_RETURN_PROCESSED'
ON CONFLICT (alert_id, channel) DO NOTHING;

INSERT INTO public.communication_templates
  (tenant_id, alert_id, channel, subject_template, body_template, body_format, in_app_recipients)
SELECT
  ca.tenant_id,
  ca.id,
  'in_app',
  'Return Processed',
  'Return shipment [[shipment_number]] processed.',
  'text',
  '[[manager_role]], [[client_user_role]]'
FROM public.communication_alerts ca
WHERE ca.key = 'SHIPMENT_RETURN_PROCESSED'
ON CONFLICT (alert_id, channel) DO NOTHING;
