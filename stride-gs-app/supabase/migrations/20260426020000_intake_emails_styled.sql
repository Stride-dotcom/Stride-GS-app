-- Intake email templates restyled to match the current PUBLIC_REQUEST_*
-- shell (Apr 27 — newest canonical email design).
--
-- Two templates, identical chrome (DOCTYPE → 600px centred card → dark
-- header → coloured reference-number band → white body table → footer):
--   1. INTAKE_RECEIPT_CLIENT  — sent to the prospect after they submit.
--      Auto-fired by GAS handleEmailSignedAgreement_ on submit success.
--      Green status pill + green band ("Agreement Signed").
--   2. INTAKE_SUBMITTED       — sent to staff when an intake lands.
--      Orange status pill + orange band ("Needs Review"). Includes a
--      "Review intake" CTA button to the Stride Hub deep-link.
--
-- Tokens used:
--   Common :  {{BUSINESS_NAME}} {{CONTACT_NAME}} {{CONTACT_EMAIL}} {{APP_URL}}
--   Client :  {{SIGNED_DATE}} {{INSURANCE_LABEL}} {{INSURANCE_DETAIL}}
--             {{AUTO_INSPECT_LABEL}} {{INTAKE_REF}}
--   Staff  :  {{CONTACT_PHONE}} {{SUBMITTED_AT}} {{INSURANCE_CHOICE}}
--             {{DECLARED_VALUE}} {{PAYMENT_AUTHORIZED}} {{REVIEW_LINK}}

INSERT INTO public.email_templates (template_key, subject, body, recipients, category, active, created_at, updated_at)
VALUES (
  'INTAKE_RECEIPT_CLIENT',
  '✓ Your Stride Logistics agreement is signed and on file',
  $TPL$<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#F5F5F0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F5F5F0;padding:40px 20px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">
      <tr>
        <td style="background:#1C1C1C;border-radius:16px 16px 0 0;padding:28px 32px;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td>
                <div style="color:#E85D2D;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:6px;">Stride Logistics</div>
                <div style="color:#ffffff;font-size:22px;font-weight:700;line-height:1.2;">Agreement Signed</div>
              </td>
              <td align="right" valign="top">
                <div style="background:#16A34A;color:#ffffff;font-size:11px;font-weight:700;padding:6px 14px;border-radius:20px;letter-spacing:1px;text-transform:uppercase;">Confirmed</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="background:#16A34A;padding:14px 32px;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td>
                <div style="color:#ffffff;font-size:11px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;opacity:0.9;margin-bottom:2px;">Reference</div>
                <div style="color:#ffffff;font-size:18px;font-weight:700;font-family:monospace,monospace;">{{INTAKE_REF}}</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="background:#ffffff;padding:28px 32px;border-radius:0 0 16px 16px;">
          <p style="margin:0 0 16px;color:#1F2937;font-size:15px;line-height:1.55;">
            Hi {{CONTACT_NAME}}, thanks for choosing Stride Logistics. We've received your signed Warehousing &amp; Delivery Agreement for <strong>{{BUSINESS_NAME}}</strong>. Our team will review it and email you within 1–2 business days to activate your account.
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0 8px;border-collapse:collapse;">
            <tr><td style="padding:8px 0;font-size:12px;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;border-bottom:1px solid #E5E7EB;">Business</td><td style="padding:8px 0;font-size:13px;color:#1F2937;text-align:right;border-bottom:1px solid #E5E7EB;">{{BUSINESS_NAME}}</td></tr>
            <tr><td style="padding:8px 0;font-size:12px;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;border-bottom:1px solid #E5E7EB;">Signed</td><td style="padding:8px 0;font-size:13px;color:#1F2937;text-align:right;border-bottom:1px solid #E5E7EB;">{{SIGNED_DATE}}</td></tr>
            <tr><td style="padding:8px 0;font-size:12px;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;border-bottom:1px solid #E5E7EB;">Coverage</td><td style="padding:8px 0;font-size:13px;color:#1F2937;text-align:right;border-bottom:1px solid #E5E7EB;">{{INSURANCE_LABEL}}</td></tr>
            <tr><td style="padding:8px 0;font-size:12px;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;border-bottom:1px solid #E5E7EB;">Coverage Detail</td><td style="padding:8px 0;font-size:13px;color:#1F2937;text-align:right;border-bottom:1px solid #E5E7EB;">{{INSURANCE_DETAIL}}</td></tr>
            <tr><td style="padding:8px 0;font-size:12px;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;">Auto-Inspection</td><td style="padding:8px 0;font-size:13px;color:#1F2937;text-align:right;">{{AUTO_INSPECT_LABEL}}</td></tr>
          </table>
          <p style="margin:18px 0 0;color:#6B7280;font-size:12px;line-height:1.5;">
            Please save this email as your record of the signed agreement. Reply to this message any time if you need a printable PDF copy or have questions before activation.
          </p>
        </td>
      </tr>
      <tr>
        <td align="center" style="padding:18px 12px 0;">
          <div style="font-size:11px;color:#9CA3AF;">Stride Logistics · Kent, WA · <a href="{{APP_URL}}" style="color:#E85D2D;text-decoration:none;">mystridehub.com</a></div>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>$TPL$,
  '',  -- recipients resolved per-call from the prospect's email; not from STAFF_EMAILS
  'system',
  true,
  now(),
  now()
)
ON CONFLICT (template_key) DO UPDATE
SET subject = EXCLUDED.subject,
    body = EXCLUDED.body,
    recipients = EXCLUDED.recipients,
    category = EXCLUDED.category,
    active = true,
    updated_at = now();

-- Restyle INTAKE_SUBMITTED to the same canonical PUBLIC_REQUEST_ALERT shell.
UPDATE public.email_templates
SET body = $TPL$<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#F5F5F0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F5F5F0;padding:40px 20px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">
      <tr>
        <td style="background:#1C1C1C;border-radius:16px 16px 0 0;padding:28px 32px;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td>
                <div style="color:#E85D2D;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:6px;">Stride Logistics</div>
                <div style="color:#ffffff;font-size:22px;font-weight:700;line-height:1.2;">New Client<br>Intake Submitted</div>
              </td>
              <td align="right" valign="top">
                <div style="background:#E85D2D;color:#ffffff;font-size:11px;font-weight:700;padding:6px 14px;border-radius:20px;letter-spacing:1px;text-transform:uppercase;">Needs Review</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="background:#E85D2D;padding:14px 32px;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td>
                <div style="color:#ffffff;font-size:11px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;opacity:0.9;margin-bottom:2px;">Business</div>
                <div style="color:#ffffff;font-size:18px;font-weight:700;">{{BUSINESS_NAME}}</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="background:#ffffff;padding:28px 32px;border-radius:0 0 16px 16px;">
          <p style="margin:0 0 16px;color:#1F2937;font-size:15px;line-height:1.55;">
            <strong>{{CONTACT_NAME}}</strong> just completed the onboarding form and signed the Warehousing &amp; Delivery Agreement. Review the submission and convert to an active client when ready.
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
            <tr><td style="padding:8px 0;font-size:12px;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;border-bottom:1px solid #E5E7EB;">Contact</td><td style="padding:8px 0;font-size:13px;color:#1F2937;text-align:right;border-bottom:1px solid #E5E7EB;">{{CONTACT_NAME}}</td></tr>
            <tr><td style="padding:8px 0;font-size:12px;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;border-bottom:1px solid #E5E7EB;">Email</td><td style="padding:8px 0;font-size:13px;color:#1F2937;text-align:right;border-bottom:1px solid #E5E7EB;"><a href="mailto:{{CONTACT_EMAIL}}" style="color:#E85D2D;text-decoration:none;">{{CONTACT_EMAIL}}</a></td></tr>
            <tr><td style="padding:8px 0;font-size:12px;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;border-bottom:1px solid #E5E7EB;">Phone</td><td style="padding:8px 0;font-size:13px;color:#1F2937;text-align:right;border-bottom:1px solid #E5E7EB;">{{CONTACT_PHONE}}</td></tr>
            <tr><td style="padding:8px 0;font-size:12px;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;border-bottom:1px solid #E5E7EB;">Submitted</td><td style="padding:8px 0;font-size:13px;color:#1F2937;text-align:right;border-bottom:1px solid #E5E7EB;">{{SUBMITTED_AT}}</td></tr>
            <tr><td style="padding:8px 0;font-size:12px;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;border-bottom:1px solid #E5E7EB;">Coverage</td><td style="padding:8px 0;font-size:13px;color:#1F2937;text-align:right;border-bottom:1px solid #E5E7EB;">{{INSURANCE_CHOICE}}</td></tr>
            <tr><td style="padding:8px 0;font-size:12px;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;border-bottom:1px solid #E5E7EB;">Declared Value</td><td style="padding:8px 0;font-size:13px;color:#1F2937;text-align:right;border-bottom:1px solid #E5E7EB;">{{DECLARED_VALUE}}</td></tr>
            <tr><td style="padding:8px 0;font-size:12px;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;">Payment Auth</td><td style="padding:8px 0;font-size:13px;color:#1F2937;text-align:right;">{{PAYMENT_AUTHORIZED}}</td></tr>
          </table>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;">
            <tr><td align="center"><a href="{{REVIEW_LINK}}" style="display:inline-block;background:#E85D2D;color:#ffffff;text-decoration:none;font-weight:700;font-size:13px;padding:12px 22px;border-radius:8px;">Review Intake</a></td></tr>
          </table>
        </td>
      </tr>
      <tr>
        <td align="center" style="padding:18px 12px 0;">
          <div style="font-size:11px;color:#9CA3AF;">Submitted via Stride Hub on <a href="{{APP_URL}}" style="color:#E85D2D;text-decoration:none;">mystridehub.com</a></div>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>$TPL$,
    updated_at = now()
WHERE template_key = 'INTAKE_SUBMITTED';
