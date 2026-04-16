-- Marketing contacts read-cache table (mirrors Campaign spreadsheet Contacts tab)
-- Admin/staff only — Marketing page is RoleGuarded to admin.

CREATE TABLE IF NOT EXISTS public.marketing_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  first_name text,
  last_name text,
  company text,
  status text,
  existing_client boolean DEFAULT false,
  campaign_tag text,
  source text,
  added_by text,
  date_added text,
  last_campaign_date text,
  replied boolean DEFAULT false,
  converted boolean DEFAULT false,
  bounced boolean DEFAULT false,
  unsubscribed boolean DEFAULT false,
  suppressed boolean DEFAULT false,
  suppression_reason text,
  suppression_date text,
  manual_release_note text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.marketing_contacts ADD CONSTRAINT marketing_contacts_email_unique UNIQUE (email);

CREATE INDEX idx_marketing_contacts_status ON public.marketing_contacts (status);
CREATE INDEX idx_marketing_contacts_suppressed ON public.marketing_contacts (suppressed);
CREATE INDEX idx_marketing_contacts_company ON public.marketing_contacts (company);
CREATE INDEX idx_marketing_contacts_email_lower ON public.marketing_contacts (lower(email));

ALTER TABLE public.marketing_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "marketing_contacts_select_admin_staff" ON public.marketing_contacts
  FOR SELECT USING (
    (auth.jwt()->'user_metadata'->>'role') IN ('admin', 'staff')
  );

CREATE POLICY "marketing_contacts_service_role_all" ON public.marketing_contacts
  FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.marketing_contacts REPLICA IDENTITY FULL;
