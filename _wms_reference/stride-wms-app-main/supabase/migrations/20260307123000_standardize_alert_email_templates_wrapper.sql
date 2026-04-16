-- ============================================================================
-- Standardize alert email templates onto the shared wrapper-based model
-- - Updates platform email template library entries for key client-facing alerts
-- - Ensures active tenant alerts/templates exist for those triggers
-- - Converts legacy standalone HTML / untouched generic tenant templates to text
--   + editor_json so send-alerts always renders the shared branded wrapper
-- ============================================================================

CREATE TEMP TABLE tmp_standard_alert_email_templates (
  trigger_event text PRIMARY KEY,
  subject_template text NOT NULL,
  body_template text NOT NULL,
  heading text NOT NULL,
  cta_label text NOT NULL,
  cta_link text NOT NULL
) ON COMMIT DROP;

INSERT INTO tmp_standard_alert_email_templates (
  trigger_event,
  subject_template,
  body_template,
  heading,
  cta_label,
  cta_link
) VALUES
  (
    'shipment.received',
    '[[tenant_name]]: Shipment Received — [[shipment_number]]',
    $$We've received your shipment and it's now in our facility.

**Shipment:** [[shipment_number]]
**Vendor:** [[shipment_vendor]]
**Status:** [[shipment_status]]
**Items:** [[items_count]]

[[items_table_html]]

[[exceptions_section_html]]$$,
    'Shipment Received',
    'View Shipment',
    '[[shipment_link]]'
  ),
  (
    'shipment_received',
    '[[tenant_name]]: Shipment Received — [[shipment_number]]',
    $$We've received your shipment and it's now in our facility.

**Shipment:** [[shipment_number]]
**Vendor:** [[shipment_vendor]]
**Status:** [[shipment_status]]
**Items:** [[items_count]]

[[items_table_html]]

[[exceptions_section_html]]$$,
    'Shipment Received',
    'View Shipment',
    '[[shipment_link]]'
  ),
  (
    'shipment_created',
    '[[tenant_name]]: Shipment Created — [[shipment_number]]',
    $$We've created a shipment record for your account and will keep you updated as it moves through our facility.

**Shipment:** [[shipment_number]]
**Vendor:** [[shipment_vendor]]
**Expected Date:** [[shipment_expected_date]]
**Items:** [[items_count]]

[[items_table_html]]$$,
    'Shipment Created',
    'View Shipment',
    '[[shipment_link]]'
  ),
  (
    'shipment.status_changed',
    '[[tenant_name]]: Shipment Status Changed — [[shipment_number]]',
    $$Your shipment status has been updated.

**Shipment:** [[shipment_number]]
**New Status:** [[shipment_status]]
**Vendor:** [[shipment_vendor]]
**Items:** [[items_count]]

[[items_table_html]]$$,
    'Shipment Status Updated',
    'View Shipment',
    '[[shipment_link]]'
  ),
  (
    'shipment_status_changed',
    '[[tenant_name]]: Shipment Status Changed — [[shipment_number]]',
    $$Your shipment status has been updated.

**Shipment:** [[shipment_number]]
**New Status:** [[shipment_status]]
**Vendor:** [[shipment_vendor]]
**Items:** [[items_count]]

[[items_table_html]]$$,
    'Shipment Status Updated',
    'View Shipment',
    '[[shipment_link]]'
  ),
  (
    'shipment.completed',
    '[[tenant_name]]: Shipment Completed — [[shipment_number]]',
    $$Your shipment has been fully processed and completed.

**Shipment:** [[shipment_number]]
**Items:** [[items_count]]

[[items_table_html]]$$,
    'Shipment Completed',
    'View Shipment',
    '[[shipment_link]]'
  ),
  (
    'shipment_completed',
    '[[tenant_name]]: Shipment Completed — [[shipment_number]]',
    $$Your shipment has been fully processed and completed.

**Shipment:** [[shipment_number]]
**Items:** [[items_count]]

[[items_table_html]]$$,
    'Shipment Completed',
    'View Shipment',
    '[[shipment_link]]'
  ),
  (
    'shipment.partial_completed',
    '[[tenant_name]]: Partial Shipment Completed — [[shipment_number]]',
    $$Your shipment was partially completed. Some items were processed and any remaining items were returned to inventory or held for follow-up.

**Shipment:** [[shipment_number]]
**Items Processed:** [[items_count]]
**Reason / Notes:** [[shipment_unable_reason]]

[[items_table_html]]$$,
    'Partial Shipment Completed',
    'View Shipment',
    '[[shipment_link]]'
  ),
  (
    'shipment.unable_to_complete',
    '[[tenant_name]]: Shipment Unable to Complete — [[shipment_number]]',
    $$We were unable to complete your shipment and our team has flagged it for follow-up.

**Shipment:** [[shipment_number]]
**Reason:** [[shipment_unable_reason]]
**Status:** [[shipment_status]]
**Items:** [[items_count]]

[[items_table_html]]$$,
    'Shipment Unable to Complete',
    'Review Shipment',
    '[[shipment_link]]'
  ),
  (
    'shipment.return_created',
    '[[tenant_name]]: Return Shipment Created — [[shipment_number]]',
    $$We've created a return shipment record and it's ready for receiving.

**Shipment:** [[shipment_number]]
**Account:** [[account_name]]
**Status:** [[shipment_status]]
**Items:** [[items_count]]

[[items_table_html]]$$,
    'Return Shipment Created',
    'View Return Shipment',
    '[[shipment_link]]'
  ),
  (
    'shipment.return_processed',
    '[[tenant_name]]: Return Processed — [[shipment_number]]',
    $$Your returned items have been received back at our warehouse and processed.

**Shipment:** [[shipment_number]]
**Account:** [[account_name]]
**Status:** [[shipment_status]]
**Items:** [[items_count]]

[[items_table_html]]$$,
    'Return Processed',
    'View Return Shipment',
    '[[shipment_link]]'
  ),
  (
    'shipment.unidentified_intake_completed',
    '[[tenant_name]]: Unidentified Intake Completed — [[shipment_number]]',
    $$An unidentified shipment intake has been completed and ARRIVAL_NO_ID flags were applied to the item(s) below.

**Shipment:** [[shipment_number]]
**Account:** [[account_name]]
**Status:** [[shipment_status]]
**Items Flagged:** [[items_count]]

[[items_table_html]]$$,
    'Unidentified Intake Completed',
    'Open Shipment',
    '[[shipment_link]]'
  ),
  (
    'shipment_scheduled',
    '[[tenant_name]]: Shipment Scheduled — [[shipment_number]]',
    $$Your shipment has been scheduled and is on our delivery calendar.

**Shipment:** [[shipment_number]]
**Scheduled Date:** [[scheduled_date]]
**Delivery Window:** [[delivery_window]]
**Items:** [[items_count]]

[[items_table_html]]$$,
    'Shipment Scheduled',
    'View Shipment',
    '[[shipment_link]]'
  ),
  (
    'shipment_delayed',
    '[[tenant_name]]: Shipment Delayed — [[shipment_number]]',
    $$Your shipment has been delayed. We apologize for the inconvenience.

**Shipment:** [[shipment_number]]
**Reason:** [[delay_reason]]
**New Expected Date:** [[shipment_expected_date]]
**Items:** [[items_count]]

[[items_table_html]]$$,
    'Shipment Delayed',
    'View Shipment',
    '[[shipment_link]]'
  ),
  (
    'shipment_out_for_delivery',
    '[[tenant_name]]: Out for Delivery — [[shipment_number]]',
    $$Your shipment is on its way.

**Shipment:** [[shipment_number]]
**Delivery Window:** [[delivery_window]]
**Items:** [[items_count]]

[[items_table_html]]$$,
    'Out for Delivery',
    'Track Shipment',
    '[[shipment_link]]'
  ),
  (
    'shipment_delivered',
    '[[tenant_name]]: Delivered — [[shipment_number]]',
    $$Your shipment has been delivered successfully.

**Shipment:** [[shipment_number]]
**Delivered At:** [[delivered_at]]
**Items:** [[items_count]]

[[items_table_html]]$$,
    'Shipment Delivered',
    'View Shipment',
    '[[shipment_link]]'
  ),
  (
    'task.assigned',
    '[[tenant_name]]: Task Assigned — [[task_title]]',
    $$A task has been assigned and is ready for action.

**Task:** [[task_title]]
**Type:** [[task_type]]
**Due Date:** [[task_due_date]]
**Assigned To:** [[assigned_to_name]]

[[items_table_html]]

[[task_services_table_html]]$$,
    'Task Assigned',
    'View Task',
    '[[task_link]]'
  ),
  (
    'task_assigned',
    '[[tenant_name]]: Task Assigned — [[task_title]]',
    $$A task has been assigned and is ready for action.

**Task:** [[task_title]]
**Type:** [[task_type]]
**Due Date:** [[task_due_date]]

[[items_table_html]]

[[task_services_table_html]]$$,
    'Task Assigned',
    'View Task',
    '[[task_link]]'
  ),
  (
    'inspection.completed',
    '[[tenant_name]]: Inspection Completed — [[inspection_number]]',
    $$Your inspection has been completed and the latest findings are available below.

**Inspection:** [[inspection_number]]
**Result:** [[inspection_result]]
**Issues Found:** [[inspection_issues_count]]

[[inspection_findings_table_html]]$$,
    'Inspection Completed',
    'View Inspection',
    '[[portal_inspection_url]]'
  ),
  (
    'repair.quote_ready',
    '[[tenant_name]]: Repair Quote Ready — [[item_code]]',
    $$We've prepared a repair quote for your review.

**Item:** [[item_code]]
**Repair Type:** [[repair_type]]
**Estimate:** [[repair_estimate_amount]]
**Account:** [[account_name]]

[[repair_actions_table_html]]$$,
    'Repair Quote Ready',
    'Review Repair Quote',
    '[[portal_repair_url]]'
  ),
  (
    'repair.quote_sent_to_client',
    '[[tenant_name]]: Repair Quote Sent — [[item_code]]',
    $$We've sent your repair quote and included the current estimate below.

**Item:** [[item_code]]
**Repair Type:** [[repair_type]]
**Estimate:** [[repair_estimate_amount]]
**Account:** [[account_name]]

[[repair_actions_table_html]]$$,
    'Repair Quote Sent',
    'Review Repair Quote',
    '[[portal_repair_url]]'
  );

DO $$
BEGIN
  IF to_regclass('public.platform_alert_template_library') IS NOT NULL THEN
    INSERT INTO public.platform_alert_template_library (
      trigger_event,
      channel,
      subject_template,
      body_template,
      body_format,
      editor_json,
      is_active,
      updated_at
    )
    SELECT
      t.trigger_event,
      'email',
      t.subject_template,
      t.body_template,
      'text',
      jsonb_build_object(
        'heading', t.heading,
        'recipients', '',
        'cta_enabled', true,
        'cta_label', t.cta_label,
        'cta_link', t.cta_link
      ),
      true,
      now()
    FROM tmp_standard_alert_email_templates t
    ON CONFLICT (trigger_event, channel) DO UPDATE
    SET
      subject_template = EXCLUDED.subject_template,
      body_template = EXCLUDED.body_template,
      body_format = EXCLUDED.body_format,
      editor_json = EXCLUDED.editor_json,
      is_active = true,
      updated_at = now();
  END IF;
END;
$$;

DO $$
DECLARE
  v_trigger record;
BEGIN
  IF to_regprocedure('public._ensure_catalog_trigger_for_all_tenants(text)') IS NOT NULL THEN
    FOR v_trigger IN
      SELECT trigger_event
      FROM tmp_standard_alert_email_templates
    LOOP
      PERFORM public._ensure_catalog_trigger_for_all_tenants(v_trigger.trigger_event);
    END LOOP;
  END IF;
END;
$$;

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
  a.tenant_id,
  a.id,
  'email',
  t.subject_template,
  t.body_template,
  'text',
  jsonb_build_object(
    'heading', t.heading,
    'recipients', '',
    'cta_enabled', true,
    'cta_label', t.cta_label,
    'cta_link', t.cta_link
  )
FROM public.communication_alerts a
JOIN tmp_standard_alert_email_templates t
  ON t.trigger_event = a.trigger_event
LEFT JOIN public.communication_templates ct
  ON ct.alert_id = a.id
 AND ct.channel = 'email'
WHERE a.is_enabled = true
  AND ct.id IS NULL;

UPDATE public.communication_templates ct
SET
  subject_template = t.subject_template,
  body_template = t.body_template,
  body_format = 'text',
  editor_json = jsonb_build_object(
    'heading', t.heading,
    'recipients', COALESCE(ct.editor_json ->> 'recipients', ''),
    'cta_enabled', true,
    'cta_label', t.cta_label,
    'cta_link', t.cta_link
  ),
  updated_at = now()
FROM public.communication_alerts a
JOIN tmp_standard_alert_email_templates t
  ON t.trigger_event = a.trigger_event
WHERE ct.alert_id = a.id
  AND ct.channel = 'email'
  AND (
    ct.body_format = 'html'
    OR ct.updated_at <= ct.created_at
    OR ct.editor_json IS NULL
    OR position('An alert of type' in coalesce(ct.body_template, '')) > 0
    OR coalesce(ct.body_template, '') = E'Dear [[account_contact_name]],\n\nThis is a notification from [[tenant_name]].'
  );
