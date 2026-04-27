-- 20260427000000_public_service_request.sql
--
-- Public Service Request form — anonymous (no-auth) submission of
-- delivery/service requests by prospects. Mirrors the in-app
-- CreateDeliveryOrderModal layout but accepts only ad-hoc line items
-- and gathers contact info instead of selecting an authenticated
-- tenant.
--
-- Surface area changed:
--   1. dt_orders.source CHECK gains 'public_form'
--   2. dt_orders / dt_order_items get narrow anon INSERT RLS policies
--      so an unauthenticated browser can drop a single pending order +
--      its line items into the table without acquiring SELECT, UPDATE,
--      or DELETE. Other public_form rows are NOT readable to anon.
--   3. New singleton-by-convention table public_form_settings holds
--      the configurable alert-email recipient list. SELECT/UPDATE
--      restricted to admin via JWT user_metadata.role check.
--
-- The submitted rows always carry tenant_id = NULL,
-- source = 'public_form', review_status = 'pending_review'. Staff
-- triage and assign a tenant via the standard review workflow.
-- An Edge Function (submit-public-service-request) handles the
-- confirmation email to the submitter and the alert email to the
-- recipients listed in public_form_settings.

-- ── 1. Extend dt_orders.source CHECK ────────────────────────────────
-- The constraint was already named `dt_orders_source_check` by
-- migration 20260415000000_dt_phase1c_webhook_prep.sql, and currently
-- allows ('app','dt_ui','webhook_backfill','reconcile','dt_webhook').
-- We drop + re-add unconditionally with the full list including
-- 'public_form'. Matches the pattern used in 20260415000000.
ALTER TABLE public.dt_orders
  DROP CONSTRAINT IF EXISTS dt_orders_source_check;

ALTER TABLE public.dt_orders
  ADD CONSTRAINT dt_orders_source_check
  CHECK (source IN ('app','dt_ui','webhook_backfill','reconcile','dt_webhook','public_form'));

COMMENT ON COLUMN public.dt_orders.source IS
  'Origin of the row: app | dt_ui | webhook_backfill | reconcile | dt_webhook | public_form';

-- ── 1a. Uniqueness for public_form dt_identifier ────────────────────
-- The table-level UNIQUE(tenant_id, dt_identifier) treats each NULL
-- tenant_id as distinct, so two public_form rows could collide on
-- the same SRF-XXX identifier. Add a partial unique index that
-- treats NULL-tenant public_form rows as a single namespace. The
-- React form retries on conflict.
CREATE UNIQUE INDEX IF NOT EXISTS dt_orders_public_form_identifier_uniq
  ON public.dt_orders (dt_identifier)
  WHERE tenant_id IS NULL AND source = 'public_form';

-- ── 1b. contact_company column ──────────────────────────────────────
-- Public service-request submitters often represent a business; the
-- existing contact_name field captures the individual but a separate
-- company column lets staff sort/triage by org without parsing notes.
-- Nullable; useful for in-app orders too but never required.
ALTER TABLE public.dt_orders
  ADD COLUMN IF NOT EXISTS contact_company text;

COMMENT ON COLUMN public.dt_orders.contact_company IS
  'Optional business/organization name for the contact. Used by the public service-request form; may be set on in-app orders too.';

-- ── 2. Anon INSERT RLS for public_form submissions ──────────────────
-- The anon role gets a single, very narrow INSERT path: tenant_id MUST
-- be NULL, source MUST be public_form, review_status MUST be
-- pending_review. No SELECT/UPDATE/DELETE policy is granted, so the
-- submitter cannot read back their row or any other row.
CREATE POLICY "dt_orders_insert_public_form"
ON public.dt_orders
FOR INSERT
TO anon
WITH CHECK (
  tenant_id IS NULL
  AND source = 'public_form'
  AND review_status = 'pending_review'
);

-- Items policy: the parent dt_order must itself be a pending
-- public_form row. EXISTS subquery does the lookup in the same
-- transaction the INSERT is executing in.
CREATE POLICY "dt_order_items_insert_public_form"
ON public.dt_order_items
FOR INSERT
TO anon
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.dt_orders o
    WHERE o.id = dt_order_items.dt_order_id
      AND o.tenant_id IS NULL
      AND o.source = 'public_form'
      AND o.review_status = 'pending_review'
  )
);

-- ── 3. public_form_settings (singleton) ─────────────────────────────
-- Holds the configurable list of internal alert recipients (admins +
-- ops folks who get pinged when a new public submission arrives).
-- Singleton-by-convention via id=1 + a CHECK constraint enforced on
-- INSERT — there is no need for a more elaborate one-row pattern
-- since UPDATE-only policies prevent anon/authenticated from
-- creating a second row.
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

-- Seed the singleton row so UPDATE-only policies are sufficient.
INSERT INTO public.public_form_settings (id, alert_emails, reply_to_email)
VALUES (1, '{}'::text[], NULL)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.public_form_settings ENABLE ROW LEVEL SECURITY;

-- Admin-only SELECT (the form itself doesn't need to read it; the
-- Edge Function uses the service role and bypasses RLS).
CREATE POLICY "public_form_settings_select_admin"
ON public.public_form_settings
FOR SELECT
TO authenticated
USING (
  ((auth.jwt() -> 'user_metadata') ->> 'role') = 'admin'
);

-- Admin-only UPDATE.
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

-- ── 4. updated_at trigger ───────────────────────────────────────────
CREATE OR REPLACE TRIGGER public_form_settings_updated_at
  BEFORE UPDATE ON public.public_form_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 5. Email templates ──────────────────────────────────────────────
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
