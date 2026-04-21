-- client_intake_system — public intake form + admin review pipeline.
--
-- A prospect receives a unique `link_id` (row in client_intake_links).
-- They fill out a 6-step public wizard at /#/intake/:linkId and submit
-- a row into client_intakes. The row carries signature data, initials
-- per T&C section, and a handful of meta fields (IP, UA, timestamps).
-- An admin later reviews the intake and clicks "Create Client" to
-- materialize the record in the CB Clients sheet.
--
-- RLS:
--   • client_intakes.INSERT: public (anon + authenticated) — the form
--     lives outside the auth gate. Value side of the system is that
--     every submission carries an ip_address + user_agent stamp so we
--     can recognize spam bursts before they hit the admin inbox.
--   • client_intakes.SELECT/UPDATE: admin + staff only.
--   • client_intake_links.SELECT (public): only `active=true` and not
--     expired — enough to validate a linkId without auth. Prospect-
--     facing fields (email, name) are fine to return since the link
--     itself is the capability.
--   • client_intake_links.ALL (admin-only): link generation + revoke.

CREATE TABLE IF NOT EXISTS public.client_intakes (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id            text,
  status             text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','reviewed','activated','rejected')),

  -- Business info
  business_name      text        NOT NULL,
  contact_name       text        NOT NULL,
  email              text        NOT NULL,
  phone              text,
  business_address   text,
  website            text,

  -- Billing
  billing_contact_name text,
  billing_email        text,
  billing_address      text,

  -- Notification contacts: [{ name, email }]
  notification_contacts jsonb    DEFAULT '[]'::jsonb,

  -- Insurance
  insurance_choice   text        CHECK (insurance_choice IN ('own_policy','eis_coverage')),

  -- Payment
  payment_authorized boolean     DEFAULT false,

  -- Signature + section initials
  signature_type     text        CHECK (signature_type IN ('typed','drawn')),
  signature_data     text,       -- typed name string OR base64 canvas image
  signed_at          timestamptz,
  initials           jsonb       DEFAULT '{}'::jsonb, -- { "<section_key>": "ABC" }

  -- Document storage paths (Supabase Storage)
  signed_tc_pdf_path text,
  resale_cert_path   text,

  -- Meta
  ip_address         text,
  user_agent         text,
  submitted_at       timestamptz DEFAULT now(),
  reviewed_by        uuid,
  reviewed_at        timestamptz,
  activated_at       timestamptz,
  notes              text,
  created_at         timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_intakes_status    ON public.client_intakes(status);
CREATE INDEX IF NOT EXISTS idx_client_intakes_submitted ON public.client_intakes(submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_intakes_link      ON public.client_intakes(link_id);

CREATE TABLE IF NOT EXISTS public.client_intake_links (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id        text        UNIQUE NOT NULL DEFAULT substr(md5(random()::text), 1, 12),
  prospect_name  text,
  prospect_email text,
  created_by     uuid        REFERENCES auth.users(id),
  expires_at     timestamptz,
  used_at        timestamptz,
  active         boolean     DEFAULT true,
  created_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_intake_links_link_id ON public.client_intake_links(link_id);
CREATE INDEX IF NOT EXISTS idx_client_intake_links_active  ON public.client_intake_links(active) WHERE active = true;

ALTER TABLE public.client_intakes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_intake_links  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "intakes_public_insert" ON public.client_intakes;
CREATE POLICY "intakes_public_insert" ON public.client_intakes
  FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "intakes_staff_read" ON public.client_intakes;
CREATE POLICY "intakes_staff_read" ON public.client_intakes
  FOR SELECT TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('admin','staff'));

DROP POLICY IF EXISTS "intakes_staff_update" ON public.client_intakes;
CREATE POLICY "intakes_staff_update" ON public.client_intakes
  FOR UPDATE TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('admin','staff'));

DROP POLICY IF EXISTS "links_public_read" ON public.client_intake_links;
CREATE POLICY "links_public_read" ON public.client_intake_links
  FOR SELECT TO anon, authenticated
  USING (active = true AND (expires_at IS NULL OR expires_at > now()));

DROP POLICY IF EXISTS "links_admin_write" ON public.client_intake_links;
CREATE POLICY "links_admin_write" ON public.client_intake_links
  FOR ALL TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') = 'admin')
  WITH CHECK ((auth.jwt()->'user_metadata'->>'role') = 'admin');

-- Realtime so the admin's "Pending Intakes" view sees submissions land
-- without a manual refresh.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='client_intakes'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.client_intakes';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='client_intake_links'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.client_intake_links';
  END IF;
END $$;
