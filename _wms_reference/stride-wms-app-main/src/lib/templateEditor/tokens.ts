// Token definitions for Template Editor
// Used by both Invoice Template Editor and Email Alert Template Editor

export interface Token {
  id: string;
  label: string;
  token: string;
  description: string;
  category: string;
}

// Invoice Template Tokens
export const INVOICE_TOKENS: Token[] = [
  // Company Information
  {
    id: 'company_name',
    label: 'Company Name',
    token: 'company_name',
    description: 'Your company/organization name',
    category: 'Company Information'
  },
  {
    id: 'company_address',
    label: 'Company Address',
    token: 'company_address',
    description: 'Your company street address',
    category: 'Company Information'
  },
  {
    id: 'company_city',
    label: 'Company City',
    token: 'company_city',
    description: 'Your company city',
    category: 'Company Information'
  },
  {
    id: 'company_state',
    label: 'Company State',
    token: 'company_state',
    description: 'Your company state',
    category: 'Company Information'
  },
  {
    id: 'company_zip',
    label: 'Company ZIP',
    token: 'company_zip',
    description: 'Your company ZIP/postal code',
    category: 'Company Information'
  },
  {
    id: 'company_phone',
    label: 'Company Phone',
    token: 'company_phone',
    description: 'Your company phone number',
    category: 'Company Information'
  },
  {
    id: 'company_email',
    label: 'Company Email',
    token: 'company_email',
    description: 'Your company email address',
    category: 'Company Information'
  },
  {
    id: 'company_logo',
    label: 'Company Logo',
    token: 'company_logo',
    description: 'Your company logo URL',
    category: 'Company Information'
  },

  // Invoice Details
  {
    id: 'invoice_number',
    label: 'Invoice Number',
    token: 'invoice_number',
    description: 'The invoice number (e.g., INV-00001)',
    category: 'Invoice Details'
  },
  {
    id: 'invoice_date',
    label: 'Invoice Date',
    token: 'invoice_date',
    description: 'Date the invoice was created',
    category: 'Invoice Details'
  },
  {
    id: 'due_date',
    label: 'Due Date',
    token: 'due_date',
    description: 'Payment due date',
    category: 'Invoice Details'
  },
  {
    id: 'period_start',
    label: 'Period Start',
    token: 'period_start',
    description: 'Billing period start date',
    category: 'Invoice Details'
  },
  {
    id: 'period_end',
    label: 'Period End',
    token: 'period_end',
    description: 'Billing period end date',
    category: 'Invoice Details'
  },
  {
    id: 'payment_terms',
    label: 'Payment Terms',
    token: 'payment_terms',
    description: 'Payment terms (e.g., Net 30)',
    category: 'Invoice Details'
  },

  // Customer Information
  {
    id: 'customer_name',
    label: 'Customer Name',
    token: 'customer_name',
    description: 'Customer/account name',
    category: 'Customer Information'
  },
  {
    id: 'customer_code',
    label: 'Customer Code',
    token: 'customer_code',
    description: 'Customer account code',
    category: 'Customer Information'
  },
  {
    id: 'billing_contact_name',
    label: 'Billing Contact',
    token: 'billing_contact_name',
    description: 'Billing contact name',
    category: 'Customer Information'
  },
  {
    id: 'billing_address',
    label: 'Billing Address',
    token: 'billing_address',
    description: 'Customer billing address',
    category: 'Customer Information'
  },
  {
    id: 'billing_city',
    label: 'Billing City',
    token: 'billing_city',
    description: 'Customer billing city',
    category: 'Customer Information'
  },
  {
    id: 'billing_state',
    label: 'Billing State',
    token: 'billing_state',
    description: 'Customer billing state',
    category: 'Customer Information'
  },
  {
    id: 'billing_zip',
    label: 'Billing ZIP',
    token: 'billing_zip',
    description: 'Customer billing ZIP code',
    category: 'Customer Information'
  },
  {
    id: 'billing_email',
    label: 'Billing Email',
    token: 'billing_email',
    description: 'Customer billing email',
    category: 'Customer Information'
  },
  {
    id: 'sidemark_name',
    label: 'Sidemark Name',
    token: 'sidemark_name',
    description: 'Sidemark/project name',
    category: 'Customer Information'
  },

  // Totals
  {
    id: 'subtotal',
    label: 'Subtotal',
    token: 'subtotal',
    description: 'Invoice subtotal before tax',
    category: 'Totals'
  },
  {
    id: 'tax_amount',
    label: 'Tax Amount',
    token: 'tax_amount',
    description: 'Tax amount',
    category: 'Totals'
  },
  {
    id: 'total_amount',
    label: 'Total Amount',
    token: 'total_amount',
    description: 'Invoice total including tax',
    category: 'Totals'
  },
  {
    id: 'balance_due',
    label: 'Balance Due',
    token: 'balance_due',
    description: 'Outstanding balance',
    category: 'Totals'
  },
  {
    id: 'credits_applied',
    label: 'Credits Applied',
    token: 'credits_applied',
    description: 'Credits applied to invoice',
    category: 'Totals'
  },

  // Special Tokens
  {
    id: 'line_items_table',
    label: 'Line Items Table',
    token: 'line_items_table',
    description: 'Renders the full line items table',
    category: 'Special'
  },
  {
    id: 'current_date',
    label: 'Current Date',
    token: 'current_date',
    description: 'Today\'s date',
    category: 'Special'
  },
  {
    id: 'payment_link',
    label: 'Payment Link',
    token: 'payment_link',
    description: 'Link to online payment portal',
    category: 'Special'
  },
  {
    id: 'invoice_notes',
    label: 'Invoice Notes',
    token: 'invoice_notes',
    description: 'Custom notes for this invoice',
    category: 'Special'
  },
];

// Email Template Tokens
export const EMAIL_TOKENS: Token[] = [
  // Brand Tokens
  {
    id: 'tenant_name',
    label: 'Organization Name',
    token: 'tenant_name',
    description: 'Your organization name',
    category: 'Brand'
  },
  {
    id: 'brand_logo_url',
    label: 'Logo URL',
    token: 'brand_logo_url',
    description: 'Your organization logo URL',
    category: 'Brand'
  },
  {
    id: 'brand_support_email',
    label: 'Support Email',
    token: 'brand_support_email',
    description: 'Support email address',
    category: 'Brand'
  },
  {
    id: 'company_address',
    label: 'Company Address',
    token: 'company_address',
    description: 'Company full address',
    category: 'Brand'
  },
  {
    id: 'company_phone',
    label: 'Company Phone',
    token: 'company_phone',
    description: 'Company phone number',
    category: 'Brand'
  },
  {
    id: 'office_alert_emails',
    label: 'Office Alerts Email(s)',
    token: 'office_alert_emails',
    description: 'Comma-separated office alert email addresses',
    category: 'Brand'
  },
  {
    id: 'office_alert_email_primary',
    label: 'Office Alerts Email (Primary)',
    token: 'office_alert_email_primary',
    description: 'First office alert email address',
    category: 'Brand'
  },

  // Invoice Tokens
  {
    id: 'invoice_number',
    label: 'Invoice Number',
    token: 'invoice_number',
    description: 'The invoice number',
    category: 'Invoice'
  },
  {
    id: 'invoice_date',
    label: 'Invoice Date',
    token: 'invoice_date',
    description: 'Invoice creation date',
    category: 'Invoice'
  },
  {
    id: 'invoice_due_date',
    label: 'Due Date',
    token: 'invoice_due_date',
    description: 'Invoice due date',
    category: 'Invoice'
  },
  {
    id: 'total_amount',
    label: 'Total Amount',
    token: 'total_amount',
    description: 'Invoice total amount',
    category: 'Invoice'
  },
  {
    id: 'paid_amount',
    label: 'Paid Amount',
    token: 'paid_amount',
    description: 'Amount paid',
    category: 'Invoice'
  },
  {
    id: 'balance_due',
    label: 'Balance Due',
    token: 'balance_due',
    description: 'Remaining balance',
    category: 'Invoice'
  },
  {
    id: 'payment_link',
    label: 'Payment Link',
    token: 'payment_link',
    description: 'Link to payment portal',
    category: 'Invoice'
  },
  {
    id: 'invoice_link',
    label: 'Invoice Link',
    token: 'invoice_link',
    description: 'Link to view invoice',
    category: 'Invoice'
  },
  {
    id: 'period_start',
    label: 'Period Start',
    token: 'period_start',
    description: 'Billing period start',
    category: 'Invoice'
  },
  {
    id: 'period_end',
    label: 'Period End',
    token: 'period_end',
    description: 'Billing period end',
    category: 'Invoice'
  },
  {
    id: 'account_name',
    label: 'Account Name',
    token: 'account_name',
    description: 'Customer account name',
    category: 'Invoice'
  },

  // Payment Tokens
  {
    id: 'payment_date',
    label: 'Payment Date',
    token: 'payment_date',
    description: 'Date payment was received',
    category: 'Payment'
  },
  {
    id: 'payment_method',
    label: 'Payment Method',
    token: 'payment_method',
    description: 'Method of payment',
    category: 'Payment'
  },
  {
    id: 'receipt_link',
    label: 'Receipt Link',
    token: 'receipt_link',
    description: 'Link to payment receipt',
    category: 'Payment'
  },

  // Contact Tokens
  {
    id: 'billing_contact_name',
    label: 'Billing Contact',
    token: 'billing_contact_name',
    description: 'Billing contact name',
    category: 'Contact'
  },
  {
    id: 'contact_name',
    label: 'Contact Name',
    token: 'contact_name',
    description: 'Primary contact name',
    category: 'Contact'
  },

  // Shipment Tokens
  {
    id: 'shipment_reference',
    label: 'Shipment Reference',
    token: 'shipment_reference',
    description: 'Shipment reference number',
    category: 'Shipment'
  },
  {
    id: 'tracking_number',
    label: 'Tracking Number',
    token: 'tracking_number',
    description: 'Carrier tracking number',
    category: 'Shipment'
  },
  {
    id: 'carrier_name',
    label: 'Carrier Name',
    token: 'carrier_name',
    description: 'Shipping carrier name',
    category: 'Shipment'
  },
  {
    id: 'ship_date',
    label: 'Ship Date',
    token: 'ship_date',
    description: 'Date shipment was sent',
    category: 'Shipment'
  },
  {
    id: 'item_count',
    label: 'Item Count',
    token: 'item_count',
    description: 'Number of items in shipment',
    category: 'Shipment'
  },
  {
    id: 'tracking_link',
    label: 'Tracking Link',
    token: 'tracking_link',
    description: 'Link to track shipment',
    category: 'Shipment'
  },
  {
    id: 'shipment_link',
    label: 'Shipment Details Link',
    token: 'shipment_link',
    description: 'Link to shipment details',
    category: 'Shipment'
  },

  // Item Tokens
  {
    id: 'item_code',
    label: 'Item Code',
    token: 'item_code',
    description: 'Item identifier code',
    category: 'Item'
  },
  {
    id: 'item_description',
    label: 'Item Description',
    token: 'item_description',
    description: 'Item description',
    category: 'Item'
  },
  {
    id: 'location',
    label: 'Location',
    token: 'location',
    description: 'Item warehouse location',
    category: 'Item'
  },

  // Aggregates
  {
    id: 'items_count',
    label: 'Items Count',
    token: 'items_count',
    description: 'Total number of items',
    category: 'Aggregates'
  },
  {
    id: 'items_table_html',
    label: 'Items Table (HTML)',
    token: 'items_table_html',
    description: 'Formatted HTML table of items with columns',
    category: 'Aggregates'
  },
  {
    id: 'items_list_html',
    label: 'Items List (HTML)',
    token: 'items_list_html',
    description: 'Formatted HTML list of items (card style)',
    category: 'Aggregates'
  },
  {
    id: 'items_list_text',
    label: 'Items List (Text)',
    token: 'items_list_text',
    description: 'Plain text list of items',
    category: 'Aggregates'
  },

  // Task Tokens
  {
    id: 'task_title',
    label: 'Task Title',
    token: 'task_title',
    description: 'Task name/title',
    category: 'Task'
  },
  {
    id: 'task_priority',
    label: 'Task Priority',
    token: 'task_priority',
    description: 'Task priority level',
    category: 'Task'
  },
  {
    id: 'task_due_date',
    label: 'Task Due Date',
    token: 'task_due_date',
    description: 'Task due date',
    category: 'Task'
  },
  {
    id: 'assigned_to',
    label: 'Assigned To',
    token: 'assigned_to',
    description: 'Person task is assigned to',
    category: 'Task'
  },

  // Notes Tokens (Unified Notes Module)
  {
    id: 'shipment_internal_notes',
    label: 'Shipment Internal Notes',
    token: 'shipment.internal_notes',
    description: 'Threaded internal notes for shipment context',
    category: 'Notes'
  },
  {
    id: 'shipment_public_notes',
    label: 'Shipment Public Notes',
    token: 'shipment.public_notes',
    description: 'Threaded public notes for shipment context',
    category: 'Notes'
  },
  {
    id: 'shipment_exception_notes',
    label: 'Shipment Exception Notes',
    token: 'shipment.exception_notes',
    description: 'Threaded exception notes for shipment context',
    category: 'Notes'
  },
  {
    id: 'task_internal_notes',
    label: 'Task Internal Notes',
    token: 'task.internal_notes',
    description: 'Threaded internal notes for task context',
    category: 'Notes'
  },
  {
    id: 'task_public_notes',
    label: 'Task Public Notes',
    token: 'task.public_notes',
    description: 'Threaded public notes for task context',
    category: 'Notes'
  },
  {
    id: 'task_exception_notes',
    label: 'Task Exception Notes',
    token: 'task.exception_notes',
    description: 'Threaded exception notes for task context',
    category: 'Notes'
  },
  {
    id: 'item_internal_notes',
    label: 'Item Internal Notes',
    token: 'item.internal_notes',
    description: 'Threaded internal notes for item context',
    category: 'Notes'
  },
  {
    id: 'item_public_notes',
    label: 'Item Public Notes',
    token: 'item.public_notes',
    description: 'Threaded public notes for item context',
    category: 'Notes'
  },
  {
    id: 'item_exception_notes',
    label: 'Item Exception Notes',
    token: 'item.exception_notes',
    description: 'Threaded exception notes for item context',
    category: 'Notes'
  },
  {
    id: 'claim_internal_notes',
    label: 'Claim Internal Notes',
    token: 'claim.internal_notes',
    description: 'Threaded internal notes for claim context',
    category: 'Notes'
  },
  {
    id: 'claim_public_notes',
    label: 'Claim Public Notes',
    token: 'claim.public_notes',
    description: 'Threaded public notes for claim context',
    category: 'Notes'
  },
  {
    id: 'claim_exception_notes',
    label: 'Claim Exception Notes',
    token: 'claim.exception_notes',
    description: 'Threaded exception notes for claim context',
    category: 'Notes'
  },
  {
    id: 'quote_internal_notes',
    label: 'Quote Internal Notes',
    token: 'quote.internal_notes',
    description: 'Threaded internal notes for quote context',
    category: 'Notes'
  },
  {
    id: 'quote_public_notes',
    label: 'Quote Public Notes',
    token: 'quote.public_notes',
    description: 'Threaded public notes for quote context',
    category: 'Notes'
  },
  {
    id: 'quote_exception_notes',
    label: 'Quote Exception Notes',
    token: 'quote.exception_notes',
    description: 'Threaded exception notes for quote context',
    category: 'Notes'
  },
  {
    id: 'stocktake_internal_notes',
    label: 'Stocktake Internal Notes',
    token: 'stocktake.internal_notes',
    description: 'Threaded internal notes for stocktake context',
    category: 'Notes'
  },
  {
    id: 'stocktake_public_notes',
    label: 'Stocktake Public Notes',
    token: 'stocktake.public_notes',
    description: 'Threaded public notes for stocktake context',
    category: 'Notes'
  },
  {
    id: 'stocktake_exception_notes',
    label: 'Stocktake Exception Notes',
    token: 'stocktake.exception_notes',
    description: 'Threaded exception notes for stocktake context',
    category: 'Notes'
  },
  {
    id: 'repair_quote_internal_notes',
    label: 'Repair Quote Internal Notes',
    token: 'repair_quote.internal_notes',
    description: 'Threaded internal notes for repair quote context',
    category: 'Notes'
  },
  {
    id: 'repair_quote_public_notes',
    label: 'Repair Quote Public Notes',
    token: 'repair_quote.public_notes',
    description: 'Threaded public notes for repair quote context',
    category: 'Notes'
  },
  {
    id: 'repair_quote_exception_notes',
    label: 'Repair Quote Exception Notes',
    token: 'repair_quote.exception_notes',
    description: 'Threaded exception notes for repair quote context',
    category: 'Notes'
  },

  // Claim Tokens
  {
    id: 'claim_reference',
    label: 'Claim Reference',
    token: 'claim_reference',
    description: 'Claim reference number',
    category: 'Claim'
  },
  {
    id: 'claim_amount',
    label: 'Claim Amount',
    token: 'claim_amount',
    description: 'Total claim amount',
    category: 'Claim'
  },
  {
    id: 'offer_amount',
    label: 'Offer Amount',
    token: 'offer_amount',
    description: 'Settlement offer amount',
    category: 'Claim'
  },
  {
    id: 'claim_status',
    label: 'Claim Status',
    token: 'claim_status',
    description: 'Current claim status',
    category: 'Claim'
  },

  // Release Tokens
  {
    id: 'release_number',
    label: 'Release Number',
    token: 'release_number',
    description: 'Release order number',
    category: 'Release'
  },
  {
    id: 'release_items_count',
    label: 'Release Items Count',
    token: 'release_items_count',
    description: 'Number of items included in the release',
    category: 'Release'
  },
  {
    id: 'release_link',
    label: 'Release Link',
    token: 'release_link',
    description: 'Direct link to release details',
    category: 'Release'
  },

  // Employee Tokens
  {
    id: 'employee_name',
    label: 'Employee Name',
    token: 'employee_name',
    description: 'New employee name',
    category: 'Employee'
  },
  {
    id: 'employee_role',
    label: 'Employee Role',
    token: 'employee_role',
    description: 'Employee role/position',
    category: 'Employee'
  },
  {
    id: 'invited_by',
    label: 'Invited By',
    token: 'invited_by',
    description: 'Name of person who sent invite',
    category: 'Employee'
  },
  {
    id: 'invitation_link',
    label: 'Invitation Link',
    token: 'invitation_link',
    description: 'Link to accept invitation',
    category: 'Employee'
  },
  {
    id: 'expiry_date',
    label: 'Expiry Date',
    token: 'expiry_date',
    description: 'Invitation expiry date',
    category: 'Employee'
  },

  // General
  {
    id: 'current_date',
    label: 'Current Date',
    token: 'current_date',
    description: 'Today\'s date',
    category: 'General'
  },
  {
    id: 'subject',
    label: 'Email Subject',
    token: 'subject',
    description: 'Email subject line',
    category: 'General'
  },
];

// Get all unique categories from tokens
export function getTokenCategories(tokens: Token[]): string[] {
  const categories = new Set(tokens.map(t => t.category));
  return Array.from(categories);
}

// Sample data for preview rendering
export const SAMPLE_DATA: Record<string, string> = {
  // Company
  company_name: 'Stride Warehouse Services',
  company_address: '19803 87th Ave S',
  company_city: 'Kent',
  company_state: 'WA',
  company_zip: '98031',
  company_phone: '206-550-1848',
  company_email: 'warehouse@stridenw.com',
  company_logo: '/logo.png',
  office_alert_emails: 'ops@stridenw.com, alerts@stridenw.com',
  office_alert_email_primary: 'ops@stridenw.com',

  // Invoice
  invoice_number: 'INV-00001',
  invoice_date: 'January 30, 2026',
  due_date: 'March 1, 2026',
  invoice_due_date: 'March 1, 2026',
  period_start: 'Jan 1, 2026',
  period_end: 'Jan 31, 2026',
  payment_terms: 'Net 30',
  subtotal: '$1,547.50',
  tax_amount: '$0.00',
  total_amount: '$1,547.50',
  balance_due: '$1,547.50',
  credits_applied: '$0.00',
  paid_amount: '$1,547.50',

  // Customer
  customer_name: 'Acme Corporation',
  customer_code: 'ACME',
  billing_contact_name: 'John Smith',
  billing_address: '123 Business Ave, Suite 400',
  billing_city: 'Seattle',
  billing_state: 'WA',
  billing_zip: '98101',
  billing_email: 'billing@acmecorp.com',
  account_name: 'Acme Corporation',

  // Other
  sidemark_name: 'Project Alpha',
  current_date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
  tenant_name: 'Stride Warehouse Services',
  brand_support_email: 'warehouse@stridenw.com',
  brand_logo_url: '/logo.png',
  payment_link: 'https://pay.example.com',
  invoice_link: 'https://portal.example.com/invoices/123',
  receipt_link: 'https://portal.example.com/receipts/123',
  invoice_notes: 'Thank you for your business!',

  // Payment
  payment_date: 'February 15, 2026',
  payment_method: 'Credit Card',

  // Contact
  contact_name: 'Jane Doe',

  // Shipment
  shipment_reference: 'SHP-2026-001',
  tracking_number: '1Z999AA10123456784',
  carrier_name: 'UPS',
  ship_date: 'February 1, 2026',
  item_count: '5',
  tracking_link: 'https://track.example.com/123',
  shipment_link: 'https://portal.example.com/shipments/123',

  // Item
  item_code: 'ITM-00123',
  item_description: 'Office Chair - Executive Black',
  location: 'A-01-02',

  // Aggregates
  items_count: '5',
  items_table_html: '<table style="width:100%;border-collapse:collapse;"><tr style="background:#f8fafc;"><th style="padding:8px;text-align:left;border-bottom:1px solid #e2e8f0;">Item</th><th style="padding:8px;text-align:left;border-bottom:1px solid #e2e8f0;">Description</th></tr><tr><td style="padding:8px;border-bottom:1px solid #e2e8f0;">ITM-001</td><td style="padding:8px;border-bottom:1px solid #e2e8f0;">Office Chair</td></tr><tr><td style="padding:8px;border-bottom:1px solid #e2e8f0;">ITM-002</td><td style="padding:8px;border-bottom:1px solid #e2e8f0;">Standing Desk</td></tr></table>',
  items_list_html: '<div><div style="padding:8px;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:8px;">ITM-001 - Office Chair</div><div style="padding:8px;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:8px;">ITM-002 - Standing Desk</div></div>',
  items_list_text: '1x Office Chair, 1x Standing Desk',

  // Task
  task_title: 'Inventory Count - Zone A',
  task_priority: 'High',
  task_due_date: 'February 10, 2026',
  assigned_to: 'Mike Johnson',

  // Unified Notes
  'shipment.internal_notes': '<div><strong>Alex Rivera</strong> · Feb 26, 2026 9:14 AM<br/>Carrier called ahead; prioritize unload.</div>',
  'shipment.public_notes': '<div><strong>Alex Rivera</strong> · Feb 26, 2026 9:15 AM<br/>Delivery window confirmed for 10:00 AM.</div>',
  'shipment.exception_notes': '<div><strong>Dock Lead</strong> · Feb 26, 2026 9:22 AM<br/>Pallet wrapping torn on arrival.</div>',
  'task.internal_notes': '<div><strong>Jamie Chen</strong> · Feb 26, 2026 11:05 AM<br/>@warehouse_guy please verify hardware count.</div>',
  'task.public_notes': '<div><strong>Jamie Chen</strong> · Feb 26, 2026 11:11 AM<br/>Task in progress; update expected by EOD.</div>',
  'task.exception_notes': '',
  'item.internal_notes': '<div><strong>Receiving</strong> · Feb 26, 2026 12:02 PM<br/>Linked from Task TSK-00123 for follow-up.</div>',
  'item.public_notes': '<div><strong>Receiving</strong> · Feb 26, 2026 12:04 PM<br/>Packaging verified and documented.</div>',
  'item.exception_notes': '',
  'claim.internal_notes': '<div><strong>Claims Team</strong> · Feb 26, 2026 1:18 PM<br/>Pending manager approval.</div>',
  'claim.public_notes': '<div><strong>Claims Team</strong> · Feb 26, 2026 1:22 PM<br/>We are reviewing your claim details.</div>',
  'claim.exception_notes': '',
  'quote.internal_notes': '<div><strong>Estimator</strong> · Feb 26, 2026 2:10 PM<br/>Awaiting labor confirmation.</div>',
  'quote.public_notes': '<div><strong>Estimator</strong> · Feb 26, 2026 2:12 PM<br/>Estimate draft is ready for review.</div>',
  'quote.exception_notes': '',
  'stocktake.internal_notes': '<div><strong>Cycle Count</strong> · Feb 26, 2026 3:30 PM<br/>Variance flagged for aisle B.</div>',
  'stocktake.public_notes': '',
  'stocktake.exception_notes': '',
  'repair_quote.internal_notes': '<div><strong>Repair Team</strong> · Feb 26, 2026 4:05 PM<br/>Need replacement caster kit.</div>',
  'repair_quote.public_notes': '<div><strong>Repair Team</strong> · Feb 26, 2026 4:11 PM<br/>Quote sent to client for approval.</div>',
  'repair_quote.exception_notes': '',

  // Claim
  claim_reference: 'CLM-2026-001',
  claim_amount: '$500.00',
  offer_amount: '$450.00',
  claim_status: 'Under Review',

  // Release
  release_number: 'REL-2026-001',
  release_items_count: '12',
  release_link: 'https://portal.example.com/releases/123',

  // Employee
  employee_name: 'Sarah Williams',
  employee_role: 'Warehouse Associate',
  invited_by: 'Admin User',
  invitation_link: 'https://portal.example.com/invite/abc123',
  expiry_date: 'February 7, 2026',

  // Email
  subject: 'Your Invoice is Ready',

  // Line items table placeholder
  line_items_table: '<table style="width:100%;border-collapse:collapse;"><thead><tr style="background:#f8fafc;"><th style="padding:12px;text-align:left;border-bottom:2px solid #e2e8f0;">#</th><th style="padding:12px;text-align:left;border-bottom:2px solid #e2e8f0;">Date</th><th style="padding:12px;text-align:left;border-bottom:2px solid #e2e8f0;">Service</th><th style="padding:12px;text-align:left;border-bottom:2px solid #e2e8f0;">Description</th><th style="padding:12px;text-align:right;border-bottom:2px solid #e2e8f0;">Qty</th><th style="padding:12px;text-align:right;border-bottom:2px solid #e2e8f0;">Rate</th><th style="padding:12px;text-align:right;border-bottom:2px solid #e2e8f0;">Total</th></tr></thead><tbody><tr><td style="padding:12px;border-bottom:1px solid #e2e8f0;">1</td><td style="padding:12px;border-bottom:1px solid #e2e8f0;">Jan 15, 2026</td><td style="padding:12px;border-bottom:1px solid #e2e8f0;">Storage</td><td style="padding:12px;border-bottom:1px solid #e2e8f0;">Monthly storage - Zone A</td><td style="padding:12px;text-align:right;border-bottom:1px solid #e2e8f0;">50</td><td style="padding:12px;text-align:right;border-bottom:1px solid #e2e8f0;">$15.00</td><td style="padding:12px;text-align:right;border-bottom:1px solid #e2e8f0;">$750.00</td></tr><tr><td style="padding:12px;border-bottom:1px solid #e2e8f0;">2</td><td style="padding:12px;border-bottom:1px solid #e2e8f0;">Jan 20, 2026</td><td style="padding:12px;border-bottom:1px solid #e2e8f0;">Handling</td><td style="padding:12px;border-bottom:1px solid #e2e8f0;">Inbound handling</td><td style="padding:12px;text-align:right;border-bottom:1px solid #e2e8f0;">25</td><td style="padding:12px;text-align:right;border-bottom:1px solid #e2e8f0;">$5.50</td><td style="padding:12px;text-align:right;border-bottom:1px solid #e2e8f0;">$137.50</td></tr><tr><td style="padding:12px;border-bottom:1px solid #e2e8f0;">3</td><td style="padding:12px;border-bottom:1px solid #e2e8f0;">Jan 25, 2026</td><td style="padding:12px;border-bottom:1px solid #e2e8f0;">Shipping</td><td style="padding:12px;border-bottom:1px solid #e2e8f0;">Outbound shipping - UPS Ground</td><td style="padding:12px;text-align:right;border-bottom:1px solid #e2e8f0;">10</td><td style="padding:12px;text-align:right;border-bottom:1px solid #e2e8f0;">$66.00</td><td style="padding:12px;text-align:right;border-bottom:1px solid #e2e8f0;">$660.00</td></tr></tbody></table>',
};

// Render template with token replacement
export function renderTemplate(html: string, tokens: Token[], data?: Record<string, string>): string {
  let rendered = html;
  const sampleData = data || SAMPLE_DATA;
  const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  tokens.forEach(token => {
    const regex = new RegExp(`\\{\\{${escapeRegExp(token.token)}\\}\\}`, 'g');
    rendered = rendered.replace(regex, sampleData[token.token] || `[${token.label}]`);
  });

  return rendered;
}
