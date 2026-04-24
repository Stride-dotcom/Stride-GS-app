-- email_templates.recipients for INTAKE_SUBMITTED — use the canonical
-- {{STAFF_EMAILS}} token so it matches every other staff-alert template
-- (CLAIM_*, REPAIR_*, WILL_CALL_*, SHIPMENT_RECEIVED, TASK_COMPLETE,
-- ORDER_REVIEW_REQUEST, etc.).
--
-- The row used to carry an empty `recipients` column and the GAS handler
-- fell back to CB Settings OWNER_EMAIL + NOTIFICATION_EMAILS, which
-- worked but was inconsistent with the documented convention and meant
-- admins couldn't override the recipient list from Settings → Email
-- Templates without editing the CB sheet.
--
-- Paired GAS change: handleNotifyIntakeSubmitted_ (v38.119.0) now expands
-- {{STAFF_EMAILS}} in this column before sending. Without that handler
-- change the token would be passed through as a literal string and the
-- email would fail to send.

UPDATE public.email_templates
   SET recipients = '{{STAFF_EMAILS}}',
       updated_at = now()
 WHERE template_key = 'INTAKE_SUBMITTED';
