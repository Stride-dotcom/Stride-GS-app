-- Add Supabase-only billing contact fields to public.clients.
--
-- Context: the existing `email` field has been the only contact column on
-- clients, so it ended up driving everything — shipment alerts, inspection
-- reports, status notifications, AND invoice emails (and via PR #220, the
-- QBO BillEmail inheritance for sub-customer pushes). Justin pointed out
-- this is wrong: the people who want shipment alerts (Hillary, Allison,
-- adavisdesign) are not necessarily the ones who should receive invoices.
--
-- Solution: add separate billing contact fields. These intentionally live
-- ONLY in Supabase (no CB Clients sheet column, no CLIENT_FIELDS_ entry,
-- no writeSettingsToClientSheet sync). The React settings modal writes
-- them directly to Supabase; GAS callers read them from Supabase via the
-- existing service-role client. This is the first step toward the broader
-- "stop using the sheet for fields the operator only edits via the app"
-- direction.
--
-- The intake form (client_intakes table) already has these three fields
-- under the same names, so backfill copies the latest intake row's values
-- onto each client record where present. Clients without an intake record
-- (legacy onboardings, manual additions) get NULL and the operator fills
-- them in via the settings modal.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS billing_contact_name text,
  ADD COLUMN IF NOT EXISTS billing_email        text,
  ADD COLUMN IF NOT EXISTS billing_address      text;

COMMENT ON COLUMN public.clients.billing_contact_name IS
  'Name of the billing contact (who receives invoices). Distinct from the operational `contact_name` who handles day-to-day. Supabase-only — no CB Clients sheet column.';
COMMENT ON COLUMN public.clients.billing_email IS
  'Email address(es) that should receive invoices and QBO BillEmail. May be comma-separated for multi-recipient. Supabase-only — no CB Clients sheet column.';
COMMENT ON COLUMN public.clients.billing_address IS
  'Optional billing mailing address when it differs from the operational address. Supabase-only.';

-- Backfill from the latest client_intakes row per client, when present.
-- Match on email (case-insensitive) since client_intakes has no
-- spreadsheet_id at submission time. Only fills nulls; never overwrites
-- an explicit operator-set value.
WITH latest_intake AS (
  SELECT DISTINCT ON (lower(trim(email)))
    lower(trim(email))      AS norm_email,
    billing_contact_name,
    billing_email,
    billing_address
  FROM public.client_intakes
  WHERE email IS NOT NULL AND trim(email) <> ''
  ORDER BY lower(trim(email)), submitted_at DESC NULLS LAST
)
UPDATE public.clients c
SET
  billing_contact_name = COALESCE(c.billing_contact_name, li.billing_contact_name),
  billing_email        = COALESCE(c.billing_email,        li.billing_email),
  billing_address      = COALESCE(c.billing_address,      li.billing_address)
FROM latest_intake li
WHERE lower(trim(split_part(c.email, ',', 1))) = li.norm_email
  AND (c.billing_contact_name IS NULL OR c.billing_email IS NULL OR c.billing_address IS NULL);
