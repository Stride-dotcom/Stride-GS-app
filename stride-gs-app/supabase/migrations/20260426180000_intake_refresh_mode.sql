-- ============================================================
-- Refresh-mode support for the intake form.
--
-- When an admin sends an intake link to an existing client (to
-- renew a resale cert or re-confirm T&Cs) we tag the link row with
-- the client's spreadsheet_id. The public form detects this and:
--   - switches to "update your account on file" copy
--   - pre-fills every field from the existing client + last intake
--   - replaces (not merges) notification contacts on save
--   - shows current cert state above the cert upload field
-- Activation merges into the existing clients row instead of
-- running postOnboardClient.
--
-- 2026-04-26 PST
-- ============================================================

ALTER TABLE public.client_intake_links
  ADD COLUMN IF NOT EXISTS client_spreadsheet_id text;

COMMENT ON COLUMN public.client_intake_links.client_spreadsheet_id IS
  'When set, the link is for an existing client. Form switches to refresh mode (pre-fills, replaces contacts on save). Activation merges into the existing clients row instead of running postOnboardClient.';

ALTER TABLE public.client_intakes
  ADD COLUMN IF NOT EXISTS client_spreadsheet_id text,
  ADD COLUMN IF NOT EXISTS intake_mode text NOT NULL DEFAULT 'new';

COMMENT ON COLUMN public.client_intakes.client_spreadsheet_id IS
  'Set when the intake was submitted via a refresh link. References the existing client this intake updates.';
COMMENT ON COLUMN public.client_intakes.intake_mode IS
  'new = first-time client onboard, refresh = existing-client update (resale-cert renewal, T&C re-confirm).';

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS notification_contacts jsonb;

COMMENT ON COLUMN public.clients.notification_contacts IS
  'Authoritative list of warehouse-alert contacts: [{ name?, email }]. Populated by intake activation + refresh updates. Null = use the prior client_intakes row as fallback.';

NOTIFY pgrst, 'reload schema';
