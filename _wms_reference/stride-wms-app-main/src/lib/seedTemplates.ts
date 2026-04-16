import { supabase } from '@/integrations/supabase/client';
import { getDefaultTemplate } from '@/lib/emailTemplates/defaultAlertTemplates';

/**
 * All trigger events that should have alert templates seeded.
 * Covers both legacy dot-notation and underscore event formats.
 * Duplicate coverage (e.g. 'shipment.received' + 'shipment_created') is
 * intentional so the seed covers whichever format was used at alert-creation.
 */
const CORE_TRIGGERS = [
  // Shipment events (legacy)
  { trigger: 'shipment.received', name: 'Shipment Received', key: 'shipment_received' },
  { trigger: 'shipment.completed', name: 'Shipment Completed', key: 'shipment_completed' },
  { trigger: 'shipment.status_changed', name: 'Shipment Status Changed', key: 'shipment_status_changed' },
  { trigger: 'shipment.return_created', name: 'Return Shipment Created', key: 'shipment_return_created' },
  { trigger: 'shipment.return_processed', name: 'Return Shipment Processed', key: 'shipment_return_processed' },

  // Shipment events (additional)
  { trigger: 'shipment_created', name: 'Shipment Created', key: 'alt_shipment_created' },
  { trigger: 'shipment_scheduled', name: 'Shipment Scheduled', key: 'alt_shipment_scheduled' },
  { trigger: 'shipment_delayed', name: 'Shipment Delayed', key: 'alt_shipment_delayed' },
  { trigger: 'shipment_out_for_delivery', name: 'Shipment Out for Delivery', key: 'alt_shipment_out_for_delivery' },
  { trigger: 'shipment_delivered', name: 'Shipment Delivered', key: 'alt_shipment_delivered' },
  { trigger: 'shipment.partial_completed', name: 'Partial Shipment Completed', key: 'shipment_partial_completed' },
  { trigger: 'shipment.unable_to_complete', name: 'Shipment Unable to Complete', key: 'shipment_unable_to_complete' },
  { trigger: 'shipment.unidentified_intake_completed', name: 'Unidentified Intake Completed', key: 'shipment_unidentified_intake_completed' },

  // Items
  { trigger: 'item.received', name: 'Item Received', key: 'item_received' },
  { trigger: 'item.damaged', name: 'Item Damaged', key: 'item_damaged' },
  { trigger: 'item.location_changed', name: 'Item Location Changed', key: 'item_location_changed' },
  { trigger: 'item.flag_added', name: 'Flag Added to Item', key: 'item_flag_added' },

  // Tasks (legacy)
  { trigger: 'task.created', name: 'Task Created', key: 'task_created' },
  { trigger: 'task.assigned', name: 'Task Assigned', key: 'task_assigned' },
  { trigger: 'task.completed', name: 'Task Completed', key: 'task_completed' },
  { trigger: 'task.overdue', name: 'Task Overdue', key: 'task_overdue' },
  { trigger: 'task.unable_to_complete', name: 'Task Unable to Complete', key: 'task_unable_to_complete' },

  // Tasks (additional — seed uses key uniqueness to avoid duplicates)
  { trigger: 'task_assigned', name: 'Task Assigned', key: 'alt_task_assigned' },
  { trigger: 'task_completed', name: 'Task Completed', key: 'alt_task_completed' },
  { trigger: 'task_overdue', name: 'Task Overdue', key: 'alt_task_overdue' },
  { trigger: 'task_unable_to_complete', name: 'Task Unable to Complete', key: 'alt_task_unable_to_complete' },

  // Releases
  { trigger: 'release.created', name: 'Release Created', key: 'release_created' },
  { trigger: 'release.approved', name: 'Release Approved', key: 'release_approved' },
  { trigger: 'release.completed', name: 'Release Completed', key: 'release_completed' },
  { trigger: 'will_call_ready', name: 'Will Call Ready', key: 'will_call_ready' },
  { trigger: 'will_call_released', name: 'Will Call Released', key: 'will_call_released' },

  // Inspections
  { trigger: 'inspection_started', name: 'Inspection Started', key: 'inspection_started' },
  { trigger: 'inspection_report_available', name: 'Inspection Report Available', key: 'inspection_report_available' },
  { trigger: 'inspection_requires_attention', name: 'Inspection Requires Attention', key: 'inspection_requires_attention' },

  // Repairs
  { trigger: 'repair_started', name: 'Repair Started', key: 'repair_started' },
  { trigger: 'repair_completed', name: 'Repair Completed', key: 'repair_completed' },
  { trigger: 'repair_requires_approval', name: 'Repair Requires Approval', key: 'repair_requires_approval' },

  // Billing
  { trigger: 'billing_event.created', name: 'Billing Event Created', key: 'billing_event_created' },
  { trigger: 'invoice.created', name: 'Invoice Created', key: 'invoice_created' },
  { trigger: 'invoice.sent', name: 'Invoice Sent', key: 'invoice_sent' },
  { trigger: 'payment.received', name: 'Payment Received', key: 'payment_received' },
];

/**
 * Seeds default alert templates for a tenant.
 *
 * Creates communication_alerts + communication_templates for any missing
 * core triggers. Uses plain text defaults from defaultAlertTemplates.ts.
 * Existing alerts (matched by trigger_event) are left unchanged.
 */
export async function seedDefaultTemplates(tenantId: string): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;

  // Fetch existing alerts for this tenant
  const { data: existingAlerts } = await supabase
    .from('communication_alerts')
    .select('id, trigger_event')
    .eq('tenant_id', tenantId);

  const existingTriggers = new Set((existingAlerts || []).map(a => a.trigger_event));

  for (const triggerDef of CORE_TRIGGERS) {
    if (existingTriggers.has(triggerDef.trigger)) {
      skipped++;
      continue;
    }

    // Create the alert
    const { data: alert, error: alertError } = await supabase
      .from('communication_alerts')
      .insert({
        tenant_id: tenantId,
        name: triggerDef.name,
        key: triggerDef.key,
        description: `Default template for ${triggerDef.name}`,
        is_enabled: true,
        channels: { email: true, sms: true, in_app: false },
        trigger_event: triggerDef.trigger,
        timing_rule: 'immediate',
      })
      .select()
      .single();

    if (alertError || !alert) {
      continue;
    }

    // Get plain text defaults for this trigger
    const defaults = getDefaultTemplate(triggerDef.trigger);

    // Create email template (plain text — system wraps in branded HTML at render time)
    await supabase.from('communication_templates').insert({
      tenant_id: tenantId,
      alert_id: alert.id,
      channel: 'email',
      subject_template: defaults.subject || `[[tenant_name]]: ${triggerDef.name}`,
      body_template: defaults.body,
      body_format: 'text',
      editor_json: {
        heading: defaults.heading,
        recipients: '',
        cta_enabled: !!defaults.ctaLabel,
        cta_label: defaults.ctaLabel,
        cta_link: defaults.ctaLink,
      },
    });

    // Create SMS template
    await supabase.from('communication_templates').insert({
      tenant_id: tenantId,
      alert_id: alert.id,
      channel: 'sms',
      body_template: defaults.smsBody,
      body_format: 'text',
    });

    // Create in-app notification template (channel disabled by default, template ready)
    await supabase.from('communication_templates').insert({
      tenant_id: tenantId,
      alert_id: alert.id,
      channel: 'in_app',
      subject_template: triggerDef.name,
      body_template: defaults.inAppBody,
      body_format: 'text',
      in_app_recipients: defaults.inAppRecipients,
    });

    created++;
  }

  return { created, skipped };
}

/** @deprecated Use seedDefaultTemplates instead */
export const seedV4Templates = seedDefaultTemplates;
