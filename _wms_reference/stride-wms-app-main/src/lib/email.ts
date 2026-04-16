import { supabase } from "@/integrations/supabase/client";

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  tenantId?: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke("send-email", {
      body: { to, subject, html, ...(tenantId ? { tenant_id: tenantId } : {}) },
    });
    
    if (error) {
      console.error("sendEmail error:", error);
      return { ok: false, error: error.message };
    }
    
    return data as { ok: boolean; error?: string };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("sendEmail exception:", err);
    return { ok: false, error: message };
  }
}

// Email template helpers for core warehouse alerts

export function buildShipmentReceivedEmail(params: {
  shipmentNumber: string;
  accountName: string;
  itemCount: number;
  receivedDate: string;
  receivedBy?: string;
}): { subject: string; html: string } {
  return {
    subject: `Shipment ${params.shipmentNumber} Received`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Shipment Received</h2>
        <p>Your shipment has been received at the warehouse.</p>
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Shipment #:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${params.shipmentNumber}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Account:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${params.accountName}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Items:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${params.itemCount}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Received:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${params.receivedDate}</td>
          </tr>
          ${params.receivedBy ? `
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Received By:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${params.receivedBy}</td>
          </tr>
          ` : ''}
        </table>
        <p style="color: #666; font-size: 14px;">This is an automated notification from Stride WMS.</p>
      </div>
    `,
  };
}

export function buildInspectionCompletedEmail(params: {
  itemCode: string;
  itemDescription: string;
  accountName: string;
  inspectionDate: string;
  inspectionNotes?: string;
  hasDamage?: boolean;
}): { subject: string; html: string } {
  return {
    subject: `Inspection Completed: ${params.itemCode}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Inspection Completed</h2>
        <p>An item inspection has been completed.</p>
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Item Code:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${params.itemCode}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Description:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${params.itemDescription}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Account:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${params.accountName}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Date:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${params.inspectionDate}</td>
          </tr>
          ${params.hasDamage !== undefined ? `
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Condition:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #eee; color: ${params.hasDamage ? '#d9534f' : '#5cb85c'};">
              ${params.hasDamage ? 'Damage Found' : 'No Damage'}
            </td>
          </tr>
          ` : ''}
          ${params.inspectionNotes ? `
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Notes:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${params.inspectionNotes}</td>
          </tr>
          ` : ''}
        </table>
        <p style="color: #666; font-size: 14px;">This is an automated notification from Stride WMS.</p>
      </div>
    `,
  };
}

export function buildRepairQuoteReadyEmail(params: {
  accountName: string;
  quoteAmount: number;
  quoteNotes?: string;
  quoteLink?: string;
  items: Array<{
    itemCode: string;
    description: string;
    damageDescription?: string;
    amount?: number;
  }>;
}): { subject: string; html: string } {
  const itemSummary = params.items.length === 1
    ? params.items[0].itemCode
    : `${params.items.length} items`;

  const itemRows = params.items.map(item => `
          <tr>
            <td style="padding: 10px 12px; border-bottom: 1px solid #eee; font-weight: 600; color: #2563eb;">${item.itemCode}</td>
            <td style="padding: 10px 12px; border-bottom: 1px solid #eee;">${item.description}</td>
            <td style="padding: 10px 12px; border-bottom: 1px solid #eee;">${item.damageDescription || '—'}</td>
            ${params.items.some(i => i.amount != null) ? `<td style="padding: 10px 12px; border-bottom: 1px solid #eee; text-align: right;">${item.amount != null ? '$' + item.amount.toFixed(2) : '—'}</td>` : ''}
          </tr>`).join('');

  const hasAmounts = params.items.some(i => i.amount != null);

  return {
    subject: `Repair Quote Ready: ${itemSummary}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Repair Quote Ready</h2>
        <p>A repair quote has been prepared for your review.</p>

        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Account:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${params.accountName}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Total Quote Amount:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #eee; font-size: 18px; font-weight: bold; color: #333;">$${params.quoteAmount.toFixed(2)}</td>
          </tr>
          ${params.quoteNotes ? `
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Notes:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${params.quoteNotes}</td>
          </tr>
          ` : ''}
        </table>

        <h3 style="color: #333; margin-top: 24px; margin-bottom: 8px;">Items (${params.items.length})</h3>
        <table style="width: 100%; border-collapse: collapse; margin: 0 0 20px; border: 1px solid #eee; border-radius: 6px;">
          <thead>
            <tr style="background-color: #f8fafc;">
              <th style="padding: 10px 12px; text-align: left; font-size: 12px; text-transform: uppercase; color: #64748b; border-bottom: 2px solid #e2e8f0;">Item Code</th>
              <th style="padding: 10px 12px; text-align: left; font-size: 12px; text-transform: uppercase; color: #64748b; border-bottom: 2px solid #e2e8f0;">Description</th>
              <th style="padding: 10px 12px; text-align: left; font-size: 12px; text-transform: uppercase; color: #64748b; border-bottom: 2px solid #e2e8f0;">Damage</th>
              ${hasAmounts ? `<th style="padding: 10px 12px; text-align: right; font-size: 12px; text-transform: uppercase; color: #64748b; border-bottom: 2px solid #e2e8f0;">Amount</th>` : ''}
            </tr>
          </thead>
          <tbody>
            ${itemRows}
          </tbody>
        </table>

        ${params.quoteLink ? `
        <div style="margin: 30px 0; text-align: center;">
          <p style="margin-bottom: 20px; font-size: 16px;">Please review and respond to this quote:</p>
          <a href="${params.quoteLink}" style="display: inline-block; background-color: #0066cc; color: white; padding: 14px 32px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px;">Review Quote</a>
        </div>
        <p style="color: #666; font-size: 13px; text-align: center;">Click the button above to view full details and accept or decline this quote.</p>
        ` : ''}
        <p style="color: #666; font-size: 14px; margin-top: 30px;">This is an automated notification from Stride WMS.</p>
      </div>
    `,
  };
}

export function buildRepairUnableToCompleteEmail(params: {
  itemCodes: string[];
  accountName: string;
  taskTitle: string;
  note: string;
  completedDate: string;
  completedBy?: string;
}): { subject: string; html: string } {
  const itemSummary = params.itemCodes.length === 1
    ? params.itemCodes[0]
    : `${params.itemCodes.length} items`;

  return {
    subject: `Repair Unable to Complete: ${itemSummary}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #d9534f;">Repair Unable to Complete</h2>
        <p>A repair task could not be completed. The item${params.itemCodes.length !== 1 ? 's' : ''} remain${params.itemCodes.length === 1 ? 's' : ''} flagged as damaged${params.itemCodes.length > 0 ? ' and quarantined (if applicable)' : ''}.</p>
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Task:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${params.taskTitle}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Item${params.itemCodes.length !== 1 ? 's' : ''}:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${params.itemCodes.join(', ')}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Account:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${params.accountName}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Date:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${params.completedDate}</td>
          </tr>
          ${params.completedBy ? `
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Marked By:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${params.completedBy}</td>
          </tr>
          ` : ''}
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Reason:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #eee; color: #d9534f;">${params.note}</td>
          </tr>
        </table>
        <p style="color: #666; font-size: 14px;">This item requires manual attention. Please review and determine next steps.</p>
        <p style="color: #666; font-size: 14px;">This is an automated notification from Stride WMS.</p>
      </div>
    `,
  };
}

export function buildInvoiceSentEmail(params: {
  invoiceNumber: string;
  accountName: string;
  periodStart: string;
  periodEnd: string;
  total: number;
  lineCount: number;
}): { subject: string; html: string } {
  return {
    subject: `Invoice ${params.invoiceNumber}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Invoice</h2>
        <p>Please find your invoice details below.</p>
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Invoice #:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${params.invoiceNumber}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Account:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${params.accountName}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Period:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${params.periodStart} to ${params.periodEnd}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Line Items:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${params.lineCount}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Total:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #eee; font-size: 18px; font-weight: bold; color: #333;">$${params.total.toFixed(2)}</td>
          </tr>
        </table>
        <p style="color: #666; font-size: 14px;">This is an automated notification from Stride WMS.</p>
      </div>
    `,
  };
}
