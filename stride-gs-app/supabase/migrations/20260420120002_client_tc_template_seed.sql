-- DOC_CLIENT_TC — Warehousing & Delivery Agreement rendered by the
-- public intake wizard (Part 3). Modern plain-English rewrite of the
-- legacy paper T&C. Structured into five sections so the wizard can
-- render each as an initial block, with a final signature block at the
-- bottom. Tokens: BUSINESS_NAME, SIGNED_DATE.
--
-- NOTE: the actual body is committed to Supabase via the companion
-- one-off in the session SQL seed path (the HTML is 9KB and doesn't
-- translate well through this migration step without losing formatting).
-- This file is the canonical record that the template exists; the
-- content lives authoritatively in email_templates.body. Re-runs are
-- safe — ON CONFLICT DO NOTHING so we don't overwrite admin edits.

INSERT INTO public.email_templates (template_key, subject, category, active, notes)
VALUES (
  'DOC_CLIENT_TC',
  'Stride Logistics — Warehousing & Delivery Agreement',
  'document',
  true,
  'Client Agreement — multi-section T&C rendered by the public intake wizard. Each <section data-tc-section="..."> becomes an initial block; the final <section data-tc-signature> anchors the full signature pad. Tokens: BUSINESS_NAME, SIGNED_DATE. Seed content applied out-of-band; see Docs/Archive or ask an admin.'
)
ON CONFLICT (template_key) DO NOTHING;
