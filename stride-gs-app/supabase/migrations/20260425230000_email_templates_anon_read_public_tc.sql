-- The public intake wizard at /#/intake/:linkId is anon (no auth). Step 3
-- renders the client T&C body, fetched via fetchClientTcBody() →
-- email_templates where template_key='DOC_CLIENT_TC' AND active=true.
--
-- Until this migration the only SELECT policy on email_templates was
-- `email_templates_select_auth` (authenticated only), so anon prospects
-- got an empty result and the page showed
-- "The agreement text couldn't be loaded right now."
--
-- Fix: narrow anon SELECT just to the public-facing T&C row. Other
-- templates (claim emails, repair quotes, billing notifications, etc.)
-- stay locked to authenticated; their bodies aren't intended for the
-- public intake form.

DROP POLICY IF EXISTS "email_templates_anon_read_public_tc" ON public.email_templates;
CREATE POLICY "email_templates_anon_read_public_tc" ON public.email_templates
  FOR SELECT TO anon
  USING (template_key = 'DOC_CLIENT_TC' AND active = true);
