// Quoting Tool TypeScript Types

export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'declined' | 'expired' | 'void';

export type QuoteBillingUnit = 'flat' | 'per_piece' | 'per_line_item' | 'per_class' | 'per_hour' | 'per_day';

export type DiscountType = 'percentage' | 'flat_rate';

export type QuoteEventType =
  | 'created'
  | 'updated'
  | 'emailed'
  | 'email_failed'
  | 'exported_pdf'
  | 'exported_excel'
  | 'viewed'
  | 'accepted'
  | 'declined'
  | 'expired'
  | 'voided'
  | 'attachment_added'
  | 'attachment_removed';

// Quote Class (master list)
export interface QuoteClass {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  display_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// Quote Service (master catalog)
export interface QuoteService {
  id: string;
  tenant_id: string;
  service_code: string;
  category: string;
  name: string;
  description: string | null;
  billing_unit: QuoteBillingUnit;
  trigger_label: string | null;
  is_storage_service: boolean;
  is_taxable_default: boolean;
  is_class_based: boolean; // true if service has class-specific rates
  display_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// Service Rate
export interface QuoteServiceRate {
  id: string;
  tenant_id: string;
  service_id: string;
  class_id: string | null;
  rate_amount: number;
  currency: string;
  effective_date: string;
  is_current: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // Joined data
  service?: QuoteService;
  class?: QuoteClass;
}

// Main Quote
export interface Quote {
  id: string;
  tenant_id: string;
  account_id: string;
  quote_number: string;
  status: QuoteStatus;
  currency: string;
  tax_enabled: boolean;
  tax_rate_percent: number | null;
  tax_rate_source: string | null;
  storage_days: number;
  storage_months_input: number | null;
  storage_days_input: number | null;
  rates_locked: boolean;
  expiration_date: string | null;
  quote_discount_type: DiscountType | null;
  quote_discount_value: number | null;
  subtotal_before_discounts: number;
  subtotal_after_discounts: number;
  tax_amount: number;
  grand_total: number;
  coverage_type: string | null;
  total_declared_value: number;
  coverage_cost: number;
  notes: string | null;
  internal_notes: string | null;
  decline_reason: string | null;
  magic_link_token: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
  accepted_at: string | null;
  declined_at: string | null;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
  // Joined data
  account?: {
    id: string;
    account_name: string;
    account_code: string;
    is_wholesale: boolean;
    billing_email: string | null;
  };
}

// Quote Class Line (quantities per class)
export interface QuoteClassLine {
  id: string;
  quote_id: string;
  class_id: string;
  qty: number;
  line_discount_type: DiscountType | null;
  line_discount_value: number | null;
  line_subtotal_before_discounts: number;
  line_subtotal_after_discounts: number;
  created_at: string;
  updated_at: string;
  // Joined data
  class?: QuoteClass;
}

// Quote Selected Service
export interface QuoteSelectedService {
  id: string;
  quote_id: string;
  service_id: string;
  is_selected: boolean;
  hours_input: number | null;
  qty_input: number | null;
  computed_billable_qty: number;
  applied_rate_amount: number;
  line_total: number;
  created_at: string;
  updated_at: string;
  // Joined data
  service?: QuoteService;
}

// Quote Rate Override
export interface QuoteRateOverride {
  id: string;
  quote_id: string;
  service_id: string;
  class_id: string | null;
  override_rate_amount: number;
  reason: string | null;
  created_at: string;
}

// Quote Event (audit log)
export interface QuoteEvent {
  id: string;
  tenant_id: string;
  quote_id: string;
  event_type: QuoteEventType;
  payload_json: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
}

// Edit Lock
export interface EditLock {
  id: string;
  tenant_id: string;
  resource_type: string;
  resource_id: string;
  locked_by: string;
  locked_by_name: string;
  locked_at: string;
  expires_at: string | null;
}

// Quote Attachment (derived from quote_events)
export interface QuoteAttachment {
  file_name: string;
  file_url: string;
  file_size: number;
  mime_type: string;
  storage_path: string;
  uploaded_by: string | null;
  uploaded_by_name?: string | null;
  uploaded_at: string;
}

// Quote with all relations (for full display)
export interface QuoteWithDetails extends Quote {
  class_lines: QuoteClassLine[];
  selected_services: QuoteSelectedService[];
  class_service_selections: ClassServiceSelection[];
  rate_overrides: QuoteRateOverride[];
  events: QuoteEvent[];
  attachments: QuoteAttachment[];
  // Audit trail resolved names
  created_by_name?: string | null;
  last_updated_by_name?: string | null;
  last_updated_at?: string | null;
}

// Per-class service selection for class-based services
export interface ClassServiceSelection {
  class_id: string;
  service_id: string;
  is_selected: boolean;
  qty_override: number | null; // null = use class qty, number = specific qty
}

// Form data for creating/editing quotes
export interface QuoteFormData {
  account_id: string;
  currency: string;
  tax_enabled: boolean;
  tax_rate_percent: number | null;
  storage_months_input: number | null;
  storage_days_input: number | null;
  rates_locked: boolean;
  expiration_date: string | null;
  quote_discount_type: DiscountType | null;
  quote_discount_value: number | null;
  coverage_type: string | null;
  total_declared_value: number | null;
  notes: string | null;
  internal_notes: string | null;
  class_lines: {
    class_id: string;
    qty: number;
    line_discount_type: DiscountType | null;
    line_discount_value: number | null;
  }[];
  // Class-based services: tracks per-class service selections and qty overrides
  class_service_selections: ClassServiceSelection[];
  // Non-class based services (flat rate)
  selected_services: {
    service_id: string;
    is_selected: boolean;
    hours_input: number | null;
    qty_input: number | null; // for services that need quantity
  }[];
  rate_overrides: {
    service_id: string;
    class_id: string | null;
    override_rate_amount: number;
    reason: string | null;
  }[];
}

// Calculated quote totals (for preview)
export interface QuoteCalculation {
  class_line_totals: {
    class_id: string;
    class_name: string;
    qty: number;
    services_total: number;
    storage_total: number;
    subtotal_before_discount: number;
    discount_amount: number;
    subtotal_after_discount: number;
  }[];
  service_totals: {
    service_id: string;
    service_name: string;
    category: string;
    billing_unit: QuoteBillingUnit;
    billable_qty: number;
    rate: number;
    total: number;
  }[];
  storage_days: number;
  subtotal_before_discounts: number;
  quote_discount_amount: number;
  subtotal_after_discounts: number;
  tax_rate: number;
  tax_amount: number;
  coverage_type: string | null;
  total_declared_value: number;
  coverage_cost: number;
  grand_total: number;
}

// Status display config
export const QUOTE_STATUS_CONFIG: Record<QuoteStatus, { label: string; variant: string; color: string }> = {
  draft: { label: 'Draft', variant: 'outline', color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300 border-yellow-500/20' },
  sent: { label: 'Sent', variant: 'outline', color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 border-green-500/20' },
  accepted: { label: 'Accepted', variant: 'outline', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 border-blue-500/20' },
  declined: { label: 'Declined', variant: 'outline', color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 border-red-500/20' },
  expired: { label: 'Expired', variant: 'outline', color: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400 border-gray-500/20' },
  void: { label: 'Void', variant: 'outline', color: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400 border-gray-500/20' },
};

// Billing unit display labels
export const BILLING_UNIT_LABELS: Record<QuoteBillingUnit, string> = {
  flat: 'Flat Rate',
  per_piece: 'Per Piece',
  per_line_item: 'Per Line Item',
  per_class: 'Per Class',
  per_hour: 'Per Hour',
  per_day: 'Per Day',
};

// Check if quote is editable
export function isQuoteEditable(status: QuoteStatus): boolean {
  return status === 'draft' || status === 'sent';
}

// Check if quote can be voided
export function canVoidQuote(status: QuoteStatus): boolean {
  return true; // Can void at any status
}

// Check if quote can be sent
export function canSendQuote(status: QuoteStatus): boolean {
  return status === 'draft' || status === 'sent';
}

// Check if quote can be accepted (via magic link)
export function canAcceptQuote(quote: Quote): boolean {
  if (quote.status !== 'sent') return false;
  if (quote.expiration_date && new Date(quote.expiration_date) < new Date()) return false;
  return true;
}
