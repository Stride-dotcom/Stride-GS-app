-- DELIVERY_ORDER_APPROVED — fix misleading greeting
--
-- Context: PRs #508 + #509 routed this email to the SUBMITTER (the person
-- who created the order in the Stride app) instead of the delivery contact.
-- But the body still opens with "Hi {{CONTACT_NAME}}, ..." where
-- CONTACT_NAME is the end-customer (the recipient on the delivery). So
-- when an office user at a warehouse client opens the email, they see
-- their customer's name in the greeting — confusing.
--
-- Fix: drop the personalized greeting and move {{CONTACT_NAME}} inline as
-- order context ("delivery request for {{CONTACT_NAME}}"). Works for all
-- three send paths:
--   - client-submitted   → submitter sees customer name as "which order"
--   - public-form        → submitter IS the contact, slightly redundant but fine
--   - staff-created      → same as client-submitted
--
-- Idempotent: REPLACE only changes the row if the old fragment is present,
-- so re-running this migration is a no-op once applied.

UPDATE email_templates
SET body = REPLACE(
  body,
  'Hi {{CONTACT_NAME}}, thanks for your order. Stride has received your delivery request and is preparing for service.',
  'Thanks for your order. Stride has received your delivery request for {{CONTACT_NAME}} and is preparing for service.'
),
updated_at = NOW()
WHERE template_key = 'DELIVERY_ORDER_APPROVED';
