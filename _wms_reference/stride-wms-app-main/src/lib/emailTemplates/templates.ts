// Stride WMS Email Templates
// All 23 branded email templates with orange theme (#E85D2D)

export interface EmailTemplate {
  key: string;
  name: string;
  subject: string;
  html: string;
  text: string;
}

// Email wrapper with consistent styling
const emailWrapper = (content: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{subject}}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
          ${content}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

// Email header with badge
type BadgeStyle = 'info' | 'success' | 'warning' | 'error' | 'purple';

const emailHeader = (badgeText: string, badgeStyle: BadgeStyle = 'info') => {
  const badgeColors: Record<BadgeStyle, string> = {
    info: 'background:#dbeafe;color:#1e40af;',
    success: 'background:#dcfce7;color:#166534;',
    warning: 'background:#fef3c7;color:#92400e;',
    error: 'background:#fee2e2;color:#991b1b;',
    purple: 'background:#e9d5ff;color:#7c3aed;',
  };

  return `
  <tr>
    <td style="background:#E85D2D;border-radius:12px 12px 0 0;padding:24px 32px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td>
            <img src="{{brand_logo_url}}" alt="{{tenant_name}}" style="height:32px;max-width:150px;" />
          </td>
          <td align="right">
            <span style="display:inline-block;padding:6px 14px;border-radius:20px;font-size:11px;font-weight:600;text-transform:uppercase;${badgeColors[badgeStyle]}">
              ${badgeText}
            </span>
          </td>
        </tr>
      </table>
    </td>
  </tr>
`;
};

const emailFooter = () => `
  <tr>
    <td style="background:#f8fafc;border-radius:0 0 12px 12px;padding:24px 32px;text-align:center;border-top:1px solid #e2e8f0;">
      <p style="margin:0 0 4px;font-size:14px;font-weight:600;color:#1e293b;">{{tenant_name}}</p>
      <p style="margin:0 0 8px;font-size:12px;color:#64748b;">{{company_address}}</p>
      <p style="margin:0;font-size:12px;">
        <a href="mailto:{{brand_support_email}}" style="color:#E85D2D;text-decoration:none;">{{brand_support_email}}</a>
        <span style="color:#94a3b8;"> • </span>
        <span style="color:#64748b;">{{company_phone}}</span>
      </p>
    </td>
  </tr>
`;

const primaryButton = (text: string, url: string) => `
  <a href="${url}" style="display:inline-block;padding:14px 28px;background:#E85D2D;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px;">${text}</a>
`;

const secondaryButton = (text: string, url: string) => `
  <a href="${url}" style="display:inline-block;padding:14px 28px;background:#ffffff;color:#1e293b;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px;border:2px solid #e2e8f0;">${text}</a>
`;

// ==================== INVOICE SENT ====================
export const INVOICE_SENT: EmailTemplate = {
  key: 'INVOICE_SENT',
  name: 'Invoice Sent',
  subject: 'Invoice {{invoice_number}} - Payment due {{invoice_due_date}}',
  html: emailWrapper(`
    ${emailHeader('Invoice', 'info')}
    <tr>
      <td style="background:#ffffff;padding:40px 32px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="padding-bottom:20px;">
              <div style="width:64px;height:64px;background:#fed7aa;border-radius:50%;line-height:64px;text-align:center;font-size:28px;">💰</div>
            </td>
          </tr>
          <tr>
            <td align="center">
              <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#1e293b;">Your Invoice is Ready</h1>
              <p style="margin:0 0 24px;font-size:15px;color:#64748b;">Payment due {{invoice_due_date}}</p>
            </td>
          </tr>
          <tr>
            <td>
              <p style="margin:0 0 16px;font-size:15px;color:#475569;">Dear {{billing_contact_name}},</p>
              <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.6;">Your invoice for warehouse services has been generated and is ready for payment.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-bottom:16px;border-bottom:1px solid #e2e8f0;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td>
                          <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Invoice Number</p>
                          <p style="margin:4px 0 0;font-size:18px;font-weight:700;color:#1e293b;">{{invoice_number}}</p>
                        </td>
                        <td align="right">
                          <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:1px;">Amount Due</p>
                          <p style="margin:4px 0 0;font-size:24px;font-weight:700;color:#E85D2D;">{{total_amount}}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding-top:16px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td width="50%" style="padding-right:8px;">
                          <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;font-weight:600;">Invoice Date</p>
                          <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#1e293b;">{{invoice_date}}</p>
                        </td>
                        <td width="50%" style="padding-left:8px;">
                          <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;font-weight:600;">Due Date</p>
                          <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#1e293b;">{{invoice_due_date}}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:28px 0;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-right:6px;">
                    ${primaryButton('Pay Now', '{{payment_link}}')}
                  </td>
                  <td style="padding-left:6px;">
                    ${secondaryButton('View Invoice', '{{invoice_link}}')}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    ${emailFooter()}
  `),
  text: `Your Invoice is Ready

Dear {{billing_contact_name}},

Your invoice for warehouse services has been generated and is ready for payment.

Invoice Number: {{invoice_number}}
Invoice Date: {{invoice_date}}
Due Date: {{invoice_due_date}}
Amount Due: {{total_amount}}

View Invoice: {{invoice_link}}
Pay Now: {{payment_link}}

Thank you,
{{tenant_name}}`
};

// ==================== INVOICE CREATED ====================
export const INVOICE_CREATED: EmailTemplate = {
  key: 'INVOICE_CREATED',
  name: 'Invoice Created',
  subject: 'Invoice {{invoice_number}} Created',
  html: INVOICE_SENT.html,
  text: INVOICE_SENT.text
};

// ==================== PAYMENT RECEIVED ====================
export const PAYMENT_RECEIVED: EmailTemplate = {
  key: 'PAYMENT_RECEIVED',
  name: 'Payment Received',
  subject: 'Payment Received - {{invoice_number}}',
  html: emailWrapper(`
    ${emailHeader('Payment', 'success')}
    <tr>
      <td style="background:#ffffff;padding:40px 32px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="padding-bottom:20px;">
              <div style="width:64px;height:64px;background:#dcfce7;border-radius:50%;line-height:64px;text-align:center;font-size:28px;">✓</div>
            </td>
          </tr>
          <tr>
            <td align="center">
              <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#1e293b;">Payment Received</h1>
              <p style="margin:0 0 24px;font-size:15px;color:#64748b;">Thank you for your payment</p>
            </td>
          </tr>
          <tr>
            <td>
              <p style="margin:0 0 16px;font-size:15px;color:#475569;">Dear {{billing_contact_name}},</p>
              <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.6;">We have received your payment. Thank you for your prompt attention to this invoice.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-bottom:16px;border-bottom:1px solid #e2e8f0;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td>
                          <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;font-weight:600;">Invoice Number</p>
                          <p style="margin:4px 0 0;font-size:18px;font-weight:700;color:#1e293b;">{{invoice_number}}</p>
                        </td>
                        <td align="right">
                          <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;">Amount Paid</p>
                          <p style="margin:4px 0 0;font-size:24px;font-weight:700;color:#166534;">{{paid_amount}}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding-top:16px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td width="50%">
                          <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;font-weight:600;">Payment Date</p>
                          <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#1e293b;">{{payment_date}}</p>
                        </td>
                        <td width="50%">
                          <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;font-weight:600;">Payment Method</p>
                          <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#1e293b;">{{payment_method}}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding-top:28px;">
              ${primaryButton('View Receipt', '{{receipt_link}}')}
            </td>
          </tr>
        </table>
      </td>
    </tr>
    ${emailFooter()}
  `),
  text: `Payment Received

Dear {{billing_contact_name}},

We have received your payment. Thank you for your prompt attention to this invoice.

Invoice: {{invoice_number}}
Amount Paid: {{paid_amount}}
Payment Date: {{payment_date}}
Payment Method: {{payment_method}}

View Receipt: {{receipt_link}}

Thank you,
{{tenant_name}}`
};

// ==================== SHIPMENT RECEIVED ====================
export const SHIPMENT_RECEIVED: EmailTemplate = {
  key: 'SHIPMENT_RECEIVED',
  name: 'Shipment Received',
  subject: 'Shipment {{shipment_reference}} Received',
  html: emailWrapper(`
    ${emailHeader('Received', 'success')}
    <tr>
      <td style="background:#ffffff;padding:40px 32px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="padding-bottom:20px;">
              <div style="width:64px;height:64px;background:#dcfce7;border-radius:50%;line-height:64px;text-align:center;font-size:28px;">📦</div>
            </td>
          </tr>
          <tr>
            <td align="center">
              <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#1e293b;">Shipment Received</h1>
              <p style="margin:0 0 24px;font-size:15px;color:#64748b;">Your shipment has arrived at our facility</p>
            </td>
          </tr>
          <tr>
            <td>
              <p style="margin:0 0 16px;font-size:15px;color:#475569;">Dear {{contact_name}},</p>
              <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.6;">We have received your inbound shipment at our warehouse and it has been checked in.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-bottom:16px;border-bottom:1px solid #e2e8f0;">
                    <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;font-weight:600;">Shipment Reference</p>
                    <p style="margin:4px 0 0;font-size:18px;font-weight:700;color:#1e293b;">{{shipment_reference}}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding-top:16px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td width="50%">
                          <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;font-weight:600;">Received Date</p>
                          <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#1e293b;">{{ship_date}}</p>
                        </td>
                        <td width="50%">
                          <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;font-weight:600;">Items Received</p>
                          <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#1e293b;">{{item_count}} items</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding-top:28px;">
              ${primaryButton('View Details', '{{shipment_link}}')}
            </td>
          </tr>
        </table>
      </td>
    </tr>
    ${emailFooter()}
  `),
  text: `Shipment Received

Dear {{contact_name}},

We have received your inbound shipment at our warehouse.

Shipment Reference: {{shipment_reference}}
Received Date: {{ship_date}}
Items Received: {{item_count}} items

View Details: {{shipment_link}}

Thank you,
{{tenant_name}}`
};

// ==================== SHIPMENT COMPLETED ====================
export const SHIPMENT_COMPLETED: EmailTemplate = {
  key: 'SHIPMENT_COMPLETED',
  name: 'Shipment Completed',
  subject: 'Shipment {{shipment_reference}} has been shipped',
  html: emailWrapper(`
    ${emailHeader('Completed', 'success')}
    <tr>
      <td style="background:#ffffff;padding:40px 32px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="padding-bottom:20px;">
              <div style="width:64px;height:64px;background:#dcfce7;border-radius:50%;line-height:64px;text-align:center;font-size:28px;">✅</div>
            </td>
          </tr>
          <tr>
            <td align="center">
              <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#1e293b;">Shipment Completed</h1>
              <p style="margin:0 0 24px;font-size:15px;color:#64748b;">Your shipment is on its way</p>
            </td>
          </tr>
          <tr>
            <td>
              <p style="margin:0 0 16px;font-size:15px;color:#475569;">Dear {{contact_name}},</p>
              <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.6;">Your outbound shipment has been completed and is on its way to the destination.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-bottom:16px;border-bottom:1px solid #e2e8f0;">
                    <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;font-weight:600;">Shipment Reference</p>
                    <p style="margin:4px 0 0;font-size:18px;font-weight:700;color:#1e293b;">{{shipment_reference}}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding-top:16px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td width="50%">
                          <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;font-weight:600;">Ship Date</p>
                          <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#1e293b;">{{ship_date}}</p>
                        </td>
                        <td width="50%">
                          <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;font-weight:600;">Carrier</p>
                          <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#1e293b;">{{carrier_name}}</p>
                        </td>
                      </tr>
                      <tr>
                        <td width="50%" style="padding-top:16px;">
                          <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;font-weight:600;">Tracking #</p>
                          <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#E85D2D;">{{tracking_number}}</p>
                        </td>
                        <td width="50%" style="padding-top:16px;">
                          <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;font-weight:600;">Items Shipped</p>
                          <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#1e293b;">{{item_count}} items</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:28px 0;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-right:6px;">
                    ${primaryButton('Track Shipment', '{{tracking_link}}')}
                  </td>
                  <td style="padding-left:6px;">
                    ${secondaryButton('View Details', '{{shipment_link}}')}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    ${emailFooter()}
  `),
  text: `Shipment Completed

Dear {{contact_name}},

Your outbound shipment has been completed and is on its way.

Shipment Reference: {{shipment_reference}}
Ship Date: {{ship_date}}
Carrier: {{carrier_name}}
Tracking #: {{tracking_number}}
Items Shipped: {{item_count}} items

Track Shipment: {{tracking_link}}

Thank you,
{{tenant_name}}`
};

// ==================== SHIPMENT STATUS CHANGED ====================
export const SHIPMENT_STATUS_CHANGED: EmailTemplate = {
  key: 'SHIPMENT_STATUS_CHANGED',
  name: 'Shipment Status Update',
  subject: 'Shipment {{shipment_reference}} Status Update',
  html: SHIPMENT_COMPLETED.html.replace('Shipment Completed', 'Status Update').replace('Your shipment is on its way', 'Your shipment status has changed'),
  text: SHIPMENT_COMPLETED.text.replace('Shipment Completed', 'Shipment Status Update')
};

// ==================== ITEM RECEIVED ====================
export const ITEM_RECEIVED: EmailTemplate = {
  key: 'ITEM_RECEIVED',
  name: 'Item Received',
  subject: 'Item {{item_code}} Received',
  html: emailWrapper(`
    ${emailHeader('Received', 'success')}
    <tr>
      <td style="background:#ffffff;padding:40px 32px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="padding-bottom:20px;">
              <div style="width:64px;height:64px;background:#dcfce7;border-radius:50%;line-height:64px;text-align:center;font-size:28px;">📦</div>
            </td>
          </tr>
          <tr>
            <td align="center">
              <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#1e293b;">Item Received</h1>
              <p style="margin:0 0 24px;font-size:15px;color:#64748b;">Your item has been checked into inventory</p>
            </td>
          </tr>
          <tr>
            <td>
              <p style="margin:0 0 16px;font-size:15px;color:#475569;">Dear {{contact_name}},</p>
              <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.6;">The following item has been received and added to your inventory.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;font-weight:600;">Item Code</p>
                    <p style="margin:4px 0 0;font-size:18px;font-weight:700;color:#1e293b;">{{item_code}}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding-top:16px;">
                    <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;font-weight:600;">Description</p>
                    <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#1e293b;">{{item_description}}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding-top:16px;">
                    <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;font-weight:600;">Location</p>
                    <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#E85D2D;">{{location}}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    ${emailFooter()}
  `),
  text: `Item Received

Dear {{contact_name}},

The following item has been received and added to your inventory.

Item Code: {{item_code}}
Description: {{item_description}}
Location: {{location}}

Thank you,
{{tenant_name}}`
};

// ==================== ITEM DAMAGED ====================
export const ITEM_DAMAGED: EmailTemplate = {
  key: 'ITEM_DAMAGED',
  name: 'Item Damaged',
  subject: 'Item Damage Report - {{item_code}}',
  html: emailWrapper(`
    ${emailHeader('Damage Report', 'error')}
    <tr>
      <td style="background:#ffffff;padding:40px 32px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="padding-bottom:20px;">
              <div style="width:64px;height:64px;background:#fee2e2;border-radius:50%;line-height:64px;text-align:center;font-size:28px;">⚠️</div>
            </td>
          </tr>
          <tr>
            <td align="center">
              <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#1e293b;">Item Damage Reported</h1>
              <p style="margin:0 0 24px;font-size:15px;color:#64748b;">Damage has been noted on one of your items</p>
            </td>
          </tr>
          <tr>
            <td>
              <p style="margin:0 0 16px;font-size:15px;color:#475569;">Dear {{contact_name}},</p>
              <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.6;">We are notifying you that damage has been reported on the following item in your inventory.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px;background:#fef2f2;border:1px solid #fecaca;border-radius:12px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <p style="margin:0;font-size:11px;color:#991b1b;text-transform:uppercase;font-weight:600;">Item Code</p>
                    <p style="margin:4px 0 0;font-size:18px;font-weight:700;color:#1e293b;">{{item_code}}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding-top:16px;">
                    <p style="margin:0;font-size:11px;color:#991b1b;text-transform:uppercase;font-weight:600;">Description</p>
                    <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#1e293b;">{{item_description}}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding-top:16px;">
                    <p style="margin:0;font-size:11px;color:#991b1b;text-transform:uppercase;font-weight:600;">Location</p>
                    <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#1e293b;">{{location}}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding-top:24px;">
              <p style="margin:0;font-size:13px;color:#64748b;text-align:center;">Please contact us if you have any questions about this damage report.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    ${emailFooter()}
  `),
  text: `Item Damage Reported

Dear {{contact_name}},

We are notifying you that damage has been reported on the following item.

Item Code: {{item_code}}
Description: {{item_description}}
Location: {{location}}

Please contact us if you have any questions.

Thank you,
{{tenant_name}}`
};

// ==================== ITEM LOCATION CHANGED ====================
export const ITEM_LOCATION_CHANGED: EmailTemplate = {
  key: 'ITEM_LOCATION_CHANGED',
  name: 'Item Location Changed',
  subject: 'Item {{item_code}} Location Update',
  html: ITEM_RECEIVED.html.replace('Item Received', 'Location Updated').replace('Your item has been checked into inventory', 'Your item has been moved to a new location'),
  text: ITEM_RECEIVED.text.replace('Item Received', 'Item Location Changed')
};

// ==================== RELEASE CREATED ====================
export const RELEASE_CREATED: EmailTemplate = {
  key: 'RELEASE_CREATED',
  name: 'Release Created',
  subject: 'Release Order {{release_number}} Created',
  html: emailWrapper(`
    ${emailHeader('Release', 'info')}
    <tr>
      <td style="background:#ffffff;padding:40px 32px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="padding-bottom:20px;">
              <div style="width:64px;height:64px;background:#dbeafe;border-radius:50%;line-height:64px;text-align:center;font-size:28px;">📋</div>
            </td>
          </tr>
          <tr>
            <td align="center">
              <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#1e293b;">Release Order Created</h1>
              <p style="margin:0 0 24px;font-size:15px;color:#64748b;">A new release order has been created</p>
            </td>
          </tr>
          <tr>
            <td>
              <p style="margin:0 0 16px;font-size:15px;color:#475569;">Dear {{contact_name}},</p>
              <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.6;">A release order has been created for items in your inventory.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">
              <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;font-weight:600;">Release Number</p>
              <p style="margin:4px 0 0;font-size:18px;font-weight:700;color:#1e293b;">{{release_number}}</p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding-top:28px;">
              ${primaryButton('View Release', '{{release_link}}')}
            </td>
          </tr>
        </table>
      </td>
    </tr>
    ${emailFooter()}
  `),
  text: `Release Order Created

Dear {{contact_name}},

A release order has been created for items in your inventory.

Release Number: {{release_number}}

View Release: {{release_link}}

Thank you,
{{tenant_name}}`
};

// ==================== RELEASE APPROVED ====================
export const RELEASE_APPROVED: EmailTemplate = {
  key: 'RELEASE_APPROVED',
  name: 'Release Approved',
  subject: 'Release Order {{release_number}} Approved',
  html: RELEASE_CREATED.html.replace('Release Order Created', 'Release Approved').replace('A new release order has been created', 'Your release order has been approved'),
  text: RELEASE_CREATED.text.replace('Release Order Created', 'Release Approved')
};

// ==================== RELEASE COMPLETED ====================
export const RELEASE_COMPLETED: EmailTemplate = {
  key: 'RELEASE_COMPLETED',
  name: 'Release Completed',
  subject: 'Release Order {{release_number}} Completed',
  html: RELEASE_CREATED.html.replace('Release Order Created', 'Release Completed').replace('A new release order has been created', 'Your release order has been completed'),
  text: RELEASE_CREATED.text.replace('Release Order Created', 'Release Completed')
};

// ==================== TASK CREATED ====================
export const TASK_CREATED: EmailTemplate = {
  key: 'TASK_CREATED',
  name: 'Task Created',
  subject: 'New Task: {{task_title}}',
  html: emailWrapper(`
    ${emailHeader('Task', 'info')}
    <tr>
      <td style="background:#ffffff;padding:40px 32px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="padding-bottom:20px;">
              <div style="width:64px;height:64px;background:#dbeafe;border-radius:50%;line-height:64px;text-align:center;font-size:28px;">📝</div>
            </td>
          </tr>
          <tr>
            <td align="center">
              <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#1e293b;">New Task Created</h1>
              <p style="margin:0 0 24px;font-size:15px;color:#64748b;">A new task has been created</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;font-weight:600;">Task</p>
                    <p style="margin:4px 0 0;font-size:18px;font-weight:700;color:#1e293b;">{{task_title}}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding-top:16px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td width="50%">
                          <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;font-weight:600;">Priority</p>
                          <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#E85D2D;">{{task_priority}}</p>
                        </td>
                        <td width="50%">
                          <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;font-weight:600;">Due Date</p>
                          <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#1e293b;">{{task_due_date}}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    ${emailFooter()}
  `),
  text: `New Task Created

A new task has been created.

Task: {{task_title}}
Priority: {{task_priority}}
Due Date: {{task_due_date}}

Thank you,
{{tenant_name}}`
};

// ==================== TASK ASSIGNED ====================
export const TASK_ASSIGNED: EmailTemplate = {
  key: 'TASK_ASSIGNED',
  name: 'Task Assigned',
  subject: 'Task Assigned: {{task_title}}',
  html: TASK_CREATED.html.replace('New Task Created', 'Task Assigned').replace('A new task has been created', 'A task has been assigned to you'),
  text: TASK_CREATED.text.replace('New Task Created', 'Task Assigned to You')
};

// ==================== TASK COMPLETED ====================
export const TASK_COMPLETED: EmailTemplate = {
  key: 'TASK_COMPLETED',
  name: 'Task Completed',
  subject: 'Task Completed: {{task_title}}',
  html: emailWrapper(`
    ${emailHeader('Completed', 'success')}
    <tr>
      <td style="background:#ffffff;padding:40px 32px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="padding-bottom:20px;">
              <div style="width:64px;height:64px;background:#dcfce7;border-radius:50%;line-height:64px;text-align:center;font-size:28px;">✅</div>
            </td>
          </tr>
          <tr>
            <td align="center">
              <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#1e293b;">Task Completed</h1>
              <p style="margin:0 0 24px;font-size:15px;color:#64748b;">{{task_title}}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    ${emailFooter()}
  `),
  text: `Task Completed

Task: {{task_title}}

Thank you,
{{tenant_name}}`
};

// ==================== CLAIM TEMPLATES ====================
export const CLAIM_ATTACHMENT_ADDED: EmailTemplate = {
  key: 'CLAIM_ATTACHMENT_ADDED',
  name: 'Claim Attachment Added',
  subject: 'New Attachment - Claim {{claim_reference}}',
  html: emailWrapper(`
    ${emailHeader('Claim', 'info')}
    <tr>
      <td style="background:#ffffff;padding:40px 32px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="padding-bottom:20px;">
              <div style="width:64px;height:64px;background:#dbeafe;border-radius:50%;line-height:64px;text-align:center;font-size:28px;">📎</div>
            </td>
          </tr>
          <tr>
            <td align="center">
              <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#1e293b;">New Attachment Added</h1>
              <p style="margin:0 0 24px;font-size:15px;color:#64748b;">Claim {{claim_reference}}</p>
            </td>
          </tr>
          <tr>
            <td>
              <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.6;">A new attachment has been added to your claim.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    ${emailFooter()}
  `),
  text: `New Attachment Added

A new attachment has been added to claim {{claim_reference}}.

Thank you,
{{tenant_name}}`
};

export const CLAIM_DETERMINATION_SENT: EmailTemplate = {
  key: 'CLAIM_DETERMINATION_SENT',
  name: 'Claim Determination',
  subject: 'Claim Determination - {{claim_reference}}',
  html: emailWrapper(`
    ${emailHeader('Claim', 'info')}
    <tr>
      <td style="background:#ffffff;padding:40px 32px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="padding-bottom:20px;">
              <div style="width:64px;height:64px;background:#fed7aa;border-radius:50%;line-height:64px;text-align:center;font-size:28px;">⚖️</div>
            </td>
          </tr>
          <tr>
            <td align="center">
              <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#1e293b;">Claim Determination</h1>
              <p style="margin:0 0 24px;font-size:15px;color:#64748b;">{{claim_reference}}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;font-weight:600;">Claim Amount</p>
                    <p style="margin:4px 0 0;font-size:18px;font-weight:700;color:#1e293b;">{{claim_amount}}</p>
                  </td>
                  <td align="right">
                    <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;">Offer Amount</p>
                    <p style="margin:4px 0 0;font-size:24px;font-weight:700;color:#E85D2D;">{{offer_amount}}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    ${emailFooter()}
  `),
  text: `Claim Determination

Claim Reference: {{claim_reference}}
Claim Amount: {{claim_amount}}
Offer Amount: {{offer_amount}}

Thank you,
{{tenant_name}}`
};

export const CLAIM_REQUIRES_APPROVAL: EmailTemplate = {
  key: 'CLAIM_REQUIRES_APPROVAL',
  name: 'Claim Requires Approval',
  subject: 'Approval Required - Claim {{claim_reference}}',
  html: emailWrapper(`
    ${emailHeader('Approval', 'warning')}
    <tr>
      <td style="background:#ffffff;padding:40px 32px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="padding-bottom:20px;">
              <div style="width:64px;height:64px;background:#fef3c7;border-radius:50%;line-height:64px;text-align:center;font-size:28px;">⏳</div>
            </td>
          </tr>
          <tr>
            <td align="center">
              <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#1e293b;">Approval Required</h1>
              <p style="margin:0 0 24px;font-size:15px;color:#64748b;">Claim {{claim_reference}} needs your approval</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px;background:#fefce8;border:1px solid #fde047;border-radius:12px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <p style="margin:0;font-size:11px;color:#92400e;text-transform:uppercase;font-weight:600;">Amount</p>
                    <p style="margin:4px 0 0;font-size:24px;font-weight:700;color:#1e293b;">{{claim_amount}}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    ${emailFooter()}
  `),
  text: `Claim Approval Required

Claim {{claim_reference}} requires your approval.

Amount: {{claim_amount}}

Thank you,
{{tenant_name}}`
};

export const CLAIM_CLIENT_ACCEPTED: EmailTemplate = {
  key: 'CLAIM_CLIENT_ACCEPTED',
  name: 'Client Accepted Claim',
  subject: 'Claim {{claim_reference}} Accepted',
  html: emailWrapper(`
    ${emailHeader('Accepted', 'success')}
    <tr>
      <td style="background:#ffffff;padding:40px 32px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="padding-bottom:20px;">
              <div style="width:64px;height:64px;background:#dcfce7;border-radius:50%;line-height:64px;text-align:center;font-size:28px;">✅</div>
            </td>
          </tr>
          <tr>
            <td align="center">
              <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#1e293b;">Claim Accepted</h1>
              <p style="margin:0 0 24px;font-size:15px;color:#64748b;">{{claim_reference}}</p>
            </td>
          </tr>
          <tr>
            <td>
              <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.6;">The client has accepted the claim offer of {{offer_amount}}.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    ${emailFooter()}
  `),
  text: `Claim Accepted

The client has accepted claim {{claim_reference}}.
Offer Amount: {{offer_amount}}

Thank you,
{{tenant_name}}`
};

export const CLAIM_CLIENT_COUNTERED: EmailTemplate = {
  key: 'CLAIM_CLIENT_COUNTERED',
  name: 'Client Countered Claim',
  subject: 'Counter Offer - Claim {{claim_reference}}',
  html: emailWrapper(`
    ${emailHeader('Counter', 'warning')}
    <tr>
      <td style="background:#ffffff;padding:40px 32px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="padding-bottom:20px;">
              <div style="width:64px;height:64px;background:#fef3c7;border-radius:50%;line-height:64px;text-align:center;font-size:28px;">🔄</div>
            </td>
          </tr>
          <tr>
            <td align="center">
              <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#1e293b;">Counter Offer Received</h1>
              <p style="margin:0 0 24px;font-size:15px;color:#64748b;">{{claim_reference}}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    ${emailFooter()}
  `),
  text: `Counter Offer Received

The client has submitted a counter offer for claim {{claim_reference}}.

Thank you,
{{tenant_name}}`
};

export const CLAIM_CLIENT_DECLINED: EmailTemplate = {
  key: 'CLAIM_CLIENT_DECLINED',
  name: 'Client Declined Claim',
  subject: 'Claim {{claim_reference}} Declined',
  html: emailWrapper(`
    ${emailHeader('Declined', 'error')}
    <tr>
      <td style="background:#ffffff;padding:40px 32px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="padding-bottom:20px;">
              <div style="width:64px;height:64px;background:#fee2e2;border-radius:50%;line-height:64px;text-align:center;font-size:28px;">❌</div>
            </td>
          </tr>
          <tr>
            <td align="center">
              <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#1e293b;">Claim Declined</h1>
              <p style="margin:0 0 24px;font-size:15px;color:#64748b;">{{claim_reference}}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    ${emailFooter()}
  `),
  text: `Claim Declined

The client has declined claim {{claim_reference}}.

Thank you,
{{tenant_name}}`
};

export const CLAIM_NOTE_ADDED: EmailTemplate = {
  key: 'CLAIM_NOTE_ADDED',
  name: 'Claim Note Added',
  subject: 'New Note - Claim {{claim_reference}}',
  html: CLAIM_ATTACHMENT_ADDED.html.replace('New Attachment Added', 'New Note Added').replace('A new attachment has been added', 'A new note has been added'),
  text: CLAIM_ATTACHMENT_ADDED.text.replace('attachment', 'note')
};

// ==================== EMPLOYEE INVITE ====================
export const EMPLOYEE_INVITE: EmailTemplate = {
  key: 'EMPLOYEE_INVITE',
  name: 'Employee Invitation',
  subject: "You're invited to join {{tenant_name}}",
  html: emailWrapper(`
    ${emailHeader('Invitation', 'purple')}
    <tr>
      <td style="background:#ffffff;padding:40px 32px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="padding-bottom:20px;">
              <div style="width:64px;height:64px;background:#e9d5ff;border-radius:50%;line-height:64px;text-align:center;font-size:28px;">🎉</div>
            </td>
          </tr>
          <tr>
            <td align="center">
              <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#1e293b;">You're Invited!</h1>
              <p style="margin:0 0 24px;font-size:15px;color:#64748b;">Join {{tenant_name}} on Stride WMS</p>
            </td>
          </tr>
          <tr>
            <td>
              <p style="margin:0 0 16px;font-size:15px;color:#475569;">Hi {{employee_name}},</p>
              <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.6;">You've been invited to join {{tenant_name}}'s warehouse management system. Click the button below to create your account and get started.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td width="50%">
                    <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;font-weight:600;">Organization</p>
                    <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#1e293b;">{{tenant_name}}</p>
                  </td>
                  <td width="50%">
                    <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;font-weight:600;">Role</p>
                    <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#1e293b;">{{employee_role}}</p>
                  </td>
                </tr>
                <tr>
                  <td width="50%" style="padding-top:16px;">
                    <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;font-weight:600;">Invited By</p>
                    <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#1e293b;">{{invited_by}}</p>
                  </td>
                  <td width="50%" style="padding-top:16px;">
                    <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;font-weight:600;">Expires</p>
                    <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#1e293b;">{{expiry_date}}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding-top:28px;">
              ${primaryButton('Accept Invitation', '{{invitation_link}}')}
            </td>
          </tr>
          <tr>
            <td style="padding-top:24px;border-top:1px solid #e2e8f0;">
              <p style="margin:0;font-size:13px;color:#64748b;text-align:center;line-height:1.5;">If you didn't expect this invitation, you can safely ignore this email.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    ${emailFooter()}
  `),
  text: `You're Invited to {{tenant_name}}!

Hi {{employee_name}},

You've been invited to join {{tenant_name}}'s warehouse management system.

Organization: {{tenant_name}}
Role: {{employee_role}}
Invited By: {{invited_by}}
Expires: {{expiry_date}}

Accept Invitation: {{invitation_link}}

If you didn't expect this invitation, you can safely ignore this email.`
};

// Export all templates as an object for easy lookup
export const EMAIL_TEMPLATES: Record<string, EmailTemplate> = {
  INVOICE_SENT,
  INVOICE_CREATED,
  PAYMENT_RECEIVED,
  SHIPMENT_RECEIVED,
  SHIPMENT_COMPLETED,
  SHIPMENT_STATUS_CHANGED,
  ITEM_RECEIVED,
  ITEM_DAMAGED,
  ITEM_LOCATION_CHANGED,
  RELEASE_CREATED,
  RELEASE_APPROVED,
  RELEASE_COMPLETED,
  TASK_CREATED,
  TASK_ASSIGNED,
  TASK_COMPLETED,
  CLAIM_ATTACHMENT_ADDED,
  CLAIM_DETERMINATION_SENT,
  CLAIM_REQUIRES_APPROVAL,
  CLAIM_CLIENT_ACCEPTED,
  CLAIM_CLIENT_COUNTERED,
  CLAIM_CLIENT_DECLINED,
  CLAIM_NOTE_ADDED,
  EMPLOYEE_INVITE,
};

// Map trigger events (e.g., 'shipment.received') to template keys (e.g., 'SHIPMENT_RECEIVED')
const TRIGGER_TO_TEMPLATE_KEY: Record<string, string> = {
  'shipment.received': 'SHIPMENT_RECEIVED',
  'shipment.completed': 'SHIPMENT_COMPLETED',
  'shipment.status_changed': 'SHIPMENT_STATUS_CHANGED',
  'item.received': 'ITEM_RECEIVED',
  'item.damaged': 'ITEM_DAMAGED',
  'item.location_changed': 'ITEM_LOCATION_CHANGED',
  'task.created': 'TASK_CREATED',
  'task.assigned': 'TASK_ASSIGNED',
  'task.completed': 'TASK_COMPLETED',
  'release.created': 'RELEASE_CREATED',
  'release.approved': 'RELEASE_APPROVED',
  'release.completed': 'RELEASE_COMPLETED',
  'invoice.created': 'INVOICE_CREATED',
  'invoice.sent': 'INVOICE_SENT',
  'payment.received': 'PAYMENT_RECEIVED',
  'employee.invited': 'EMPLOYEE_INVITE',
};

// Helper to get template by key or trigger event
export function getEmailTemplate(key: string): EmailTemplate | undefined {
  // Try direct key match first (e.g., 'INVOICE_SENT')
  if (EMAIL_TEMPLATES[key]) {
    return EMAIL_TEMPLATES[key];
  }
  // Try trigger event mapping (e.g., 'invoice.sent' -> 'INVOICE_SENT')
  const mappedKey = TRIGGER_TO_TEMPLATE_KEY[key];
  if (mappedKey) {
    return EMAIL_TEMPLATES[mappedKey];
  }
  return undefined;
}

// Helper to get all template keys
export function getEmailTemplateKeys(): string[] {
  return Object.keys(EMAIL_TEMPLATES);
}
