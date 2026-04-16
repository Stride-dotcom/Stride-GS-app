-- =============================================================================
-- communication_trigger_catalog — Global trigger definition table
--
-- Defines WHAT each trigger is: display name, module group, audience,
-- default channels, severity.
--
-- NOT tenant-scoped — provides a shared catalog across all tenants.
-- Tenant-specific enablement remains in communication_alerts.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.communication_trigger_catalog (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key text NOT NULL UNIQUE,
  display_name text NOT NULL,
  description text,
  module_group text NOT NULL
    CHECK (module_group IN ('shipments','tasks','claims','quotes','items','onboarding','stocktake','billing','system')),
  audience text NOT NULL DEFAULT 'internal'
    CHECK (audience IN ('internal','client','both')),
  default_channels text[] NOT NULL DEFAULT ARRAY['in_app']::text[],
  severity text NOT NULL DEFAULT 'info'
    CHECK (severity IN ('info','warn','critical')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- No RLS needed for a global catalog (not tenant-scoped).
-- Authenticated users can read; only service-role or RPCs can write.
ALTER TABLE public.communication_trigger_catalog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read trigger catalog"
  ON public.communication_trigger_catalog
  FOR SELECT TO authenticated
  USING (true);

-- =============================================================================
-- Seed the catalog with all known trigger keys.
-- ON CONFLICT DO NOTHING ensures idempotency if run multiple times.
-- =============================================================================

INSERT INTO public.communication_trigger_catalog
  (key, display_name, description, module_group, audience, default_channels, severity)
VALUES
  -- ──────────── SHIPMENTS ────────────
  ('shipment.received',               'Shipment Received',              'A shipment has been received at the warehouse.',                        'shipments', 'both',     ARRAY['email','in_app'], 'info'),
  ('shipment.completed',              'Shipment Completed',             'A shipment has been fully processed.',                                  'shipments', 'both',     ARRAY['email','in_app'], 'info'),
  ('shipment.status_changed',         'Shipment Status Changed',        'A shipment status has been updated.',                                   'shipments', 'both',     ARRAY['email','in_app'], 'info'),
  ('shipment.return_created',         'Return Shipment Created',        'A return shipment has been created.',                                   'shipments', 'internal', ARRAY['email','in_app'], 'info'),
  ('shipment_created',                'Shipment Created',               'A new shipment has been created.',                                      'shipments', 'both',     ARRAY['email','in_app'], 'info'),
  ('shipment_scheduled',              'Shipment Scheduled',             'A shipment has been scheduled.',                                        'shipments', 'both',     ARRAY['email','in_app'], 'info'),
  ('shipment_delayed',                'Shipment Delayed',               'A shipment has been delayed.',                                          'shipments', 'both',     ARRAY['email','in_app'], 'warn'),
  ('shipment_out_for_delivery',       'Shipment Out for Delivery',      'A shipment is out for delivery.',                                       'shipments', 'client',   ARRAY['email','in_app'], 'info'),
  ('shipment_delivered',              'Shipment Delivered',             'A shipment has been delivered.',                                        'shipments', 'client',   ARRAY['email','in_app'], 'info'),

  -- ──────────── RELEASES ────────────
  ('release.created',                 'Release Created',                'A release order has been created.',                                     'shipments', 'both',     ARRAY['email','in_app'], 'info'),
  ('release.approved',                'Release Approved',               'A release order has been approved.',                                    'shipments', 'both',     ARRAY['email','in_app'], 'info'),
  ('release.completed',               'Release Completed',              'A release order has been completed.',                                   'shipments', 'both',     ARRAY['email','in_app'], 'info'),
  ('will_call_ready',                 'Will Call Ready',                'A will-call order is ready for pickup.',                                'shipments', 'client',   ARRAY['email','in_app'], 'info'),
  ('will_call_released',              'Will Call Released',             'A will-call order has been released.',                                  'shipments', 'client',   ARRAY['email','in_app'], 'info'),

  -- ──────────── TASKS ────────────
  ('task.created',                    'Task Created',                   'A new task has been created.',                                          'tasks', 'internal', ARRAY['email','in_app'], 'info'),
  ('task.assigned',                   'Task Assigned',                  'A task has been assigned to a user.',                                   'tasks', 'internal', ARRAY['email','in_app'], 'info'),
  ('task.completed',                  'Task Completed',                 'A task has been completed.',                                            'tasks', 'internal', ARRAY['email','in_app'], 'info'),
  ('task.overdue',                    'Task Overdue',                   'A task is past its due date.',                                          'tasks', 'internal', ARRAY['email','in_app'], 'warn'),
  ('task_assigned',                   'Task Assigned (legacy)',         'Legacy trigger: task assigned.',                                        'tasks', 'internal', ARRAY['email','in_app'], 'info'),
  ('task_completed',                  'Task Completed (legacy)',        'Legacy trigger: task completed.',                                       'tasks', 'internal', ARRAY['email','in_app'], 'info'),
  ('task_overdue',                    'Task Overdue (legacy)',          'Legacy trigger: task overdue.',                                         'tasks', 'internal', ARRAY['email','in_app'], 'warn'),

  -- ──────────── INSPECTIONS (under tasks) ────────────
  ('inspection.completed',            'Inspection Completed',           'An inspection task has been completed.',                                'tasks', 'both',     ARRAY['email','in_app'], 'info'),
  ('inspection_started',              'Inspection Started',             'An inspection has started.',                                            'tasks', 'internal', ARRAY['email','in_app'], 'info'),
  ('inspection_report_available',     'Inspection Report Available',    'An inspection report is ready for review.',                             'tasks', 'both',     ARRAY['email','in_app'], 'info'),
  ('inspection_requires_attention',   'Inspection Requires Attention',  'An inspection has issues that need attention.',                         'tasks', 'internal', ARRAY['email','in_app'], 'warn'),

  -- ──────────── CLAIMS ────────────
  ('claim.filed',                     'Claim Filed',                    'A new claim has been filed.',                                           'claims', 'internal', ARRAY['email','in_app'], 'info'),
  ('claim.status_changed',            'Claim Status Changed',           'A claim status has been updated.',                                      'claims', 'both',     ARRAY['email','in_app'], 'info'),
  ('claim.approved',                  'Claim Approved',                 'A claim has been approved.',                                            'claims', 'both',     ARRAY['email','in_app'], 'info'),
  ('claim.denied',                    'Claim Denied',                   'A claim has been denied.',                                              'claims', 'both',     ARRAY['email','in_app'], 'warn'),
  ('claim.determination_sent',        'Claim Determination Sent',       'A claim determination has been sent to the client.',                    'claims', 'client',   ARRAY['email','in_app'], 'info'),
  ('claim.client_accepted',           'Claim Client Accepted',          'The client accepted a claim determination.',                            'claims', 'internal', ARRAY['email','in_app'], 'info'),
  ('claim.client_declined',           'Claim Client Declined',          'The client declined a claim determination.',                            'claims', 'internal', ARRAY['email','in_app'], 'warn'),
  ('claim.client_countered',          'Claim Client Countered',         'The client submitted a counteroffer on a claim.',                       'claims', 'internal', ARRAY['email','in_app'], 'warn'),
  ('claim.attachment_added',          'Claim Attachment Added',         'An attachment was added to a claim.',                                   'claims', 'internal', ARRAY['email','in_app'], 'info'),
  ('claim.note_added',                'Claim Note Added',               'A note was added to a claim.',                                         'claims', 'internal', ARRAY['email','in_app'], 'info'),
  ('claim.requires_approval',         'Claim Requires Approval',        'A claim requires management approval.',                                'claims', 'internal', ARRAY['email','in_app'], 'warn'),
  ('client.claim_filed',              'Client Filed Claim',             'A client has filed a claim through the portal.',                        'claims', 'internal', ARRAY['email','in_app'], 'info'),

  -- ──────────── QUOTES / REPAIRS ────────────
  ('repair.quote_ready',              'Repair Quote Ready',             'A repair quote is ready for review.',                                   'quotes', 'both',     ARRAY['email','in_app'], 'info'),
  ('repair.quote_sent_to_client',     'Repair Quote Sent to Client',    'A repair quote has been sent to the client.',                           'quotes', 'client',   ARRAY['email','in_app'], 'info'),
  ('repair.unable_to_complete',       'Repair Unable to Complete',      'A repair could not be completed.',                                      'quotes', 'both',     ARRAY['email','in_app'], 'warn'),
  ('repair_started',                  'Repair Started',                 'A repair has been started.',                                            'quotes', 'internal', ARRAY['email','in_app'], 'info'),
  ('repair_completed',                'Repair Completed',               'A repair has been completed.',                                         'quotes', 'both',     ARRAY['email','in_app'], 'info'),
  ('repair_requires_approval',        'Repair Requires Approval',       'A repair requires management approval.',                               'quotes', 'internal', ARRAY['email','in_app'], 'warn'),

  -- ──────────── ITEMS ────────────
  ('item.received',                   'Item Received',                  'An item has been received at the warehouse.',                           'items', 'both',     ARRAY['email','in_app'], 'info'),
  ('item.damaged',                    'Item Damaged',                   'An item has been marked as damaged.',                                   'items', 'both',     ARRAY['email','in_app'], 'warn'),
  ('item.location_changed',           'Item Location Changed',          'An item has been moved to a new location.',                             'items', 'internal', ARRAY['email','in_app'], 'info'),
  ('item.flag_added',                 'Flag Added to Item',             'A flag has been applied to an item (generic).',                         'items', 'internal', ARRAY['in_app'],         'info'),

  -- ──────────── BILLING ────────────
  ('billing_event.created',           'Billing Event Created',          'A new billing event has been created.',                                 'billing', 'internal', ARRAY['in_app'],         'info'),
  ('invoice.created',                 'Invoice Created',                'A new invoice has been created.',                                       'billing', 'internal', ARRAY['email','in_app'], 'info'),
  ('invoice.sent',                    'Invoice Sent',                   'An invoice has been sent to the client.',                               'billing', 'client',   ARRAY['email','in_app'], 'info'),
  ('payment.received',                'Payment Received',               'A payment has been received.',                                         'billing', 'both',     ARRAY['email','in_app'], 'info'),

  -- ──────────── ONBOARDING / CLIENT PORTAL ────────────
  ('client.inbound_shipment_created', 'Client Created Inbound Shipment','A client created an inbound shipment via the portal.',                  'onboarding', 'internal', ARRAY['email','in_app'], 'info'),
  ('client.outbound_shipment_created','Client Created Outbound Shipment','A client created an outbound shipment via the portal.',                'onboarding', 'internal', ARRAY['email','in_app'], 'info'),
  ('client.task_created',             'Client Created Task',            'A client created a task via the portal.',                               'onboarding', 'internal', ARRAY['email','in_app'], 'info'),
  ('client.item_reassigned',          'Client Reassigned Items',        'A client reassigned items via the portal.',                             'onboarding', 'internal', ARRAY['email','in_app'], 'info'),

  -- ──────────── RECEIVING (sub of shipments, but tracked separately) ────────────
  ('receiving.discrepancy_created',   'Receiving Discrepancy Created',  'A discrepancy was found during receiving.',                             'shipments', 'internal', ARRAY['email','in_app'], 'warn'),
  ('receiving.exception_noted',       'Receiving Exception Noted',      'An exception was noted during receiving.',                              'shipments', 'internal', ARRAY['email','in_app'], 'warn'),

  -- ──────────── SYSTEM ────────────
  ('custom',                          'Custom Event',                   'A custom or ad-hoc alert event.',                                      'system', 'internal', ARRAY['email','in_app'], 'info')

ON CONFLICT (key) DO NOTHING;


-- =============================================================================
-- Update RPC: rpc_ensure_flag_alert_trigger
-- Now also upserts a catalog row for the per-flag trigger key.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.rpc_ensure_flag_alert_trigger(
  p_charge_type_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id    uuid;
  v_charge_code  text;
  v_charge_name  text;
  v_alert_rule   text;
  v_trigger_key  text;
  v_trigger_evt  text;
  v_enabled      boolean;
  v_alert_id     uuid;
  v_was_created  boolean := false;
  v_alert_name   text;
  v_display_name text;
BEGIN
  -- 1) Derive tenant from authenticated session (NEVER from caller)
  v_tenant_id := public.user_tenant_id();

  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error_code', 'AUTH_REQUIRED',
      'message', 'Could not resolve tenant for current user.'
    );
  END IF;

  -- 2) Load the charge_type row and verify it belongs to this tenant
  SELECT ct.charge_code, ct.charge_name, ct.alert_rule
  INTO   v_charge_code, v_charge_name, v_alert_rule
  FROM   public.charge_types ct
  WHERE  ct.id = p_charge_type_id
    AND  ct.tenant_id = v_tenant_id
    AND  ct.add_flag = true;

  IF v_charge_code IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error_code', 'TENANT_MISMATCH',
      'message', 'Charge type not found or does not belong to current tenant.'
    );
  END IF;

  -- 3) Derive deterministic key + event (matches existing frontend convention)
  v_trigger_key  := 'flag_alert_' || v_charge_code;
  v_trigger_evt  := 'item.flag_added.' || v_charge_code;
  v_enabled      := (v_alert_rule IS NOT NULL AND v_alert_rule <> 'none');
  v_alert_name   := 'Flag Alert: ' || v_charge_name;
  v_display_name := 'Flag added: ' || v_charge_name;

  -- 4) Ensure catalog row exists (global, not tenant-scoped)
  INSERT INTO public.communication_trigger_catalog
    (key, display_name, description, module_group, audience, default_channels, severity)
  VALUES (
    v_trigger_evt,
    v_display_name,
    'Auto-created trigger for the "' || v_charge_name || '" flag.',
    'items',
    'internal',
    ARRAY['email','in_app'],
    'info'
  )
  ON CONFLICT (key) DO NOTHING;

  -- 5) Upsert tenant trigger (communication_alerts): INSERT if missing, UPDATE is_enabled on conflict
  INSERT INTO public.communication_alerts (
    tenant_id, name, key, description, is_enabled, channels,
    trigger_event, timing_rule, created_at, updated_at
  )
  VALUES (
    v_tenant_id,
    v_alert_name,
    v_trigger_key,
    'Automatically created trigger for the "' || v_charge_name || '" flag.',
    v_enabled,
    '{"email": true, "sms": false, "in_app": true}'::jsonb,
    v_trigger_evt,
    'immediate',
    now(),
    now()
  )
  ON CONFLICT (tenant_id, key) DO UPDATE
    SET is_enabled = EXCLUDED.is_enabled,
        updated_at = now()
  RETURNING id, (xmax = 0) INTO v_alert_id, v_was_created;

  -- 6) If freshly created, add default templates (email + sms + in_app)
  IF v_was_created AND v_enabled THEN
    INSERT INTO public.communication_templates
      (tenant_id, alert_id, channel, subject_template, body_template, body_format, in_app_recipients)
    VALUES
      (
        v_tenant_id, v_alert_id, 'email',
        '[[tenant_name]]: Flag "' || v_charge_name || '" Added — [[item_code]]',
        E'A flag has been added to an item.\n\n**Item:** [[item_code]]\n**Description:** [[item_description]]',
        'text', NULL
      ),
      (
        v_tenant_id, v_alert_id, 'sms',
        NULL,
        '[[tenant_name]]: Flag "' || v_charge_name || '" added to item [[item_code]]. View: [[item_photos_link]]',
        'text', NULL
      ),
      (
        v_tenant_id, v_alert_id, 'in_app',
        'Flag "' || v_charge_name || '" added',
        'Flag "' || v_charge_name || '" added to item [[item_code]].',
        'text', '[[manager_role]], [[warehouse_role]]'
      )
    ON CONFLICT DO NOTHING;
  END IF;

  -- 7) Return result
  RETURN jsonb_build_object(
    'ok', true,
    'alert_id', v_alert_id,
    'key', v_trigger_key,
    'trigger_event', v_trigger_evt,
    'is_enabled', v_enabled,
    'created', v_was_created
  );
END;
$$;

-- Grant execute to authenticated users (RLS + SECURITY DEFINER protects data)
GRANT EXECUTE ON FUNCTION public.rpc_ensure_flag_alert_trigger(uuid) TO authenticated;
