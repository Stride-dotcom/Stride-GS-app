-- Client intake submission notifications.
--
-- Fires on every new row inserted into client_intakes (when a prospect
-- submits the /intake/:linkId form).
--
-- What this migration does:
--   1. Seeds an INTAKE_SUBMITTED row in email_templates so admins can edit
--      the subject / body / recipients list from Settings → Email Templates.
--      Uses INSERT ... ON CONFLICT DO NOTHING so re-running is safe and
--      won't clobber any edits made after the initial seed.
--   2. Creates notify_admins_on_intake_submit() — a trigger function that
--      INSERTs one in_app_notifications row per active admin user. Admins
--      see the bell badge increment + a row in the notifications drawer
--      within ~1s (powered by the existing Supabase Realtime subscription
--      on in_app_notifications).
--   3. Creates the AFTER INSERT trigger on client_intakes.
--
-- The email side of the notification is handled by the React submitIntake
-- hook firing a fire-and-forget apiFetch('notifyIntakeSubmitted', …) after
-- the insert succeeds. GAS reads the INTAKE_SUBMITTED template and sends
-- via MailApp to the admin distribution list — recipients are configurable
-- by editing the template's "Recipients" field in Settings → Email Templates.

-- ─── 1. Seed email template ────────────────────────────────────────────────

INSERT INTO public.email_templates (
  template_key,
  subject,
  body,
  notes,
  recipients,
  category,
  active
) VALUES (
  'INTAKE_SUBMITTED',
  '📝 New Client Intake — {{BUSINESS_NAME}} ({{CONTACT_NAME}})',
  E'<div style="font-family: -apple-system, BlinkMacSystemFont, ''Segoe UI'', sans-serif; max-width: 600px; color: #111;">\n'
  || E'  <div style="background: #E85D2D; color: #fff; padding: 16px 24px; border-radius: 8px 8px 0 0;">\n'
  || E'    <h2 style="margin: 0; font-size: 18px;">New Client Intake Received</h2>\n'
  || E'  </div>\n'
  || E'  <div style="border: 1px solid #E5E7EB; border-top: 0; padding: 20px 24px; border-radius: 0 0 8px 8px; background: #fff;">\n'
  || E'    <p style="margin-top: 0;"><strong>{{BUSINESS_NAME}}</strong> just submitted the onboarding form and is ready for admin review.</p>\n'
  || E'    <table style="width:100%; border-collapse: collapse; margin: 16px 0;">\n'
  || E'      <tr><td style="padding:6px 0; color:#6B7280; width: 150px;">Business</td><td style="padding:6px 0;"><strong>{{BUSINESS_NAME}}</strong></td></tr>\n'
  || E'      <tr><td style="padding:6px 0; color:#6B7280;">Primary contact</td><td style="padding:6px 0;">{{CONTACT_NAME}}</td></tr>\n'
  || E'      <tr><td style="padding:6px 0; color:#6B7280;">Email</td><td style="padding:6px 0;"><a href="mailto:{{CONTACT_EMAIL}}" style="color:#E85D2D;">{{CONTACT_EMAIL}}</a></td></tr>\n'
  || E'      <tr><td style="padding:6px 0; color:#6B7280;">Phone</td><td style="padding:6px 0;">{{CONTACT_PHONE}}</td></tr>\n'
  || E'      <tr><td style="padding:6px 0; color:#6B7280;">Submitted</td><td style="padding:6px 0;">{{SUBMITTED_AT}}</td></tr>\n'
  || E'      <tr><td style="padding:6px 0; color:#6B7280;">Insurance choice</td><td style="padding:6px 0;">{{INSURANCE_CHOICE}}</td></tr>\n'
  || E'      <tr><td style="padding:6px 0; color:#6B7280;">Declared value</td><td style="padding:6px 0;">{{DECLARED_VALUE}}</td></tr>\n'
  || E'      <tr><td style="padding:6px 0; color:#6B7280;">Payment auth</td><td style="padding:6px 0;">{{PAYMENT_AUTHORIZED}}</td></tr>\n'
  || E'    </table>\n'
  || E'    <div style="text-align:center; margin: 24px 0;">\n'
  || E'      <a href="{{REVIEW_LINK}}" style="display:inline-block; padding:12px 28px; background:#E85D2D; color:#fff; text-decoration:none; border-radius:6px; font-weight:600;">Review Intake</a>\n'
  || E'    </div>\n'
  || E'    <p style="color:#6B7280; font-size:12px; margin-bottom:0;">Review the full submission, approve, request more info, or convert to an active client in Settings → Clients → Intakes.</p>\n'
  || E'  </div>\n'
  || E'</div>',
  E'Fires when a prospect submits the public /intake/:linkId form.\n\n'
  || E'Available tokens:\n'
  || E'  {{BUSINESS_NAME}}         — from intake form\n'
  || E'  {{CONTACT_NAME}}          — primary contact\n'
  || E'  {{CONTACT_EMAIL}}         — contact email\n'
  || E'  {{CONTACT_PHONE}}         — phone\n'
  || E'  {{SUBMITTED_AT}}          — timestamp\n'
  || E'  {{INSURANCE_CHOICE}}      — coverage level selected\n'
  || E'  {{DECLARED_VALUE}}        — declared inventory value (USD)\n'
  || E'  {{PAYMENT_AUTHORIZED}}    — Yes / No\n'
  || E'  {{REVIEW_LINK}}           — deep link to Settings → Clients → Intakes\n\n'
  || E'Recipients default to the CB Settings OWNER_EMAIL + NOTIFICATION_EMAILS when this field is blank.',
  '',  -- recipients: blank = use CB Settings OWNER_EMAIL + NOTIFICATION_EMAILS
  'intake',
  TRUE
)
ON CONFLICT (template_key) DO NOTHING;

-- ─── 2. Trigger function: in-app notifications for every admin ─────────────

CREATE OR REPLACE FUNCTION public.notify_admins_on_intake_submit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  admin_profile RECORD;
  display_biz   TEXT;
  display_name  TEXT;
BEGIN
  display_biz  := COALESCE(NULLIF(trim(NEW.business_name), ''), 'unnamed business');
  display_name := COALESCE(NULLIF(trim(NEW.contact_name), ''), 'unknown contact');

  FOR admin_profile IN
    SELECT id
      FROM public.profiles
     WHERE role = 'admin'
       AND COALESCE(is_active, TRUE) = TRUE
  LOOP
    INSERT INTO public.in_app_notifications (
      tenant_id,
      user_id,
      title,
      body,
      icon,
      category,
      related_entity_type,
      related_entity_id,
      action_url,
      priority
    ) VALUES (
      'stride',
      admin_profile.id,
      'New client intake: ' || display_biz,
      display_name || ' submitted the onboarding form and is ready for review.',
      '📝',
      'intake',
      'client_intake',
      NEW.id::text,
      '#/settings?tab=clients&subtab=intakes&intake=' || NEW.id::text,
      'high'
    );
  END LOOP;

  RETURN NEW;
END;
$$;

-- ─── 3. Bind trigger to client_intakes ─────────────────────────────────────

DROP TRIGGER IF EXISTS trg_notify_admins_on_intake_submit ON public.client_intakes;

CREATE TRIGGER trg_notify_admins_on_intake_submit
AFTER INSERT ON public.client_intakes
FOR EACH ROW
EXECUTE FUNCTION public.notify_admins_on_intake_submit();
