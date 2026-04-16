import { supabase } from '@/integrations/supabase/client';

// Email types for the system
export type EmailType =
  | 'client_invitation'
  | 'quote_to_tech'
  | 'quote_to_client'
  | 'quote_accepted'
  | 'quote_declined'
  | 'tech_submitted'
  | 'shipment_notification'
  | 'password_reset'
  | 'service_quote_sent';

export interface SendEmailParams {
  to: string;
  toName?: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
  emailType: EmailType;
  tenantId?: string;
  entityType?: string;
  entityId?: string;
}

export interface EmailResult {
  success: boolean;
  emailLogId?: string;
  resendId?: string;
  provider?: 'resend' | 'postmark' | 'test_mode';
  providerMessageId?: string;
  fallbackUsed?: boolean;
  error?: string;
  // For test mode - contains useful links extracted from email
  testModeData?: {
    activationLink?: string;
    quoteLink?: string;
  };
}

// Set to true to use test mode (logs to console/DB instead of sending)
// Default: enabled in dev, disabled in production builds.
// You can override with VITE_EMAIL_TEST_MODE=true/false.
const EMAIL_TEST_MODE = (() => {
  const raw = String(import.meta.env.VITE_EMAIL_TEST_MODE || '').toLowerCase();
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return import.meta.env.DEV;
})();

function isMissingEmailLogAuditColumns(error: unknown): boolean {
  const message = String((error as { message?: unknown })?.message || '').toLowerCase();
  const code = String((error as { code?: unknown })?.code || '').toUpperCase();
  return (
    code === 'PGRST204' ||
    code === '42703' ||
    /provider|provider_message_id|fallback_used|column/i.test(message)
  );
}

// Extract links from HTML for test mode
function extractLinksFromHtml(html: string): { activationLink?: string; quoteLink?: string } {
  const result: { activationLink?: string; quoteLink?: string } = {};

  // Look for activation link
  const activationMatch = html.match(/href="([^"]*\/activate\?token=[^"]*)"/);
  if (activationMatch) {
    result.activationLink = activationMatch[1];
  }

  // Look for quote links
  const quoteMatch = html.match(/href="([^"]*\/quote\/[^"]*)"/);
  if (quoteMatch) {
    result.quoteLink = quoteMatch[1];
  }

  return result;
}

// Send email - uses test mode by default for development
export async function sendEmail(params: SendEmailParams): Promise<EmailResult> {
  try {
    // Create an email log entry (if tenant provided)
    let emailLogId: string | undefined;

    if (params.tenantId) {
      const baseInsertPayload = {
        tenant_id: params.tenantId,
        email_type: params.emailType,
        recipient_email: params.to,
        recipient_name: params.toName,
        subject: params.subject,
        status: EMAIL_TEST_MODE ? 'sent' : 'pending',
        entity_type: params.entityType,
        entity_id: params.entityId,
        // In test mode, mark as sent immediately
        sent_at: EMAIL_TEST_MODE ? new Date().toISOString() : null,
        // Keep legacy message id column for compatibility with existing consumers.
        resend_id: EMAIL_TEST_MODE ? 'TEST_MODE' : null,
      };
      const auditInsertPayload = {
        ...baseInsertPayload,
        provider: EMAIL_TEST_MODE ? 'test_mode' : null,
        provider_message_id: EMAIL_TEST_MODE ? 'TEST_MODE' : null,
        fallback_used: false,
      };

      let { data: emailLog, error: logError } = await (supabase
        .from('email_logs') as any)
        .insert(auditInsertPayload)
        .select()
        .single();

      if (logError && isMissingEmailLogAuditColumns(logError)) {
        const legacy = await (supabase
          .from('email_logs') as any)
          .insert(baseInsertPayload)
          .select()
          .single();
        emailLog = legacy.data;
        logError = legacy.error;
      }

      if (!logError && emailLog) {
        emailLogId = emailLog.id;
      }
    }

    // TEST MODE: Log to console and return success without actually sending
    if (EMAIL_TEST_MODE) {
      const links = extractLinksFromHtml(params.htmlBody);

      console.log('========================================');
      console.log('📧 EMAIL TEST MODE - Email not actually sent');
      console.log('========================================');
      console.log(`To: ${params.to}${params.toName ? ` (${params.toName})` : ''}`);
      console.log(`Subject: ${params.subject}`);
      console.log(`Type: ${params.emailType}`);
      if (links.activationLink) {
        console.log(`🔗 Activation Link: ${links.activationLink}`);
      }
      if (links.quoteLink) {
        console.log(`🔗 Quote Link: ${links.quoteLink}`);
      }
      console.log('========================================');
      console.log('Text Content:');
      console.log(params.textBody || '(no text version)');
      console.log('========================================');

      return {
        success: true,
        emailLogId,
        resendId: 'TEST_MODE',
        provider: 'test_mode',
        providerMessageId: 'TEST_MODE',
        fallbackUsed: false,
        testModeData: links,
      };
    }

    // PRODUCTION MODE: Call the Edge Function to send email
    const { data, error } = await supabase.functions.invoke('send-email', {
      body: {
        to: params.to,
        subject: params.subject,
        html: params.htmlBody,
        ...(params.tenantId ? { tenant_id: params.tenantId } : {}),
      },
    });

    if (error || !data?.ok) {
      const errorMessage = error?.message || data?.error || 'Failed to send email';

      // Update log with error
      if (emailLogId) {
        const auditErrorPayload = {
          status: 'failed',
          error_message: errorMessage,
          provider: null,
          provider_message_id: null,
          fallback_used: false,
        };
        let { error: updateError } = await (supabase.from('email_logs') as any)
          .update(auditErrorPayload)
          .eq('id', emailLogId);

        if (updateError && isMissingEmailLogAuditColumns(updateError)) {
          await (supabase.from('email_logs') as any)
            .update({
              status: 'failed',
              error_message: errorMessage,
            })
            .eq('id', emailLogId);
        }
      }

      return {
        success: false,
        emailLogId,
        error: errorMessage,
      };
    }

    // Update log with success
    const provider = data?.provider === 'postmark' ? 'postmark' : data?.provider === 'resend' ? 'resend' : undefined;
    const providerMessageId = typeof data?.id === 'string' ? data.id : undefined;
    const fallbackUsed = data?.fallback_used === true;

    if (emailLogId) {
      const sentAt = new Date().toISOString();
      const auditSuccessPayload = {
        status: 'sent',
        resend_id: data?.id,
        sent_at: sentAt,
        provider: provider || null,
        provider_message_id: providerMessageId || null,
        fallback_used: fallbackUsed,
      };
      let { error: updateError } = await (supabase.from('email_logs') as any)
        .update(auditSuccessPayload)
        .eq('id', emailLogId);

      if (updateError && isMissingEmailLogAuditColumns(updateError)) {
        await (supabase.from('email_logs') as any)
          .update({
            status: 'sent',
            resend_id: data?.id,
            sent_at: sentAt,
          })
          .eq('id', emailLogId);
      }
    }

    return {
      success: true,
      emailLogId,
      resendId: data?.id,
      provider,
      providerMessageId,
      fallbackUsed,
    };
  } catch (err) {
    console.error('Email send error:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

// Email template generators
export function generateClientInvitationEmail(params: {
  recipientName: string;
  accountName: string;
  inviterName: string;
  warehouseName: string;
  activationLink: string;
  expiresIn: string;
}): { subject: string; html: string; text: string } {
  const subject = `You've been invited to ${params.warehouseName} Client Portal`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Client Portal Invitation</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 24px;">Welcome to ${params.warehouseName}</h1>
  </div>

  <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none;">
    <p style="font-size: 16px;">Hi ${params.recipientName || 'there'},</p>

    <p>You've been invited by <strong>${params.inviterName}</strong> to access the ${params.warehouseName} Client Portal for <strong>${params.accountName}</strong>.</p>

    <p>With your portal account, you'll be able to:</p>
    <ul style="padding-left: 20px;">
      <li>View your stored items and their status</li>
      <li>Track shipments and deliveries</li>
      <li>Review and approve repair quotes</li>
      <li>Access documents and photos</li>
    </ul>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${params.activationLink}" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
        Activate Your Account
      </a>
    </div>

    <p style="color: #6b7280; font-size: 14px;">
      This invitation expires in ${params.expiresIn}. If you didn't expect this invitation, you can safely ignore this email.
    </p>
  </div>

  <div style="text-align: center; padding: 20px; color: #9ca3af; font-size: 12px;">
    <p>&copy; ${new Date().getFullYear()} ${params.warehouseName}. All rights reserved.</p>
  </div>
</body>
</html>
  `.trim();

  const text = `
Hi ${params.recipientName || 'there'},

You've been invited by ${params.inviterName} to access the ${params.warehouseName} Client Portal for ${params.accountName}.

With your portal account, you'll be able to:
- View your stored items and their status
- Track shipments and deliveries
- Review and approve repair quotes
- Access documents and photos

Click here to activate your account:
${params.activationLink}

This invitation expires in ${params.expiresIn}.

If you didn't expect this invitation, you can safely ignore this email.
  `.trim();

  return { subject, html, text };
}

export function generateTechQuoteRequestEmail(params: {
  technicianName: string;
  warehouseName: string;
  accountName: string;
  itemCount: number;
  quoteLink: string;
  expiresIn: string;
}): { subject: string; html: string; text: string } {
  const subject = `New Repair Quote Request from ${params.warehouseName}`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: #1e40af; padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 24px;">Repair Quote Request</h1>
  </div>

  <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none;">
    <p style="font-size: 16px;">Hi ${params.technicianName},</p>

    <p>${params.warehouseName} has requested a repair quote for <strong>${params.itemCount} item${params.itemCount !== 1 ? 's' : ''}</strong> belonging to <strong>${params.accountName}</strong>.</p>

    <p>Please review the items and submit your repair estimate.</p>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${params.quoteLink}" style="display: inline-block; background: #1e40af; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
        View & Submit Quote
      </a>
    </div>

    <p style="color: #6b7280; font-size: 14px;">
      This quote request expires in ${params.expiresIn}.
    </p>
  </div>
</body>
</html>
  `.trim();

  const text = `
Hi ${params.technicianName},

${params.warehouseName} has requested a repair quote for ${params.itemCount} item${params.itemCount !== 1 ? 's' : ''} belonging to ${params.accountName}.

Please review the items and submit your repair estimate:
${params.quoteLink}

This quote request expires in ${params.expiresIn}.
  `.trim();

  return { subject, html, text };
}

export function generateClientQuoteEmail(params: {
  clientName: string;
  warehouseName: string;
  itemCount: number;
  totalAmount: string;
  quoteLink: string;
  expiresIn: string;
}): { subject: string; html: string; text: string } {
  const subject = `Repair Quote Ready for Review - ${params.totalAmount}`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: #059669; padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 24px;">Repair Quote Ready</h1>
  </div>

  <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none;">
    <p style="font-size: 16px;">Hi ${params.clientName},</p>

    <p>A repair quote is ready for your review from ${params.warehouseName}.</p>

    <div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin: 20px 0; text-align: center;">
      <p style="color: #6b7280; margin: 0 0 5px 0; font-size: 14px;">${params.itemCount} item${params.itemCount !== 1 ? 's' : ''}</p>
      <p style="font-size: 32px; font-weight: bold; color: #059669; margin: 0;">${params.totalAmount}</p>
    </div>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${params.quoteLink}" style="display: inline-block; background: #059669; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
        Review Quote
      </a>
    </div>

    <p style="color: #6b7280; font-size: 14px;">
      This quote expires in ${params.expiresIn}. Please review and respond before then.
    </p>
  </div>
</body>
</html>
  `.trim();

  const text = `
Hi ${params.clientName},

A repair quote is ready for your review from ${params.warehouseName}.

Items: ${params.itemCount}
Total: ${params.totalAmount}

Review and respond here:
${params.quoteLink}

This quote expires in ${params.expiresIn}.
  `.trim();

  return { subject, html, text };
}

export function generateServiceQuoteEmail(params: {
  recipientName: string;
  accountName: string;
  warehouseName: string;
  quoteNumber: string;
  totalAmount: string;
  itemCount: number;
  storageDays: number;
  quoteLink: string;
  expiresAt?: string;
}): { subject: string; html: string; text: string } {
  const subject = `Service Quote ${params.quoteNumber} - ${params.totalAmount}`;

  const expirationText = params.expiresAt
    ? `This quote is valid until ${params.expiresAt}.`
    : 'Please review and respond at your earliest convenience.';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 24px;">Service Quote</h1>
    <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0; font-size: 16px;">${params.quoteNumber}</p>
  </div>

  <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none;">
    <p style="font-size: 16px;">Hi ${params.recipientName || 'there'},</p>

    <p>${params.warehouseName} has prepared a service quote for <strong>${params.accountName}</strong>.</p>

    <div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin: 20px 0;">
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 0; color: #6b7280;">Items:</td>
          <td style="padding: 8px 0; text-align: right; font-weight: 600;">${params.itemCount}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #6b7280;">Storage Duration:</td>
          <td style="padding: 8px 0; text-align: right; font-weight: 600;">${params.storageDays} days</td>
        </tr>
        <tr style="border-top: 2px solid #e5e7eb;">
          <td style="padding: 12px 0; color: #6b7280; font-size: 18px;">Total:</td>
          <td style="padding: 12px 0; text-align: right; font-weight: bold; font-size: 24px; color: #3b82f6;">${params.totalAmount}</td>
        </tr>
      </table>
    </div>

    <p>Click the button below to view the full quote details and accept or decline.</p>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${params.quoteLink}" style="display: inline-block; background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
        View Quote
      </a>
    </div>

    <p style="color: #6b7280; font-size: 14px;">
      ${expirationText}
    </p>
  </div>

  <div style="text-align: center; padding: 20px; color: #9ca3af; font-size: 12px;">
    <p>&copy; ${new Date().getFullYear()} ${params.warehouseName}. All rights reserved.</p>
  </div>
</body>
</html>
  `.trim();

  const text = `
Hi ${params.recipientName || 'there'},

${params.warehouseName} has prepared a service quote for ${params.accountName}.

Quote: ${params.quoteNumber}
Items: ${params.itemCount}
Storage Duration: ${params.storageDays} days
Total: ${params.totalAmount}

View and respond to the quote here:
${params.quoteLink}

${expirationText}
  `.trim();

  return { subject, html, text };
}
