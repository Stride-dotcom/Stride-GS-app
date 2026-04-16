-- Phase 7: Claims + Valuation Coverage Migration
-- ================================================================================

-- 2.2.1 Add fields to items table for coverage + claim basics
ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS weight_lbs numeric,
  ADD COLUMN IF NOT EXISTS declared_value numeric,
  ADD COLUMN IF NOT EXISTS coverage_type text,
  ADD COLUMN IF NOT EXISTS coverage_deductible numeric,
  ADD COLUMN IF NOT EXISTS coverage_rate numeric,
  ADD COLUMN IF NOT EXISTS coverage_selected_at timestamptz,
  ADD COLUMN IF NOT EXISTS coverage_selected_by uuid;

-- Add CHECK constraint for coverage_type
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'items_coverage_type_check'
  ) THEN
    ALTER TABLE public.items
      ADD CONSTRAINT items_coverage_type_check
      CHECK (coverage_type IS NULL OR coverage_type = ANY (ARRAY['standard','full_deductible','full_no_deductible','pending']));
  END IF;
END $$;

-- 2.2.2 Add coverage defaults at account level
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS default_coverage_type text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'accounts_default_coverage_type_check'
  ) THEN
    ALTER TABLE public.accounts
      ADD CONSTRAINT accounts_default_coverage_type_check
      CHECK (default_coverage_type IS NULL OR default_coverage_type = ANY (ARRAY['standard','full_deductible','full_no_deductible']));
  END IF;
END $$;

-- 2.2.3 Add new columns to claims table for Phase 7 requirements
-- Non-inventory property damage support
ALTER TABLE public.claims
  ADD COLUMN IF NOT EXISTS non_inventory_ref text,
  ADD COLUMN IF NOT EXISTS incident_location text,
  ADD COLUMN IF NOT EXISTS incident_contact_name text,
  ADD COLUMN IF NOT EXISTS incident_contact_phone text,
  ADD COLUMN IF NOT EXISTS incident_contact_email text;

-- Coverage snapshot and valuation fields
ALTER TABLE public.claims
  ADD COLUMN IF NOT EXISTS coverage_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS claim_value_requested numeric,
  ADD COLUMN IF NOT EXISTS claim_value_calculated numeric,
  ADD COLUMN IF NOT EXISTS deductible_applied numeric,
  ADD COLUMN IF NOT EXISTS approved_payout_amount numeric,
  ADD COLUMN IF NOT EXISTS payout_method text,
  ADD COLUMN IF NOT EXISTS payout_reference text,
  ADD COLUMN IF NOT EXISTS requires_manager_approval boolean NOT NULL DEFAULT true;

-- Settlement/determination fields
ALTER TABLE public.claims
  ADD COLUMN IF NOT EXISTS determination_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS settlement_terms_version text,
  ADD COLUMN IF NOT EXISTS settlement_terms_text text,
  ADD COLUMN IF NOT EXISTS settlement_acceptance_required boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS settlement_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS settlement_accepted_by uuid;

-- Add assigned_to for internal user handling
ALTER TABLE public.claims
  ADD COLUMN IF NOT EXISTS assigned_to uuid;

-- Update claim_type check constraint if needed
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'claims_claim_type_check'
  ) THEN
    ALTER TABLE public.claims DROP CONSTRAINT claims_claim_type_check;
  END IF;
EXCEPTION WHEN undefined_table THEN
  NULL;
END $$;

ALTER TABLE public.claims
  ADD CONSTRAINT claims_claim_type_check
  CHECK (claim_type = ANY (ARRAY['shipping_damage','manufacture_defect','handling_damage','property_damage','lost_item']));

-- Update status check constraint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'claims_status_check'
  ) THEN
    ALTER TABLE public.claims DROP CONSTRAINT claims_status_check;
  END IF;
EXCEPTION WHEN undefined_table THEN
  NULL;
END $$;

ALTER TABLE public.claims
  ADD CONSTRAINT claims_status_check
  CHECK (status = ANY (ARRAY['initiated','under_review','denied','approved','credited','paid','closed']));

-- Create unique index for claim_number per tenant
DROP INDEX IF EXISTS claims_tenant_claim_number_unique;
CREATE UNIQUE INDEX claims_tenant_claim_number_unique
  ON public.claims(tenant_id, claim_number)
  WHERE deleted_at IS NULL;

-- Create performance indexes
CREATE INDEX IF NOT EXISTS claims_tenant_idx ON public.claims(tenant_id);
CREATE INDEX IF NOT EXISTS claims_account_idx ON public.claims(account_id);
CREATE INDEX IF NOT EXISTS claims_item_idx ON public.claims(item_id);
CREATE INDEX IF NOT EXISTS claims_shipment_idx ON public.claims(shipment_id);

-- 2.2.4 Claim attachments table
CREATE TABLE IF NOT EXISTS public.claim_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  claim_id uuid NOT NULL REFERENCES public.claims(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  file_name text,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid,
  is_public boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS claim_attachments_claim_idx ON public.claim_attachments(claim_id);

-- 2.2.5 Claim audit log
CREATE TABLE IF NOT EXISTS public.claim_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  claim_id uuid NOT NULL REFERENCES public.claims(id) ON DELETE CASCADE,
  actor_id uuid,
  action text NOT NULL,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS claim_audit_claim_idx ON public.claim_audit(claim_id);

-- 2.2.6 Account credits ledger
CREATE TABLE IF NOT EXISTS public.account_credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  account_id uuid NOT NULL,
  claim_id uuid,
  amount numeric NOT NULL,
  reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_to_invoice_id uuid
);
CREATE INDEX IF NOT EXISTS account_credits_account_idx ON public.account_credits(account_id);

-- 2.2.7 Update billing_events event_type constraint to include 'coverage' and 'claim'
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'billing_events_event_type_check'
  ) THEN
    ALTER TABLE public.billing_events DROP CONSTRAINT billing_events_event_type_check;
  END IF;
EXCEPTION WHEN undefined_table THEN
  NULL;
END $$;

ALTER TABLE public.billing_events
  ADD CONSTRAINT billing_events_event_type_check
  CHECK (event_type = ANY (ARRAY['receiving','inspection','assembly','repair','storage','addon','coverage','claim','task_completion','flag_change','will_call','disposal','other']));

-- 2.2.8 Trigger for updated_at on claims
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_claims_updated_at ON public.claims;
CREATE TRIGGER trg_claims_updated_at
BEFORE UPDATE ON public.claims
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2.3 RLS POLICIES
-- Enable RLS on new tables
ALTER TABLE public.claim_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.claim_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_credits ENABLE ROW LEVEL SECURITY;

-- Claim attachments policies
DROP POLICY IF EXISTS "Users can view claim attachments for their tenant" ON public.claim_attachments;
CREATE POLICY "Users can view claim attachments for their tenant"
  ON public.claim_attachments FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.users WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert claim attachments for their tenant" ON public.claim_attachments;
CREATE POLICY "Users can insert claim attachments for their tenant"
  ON public.claim_attachments FOR INSERT
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.users WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update claim attachments for their tenant" ON public.claim_attachments;
CREATE POLICY "Users can update claim attachments for their tenant"
  ON public.claim_attachments FOR UPDATE
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.users WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can delete claim attachments for their tenant" ON public.claim_attachments;
CREATE POLICY "Users can delete claim attachments for their tenant"
  ON public.claim_attachments FOR DELETE
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.users WHERE id = auth.uid()
    )
  );

-- Claim audit policies
DROP POLICY IF EXISTS "Users can view claim audit for their tenant" ON public.claim_audit;
CREATE POLICY "Users can view claim audit for their tenant"
  ON public.claim_audit FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.users WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert claim audit for their tenant" ON public.claim_audit;
CREATE POLICY "Users can insert claim audit for their tenant"
  ON public.claim_audit FOR INSERT
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.users WHERE id = auth.uid()
    )
  );

-- Account credits policies
DROP POLICY IF EXISTS "Users can view account credits for their tenant" ON public.account_credits;
CREATE POLICY "Users can view account credits for their tenant"
  ON public.account_credits FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.users WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert account credits for their tenant" ON public.account_credits;
CREATE POLICY "Users can insert account credits for their tenant"
  ON public.account_credits FOR INSERT
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.users WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update account credits for their tenant" ON public.account_credits;
CREATE POLICY "Users can update account credits for their tenant"
  ON public.account_credits FOR UPDATE
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.users WHERE id = auth.uid()
    )
  );

-- Create storage bucket for claims if it doesn't exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('claims', 'claims', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for claims bucket
DROP POLICY IF EXISTS "Users can view claim files for their tenant" ON storage.objects;
CREATE POLICY "Users can view claim files for their tenant"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'claims' AND
    (storage.foldername(name))[1] IN (
      SELECT tenant_id::text FROM public.users WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can upload claim files for their tenant" ON storage.objects;
CREATE POLICY "Users can upload claim files for their tenant"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'claims' AND
    (storage.foldername(name))[1] IN (
      SELECT tenant_id::text FROM public.users WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can delete claim files for their tenant" ON storage.objects;
CREATE POLICY "Users can delete claim files for their tenant"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'claims' AND
    (storage.foldername(name))[1] IN (
      SELECT tenant_id::text FROM public.users WHERE id = auth.uid()
    )
  );