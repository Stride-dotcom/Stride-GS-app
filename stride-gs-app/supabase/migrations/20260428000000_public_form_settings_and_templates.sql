-- 20260428000000_public_form_settings_and_templates.sql
--
-- Follow-up to 20260426220000_dt_orders_public_form_anon_insert.sql
-- (the source CHECK extension + anon INSERT RLS already shipped in
-- PR #105). This migration adds the remaining pieces needed to wire
-- the public service-request notifications:
--
--   1. dt_orders.contact_company column
--   2. Partial unique index for NULL-tenant public_form rows so two
--      anonymous submissions can't collide on the same SRF identifier
--   3. public_form_settings singleton table (alert recipients +
--      reply-to) with admin-only RLS and updated_at trigger
--   4. PUBLIC_REQUEST_CONFIRMATION email template (submitter)
--   5. PUBLIC_REQUEST_ALERT email template (internal recipients)
--
-- The notify-public-request edge function reads this config via the
-- service role and dispatches both emails through StrideAPI.gs's
-- sendRawEmail action.

-- ── 1. contact_company column ───────────────────────────────────────
ALTER TABLE public.dt_orders
  ADD COLUMN IF NOT EXISTS contact_company text;

COMMENT ON COLUMN public.dt_orders.contact_company IS
  'Optional business/organization name for the contact. Used by the public service-request form; may be set on in-app orders too.';

-- ── 2. Partial unique index for NULL-tenant public_form rows ────────
-- Table-level UNIQUE(tenant_id, dt_identifier) treats each NULL
-- tenant_id as distinct, so two public_form rows could collide on
-- the same SRF-XXX identifier. This partial index treats NULL-tenant
-- public_form rows as a single namespace; the React form retries on
-- conflict.
CREATE UNIQUE INDEX IF NOT EXISTS dt_orders_public_form_identifier_uniq
  ON public.dt_orders (dt_identifier)
  WHERE tenant_id IS NULL AND source = 'public_form';

-- ── 3. public_form_settings (singleton) ─────────────────────────────
-- Singleton-by-convention via id=1 + a CHECK constraint. The seed
-- INSERT below populates the row; admin UPDATE policy keeps it
-- editable but prevents any new rows.
CREATE TABLE IF NOT EXISTS public.public_form_settings (
  id              smallint    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  alert_emails    text[]      NOT NULL DEFAULT '{}'::text[],
  reply_to_email  text,
  notes           text,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.public_form_settings IS
  'Singleton config (id=1) for the public service-request form: alert-email recipients + reply-to for confirmation emails.';

INSERT INTO public.public_form_settings (id, alert_emails, reply_to_email)
VALUES (1, '{}'::text[], NULL)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.public_form_settings ENABLE ROW LEVEL SECURITY;

-- Admin-only SELECT (the form itself doesn't need to read it; the
-- edge function uses the service role and bypasses RLS).
CREATE POLICY "public_form_settings_select_admin"
ON public.public_form_settings
FOR SELECT
TO authenticated
USING (
  ((auth.jwt() -> 'user_metadata') ->> 'role') = 'admin'
);

CREATE POLICY "public_form_settings_update_admin"
ON public.public_form_settings
FOR UPDATE
TO authenticated
USING (
  ((auth.jwt() -> 'user_metadata') ->> 'role') = 'admin'
)
WITH CHECK (
  ((auth.jwt() -> 'user_metadata') ->> 'role') = 'admin'
);

CREATE OR REPLACE TRIGGER public_form_settings_updated_at
  BEFORE UPDATE ON public.public_form_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 4. Email templates ──────────────────────────────────────────────
-- Two templates, mirroring the visual structure of
-- ORDER_REVIEW_REQUEST / ORDER_REVISION_REQUESTED:
--   PUBLIC_REQUEST_CONFIRMATION  → green accent (#16A34A) — submitter
--   PUBLIC_REQUEST_ALERT         → orange accent (#E85D2D) — internal
-- Tokens supported:
--   {{REQUEST_ID}}        Generated SRF identifier (dt_identifier)
--   {{CONTACT_NAME}}      Submitter's name
--   {{CONTACT_COMPANY}}   Submitter's company (optional)
--   {{CONTACT_PHONE}}     Submitter's phone
--   {{CONTACT_EMAIL}}     Submitter's email
--   {{SERVICE_DATE}}      Requested service date
--   {{SERVICE_ADDRESS}}   Concatenated single-line service address
--   {{ITEM_COUNT}}        Number of dt_order_items rows
--   {{NOTES}}             Optional submitter notes (rendered as "—" when empty)
--   {{REVIEW_LINK}}       Deep-link into review queue (alert email only)
--   {{APP_URL}}           Stride Hub root

INSERT INTO public.email_templates (template_key, subject, body, recipients, category, active, notes) VALUES (
  'PUBLIC_REQUEST_CONFIRMATION',
  'We received your service request — {{REQUEST_ID}}',
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
                <div style="color:#ffffff;font-size:22px;font-weight:700;line-height:1.2;">Request Received</div>
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
                <div style="color:#ffffff;font-size:11px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;opacity:0.9;margin-bottom:2px;">Reference Number</div>
                <div style="color:#ffffff;font-size:18px;font-weight:700;font-family:monospace,monospace;">{{REQUEST_ID}}</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="background:#ffffff;padding:28px 32px;border-radius:0 0 16px 16px;">
          <p style="margin:0 0 16px;color:#1F2937;font-size:15px;line-height:1.55;">
            Hi {{CONTACT_NAME}}, thanks for reaching out to Stride Logistics. We have your request and will follow up within one business day with pricing and scheduling.
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0 8px;border-collapse:collapse;">
            <tr><td style="padding:8px 0;font-size:12px;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;border-bottom:1px solid #E5E7EB;">Service Date</td><td style="padding:8px 0;font-size:13px;color:#1F2937;text-align:right;border-bottom:1px solid #E5E7EB;">{{SERVICE_DATE}}</td></tr>
            <tr><td style="padding:8px 0;font-size:12px;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;border-bottom:1px solid #E5E7EB;">Service Address</td><td style="padding:8px 0;font-size:13px;color:#1F2937;text-align:right;border-bottom:1px solid #E5E7EB;">{{SERVICE_ADDRESS}}</td></tr>
            <tr><td style="padding:8px 0;font-size:12px;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;border-bottom:1px solid #E5E7EB;">Items</td><td style="padding:8px 0;font-size:13px;color:#1F2937;text-align:right;border-bottom:1px solid #E5E7EB;">{{ITEM_COUNT}}</td></tr>
            <tr><td style="padding:8px 0;font-size:12px;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;">Notes</td><td style="padding:8px 0;font-size:13px;color:#1F2937;text-align:right;">{{NOTES}}</td></tr>
          </table>
          <p style="margin:18px 0 0;color:#6B7280;font-size:12px;line-height:1.5;">
            Reply to this email if anything in the request needs to change before we get in touch.
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
</html>',
  'SUBMITTER',
  'email',
  true,
  'Auto-confirmation sent to the submitter of the public service-request form. Recipients=SUBMITTER → resolved at send time from dt_orders.contact_email.'
)
ON CONFLICT (template_key) DO NOTHING;

INSERT INTO public.email_templates (template_key, subject, body, recipients, category, active, notes) VALUES (
  'PUBLIC_REQUEST_ALERT',
  'New public service request — {{REQUEST_ID}}',
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
                <div style="color:#ffffff;font-size:22px;font-weight:700;line-height:1.2;">New Public<br>Service Request</div>
              </td>
              <td align="right" valign="top">
                <div style="background:#E85D2D;color:#ffffff;font-size:11px;font-weight:700;padding:6px 14px;border-radius:20px;letter-spacing:1px;text-transform:uppercase;">Needs Triage</div>
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
                <div style="color:#ffffff;font-size:11px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;opacity:0.9;margin-bottom:2px;">Reference Number</div>
                <div style="color:#ffffff;font-size:18px;font-weight:700;font-family:monospace,monospace;">{{REQUEST_ID}}</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="background:#ffffff;padding:28px 32px;border-radius:0 0 16px 16px;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
            <tr><td style="padding:8px 0;font-size:12px;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;border-bottom:1px solid #E5E7EB;">Contact</td><td style="padding:8px 0;font-size:13px;color:#1F2937;text-align:right;border-bottom:1px solid #E5E7EB;">{{CONTACT_NAME}}</td></tr>
            <tr><td style="padding:8px 0;font-size:12px;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;border-bottom:1px solid #E5E7EB;">Company</td><td style="padding:8px 0;font-size:13px;color:#1F2937;text-align:right;border-bottom:1px solid #E5E7EB;">{{CONTACT_COMPANY}}</td></tr>
            <tr><td style="padding:8px 0;font-size:12px;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;border-bottom:1px solid #E5E7EB;">Phone</td><td style="padding:8px 0;font-size:13px;color:#1F2937;text-align:right;border-bottom:1px solid #E5E7EB;">{{CONTACT_PHONE}}</td></tr>
            <tr><td style="padding:8px 0;font-size:12px;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;border-bottom:1px solid #E5E7EB;">Email</td><td style="padding:8px 0;font-size:13px;color:#1F2937;text-align:right;border-bottom:1px solid #E5E7EB;">{{CONTACT_EMAIL}}</td></tr>
            <tr><td style="padding:8px 0;font-size:12px;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;border-bottom:1px solid #E5E7EB;">Service Date</td><td style="padding:8px 0;font-size:13px;color:#1F2937;text-align:right;border-bottom:1px solid #E5E7EB;">{{SERVICE_DATE}}</td></tr>
            <tr><td style="padding:8px 0;font-size:12px;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;border-bottom:1px solid #E5E7EB;">Service Address</td><td style="padding:8px 0;font-size:13px;color:#1F2937;text-align:right;border-bottom:1px solid #E5E7EB;">{{SERVICE_ADDRESS}}</td></tr>
            <tr><td style="padding:8px 0;font-size:12px;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;border-bottom:1px solid #E5E7EB;">Items</td><td style="padding:8px 0;font-size:13px;color:#1F2937;text-align:right;border-bottom:1px solid #E5E7EB;">{{ITEM_COUNT}}</td></tr>
            <tr><td style="padding:8px 0;font-size:12px;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;">Notes</td><td style="padding:8px 0;font-size:13px;color:#1F2937;text-align:right;">{{NOTES}}</td></tr>
          </table>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;">
            <tr><td align="center"><a href="{{REVIEW_LINK}}" style="display:inline-block;background:#E85D2D;color:#ffffff;text-decoration:none;font-weight:700;font-size:13px;padding:12px 22px;border-radius:8px;">Open Review Queue</a></td></tr>
          </table>
        </td>
      </tr>
      <tr>
        <td align="center" style="padding:18px 12px 0;">
          <div style="font-size:11px;color:#9CA3AF;">Submitted via the public service-request form on <a href="{{APP_URL}}" style="color:#E85D2D;text-decoration:none;">mystridehub.com</a></div>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>',
  'PUBLIC_FORM_SETTINGS',
  'email',
  true,
  'Internal alert sent to the recipient list configured in public_form_settings.alert_emails when a new public service request arrives.'
)
ON CONFLICT (template_key) DO NOTHING;
