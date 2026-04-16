-- ============================================================================
-- Migration: Add In-App Notification Channel to Communications System
-- ============================================================================
-- Adds 'in_app' as a third channel alongside 'email' and 'sms' for the
-- communication alerts system. Creates in-app templates for all existing
-- alerts with in_app channel disabled by default.
-- ============================================================================

-- 1. Drop and recreate channel check constraint to include 'in_app'
ALTER TABLE public.communication_templates
  DROP CONSTRAINT IF EXISTS communication_templates_channel_check;

ALTER TABLE public.communication_templates
  ADD CONSTRAINT communication_templates_channel_check
  CHECK (channel IN ('email', 'sms', 'in_app'));

-- 2. Drop the unique constraint on (alert_id, channel) and recreate it
-- This allows email + sms + in_app per alert
ALTER TABLE public.communication_templates
  DROP CONSTRAINT IF EXISTS communication_templates_alert_id_channel_key;

ALTER TABLE public.communication_templates
  ADD CONSTRAINT communication_templates_alert_id_channel_key
  UNIQUE (alert_id, channel);

-- 3. Add in_app_recipients column to communication_templates for role-based targeting
-- Stores comma-separated role tokens like '[[manager_role]], [[client_user_role]]'
ALTER TABLE public.communication_templates
  ADD COLUMN IF NOT EXISTS in_app_recipients TEXT;

-- 4. Create in-app templates for all existing alerts
-- in_app channel is NOT enabled by default — admin must opt in
INSERT INTO public.communication_templates (
  id, tenant_id, alert_id, channel, subject_template, body_template, body_format, in_app_recipients, created_at, updated_at
)
SELECT
  gen_random_uuid(),
  ca.tenant_id,
  ca.id,
  'in_app',
  ca.name,  -- Use alert name as notification title (subject_template)
  COALESCE(
    -- Derive a short body from the SMS template if available
    (SELECT ct.body_template FROM public.communication_templates ct
     WHERE ct.alert_id = ca.id AND ct.channel = 'sms' LIMIT 1),
    -- Fallback: use alert name + description
    ca.name || ': ' || COALESCE(ca.description, 'You have a new notification.')
  ),
  'text',
  -- Default recipients based on trigger event category
  CASE
    -- Shipment events -> manager + client
    WHEN ca.trigger_event LIKE 'shipment%' THEN '[[manager_role]], [[client_user_role]]'
    -- Item events -> manager + warehouse
    WHEN ca.trigger_event LIKE 'item%' THEN '[[manager_role]], [[warehouse_role]]'
    -- Task events -> manager + warehouse
    WHEN ca.trigger_event LIKE 'task%' THEN '[[manager_role]], [[warehouse_role]]'
    -- Inspection events -> manager + client
    WHEN ca.trigger_event LIKE 'inspection%' THEN '[[manager_role]], [[client_user_role]]'
    -- Repair events -> manager + client
    WHEN ca.trigger_event LIKE 'repair%' THEN '[[manager_role]], [[client_user_role]]'
    -- Release/will-call events -> warehouse + client
    WHEN ca.trigger_event LIKE 'release%' OR ca.trigger_event LIKE 'will_call%' THEN '[[warehouse_role]], [[client_user_role]]'
    -- Billing/invoice events -> admin + manager
    WHEN ca.trigger_event LIKE 'billing%' OR ca.trigger_event LIKE 'invoice%' OR ca.trigger_event LIKE 'payment%' THEN '[[admin_role]], [[manager_role]]'
    -- Claim events -> admin + manager + client
    WHEN ca.trigger_event LIKE 'claim%' THEN '[[admin_role]], [[manager_role]], [[client_user_role]]'
    -- Default -> manager
    ELSE '[[manager_role]]'
  END,
  NOW(),
  NOW()
FROM public.communication_alerts ca
WHERE NOT EXISTS (
  SELECT 1 FROM public.communication_templates ct
  WHERE ct.alert_id = ca.id AND ct.channel = 'in_app'
);

-- Note: We do NOT update existing alerts' channels JSONB to include in_app: true.
-- The admin must explicitly enable the in_app channel per alert.
-- The templates are pre-created so they're ready when the admin enables the channel.
