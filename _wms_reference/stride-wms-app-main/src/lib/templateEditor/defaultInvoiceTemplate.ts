// Default Invoice Template HTML
// This is the starting template for new invoice templates

export const DEFAULT_INVOICE_TEMPLATE = `
<div style="font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1e293b; max-width: 8.5in; margin: 0 auto;">
  <!-- Header -->
  <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; padding-bottom: 24px; border-bottom: 2px solid #e2e8f0;">
    <div>
      <h1 style="margin: 0 0 8px 0; font-size: 28px; font-weight: 700; color: #E85D2D;">INVOICE</h1>
      <p style="margin: 0; font-size: 14px; color: #64748b;">{{invoice_number}}</p>
    </div>
    <div style="text-align: right;">
      <h2 style="margin: 0 0 4px 0; font-size: 18px; font-weight: 600;">{{company_name}}</h2>
      <p style="margin: 0; font-size: 13px; color: #64748b; line-height: 1.5;">
        {{company_address}}<br/>
        {{company_city}}, {{company_state}} {{company_zip}}<br/>
        {{company_phone}}<br/>
        {{company_email}}
      </p>
    </div>
  </div>

  <!-- Bill To / Invoice Info -->
  <div style="display: flex; justify-content: space-between; margin-bottom: 32px;">
    <div style="flex: 1;">
      <h3 style="margin: 0 0 8px 0; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; color: #64748b;">Bill To</h3>
      <p style="margin: 0; font-size: 14px; line-height: 1.6;">
        <strong>{{customer_name}}</strong><br/>
        {{billing_contact_name}}<br/>
        {{billing_address}}<br/>
        {{billing_city}}, {{billing_state}} {{billing_zip}}
      </p>
    </div>
    <div style="width: 240px;">
      <table style="width: 100%; font-size: 13px;">
        <tr>
          <td style="padding: 6px 0; color: #64748b;">Invoice Date:</td>
          <td style="padding: 6px 0; text-align: right; font-weight: 500;">{{invoice_date}}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748b;">Due Date:</td>
          <td style="padding: 6px 0; text-align: right; font-weight: 500;">{{due_date}}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748b;">Terms:</td>
          <td style="padding: 6px 0; text-align: right; font-weight: 500;">{{payment_terms}}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748b;">Period:</td>
          <td style="padding: 6px 0; text-align: right; font-weight: 500;">{{period_start}} - {{period_end}}</td>
        </tr>
      </table>
    </div>
  </div>

  <!-- Line Items Table -->
  <div style="margin-bottom: 32px;">
    {{line_items_table}}
  </div>

  <!-- Totals -->
  <div style="display: flex; justify-content: flex-end; margin-bottom: 32px;">
    <div style="width: 280px;">
      <table style="width: 100%; font-size: 14px;">
        <tr>
          <td style="padding: 8px 0; color: #64748b;">Subtotal:</td>
          <td style="padding: 8px 0; text-align: right;">{{subtotal}}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #64748b;">Tax:</td>
          <td style="padding: 8px 0; text-align: right;">{{tax_amount}}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #64748b;">Credits Applied:</td>
          <td style="padding: 8px 0; text-align: right;">{{credits_applied}}</td>
        </tr>
        <tr style="border-top: 2px solid #e2e8f0;">
          <td style="padding: 12px 0 8px; font-weight: 700; font-size: 16px;">Total Due:</td>
          <td style="padding: 12px 0 8px; text-align: right; font-weight: 700; font-size: 18px; color: #E85D2D;">{{balance_due}}</td>
        </tr>
      </table>
    </div>
  </div>

  <!-- Payment Info -->
  <div style="background: #f8fafc; border-radius: 8px; padding: 20px; margin-bottom: 32px;">
    <h3 style="margin: 0 0 12px 0; font-size: 14px; font-weight: 600;">Payment Information</h3>
    <p style="margin: 0; font-size: 13px; color: #475569; line-height: 1.6;">
      Please make checks payable to <strong>{{company_name}}</strong><br/>
      For questions about this invoice, contact us at {{company_email}}
    </p>
  </div>

  <!-- Notes -->
  <div style="margin-bottom: 32px;">
    <h3 style="margin: 0 0 8px 0; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; color: #64748b;">Notes</h3>
    <p style="margin: 0; font-size: 13px; color: #475569; line-height: 1.5;">
      {{invoice_notes}}
    </p>
  </div>

  <!-- Footer -->
  <div style="text-align: center; padding-top: 24px; border-top: 1px solid #e2e8f0;">
    <p style="margin: 0; font-size: 12px; color: #94a3b8;">
      Thank you for your business!
    </p>
  </div>
</div>
`;

// Default template settings
export const DEFAULT_INVOICE_TEMPLATE_SETTINGS = {
  colors: {
    primary: '#E85D2D',
    secondary: '#1E293B',
    accent: '#64748B',
  },
  typography: {
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
    baseFontSize: '14px',
  },
  tableColumns: [
    { id: 'rowNumber', label: '#', enabled: true, width: '40px' },
    { id: 'date', label: 'Date', enabled: true, width: '100px' },
    { id: 'chargeType', label: 'Service', enabled: true, width: '120px' },
    { id: 'description', label: 'Description', enabled: true, width: 'auto' },
    { id: 'quantity', label: 'Qty', enabled: true, width: '60px' },
    { id: 'unitRate', label: 'Rate', enabled: true, width: '80px' },
    { id: 'total', label: 'Total', enabled: true, width: '100px' },
    { id: 'sidemark', label: 'Sidemark', enabled: false, width: '120px' },
    { id: 'itemCode', label: 'Item Code', enabled: false, width: '100px' },
  ],
  pageSetup: {
    pageSize: 'letter', // 8.5" x 11"
    orientation: 'portrait',
    margins: {
      top: '0.75in',
      right: '0.75in',
      bottom: '0.75in',
      left: '0.75in',
    },
  },
  contentOptions: {
    showLogo: true,
    showRemitTo: true,
    showPaymentTerms: true,
    showPaymentLink: true,
    showNotes: true,
    showTerms: false,
  },
};

// Alternative simple template
export const SIMPLE_INVOICE_TEMPLATE = `
<div style="font-family: Arial, sans-serif; color: #333; max-width: 8.5in; margin: 0 auto; padding: 20px;">
  <h1 style="color: #E85D2D; margin-bottom: 20px;">Invoice {{invoice_number}}</h1>

  <div style="margin-bottom: 20px;">
    <strong>From:</strong> {{company_name}}<br/>
    <strong>To:</strong> {{customer_name}}<br/>
    <strong>Date:</strong> {{invoice_date}}<br/>
    <strong>Due:</strong> {{due_date}}
  </div>

  {{line_items_table}}

  <div style="text-align: right; margin-top: 20px;">
    <strong>Total Due: {{balance_due}}</strong>
  </div>
</div>
`;
