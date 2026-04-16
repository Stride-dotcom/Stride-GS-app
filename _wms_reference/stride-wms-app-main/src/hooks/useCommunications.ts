import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

export interface CommunicationAlert {
  id: string;
  tenant_id: string;
  name: string;
  key: string;
  description: string | null;
  is_enabled: boolean;
  channels: { email: boolean; sms: boolean; in_app?: boolean };
  trigger_event: string;
  timing_rule: string;
  created_at: string;
  updated_at: string;
}

export interface TriggerCatalogEntry {
  id: string;
  key: string;
  display_name: string;
  description: string | null;
  module_group: string;
  audience: 'internal' | 'client' | 'both';
  default_channels: string[];
  severity: 'info' | 'warn' | 'critical';
  is_active: boolean;
  is_legacy?: boolean;
  legacy_replacement_key?: string | null;
}

export interface CommunicationTemplate {
  id: string;
  tenant_id: string;
  alert_id: string;
  channel: 'email' | 'sms' | 'in_app';
  subject_template: string | null;
  body_template: string;
  body_format: 'html' | 'text';
  from_name: string | null;
  from_email: string | null;
  sms_sender_id: string | null;
  in_app_recipients: string | null;
  editor_json: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface CommunicationTemplateVersion {
  id: string;
  template_id: string;
  version_number: number;
  subject_template: string | null;
  body_template: string;
  created_at: string;
  created_by: string | null;
}

export interface CommunicationDesignElement {
  id: string;
  tenant_id: string | null;
  name: string;
  category: 'icon' | 'header_block' | 'button' | 'divider' | 'callout';
  html_snippet: string;
  is_system: boolean;
  created_at: string;
}

export interface CommunicationBrandSettings {
  id: string;
  tenant_id: string;
  brand_logo_url: string | null;
  brand_primary_color: string;
  brand_support_email: string | null;
  portal_base_url: string | null;
  from_name: string | null;
  from_email: string | null;
  sms_sender_id: string | null;
  created_at: string;
  updated_at: string;
}

/** Company info from tenant_company_settings for email/SMS token resolution */
export interface TenantCompanyInfo {
  companyName?: string;
  logoUrl?: string;
  companyEmail?: string;
  supportEmail?: string;
  companyAddress?: string;
  portalBaseUrl?: string;
  companyPhone?: string;
}

export const TRIGGER_EVENTS = [
  // Legacy dot-notation events
  { value: 'shipment.received', label: 'Shipment Received' },
  { value: 'shipment.status_changed', label: 'Shipment Status Changed' },
  { value: 'shipment.completed', label: 'Shipment Completed' },
  { value: 'shipment.return_created', label: 'Return Shipment Created' },
  { value: 'shipment.return_processed', label: 'Return Shipment Processed' },
  { value: 'item.received', label: 'Item Received' },
  { value: 'item.damaged', label: 'Item Damaged' },
  { value: 'item.location_changed', label: 'Item Location Changed' },
  { value: 'item.flag_added', label: 'Flag added to item' },
  { value: 'billing_event.created', label: 'Billing Event Created' },
  { value: 'task.created', label: 'Task Created' },
  { value: 'task.assigned', label: 'Task Assigned' },
  { value: 'task.completed', label: 'Task Completed' },
  { value: 'task.overdue', label: 'Task Overdue' },
  { value: 'task.unable_to_complete', label: 'Task Unable to Complete' },
  { value: 'release.created', label: 'Release Created' },
  { value: 'release.approved', label: 'Release Approved' },
  { value: 'release.completed', label: 'Release Completed' },
  { value: 'invoice.created', label: 'Invoice Created' },
  { value: 'invoice.sent', label: 'Invoice Sent' },
  { value: 'payment.received', label: 'Payment Received' },
  // Additional triggers
  { value: 'shipment_created', label: 'Shipment Created' },
  { value: 'shipment_scheduled', label: 'Shipment Scheduled' },
  { value: 'shipment_delayed', label: 'Shipment Delayed' },
  { value: 'shipment_out_for_delivery', label: 'Shipment Out for Delivery' },
  { value: 'shipment_delivered', label: 'Shipment Delivered' },
  { value: 'will_call_ready', label: 'Will Call Ready' },
  { value: 'will_call_released', label: 'Will Call Released' },
  { value: 'inspection_started', label: 'Inspection Started' },
  { value: 'inspection_report_available', label: 'Inspection Report Available' },
  { value: 'inspection_requires_attention', label: 'Inspection Requires Attention' },
  { value: 'task_assigned', label: 'Task Assigned' },
  { value: 'task_completed', label: 'Task Completed' },
  { value: 'task_overdue', label: 'Task Overdue' },
  { value: 'task_unable_to_complete', label: 'Task Unable to Complete (legacy)' },
  { value: 'shipment.partial_completed', label: 'Partial Shipment Completed' },
  { value: 'shipment.unable_to_complete', label: 'Shipment Unable to Complete' },
  { value: 'repair_started', label: 'Repair Started' },
  { value: 'repair_completed', label: 'Repair Completed' },
  { value: 'repair_requires_approval', label: 'Repair Requires Approval' },
  { value: 'repair.unable_to_complete', label: 'Repair Unable to Complete' },
  // Client portal triggers
  { value: 'client.inbound_shipment_created', label: 'Client Created Inbound Shipment' },
  { value: 'client.outbound_shipment_created', label: 'Client Created Outbound Shipment' },
  { value: 'client.task_created', label: 'Client Created Task' },
  { value: 'client.claim_filed', label: 'Client Filed Claim' },
  { value: 'client.item_reassigned', label: 'Client Reassigned Items' },
  // Split workflow triggers
  { value: 'split.required', label: 'Split Required' },
  { value: 'split.completed', label: 'Split Completed' },
  { value: 'split.manual_review', label: 'Split Request Pending Review' },
  // Receiving triggers
  { value: 'receiving.discrepancy_created', label: 'Receiving Discrepancy Created' },
  { value: 'receiving.exception_noted', label: 'Receiving Exception Noted' },
  { value: 'shipment.unidentified_intake_completed', label: 'Unidentified Intake Completed' },
  // Coverage triggers
  { value: 'coverage.applied', label: 'Coverage Applied to Shipment' },
  { value: 'coverage.pending_declared_value', label: 'Items Pending Declared Values' },
  { value: 'custom', label: 'Custom Event' },
];

export const COMMUNICATION_VARIABLES = [
  // Brand
  { key: 'tenant_name', label: 'Tenant Name', group: 'Brand', sample: 'Stride Logistics', description: 'Your organization name' },
  { key: 'brand_logo_url', label: 'Brand Logo URL', group: 'Brand', sample: 'https://example.com/logo.png', description: 'URL to your brand logo' },
  { key: 'brand_primary_color', label: 'Brand Primary Color', group: 'Brand', sample: '#FD5A2A', description: 'Your primary brand color' },
  { key: 'brand_support_email', label: 'Support Email', group: 'Brand', sample: 'support@stride.com', description: 'Customer support email address' },
  { key: 'brand_terms_url', label: 'Terms URL', group: 'Brand', sample: 'https://stride.com/terms', description: 'Link to terms of service' },
  { key: 'brand_privacy_url', label: 'Privacy URL', group: 'Brand', sample: 'https://stride.com/privacy', description: 'Link to privacy policy' },
  { key: 'tenant_company_address', label: 'Company Address', group: 'Brand', sample: '123 Warehouse Blvd, Suite 100', description: 'Your organization mailing address' },
  { key: 'portal_base_url', label: 'Portal URL', group: 'Brand', sample: 'https://portal.stride.com', description: 'Base URL for customer portal' },

  // Office
  { key: 'office_alert_emails', label: 'Office Alerts Email(s)', group: 'Office', sample: 'ops@company.com, alerts@company.com', description: 'Comma-separated office alert email addresses' },
  { key: 'office_alert_email_primary', label: 'Office Alerts Email (Primary)', group: 'Office', sample: 'ops@company.com', description: 'First office alert email address' },

  // Account
  { key: 'account_name', label: 'Account Name', group: 'Account', sample: 'Acme Corp', description: 'Customer account name' },
  { key: 'account_contact_name', label: 'Account Contact Name', group: 'Account', sample: 'John Smith', description: 'Primary contact name' },
  { key: 'account_contact_email', label: 'Account Contact Email', group: 'Account', sample: 'john@acme.com', description: 'Parsed email from alert recipients' },
  { key: 'account_contact_phone', label: 'Account Contact Phone', group: 'Account', sample: '+1-555-123-4567', description: 'Parsed phone from alert recipients' },
  { key: 'account_contact_recipients_raw', label: 'Alert Recipients (Raw)', group: 'Account', sample: 'john@acme.com, +1-555-123-4567', description: 'Raw alert recipients field' },
  { key: 'account_billing_contact_email', label: 'Billing Contact Email', group: 'Account', sample: 'billing@acme.com', description: 'Billing contact email' },
  { key: 'account_user_email', label: 'Account User Email', group: 'Account', sample: 'user@acme.com', description: 'Logged-in user email' },

  // Shipment
  { key: 'shipment_number', label: 'Shipment Number', group: 'Shipment', sample: 'SHP-2024-001', description: 'Unique shipment identifier' },
  { key: 'shipment_vendor', label: 'Shipment Vendor', group: 'Shipment', sample: 'FedEx', description: 'Carrier/vendor name' },
  { key: 'shipment_status', label: 'Shipment Status', group: 'Shipment', sample: 'In Transit', description: 'Current shipment status' },
  { key: 'scheduled_date', label: 'Scheduled Date', group: 'Shipment', sample: 'Jan 15, 2025', description: 'Scheduled delivery date' },
  { key: 'delivery_window', label: 'Delivery Window', group: 'Shipment', sample: '9:00 AM - 12:00 PM', description: 'Expected delivery time window' },
  { key: 'delay_reason', label: 'Delay Reason', group: 'Shipment', sample: 'Weather conditions', description: 'Reason for shipment delay' },
  { key: 'delivered_at', label: 'Delivered At', group: 'Shipment', sample: 'Jan 15, 2025 10:30 AM', description: 'Actual delivery timestamp' },
  { key: 'shipment_expected_date', label: 'Expected Date', group: 'Shipment', sample: '2024-01-15', description: 'Expected arrival date' },
  { key: 'shipment_received_date', label: 'Received Date', group: 'Shipment', sample: '2024-01-14', description: 'Actual received date' },
  { key: 'shipment_link', label: 'Shipment Link', group: 'Shipment', sample: 'https://portal.stride.com/shipments/123', description: 'Direct link to shipment' },
  { key: 'exceptions_count', label: 'Exceptions Count', group: 'Shipment', sample: '2', description: 'Number of open receiving exceptions (blank/0 when none)' },
  { key: 'exceptions_list_text', label: 'Exceptions List (Text)', group: 'Shipment', sample: '- Damage: Corner torn\\n- Wet: Box soaked', description: 'Bullet list of exceptions (type + note)' },
  { key: 'exceptions_section_html', label: 'Exceptions Section (HTML)', group: 'Shipment', sample: '<div>...</div>', description: 'Preformatted Exceptions section for emails (blank when none)' },

  // Item
  { key: 'item_id', label: 'Item ID', group: 'Item', sample: 'ITM-001', description: 'Unique item identifier' },
  { key: 'item_code', label: 'Item Code', group: 'Item', sample: 'ITM-001', description: 'Item code' },
  { key: 'item_vendor', label: 'Item Vendor', group: 'Item', sample: 'Supplier Inc', description: 'Item vendor/supplier' },
  { key: 'item_description', label: 'Item Description', group: 'Item', sample: 'Office Chair - Black', description: 'Item description' },
  { key: 'item_received_date', label: 'Item Received Date', group: 'Item', sample: '2024-01-14', description: 'When item was received' },
  { key: 'item_location', label: 'Item Location', group: 'Item', sample: 'Row A, Rack 5', description: 'Current warehouse location' },
  { key: 'item_sidemark', label: 'Item Sidemark', group: 'Item', sample: 'ACME-2024', description: 'Sidemark identifier' },
  { key: 'item_photos_link', label: 'Item Photos Link', group: 'Item', sample: 'https://portal.stride.com/items/123/photos', description: 'Link to item photos' },
  { key: 'flag_service_name', label: 'Flag Name', group: 'Item', sample: 'Fragile', description: 'Name of the flag/service for item.flag_added alerts' },
  { key: 'flag_service_code', label: 'Flag Code', group: 'Item', sample: 'FLG_FRAGILE', description: 'Service code of the applied flag (per-flag triggers use this as suffix)' },
  { key: 'flag_added_by_name', label: 'Flag Added By', group: 'Item', sample: 'John Doe', description: 'User who applied the flag (best-effort)' },
  { key: 'flag_added_at', label: 'Flag Added At', group: 'Item', sample: 'Jan 15, 2026 2:05 PM', description: 'When the flag was applied (best-effort)' },

  // Inspection
  { key: 'inspection_number', label: 'Inspection Number', group: 'Inspection', sample: 'INSP-001', description: 'Inspection task identifier' },
  { key: 'inspection_issues_count', label: 'Issues Count', group: 'Inspection', sample: '3', description: 'Number of items with inspection issues' },
  { key: 'inspection_result', label: 'Inspection Result', group: 'Inspection', sample: 'Issues found', description: 'Summary result of the inspection' },

  // Tasks
  { key: 'task_number', label: 'Task Number', group: 'Tasks', sample: 'TSK-001', description: 'Unique task identifier' },
  { key: 'task_title', label: 'Task Title', group: 'Tasks', sample: 'Inspect Shipment SHP-001', description: 'Title of the task' },
  { key: 'task_type', label: 'Task Type', group: 'Tasks', sample: 'Inspection', description: 'Type of task' },
  { key: 'task_status', label: 'Task Status', group: 'Tasks', sample: 'Pending', description: 'Current task status' },
  { key: 'task_due_date', label: 'Task Due Date', group: 'Tasks', sample: '2024-01-20', description: 'Task due date' },
  { key: 'task_days_overdue', label: 'Days Overdue', group: 'Tasks', sample: '3', description: 'Number of days the task is past due' },
  { key: 'task_unable_reason', label: 'Task Unable Reason', group: 'Tasks', sample: 'Customer unavailable at pickup window', description: 'Reason a task was marked unable to complete' },
  { key: 'assigned_to_name', label: 'Assigned To', group: 'Tasks', sample: 'John Doe', description: 'Name of the person the task is assigned to' },
  { key: 'completed_by_name', label: 'Completed By', group: 'Tasks', sample: 'Jane Smith', description: 'Name of person who completed the task' },
  { key: 'task_link', label: 'Task Link', group: 'Tasks', sample: 'https://portal.stride.com/tasks/123', description: 'Direct link to task' },

  // Split workflow
  { key: 'split_grouped_qty', label: 'Grouped Quantity', group: 'Split', sample: '4', description: 'Original grouped quantity on the parent item before split' },
  { key: 'split_keep_qty', label: 'Keep Quantity', group: 'Split', sample: '2', description: 'Quantity that stays on the parent item code (the job ships/uses this)' },
  { key: 'split_leftover_qty', label: 'Leftover Quantity', group: 'Split', sample: '2', description: 'Quantity split off into newly printed child labels' },
  { key: 'split_requested_by_name', label: 'Requested By (Name)', group: 'Split', sample: 'Jane Client', description: 'Who requested the partial grouped quantity (best-effort)' },
  { key: 'split_requested_by_email', label: 'Requested By (Email)', group: 'Split', sample: 'jane@client.com', description: 'Requestor email (best-effort)' },
  { key: 'split_request_notes', label: 'Request Notes', group: 'Split', sample: 'Please pull matching set; see notes.', description: 'Notes carried from the originating job' },
  { key: 'origin_job_type', label: 'Origin Job Type', group: 'Split', sample: 'Outbound Shipment', description: 'The job type that required the split (shipment/task)' },
  { key: 'origin_job_number', label: 'Origin Job Number', group: 'Split', sample: 'OUT-000123', description: 'The originating job number/title (best-effort)' },
  { key: 'origin_job_link', label: 'Origin Job Link', group: 'Split', sample: 'https://portal.stride.com/shipments/123', description: 'Deep link to originating job (best-effort)' },
  { key: 'split_child_codes_list_text', label: 'Child Codes (Text List)', group: 'Split', sample: 'ITM-123-1\\nITM-123-2', description: 'Newly generated child codes (completion emails)' },

  // Claims
  { key: 'claim_reference', label: 'Claim Reference', group: 'Claims', sample: 'CLM-2026-001', description: 'Claim identifier/number' },
  { key: 'claim_status', label: 'Claim Status', group: 'Claims', sample: 'pending_review', description: 'Current claim status' },
  { key: 'claim_amount', label: 'Claim Amount', group: 'Claims', sample: '$250.00', description: 'Claimed amount' },
  { key: 'offer_amount', label: 'Offer Amount', group: 'Claims', sample: '$150.00', description: 'Counter-offer or approved offer amount' },

  // Releases
  { key: 'release_number', label: 'Release Number', group: 'Releases', sample: 'REL-001', description: 'Unique release identifier' },
  { key: 'release_type', label: 'Release Type', group: 'Releases', sample: 'Will Call', description: 'Type of release' },
  { key: 'release_completed_at', label: 'Release Completed', group: 'Releases', sample: '2024-01-15 10:30', description: 'When release was completed' },
  { key: 'released_at', label: 'Released At', group: 'Releases', sample: 'Jan 15, 2025 10:30 AM', description: 'Timestamp of the release' },
  { key: 'release_items_count', label: 'Release Items Count', group: 'Releases', sample: '12', description: 'Number of items included in the release' },
  { key: 'shipment_unable_reason', label: 'Shipment Unable Reason', group: 'Releases', sample: 'Pickup failed after multiple attempts', description: 'Reason a shipment/release was marked unable to complete' },
  { key: 'pickup_hours', label: 'Pickup Hours', group: 'Releases', sample: 'Mon-Fri 8AM-5PM', description: 'Available pickup hours' },
  { key: 'release_link', label: 'Release Link', group: 'Releases', sample: 'https://portal.stride.com/releases/123', description: 'Direct link to release' },
  { key: 'amount_due', label: 'Amount Due', group: 'Releases', sample: '$150.00', description: 'Total amount due' },
  { key: 'payment_status', label: 'Payment Status', group: 'Releases', sample: 'Paid', description: 'Current payment status' },

  // Repair
  { key: 'repair_type', label: 'Repair Type', group: 'Repair', sample: 'Furniture Repair', description: 'Type of repair being performed' },
  { key: 'repair_completed_at', label: 'Repair Completed At', group: 'Repair', sample: 'Jan 15, 2025 2:00 PM', description: 'When repair work was completed' },
  { key: 'repair_estimate_amount', label: 'Repair Estimate', group: 'Repair', sample: '$250.00', description: 'Estimated cost for the repair' },

  // Billing/Services
  { key: 'service_name', label: 'Service Name', group: 'Billing', sample: 'Assembly 15m', description: 'Name of the service' },
  { key: 'service_code', label: 'Service Code', group: 'Billing', sample: '15MA', description: 'Code of the service' },
  { key: 'service_amount', label: 'Service Amount', group: 'Billing', sample: '$35.00', description: 'Total amount charged' },
  { key: 'billing_description', label: 'Billing Description', group: 'Billing', sample: 'Assembly 15m: ITM-001', description: 'Billing event description' },

  // Links (Portal Deep Links)
  { key: 'portal_invoice_url', label: 'Invoice Link', group: 'Links', sample: 'https://portal.stride.com/invoices/123', description: 'Direct link to invoice' },
  { key: 'portal_claim_url', label: 'Claim Link', group: 'Links', sample: 'https://portal.stride.com/claims/123', description: 'Direct link to claim' },
  { key: 'portal_release_url', label: 'Release Link', group: 'Links', sample: 'https://portal.stride.com/releases/123', description: 'Direct link to release' },
  { key: 'portal_quote_url', label: 'Quote Link', group: 'Links', sample: 'https://portal.stride.com/quotes/123', description: 'Direct link to quote' },
  { key: 'portal_account_url', label: 'Account Link', group: 'Links', sample: 'https://portal.stride.com/accounts/123', description: 'Direct link to account' },
  { key: 'portal_settings_url', label: 'Settings Link', group: 'Links', sample: 'https://portal.stride.com/settings/organization/contact', description: 'Link to organization settings' },
  { key: 'portal_inspection_url', label: 'Inspection Link', group: 'Links', sample: 'https://portal.stride.com/inspections/123', description: 'Direct link to inspection' },
  { key: 'portal_repair_url', label: 'Repair Link', group: 'Links', sample: 'https://portal.stride.com/repairs/123', description: 'Direct link to repair quote' },

  // Aggregates / Array tokens
  { key: 'items_count', label: 'Items Count', group: 'Aggregates', sample: '5', description: 'Total number of items' },
  { key: 'items_table_html', label: 'Items Table (HTML)', group: 'Aggregates', sample: '<table>...</table>', description: 'Formatted HTML table of items with columns' },
  { key: 'items_list_text', label: 'Items List (Text)', group: 'Aggregates', sample: '1x Chair, 2x Table', description: 'Plain text list of items' },
  { key: 'items_list_html', label: 'Items List (HTML)', group: 'Aggregates', sample: '<div>...</div>', description: 'Formatted HTML list of items (card style)' },
  { key: 'inspection_findings_table_html', label: 'Inspection Findings (HTML)', group: 'Aggregates', sample: '<table>...</table>', description: 'HTML table of inspection findings per item' },
  { key: 'task_services_table_html', label: 'Task Services (HTML)', group: 'Aggregates', sample: '<table>...</table>', description: 'HTML table of services/add-ons performed on a task' },
  { key: 'repair_actions_table_html', label: 'Repair Actions (HTML)', group: 'Aggregates', sample: '<table>...</table>', description: 'HTML table of repair quote line items' },

  // General
  { key: 'user_name', label: 'User Name', group: 'General', sample: 'Jane Doe', description: 'Name of the user who performed action' },
  { key: 'created_by_name', label: 'Created By', group: 'General', sample: 'Jane Doe', description: 'Name of person who triggered' },
  { key: 'created_at', label: 'Created At', group: 'General', sample: '2024-01-15 10:30:00', description: 'Timestamp when created' },

  // Recipients (role tokens for in-app notification targeting)
  { key: 'admin_role', label: 'Admin Role', group: 'Recipients', sample: 'admin', description: 'Target all users with Admin role' },
  { key: 'manager_role', label: 'Manager Role', group: 'Recipients', sample: 'manager', description: 'Target all users with Manager role' },
  { key: 'warehouse_role', label: 'Warehouse Role', group: 'Recipients', sample: 'warehouse', description: 'Target all users with Warehouse role' },
  { key: 'client_user_role', label: 'Client User Role', group: 'Recipients', sample: 'client_user', description: 'Target all users with Client User role' },
  { key: 'technician_role', label: 'Technician Role', group: 'Recipients', sample: 'technician', description: 'Target all users with Technician role' },
  { key: 'billing_manager_role', label: 'Billing Manager Role', group: 'Recipients', sample: 'billing_manager', description: 'Target all users with Billing Manager role' },
];

export function useCommunications() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [alerts, setAlerts] = useState<CommunicationAlert[]>([]);
  const [templates, setTemplates] = useState<CommunicationTemplate[]>([]);
  const [triggerCatalog, setTriggerCatalog] = useState<TriggerCatalogEntry[]>([]);
  const [designElements, setDesignElements] = useState<CommunicationDesignElement[]>([]);
  const [brandSettings, setBrandSettings] = useState<CommunicationBrandSettings | null>(null);
  const [tenantCompanyInfo, setTenantCompanyInfo] = useState<TenantCompanyInfo>({});
  const [loading, setLoading] = useState(true);

  const fetchAlerts = useCallback(async () => {
    if (!profile?.tenant_id) return;
    
    try {
      const { data, error } = await supabase
        .from('communication_alerts')
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .order('name');
      
      if (error) throw error;
      const cleaned = (data || []).filter((row) =>
        row.trigger_event !== 'test_shipment_status_update' &&
        !(row.key || '').toLowerCase().includes('test_shipment_status_update')
      );
      setAlerts(cleaned as CommunicationAlert[]);
    } catch (error) {
      console.error('Error fetching alerts:', error);
    }
  }, [profile?.tenant_id]);

  const fetchTemplates = useCallback(async () => {
    if (!profile?.tenant_id) return;
    
    try {
      const { data, error } = await supabase
        .from('communication_templates')
        .select('*')
        .eq('tenant_id', profile.tenant_id);
      
      if (error) throw error;
      setTemplates((data || []) as CommunicationTemplate[]);
    } catch (error) {
      console.error('Error fetching templates:', error);
    }
  }, [profile?.tenant_id]);

  const fetchDesignElements = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('communication_design_elements')
        .select('*')
        .order('category, name');

      if (error) throw error;
      setDesignElements((data || []) as CommunicationDesignElement[]);
    } catch (error) {
      console.error('Error fetching design elements:', error);
    }
  }, []);

  const fetchTriggerCatalog = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('communication_trigger_catalog')
        .select('*')
        .eq('is_active', true)
        .order('module_group, display_name');

      if (error) throw error;
      setTriggerCatalog((data || []) as TriggerCatalogEntry[]);
    } catch (error) {
      console.error('Error fetching trigger catalog:', error);
    }
  }, []);

  const fetchBrandSettings = useCallback(async () => {
    if (!profile?.tenant_id) return;

    try {
      // Fetch company info plus brand settings so preview tokens match the live sender.
      const { data: companySettings } = await supabase
        .from('tenant_company_settings')
        .select('company_name, logo_url, company_email, company_address, company_phone, app_base_url')
        .eq('tenant_id', profile.tenant_id)
        .maybeSingle();

      // Brand settings only used for accent color (brand_primary_color)
      const { data, error } = await supabase
        .from('communication_brand_settings')
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        const { data: newSettings, error: createError } = await supabase
          .from('communication_brand_settings')
          .insert({
            tenant_id: profile.tenant_id,
            brand_primary_color: '#FD5A2A',
          })
          .select()
          .single();

        if (createError) throw createError;
        setBrandSettings(newSettings as CommunicationBrandSettings);
        setTenantCompanyInfo({
          companyName: companySettings?.company_name || '',
          logoUrl: companySettings?.logo_url || '',
          companyEmail: companySettings?.company_email || '',
          supportEmail: companySettings?.company_email || '',
          companyAddress: companySettings?.company_address || '',
          portalBaseUrl: companySettings?.app_base_url || '',
          companyPhone: companySettings?.company_phone || '',
        });
      } else {
        setBrandSettings(data as CommunicationBrandSettings);
        setTenantCompanyInfo({
          companyName: companySettings?.company_name || '',
          logoUrl: companySettings?.logo_url || '',
          companyEmail: companySettings?.company_email || '',
          supportEmail: data.brand_support_email || companySettings?.company_email || '',
          companyAddress: companySettings?.company_address || '',
          portalBaseUrl: data.portal_base_url || companySettings?.app_base_url || '',
          companyPhone: companySettings?.company_phone || '',
        });
      }
    } catch (error) {
      console.error('Error fetching brand settings:', error);
    }
  }, [profile?.tenant_id]);

  useEffect(() => {
    const loadAll = async () => {
      setLoading(true);
      await Promise.all([
        fetchAlerts(),
        fetchTemplates(),
        fetchDesignElements(),
        fetchBrandSettings(),
        fetchTriggerCatalog(),
      ]);
      setLoading(false);
    };
    loadAll();
  }, [fetchAlerts, fetchTemplates, fetchDesignElements, fetchBrandSettings, fetchTriggerCatalog]);

  const createAlert = async (alert: Omit<CommunicationAlert, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>) => {
    if (!profile?.tenant_id) return null;
    
    try {
      const { data, error } = await supabase
        .from('communication_alerts')
        .insert({
          ...alert,
          tenant_id: profile.tenant_id,
        })
        .select()
        .single();
      
      if (error) throw error;
      
      // Create default email, SMS, and in-app templates using plain text + tokens
      const emailBody = getDefaultEmailBody(alert.trigger_event);
      const smsBody = getDefaultSmsBody(alert.trigger_event);
      const inAppDefaults = getDefaultInAppDefaults(alert.trigger_event);
      const emailEditorJson = getDefaultEditorJson(alert.trigger_event);
      const emailSubject = getDefaultSubject(alert.name, alert.trigger_event);

      await (supabase as any).from('communication_templates').insert([
        {
          tenant_id: profile.tenant_id,
          alert_id: data.id,
          channel: 'email',
          subject_template: emailSubject,
          body_template: emailBody,
          body_format: 'text',
          editor_json: emailEditorJson,
        },
        {
          tenant_id: profile.tenant_id,
          alert_id: data.id,
          channel: 'sms',
          body_template: smsBody,
          body_format: 'text',
        },
        {
          tenant_id: profile.tenant_id,
          alert_id: data.id,
          channel: 'in_app',
          subject_template: alert.name,
          body_template: inAppDefaults.body,
          body_format: 'text',
          in_app_recipients: inAppDefaults.recipients,
        },
      ]);
      
      await fetchAlerts();
      await fetchTemplates();
      
      toast({
        title: 'Alert Created',
        description: `${alert.name} has been created with default templates.`,
      });
      
      return data as CommunicationAlert;
    } catch (error: any) {
      console.error('Error creating alert:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'Failed to create alert',
      });
      return null;
    }
  };

  const updateAlert = async (id: string, updates: Partial<CommunicationAlert>) => {
    try {
      const { error } = await supabase
        .from('communication_alerts')
        .update(updates)
        .eq('id', id);
      
      if (error) throw error;
      
      await fetchAlerts();
      toast({
        title: 'Alert Updated',
        description: 'Alert settings have been saved.',
      });
      return true;
    } catch (error: any) {
      console.error('Error updating alert:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'Failed to update alert',
      });
      return false;
    }
  };

  const deleteAlert = async (id: string) => {
    try {
      const { error } = await supabase
        .from('communication_alerts')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
      
      await fetchAlerts();
      await fetchTemplates();
      
      toast({
        title: 'Alert Deleted',
        description: 'Alert and its templates have been removed.',
      });
      return true;
    } catch (error: any) {
      console.error('Error deleting alert:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'Failed to delete alert',
      });
      return false;
    }
  };

  const createTemplate = async (alertId: string, channel: 'email' | 'sms' | 'in_app', alertName: string, triggerEvent?: string) => {
    if (!profile?.tenant_id) return null;

    try {
      const isEmail = channel === 'email';
      const isInApp = channel === 'in_app';
      let defaultBody: string;
      let inAppRecipients: string | null = null;

      if (isInApp) {
        const inAppDefaults = getDefaultInAppDefaults(triggerEvent);
        defaultBody = inAppDefaults.body;
        inAppRecipients = inAppDefaults.recipients;
      } else if (isEmail) {
        defaultBody = getDefaultEmailBody(triggerEvent);
      } else {
        defaultBody = getDefaultSmsBody(triggerEvent);
      }

      const { data, error } = await (supabase as any)
        .from('communication_templates')
        .insert({
          tenant_id: profile.tenant_id,
          alert_id: alertId,
          channel,
          subject_template: isEmail ? getDefaultSubject(alertName, triggerEvent) : isInApp ? alertName : null,
          body_template: defaultBody,
          body_format: 'text',
          ...(isEmail ? { editor_json: getDefaultEditorJson(triggerEvent) } : {}),
          ...(isInApp ? { in_app_recipients: inAppRecipients } : {}),
        })
        .select()
        .single();

      if (error) throw error;

      await fetchTemplates();

      toast({
        title: 'Template Created',
        description: `${channel.toUpperCase()} template has been created.`,
      });

      return data as CommunicationTemplate;
    } catch (error: any) {
      console.error('Error creating template:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'Failed to create template',
      });
      return null;
    }
  };

  const updateTemplate = async (id: string, updates: Partial<CommunicationTemplate>) => {
    if (!profile?.id) return false;

    try {
      // Get current template for versioning
      const currentTemplate = templates.find(t => t.id === id);
      
      const { error } = await (supabase as any)
        .from('communication_templates')
        .update(updates)
        .eq('id', id);
      
      if (error) throw error;
      
      // Create version if body changed
      if (currentTemplate && updates.body_template && updates.body_template !== currentTemplate.body_template) {
        // Get latest version number
        const { data: versions } = await supabase
          .from('communication_template_versions')
          .select('version_number')
          .eq('template_id', id)
          .order('version_number', { ascending: false })
          .limit(1);
        
        const nextVersion = versions && versions.length > 0 ? versions[0].version_number + 1 : 1;
        
        await supabase.from('communication_template_versions').insert({
          template_id: id,
          version_number: nextVersion,
          subject_template: updates.subject_template || currentTemplate.subject_template,
          body_template: updates.body_template,
          created_by: profile.id,
        });
      }
      
      await fetchTemplates();
      toast({
        title: 'Template Saved',
        description: 'Template has been updated.',
      });
      return true;
    } catch (error: any) {
      console.error('Error updating template:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'Failed to update template',
      });
      return false;
    }
  };

  const getTemplateVersions = async (templateId: string): Promise<CommunicationTemplateVersion[]> => {
    try {
      const { data, error } = await supabase
        .from('communication_template_versions')
        .select('*')
        .eq('template_id', templateId)
        .order('version_number', { ascending: false });
      
      if (error) throw error;
      return (data || []) as CommunicationTemplateVersion[];
    } catch (error) {
      console.error('Error fetching versions:', error);
      return [];
    }
  };

  const revertToVersion = async (templateId: string, version: CommunicationTemplateVersion) => {
    return updateTemplate(templateId, {
      subject_template: version.subject_template,
      body_template: version.body_template,
    });
  };

  const updateBrandSettings = async (updates: Partial<CommunicationBrandSettings>) => {
    if (!profile?.tenant_id || !brandSettings) return false;
    
    try {
      const { error } = await supabase
        .from('communication_brand_settings')
        .update(updates)
        .eq('tenant_id', profile.tenant_id);
      
      if (error) throw error;
      
      setBrandSettings({ ...brandSettings, ...updates });
      toast({
        title: 'Brand Settings Updated',
        description: 'Your brand settings have been saved.',
      });
      return true;
    } catch (error: any) {
      console.error('Error updating brand settings:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'Failed to update brand settings',
      });
      return false;
    }
  };

  return {
    alerts,
    templates,
    designElements,
    brandSettings,
    tenantCompanyInfo,
    triggerCatalog,
    loading,
    createAlert,
    updateAlert,
    deleteAlert,
    createTemplate,
    updateTemplate,
    getTemplateVersions,
    revertToVersion,
    updateBrandSettings,
    refetch: async () => {
      await Promise.all([fetchAlerts(), fetchTemplates(), fetchDesignElements(), fetchBrandSettings(), fetchTriggerCatalog()]);
    },
  };
}

import { getDefaultTemplate } from '@/lib/emailTemplates/defaultAlertTemplates';

function getDefaultEmailBody(triggerEvent?: string): string {
  return getDefaultTemplate(triggerEvent).body;
}

function getDefaultSmsBody(triggerEvent?: string): string {
  return getDefaultTemplate(triggerEvent).smsBody;
}

function getDefaultEditorJson(triggerEvent?: string): Record<string, unknown> {
  const defaults = getDefaultTemplate(triggerEvent);
  return {
    heading: defaults.heading,
    recipients: '',
    cta_enabled: !!defaults.ctaLabel,
    cta_label: defaults.ctaLabel,
    cta_link: defaults.ctaLink,
  };
}

function getDefaultSubject(alertName: string, triggerEvent?: string): string {
  const defaults = getDefaultTemplate(triggerEvent);
  return defaults.subject || `[[tenant_name]]: ${alertName}`;
}

function getDefaultInAppDefaults(triggerEvent?: string): { body: string; recipients: string } {
  const defaults = getDefaultTemplate(triggerEvent);
  return {
    body: defaults.inAppBody,
    recipients: defaults.inAppRecipients,
  };
}
