-- Claims read-cache table (mirrors CB Claim_Items / Claims tabs)
-- No tenant_id — claims are global to the CB sheet, identified by claim_id.
-- RLS: admin/staff see all; client sees own claims via company_client_name match.

CREATE TABLE IF NOT EXISTS public.claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id text NOT NULL,
  claim_type text,
  status text,
  outcome_type text,
  resolution_type text,
  date_opened text,
  incident_date text,
  date_closed text,
  date_settlement_sent text,
  date_signed_settlement_received text,
  created_by text,
  first_reviewed_by text,
  first_reviewed_at text,
  primary_contact_name text,
  company_client_name text,
  email text,
  phone text,
  requested_amount numeric,
  approved_amount numeric,
  coverage_type text,
  client_selected_coverage text,
  property_incident_reference text,
  incident_location text,
  issue_description text,
  decision_explanation text,
  internal_notes_summary text,
  public_notes_summary text,
  claim_folder_url text,
  current_settlement_file_url text,
  current_settlement_version text,
  void_reason text,
  close_note text,
  last_updated text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Unique constraint for upsert conflict resolution
ALTER TABLE public.claims ADD CONSTRAINT claims_claim_id_unique UNIQUE (claim_id);

-- Indexes
CREATE INDEX idx_claims_status ON public.claims (status);
CREATE INDEX idx_claims_company_client_name ON public.claims (company_client_name);
CREATE INDEX idx_claims_date_opened ON public.claims (date_opened);

-- RLS
ALTER TABLE public.claims ENABLE ROW LEVEL SECURITY;

-- Admin/staff: see all claims
CREATE POLICY "claims_select_admin_staff" ON public.claims
  FOR SELECT USING (
    (auth.jwt()->'user_metadata'->>'role') IN ('admin', 'staff')
  );

-- Client: see claims where company_client_name matches their client name
-- Resolved via the clients mirror table (spreadsheet_id → name lookup)
CREATE POLICY "claims_select_client_own" ON public.claims
  FOR SELECT USING (
    (auth.jwt()->'user_metadata'->>'role') = 'client'
    AND company_client_name IN (
      SELECT name FROM public.clients
      WHERE spreadsheet_id = (auth.jwt()->'user_metadata'->>'clientSheetId')
    )
  );

-- Service role: full access (GAS write-through)
CREATE POLICY "claims_service_role_all" ON public.claims
  FOR ALL USING (true) WITH CHECK (true);

-- Realtime support
ALTER TABLE public.claims REPLICA IDENTITY FULL;
