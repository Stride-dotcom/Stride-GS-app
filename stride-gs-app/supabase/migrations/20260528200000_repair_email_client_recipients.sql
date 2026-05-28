-- Add {{CLIENT_EMAIL}} to REPAIR_APPROVED + REPAIR_DECLINED recipients (2026-05-28)
--
-- Per the audit on 2026-05-28: the customer was never on the To: line of any
-- of these four repair emails because (a) the {{CLIENT_EMAIL}} token wasn't
-- implemented in send-email's expandToken() resolver, and (b) two of the
-- templates didn't even list the token in their recipients column.
--
-- Companion edge-function change in supabase/functions/send-email/index.ts
-- adds the CLIENT_EMAIL case to expandToken (resolves against
-- clients.notification_contacts → clients.email fallback). This migration
-- updates the two templates that were missing the token entirely.
--
-- REPAIR_QUOTE + REPAIR_COMPLETE already had `info@stridenw.com,{{CLIENT_EMAIL}}`
-- in their recipients column — they just needed the EF-side token fix.
-- REPAIR_APPROVED + REPAIR_DECLINED only had `info@stridenw.com` — they need
-- both the EF fix AND the recipients-column extension to start including
-- the customer.
--
-- After both changes ship, all four repair emails (Quote / Approved /
-- Declined / Complete) deliver to info@stridenw.com + every email in
-- clients.notification_contacts for the tenant.

UPDATE email_templates
SET recipients = 'info@stridenw.com,{{CLIENT_EMAIL}}',
    updated_by_name = 'repair-customer-email-fix-20260528'
WHERE template_key IN ('REPAIR_APPROVED', 'REPAIR_DECLINED')
  AND recipients = 'info@stridenw.com';

-- Assertion: both templates now carry the token. Aborts the migration
-- if either row was already on a different recipients string (e.g., an
-- admin edited it out-of-band between the audit and this apply) so the
-- operator can review before letting the migration go through.
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(template_key, ', ' ORDER BY template_key)
    INTO missing
    FROM email_templates
   WHERE template_key IN ('REPAIR_APPROVED', 'REPAIR_DECLINED')
     AND recipients NOT LIKE '%{{CLIENT_EMAIL}}%';
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'repair_email_client_recipients: template(s) % do not carry {{CLIENT_EMAIL}} after update — recipients column may have been edited out-of-band. Inspect email_templates.recipients before re-running.', missing;
  END IF;
END $$;
