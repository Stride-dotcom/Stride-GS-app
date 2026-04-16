-- =============================================================================
-- NVPC Phase R3
-- Global unidentified account + arrival-no-id automation + alert trigger seed
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Accounts: mark system accounts + ensure UNIDENTIFIED SHIPMENT exists
-- ---------------------------------------------------------------------------
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS is_system_account boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.accounts.is_system_account IS
  'Marks tenant-level system accounts (for example: UNIDENTIFIED SHIPMENT).';

CREATE UNIQUE INDEX IF NOT EXISTS ux_accounts_unidentified_system_per_tenant
  ON public.accounts (tenant_id)
  WHERE is_system_account = true
    AND upper(account_name) = 'UNIDENTIFIED SHIPMENT'
    AND deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.ensure_unidentified_account(
  p_tenant_id uuid DEFAULT public.user_tenant_id()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_account_id uuid;
  v_account_code text;
  v_attempt integer := 0;
BEGIN
  v_tenant_id := COALESCE(p_tenant_id, public.user_tenant_id());

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Could not resolve tenant_id for ensure_unidentified_account';
  END IF;

  -- Preferred lookup: explicit system account marker.
  SELECT a.id
  INTO v_account_id
  FROM public.accounts a
  WHERE a.tenant_id = v_tenant_id
    AND a.is_system_account = true
    AND upper(a.account_name) = 'UNIDENTIFIED SHIPMENT'
    AND a.deleted_at IS NULL
  ORDER BY a.created_at
  LIMIT 1;

  IF v_account_id IS NOT NULL THEN
    RETURN v_account_id;
  END IF;

  -- Backward-safe lookup: an existing row by name.
  SELECT a.id
  INTO v_account_id
  FROM public.accounts a
  WHERE a.tenant_id = v_tenant_id
    AND upper(a.account_name) = 'UNIDENTIFIED SHIPMENT'
    AND a.deleted_at IS NULL
  ORDER BY a.created_at
  LIMIT 1;

  IF v_account_id IS NOT NULL THEN
    UPDATE public.accounts
    SET is_system_account = true,
        updated_at = now()
    WHERE id = v_account_id;
    RETURN v_account_id;
  END IF;

  -- Create a deterministic-but-unique account code.
  v_account_code := 'UNID-' || upper(substr(replace(v_tenant_id::text, '-', ''), 1, 8));
  LOOP
    EXIT WHEN NOT EXISTS (
      SELECT 1
      FROM public.accounts a
      WHERE a.account_code = v_account_code
    );

    v_attempt := v_attempt + 1;
    v_account_code := 'UNID-' || upper(substr(replace(v_tenant_id::text, '-', ''), 1, 8))
      || '-' || lpad(v_attempt::text, 2, '0');

    IF v_attempt > 50 THEN
      RAISE EXCEPTION 'Unable to generate unique account_code for UNIDENTIFIED SHIPMENT';
    END IF;
  END LOOP;

  INSERT INTO public.accounts (
    tenant_id,
    account_code,
    account_name,
    status,
    is_active,
    is_system_account,
    notes
  )
  VALUES (
    v_tenant_id,
    v_account_code,
    'UNIDENTIFIED SHIPMENT',
    'active',
    true,
    true,
    'System fallback account for unidentified inbound shipments.'
  )
  RETURNING id INTO v_account_id;

  RETURN v_account_id;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_unidentified_account(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_unidentified_account(uuid) TO authenticated;

DO $$
DECLARE
  v_tenant record;
BEGIN
  FOR v_tenant IN (SELECT id FROM public.tenants) LOOP
    PERFORM public.ensure_unidentified_account(v_tenant.id);
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- 2) Tenant preference toggle: auto apply ARRIVAL_NO_ID
-- ---------------------------------------------------------------------------
ALTER TABLE public.tenant_preferences
  ADD COLUMN IF NOT EXISTS auto_apply_arrival_no_id_flag boolean NOT NULL DEFAULT true;

UPDATE public.tenant_preferences
SET auto_apply_arrival_no_id_flag = true
WHERE auto_apply_arrival_no_id_flag IS NULL;

COMMENT ON COLUMN public.tenant_preferences.auto_apply_arrival_no_id_flag IS
  'When true, Stage 2 receiving auto-applies ARRIVAL_NO_ID to shipment_items.flags for unidentified shipments.';

-- ---------------------------------------------------------------------------
-- 3) Seed ARRIVAL_NO_ID in service_events (per tenant)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_tenant record;
BEGIN
  FOR v_tenant IN (SELECT id FROM public.tenants) LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM public.service_events se
      WHERE se.tenant_id = v_tenant.id
        AND se.service_code = 'ARRIVAL_NO_ID'
        AND se.class_code IS NULL
    ) THEN
      INSERT INTO public.service_events (
        tenant_id,
        class_code,
        service_code,
        service_name,
        billing_unit,
        service_time_minutes,
        rate,
        taxable,
        uses_class_pricing,
        is_active,
        notes,
        add_flag,
        add_to_service_event_scan,
        alert_rule,
        billing_trigger
      )
      VALUES (
        v_tenant.id,
        NULL,
        'ARRIVAL_NO_ID',
        'Arrival - No ID',
        'Item',
        0,
        0,
        true,
        false,
        true,
        'Applied when unidentified intake is completed. Configure pricing as needed.',
        true,
        false,
        'email_office',
        'Flag'
      );
    END IF;
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- 4) Alert trigger catalog + seeded tenant alert/templates
-- ---------------------------------------------------------------------------
INSERT INTO public.communication_trigger_catalog (
  key,
  display_name,
  description,
  module_group,
  audience,
  default_channels,
  severity,
  is_active
)
VALUES (
  'shipment.unidentified_intake_completed',
  'Unidentified Intake Completed',
  'Stage 2 receiving completed for an unidentified shipment and ARRIVAL_NO_ID flags were applied.',
  'shipments',
  'internal',
  ARRAY['email','sms','in_app'],
  'warn',
  true
)
ON CONFLICT (key) DO UPDATE
SET display_name = EXCLUDED.display_name,
    description = EXCLUDED.description,
    module_group = EXCLUDED.module_group,
    audience = EXCLUDED.audience,
    default_channels = EXCLUDED.default_channels,
    severity = EXCLUDED.severity,
    is_active = true;

INSERT INTO public.communication_alerts (
  tenant_id,
  name,
  key,
  description,
  is_enabled,
  channels,
  trigger_event,
  timing_rule,
  created_at,
  updated_at
)
SELECT
  t.id,
  'Unidentified Intake Completed',
  'SHIPMENT_UNIDENTIFIED_INTAKE_COMPLETED',
  'Triggered when Stage 2 receiving is completed for an unidentified shipment.',
  true,
  '{"email": true, "sms": true, "in_app": true}'::jsonb,
  'shipment.unidentified_intake_completed',
  'immediate',
  now(),
  now()
FROM public.tenants t
ON CONFLICT (tenant_id, key) DO UPDATE
SET trigger_event = EXCLUDED.trigger_event,
    description = EXCLUDED.description,
    updated_at = now();

INSERT INTO public.communication_templates (
  tenant_id,
  alert_id,
  channel,
  subject_template,
  body_template,
  body_format,
  editor_json
)
SELECT
  ca.tenant_id,
  ca.id,
  'email',
  '[[tenant_name]]: Unidentified Intake Completed — [[shipment_number]]',
  E'An unidentified shipment intake has been completed and ARRIVAL_NO_ID flags were applied.\n\n**Shipment:** [[shipment_number]]\n**Account:** [[account_name]]\n**Status:** [[shipment_status]]\n**Items Flagged:** [[items_count]]\n\n[[items_table_html]]',
  'text',
  '{
    "heading": "Unidentified Intake Completed",
    "recipients": "",
    "cta_enabled": true,
    "cta_label": "Open Shipment",
    "cta_link": "[[shipment_link]]"
  }'::jsonb
FROM public.communication_alerts ca
WHERE ca.key = 'SHIPMENT_UNIDENTIFIED_INTAKE_COMPLETED'
  AND NOT EXISTS (
    SELECT 1
    FROM public.communication_templates ct
    WHERE ct.alert_id = ca.id
      AND ct.channel = 'email'
  );

INSERT INTO public.communication_templates (
  tenant_id,
  alert_id,
  channel,
  subject_template,
  body_template,
  body_format
)
SELECT
  ca.tenant_id,
  ca.id,
  'sms',
  NULL,
  '[[tenant_name]]: Unidentified intake completed for [[shipment_number]]. [[items_count]] item(s) flagged ARRIVAL_NO_ID. [[shipment_link]]',
  'text'
FROM public.communication_alerts ca
WHERE ca.key = 'SHIPMENT_UNIDENTIFIED_INTAKE_COMPLETED'
  AND NOT EXISTS (
    SELECT 1
    FROM public.communication_templates ct
    WHERE ct.alert_id = ca.id
      AND ct.channel = 'sms'
  );

INSERT INTO public.communication_templates (
  tenant_id,
  alert_id,
  channel,
  subject_template,
  body_template,
  body_format,
  in_app_recipients
)
SELECT
  ca.tenant_id,
  ca.id,
  'in_app',
  'Unidentified Intake Completed — [[shipment_number]]',
  'Shipment [[shipment_number]] completed under UNIDENTIFIED SHIPMENT. [[items_count]] item(s) auto-flagged ARRIVAL_NO_ID.',
  'text',
  '[[manager_role]], [[warehouse_role]]'
FROM public.communication_alerts ca
WHERE ca.key = 'SHIPMENT_UNIDENTIFIED_INTAKE_COMPLETED'
  AND NOT EXISTS (
    SELECT 1
    FROM public.communication_templates ct
    WHERE ct.alert_id = ca.id
      AND ct.channel = 'in_app'
  );
