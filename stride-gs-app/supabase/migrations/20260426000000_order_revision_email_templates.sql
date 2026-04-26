-- 20260426000000_order_revision_email_templates.sql
--
-- Two new email templates for delivery-order review actions, surfaced in
-- Settings → Templates the same way ORDER_REVIEW_REQUEST is. Both copy the
-- visual structure of ORDER_REVIEW_REQUEST (dark header, accent banner,
-- detail table, footer) so the email family looks consistent. Color
-- changes per template:
--   • ORDER_REVISION_REQUESTED → amber accent (#F59E0B) — "needs your edit"
--   • ORDER_REJECTED           → red accent (#DC2626)   — terminal state
--
-- Both fire from the new notify-order-revision Edge Function, which sends
-- to BOTH the office distro (NOTIFICATION_EMAILS secret) AND the submitter
-- (resolved from dt_orders.created_by_user → profiles.email). The
-- `recipients` column carries the marker `NOTIFICATION_EMAILS,SUBMITTER`
-- so the function can read intent declaratively rather than hardcode it.
--
-- Tokens supported (same set as ORDER_REVIEW_REQUEST plus three new ones):
--   {{ORDER_NUMBER}}      Human identifier, e.g. "MRS-00002" (with linked
--                         leg appended for P+D pairs)
--   {{ORDER_TYPE}}        Display string ("Delivery", "Pickup", "Pickup &
--                         Delivery", "Service Only")
--   {{CLIENT_NAME}}       Tenant display name
--   {{CONTACT_NAME}}      Customer name on the order
--   {{CONTACT_ADDRESS}}   Concatenated single-line address
--   {{SERVICE_DATE}}      Operator-picked delivery day
--   {{ITEM_COUNT}}        Number of dt_order_items rows
--   {{ORDER_TOTAL}}       Currency string OR "Quote Required" if pricing
--                         override is set
--   {{REVIEWER_NAME}}     Display name of the staff member who marked the
--                         order (resolved from auth.uid → profiles)
--   {{REVIEW_NOTES}}      Optional reviewer-supplied notes; rendered as
--                         "—" when empty so the table cell is never blank
--   {{ORDER_LINK}}        Deep-link to OrderPage so the submitter can
--                         open the order, edit it, and resubmit
--   {{APP_URL}}           Stride Hub root for footer/template fallbacks

INSERT INTO public.email_templates (template_key, subject, body, recipients, category, active, notes) VALUES (
  'ORDER_REVISION_REQUESTED',
  'Action Required: Revisions requested on order {{ORDER_NUMBER}}',
  '<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#F5F5F0;font-family:-apple-system,BlinkMacSystemFont,''Segoe UI'',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F5F5F0;padding:40px 20px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">
      <tr>
        <td style="background:#1C1C1C;border-radius:16px 16px 0 0;padding:28px 32px;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td>
                <div style="color:#E85D2D;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:6px;">Stride Logistics</div>
                <div style="color:#ffffff;font-size:22px;font-weight:700;line-height:1.2;">Delivery Order<br>Needs Your Revisions</div>
              </td>
              <td align="right" valign="top">
                <div style="background:#F59E0B;color:#1C1C1C;font-size:11px;font-weight:700;padding:6px 14px;border-radius:20px;letter-spacing:1px;text-transform:uppercase;">Revisions Requested</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="background:#F59E0B;padding:14px 32px;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td>
                <div style="color:#1C1C1C;font-size:11px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;opacity:0.8;margin-bottom:2px;">Order Number</div>
                <div style="color:#1C1C1C;font-size:18px;font-weight:700;font-family:monospace,monospace;">{{ORDER_NUMBER}}</div>
              </td>
              <td align="right">
                <div style="background:rgba(28,28,28,0.15);color:#1C1C1C;font-size:11px;font-weight:700;padding:5px 12px;border-radius:20px;">{{ORDER_TYPE}}</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="background:#ffffff;padding:28px 32px;">
          <p style="margin:0 0 20px;font-size:14px;color:#444;line-height:1.6;">{{REVIEWER_NAME}} reviewed your order and is asking for revisions before it can be approved. Open the order, make the requested changes, and click <strong>Save Changes</strong> &mdash; the order will return to Pending Review automatically.</p>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FFFBEB;border:1px solid #F59E0B;border-radius:12px;overflow:hidden;margin-bottom:20px;">
            <tr style="background:#FEF3C7;">
              <td style="padding:10px 16px;font-size:10px;font-weight:700;color:#92400E;letter-spacing:1.5px;text-transform:uppercase;">Reviewer Notes</td>
            </tr>
            <tr><td style="padding:14px 16px;font-size:13px;color:#1C1C1C;line-height:1.6;white-space:pre-wrap;">{{REVIEW_NOTES}}</td></tr>
          </table>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden;margin-bottom:24px;">
            <tr style="background:#F3F4F6;">
              <td colspan="2" style="padding:10px 16px;font-size:10px;font-weight:700;color:#6B7280;letter-spacing:1.5px;text-transform:uppercase;">Order Details</td>
            </tr>
            <tr><td style="padding:10px 16px;font-size:12px;font-weight:600;color:#6B7280;width:140px;border-top:1px solid #F3F4F6;">Client Account</td><td style="padding:10px 16px;font-size:13px;font-weight:600;color:#1C1C1C;border-top:1px solid #F3F4F6;">{{CLIENT_NAME}}</td></tr>
            <tr><td style="padding:10px 16px;font-size:12px;font-weight:600;color:#6B7280;border-top:1px solid #F3F4F6;">Contact / Customer</td><td style="padding:10px 16px;font-size:13px;color:#1C1C1C;border-top:1px solid #F3F4F6;">{{CONTACT_NAME}}</td></tr>
            <tr><td style="padding:10px 16px;font-size:12px;font-weight:600;color:#6B7280;border-top:1px solid #F3F4F6;">Address</td><td style="padding:10px 16px;font-size:13px;color:#1C1C1C;border-top:1px solid #F3F4F6;">{{CONTACT_ADDRESS}}</td></tr>
            <tr><td style="padding:10px 16px;font-size:12px;font-weight:600;color:#6B7280;border-top:1px solid #F3F4F6;">Preferred Date</td><td style="padding:10px 16px;font-size:13px;color:#1C1C1C;border-top:1px solid #F3F4F6;">{{SERVICE_DATE}}</td></tr>
            <tr><td style="padding:10px 16px;font-size:12px;font-weight:600;color:#6B7280;border-top:1px solid #F3F4F6;">Item Count</td><td style="padding:10px 16px;font-size:13px;color:#1C1C1C;border-top:1px solid #F3F4F6;">{{ITEM_COUNT}} item(s)</td></tr>
            <tr><td style="padding:10px 16px;font-size:12px;font-weight:600;color:#6B7280;border-top:1px solid #F3F4F6;">Estimated Total</td><td style="padding:10px 16px;font-size:14px;font-weight:700;color:#1C1C1C;border-top:1px solid #F3F4F6;">{{ORDER_TOTAL}}</td></tr>
          </table>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px;">
            <tr><td align="center"><a href="{{ORDER_LINK}}" style="display:inline-block;background:#E85D2D;color:#ffffff;font-size:13px;font-weight:700;padding:14px 32px;border-radius:8px;text-decoration:none;">Open Order in Stride Hub &rarr;</a></td></tr>
          </table>
          <p style="margin:0;font-size:12px;color:#9CA3AF;text-align:center;line-height:1.6;">This order is on hold until the requested edits are saved. The reviewer was copied on this email.</p>
        </td>
      </tr>
      <tr>
        <td style="background:#F9FAFB;border-top:1px solid #E5E7EB;border-radius:0 0 16px 16px;padding:20px 32px;text-align:center;">
          <div style="font-size:11px;color:#9CA3AF;line-height:1.6;">Stride Logistics &middot; Kent, WA<br>This is an automated notification from Stride Hub. Do not reply to this email.</div>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>',
  'NOTIFICATION_EMAILS,SUBMITTER',
  'delivery',
  true,
  'Sent when a reviewer marks a delivery order as ''revision_requested''. Recipients: NOTIFICATION_EMAILS (office distro) + the order submitter (resolved via dt_orders.created_by_user → profiles.email). Tokens: {{ORDER_NUMBER}}, {{ORDER_TYPE}}, {{CLIENT_NAME}}, {{CONTACT_NAME}}, {{CONTACT_ADDRESS}}, {{SERVICE_DATE}}, {{ITEM_COUNT}}, {{ORDER_TOTAL}}, {{REVIEWER_NAME}}, {{REVIEW_NOTES}}, {{ORDER_LINK}}, {{APP_URL}}.'
)
ON CONFLICT (template_key) DO NOTHING;

INSERT INTO public.email_templates (template_key, subject, body, recipients, category, active, notes) VALUES (
  'ORDER_REJECTED',
  'Order {{ORDER_NUMBER}} was rejected',
  '<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#F5F5F0;font-family:-apple-system,BlinkMacSystemFont,''Segoe UI'',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F5F5F0;padding:40px 20px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">
      <tr>
        <td style="background:#1C1C1C;border-radius:16px 16px 0 0;padding:28px 32px;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td>
                <div style="color:#E85D2D;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:6px;">Stride Logistics</div>
                <div style="color:#ffffff;font-size:22px;font-weight:700;line-height:1.2;">Delivery Order<br>Was Rejected</div>
              </td>
              <td align="right" valign="top">
                <div style="background:#DC2626;color:#fff;font-size:11px;font-weight:700;padding:6px 14px;border-radius:20px;letter-spacing:1px;text-transform:uppercase;">Rejected</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="background:#DC2626;padding:14px 32px;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td>
                <div style="color:#fff;font-size:11px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;opacity:0.85;margin-bottom:2px;">Order Number</div>
                <div style="color:#fff;font-size:18px;font-weight:700;font-family:monospace,monospace;">{{ORDER_NUMBER}}</div>
              </td>
              <td align="right">
                <div style="background:rgba(255,255,255,0.2);color:#fff;font-size:11px;font-weight:700;padding:5px 12px;border-radius:20px;">{{ORDER_TYPE}}</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="background:#ffffff;padding:28px 32px;">
          <p style="margin:0 0 20px;font-size:14px;color:#444;line-height:1.6;">{{REVIEWER_NAME}} reviewed your order and rejected it. The order will not be dispatched. If you believe this was in error or want to discuss, reply to this email or contact the Stride office.</p>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FEF2F2;border:1px solid #FCA5A5;border-radius:12px;overflow:hidden;margin-bottom:20px;">
            <tr style="background:#FEE2E2;">
              <td style="padding:10px 16px;font-size:10px;font-weight:700;color:#991B1B;letter-spacing:1.5px;text-transform:uppercase;">Reason</td>
            </tr>
            <tr><td style="padding:14px 16px;font-size:13px;color:#1C1C1C;line-height:1.6;white-space:pre-wrap;">{{REVIEW_NOTES}}</td></tr>
          </table>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden;margin-bottom:24px;">
            <tr style="background:#F3F4F6;">
              <td colspan="2" style="padding:10px 16px;font-size:10px;font-weight:700;color:#6B7280;letter-spacing:1.5px;text-transform:uppercase;">Order Details</td>
            </tr>
            <tr><td style="padding:10px 16px;font-size:12px;font-weight:600;color:#6B7280;width:140px;border-top:1px solid #F3F4F6;">Client Account</td><td style="padding:10px 16px;font-size:13px;font-weight:600;color:#1C1C1C;border-top:1px solid #F3F4F6;">{{CLIENT_NAME}}</td></tr>
            <tr><td style="padding:10px 16px;font-size:12px;font-weight:600;color:#6B7280;border-top:1px solid #F3F4F6;">Contact / Customer</td><td style="padding:10px 16px;font-size:13px;color:#1C1C1C;border-top:1px solid #F3F4F6;">{{CONTACT_NAME}}</td></tr>
            <tr><td style="padding:10px 16px;font-size:12px;font-weight:600;color:#6B7280;border-top:1px solid #F3F4F6;">Address</td><td style="padding:10px 16px;font-size:13px;color:#1C1C1C;border-top:1px solid #F3F4F6;">{{CONTACT_ADDRESS}}</td></tr>
            <tr><td style="padding:10px 16px;font-size:12px;font-weight:600;color:#6B7280;border-top:1px solid #F3F4F6;">Preferred Date</td><td style="padding:10px 16px;font-size:13px;color:#1C1C1C;border-top:1px solid #F3F4F6;">{{SERVICE_DATE}}</td></tr>
            <tr><td style="padding:10px 16px;font-size:12px;font-weight:600;color:#6B7280;border-top:1px solid #F3F4F6;">Item Count</td><td style="padding:10px 16px;font-size:13px;color:#1C1C1C;border-top:1px solid #F3F4F6;">{{ITEM_COUNT}} item(s)</td></tr>
          </table>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px;">
            <tr><td align="center"><a href="{{ORDER_LINK}}" style="display:inline-block;background:#1C1C1C;color:#ffffff;font-size:13px;font-weight:700;padding:14px 32px;border-radius:8px;text-decoration:none;">View Order in Stride Hub &rarr;</a></td></tr>
          </table>
          <p style="margin:0;font-size:12px;color:#9CA3AF;text-align:center;line-height:1.6;">The reviewer was copied on this email.</p>
        </td>
      </tr>
      <tr>
        <td style="background:#F9FAFB;border-top:1px solid #E5E7EB;border-radius:0 0 16px 16px;padding:20px 32px;text-align:center;">
          <div style="font-size:11px;color:#9CA3AF;line-height:1.6;">Stride Logistics &middot; Kent, WA<br>This is an automated notification from Stride Hub. Do not reply to this email.</div>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>',
  'NOTIFICATION_EMAILS,SUBMITTER',
  'delivery',
  true,
  'Sent when a reviewer marks a delivery order as ''rejected''. Recipients: NOTIFICATION_EMAILS (office distro) + the order submitter. Same token set as ORDER_REVISION_REQUESTED.'
)
ON CONFLICT (template_key) DO NOTHING;
