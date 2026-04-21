-- Migration: Insert CLIENT_INTAKE_INVITE email template
-- Used when an admin generates a new intake link and the prospect has an email address.
-- The admin can edit the subject/body in the modal before sending.
-- Tokens: {{PROSPECT_NAME}}, {{INTAKE_LINK}}, {{EXPIRES_DATE}}

INSERT INTO public.email_templates (
  template_key,
  category,
  subject,
  body,
  notes,
  active
)
VALUES (
  'CLIENT_INTAKE_INVITE',
  'system',
  'Your Client Onboarding Invitation — Stride Logistics',
  '<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Client Onboarding Invitation</title>
  <style>
    body { margin: 0; padding: 0; background: #F5F2EE; font-family: -apple-system, BlinkMacSystemFont, ''Segoe UI'', Roboto, sans-serif; }
    .wrapper { max-width: 580px; margin: 32px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
    .header { background: #1C1C1C; padding: 32px 40px; text-align: center; }
    .header .logo-mark { display: inline-block; width: 48px; height: 48px; background: #E8692A; border-radius: 10px; line-height: 48px; font-size: 26px; font-weight: 800; color: #ffffff; margin-bottom: 16px; }
    .header h1 { margin: 0; color: #ffffff; font-size: 20px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
    .header p { margin: 6px 0 0; color: #A0A0A0; font-size: 14px; }
    .body { padding: 36px 40px; }
    .greeting { font-size: 17px; color: #1C1C1C; margin: 0 0 20px; font-weight: 600; }
    .intro { font-size: 15px; color: #444; line-height: 1.65; margin: 0 0 28px; }
    .cta-block { text-align: center; margin: 28px 0; }
    .cta-btn { display: inline-block; background: #E8692A; color: #ffffff; text-decoration: none; padding: 14px 36px; border-radius: 8px; font-size: 16px; font-weight: 700; letter-spacing: 0.02em; }
    .link-note { font-size: 13px; color: #888; text-align: center; margin: 12px 0 28px; }
    .link-note a { color: #E8692A; word-break: break-all; }
    .expires { font-size: 13px; color: #888; text-align: center; margin: 0 0 28px; }
    .divider { border: none; border-top: 1px solid #EEE; margin: 28px 0; }
    .steps { background: #F9F7F4; border-radius: 10px; padding: 20px 24px; margin: 0 0 28px; }
    .steps h3 { margin: 0 0 14px; font-size: 14px; color: #1C1C1C; text-transform: uppercase; letter-spacing: 0.06em; }
    .steps ol { margin: 0; padding: 0 0 0 18px; }
    .steps li { font-size: 14px; color: #555; line-height: 1.7; }
    .footer { background: #F5F2EE; padding: 20px 40px; text-align: center; }
    .footer p { margin: 0; font-size: 12px; color: #999; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <div class="logo-mark">S</div>
      <h1>Warehousing &amp; Delivery Agreement</h1>
      <p>Client Onboarding Invitation</p>
    </div>
    <div class="body">
      <p class="greeting">Hi {{PROSPECT_NAME}},</p>
      <p class="intro">
        We''re excited to get you set up as a Stride Logistics client. To complete your onboarding,
        please click the button below to review and sign our Warehousing &amp; Delivery Agreement.
        The process takes about 5 minutes.
      </p>
      <div class="cta-block">
        <a href="{{INTAKE_LINK}}" class="cta-btn">Begin Onboarding →</a>
      </div>
      <p class="link-note">Or copy this link: <a href="{{INTAKE_LINK}}">{{INTAKE_LINK}}</a></p>
      <p class="expires">⏳ This link expires on <strong>{{EXPIRES_DATE}}</strong>.</p>
      <hr class="divider" />
      <div class="steps">
        <h3>What to expect</h3>
        <ol>
          <li>Enter your business contact information</li>
          <li>Select your preferred liability coverage option</li>
          <li>Review and sign the Warehousing &amp; Delivery Agreement</li>
        </ol>
      </div>
      <p style="font-size:14px; color:#666; line-height:1.65; margin:0;">
        Questions? Reply to this email or reach us at
        <a href="mailto:info@stridelogistics.com" style="color:#E8692A;">info@stridelogistics.com</a>.
      </p>
    </div>
    <div class="footer">
      <p>Stride Logistics · Kent, WA<br/>
      This invitation was sent on behalf of your account manager.</p>
    </div>
  </div>
</body>
</html>',
  'Sent to a prospect when a new intake link is generated. Tokens: {{PROSPECT_NAME}}, {{INTAKE_LINK}}, {{EXPIRES_DATE}}. Subject and body are editable in the send modal before sending.',
  true
)
ON CONFLICT (template_key) DO NOTHING;
