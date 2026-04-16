-- Phase 8: Claim Types, AI Analysis, and Claim Assistance
-- Add claim types and AI analysis capabilities

-- 1) Update claims table to ensure claim_type supports new values
-- Existing claim_type column should support: 'liability', 'shipping_damage'
-- Also add: 'manufacture_defect', 'handling_damage', 'property_damage', 'lost_item' for backwards compat
DO $$
BEGIN
  -- Add claim_category to differentiate liability vs assistance
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'claims' AND column_name = 'claim_category') THEN
    ALTER TABLE claims ADD COLUMN claim_category TEXT DEFAULT 'liability'
      CHECK (claim_category IN ('liability', 'shipping_damage'));
  END IF;

  -- Add auto_approved flag
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'claims' AND column_name = 'auto_approved') THEN
    ALTER TABLE claims ADD COLUMN auto_approved BOOLEAN DEFAULT FALSE;
  END IF;

  -- Add approved_by_system flag
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'claims' AND column_name = 'approved_by_system') THEN
    ALTER TABLE claims ADD COLUMN approved_by_system BOOLEAN DEFAULT FALSE;
  END IF;

  -- Add public_report_token for shareable reports
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'claims' AND column_name = 'public_report_token') THEN
    ALTER TABLE claims ADD COLUMN public_report_token TEXT UNIQUE;
  END IF;

  -- Add public_notes for external sharing
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'claims' AND column_name = 'public_notes') THEN
    ALTER TABLE claims ADD COLUMN public_notes TEXT;
  END IF;

  -- Add assistance_fee_billed flag
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'claims' AND column_name = 'assistance_fee_billed') THEN
    ALTER TABLE claims ADD COLUMN assistance_fee_billed BOOLEAN DEFAULT FALSE;
  END IF;
END$$;

-- 2) Create claim_ai_analysis table for AI recommendations
CREATE TABLE IF NOT EXISTS claim_ai_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  claim_id UUID NOT NULL REFERENCES claims(id) ON DELETE CASCADE,

  -- AI recommendation
  recommendation_amount NUMERIC(12,2),
  recommended_action TEXT NOT NULL CHECK (recommended_action IN ('auto_approve', 'approve', 'request_info', 'deny')),
  confidence_level TEXT NOT NULL CHECK (confidence_level IN ('low', 'medium', 'high')),

  -- Analysis details
  flags TEXT[] DEFAULT '{}',
  reasoning TEXT,

  -- Input snapshot for audit
  input_snapshot JSONB NOT NULL,

  -- Model info
  model_version TEXT DEFAULT 'v1',

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Ensure one analysis per claim (can be updated)
  CONSTRAINT unique_claim_analysis UNIQUE (claim_id)
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_claim_ai_analysis_claim_id ON claim_ai_analysis(claim_id);
CREATE INDEX IF NOT EXISTS idx_claim_ai_analysis_tenant_id ON claim_ai_analysis(tenant_id);
CREATE INDEX IF NOT EXISTS idx_claim_ai_analysis_action ON claim_ai_analysis(recommended_action);

-- RLS for claim_ai_analysis
ALTER TABLE claim_ai_analysis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their tenant's claim analyses"
  ON claim_ai_analysis FOR SELECT
  USING (tenant_id IN (
    SELECT tenant_id FROM users WHERE id = auth.uid()
  ));

CREATE POLICY "Users can insert their tenant's claim analyses"
  ON claim_ai_analysis FOR INSERT
  WITH CHECK (tenant_id IN (
    SELECT tenant_id FROM users WHERE id = auth.uid()
  ));

CREATE POLICY "Users can update their tenant's claim analyses"
  ON claim_ai_analysis FOR UPDATE
  USING (tenant_id IN (
    SELECT tenant_id FROM users WHERE id = auth.uid()
  ));

-- 3) Add claim assistance settings to organization_claim_settings
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'organization_claim_settings' AND column_name = 'enable_claim_assistance') THEN
    ALTER TABLE organization_claim_settings ADD COLUMN enable_claim_assistance BOOLEAN DEFAULT TRUE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'organization_claim_settings' AND column_name = 'claim_assistance_flat_fee') THEN
    ALTER TABLE organization_claim_settings ADD COLUMN claim_assistance_flat_fee NUMERIC(10,2) DEFAULT 150.00;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'organization_claim_settings' AND column_name = 'enable_ai_analysis') THEN
    ALTER TABLE organization_claim_settings ADD COLUMN enable_ai_analysis BOOLEAN DEFAULT TRUE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'organization_claim_settings' AND column_name = 'auto_approval_threshold') THEN
    ALTER TABLE organization_claim_settings ADD COLUMN auto_approval_threshold NUMERIC(10,2) DEFAULT 1000.00;
  END IF;
END$$;

-- 4) Add comments
COMMENT ON TABLE claim_ai_analysis IS 'Stores AI-generated claim analysis and recommendations';
COMMENT ON COLUMN claims.claim_category IS 'Category: liability (payout) or shipping_damage (assistance only)';
COMMENT ON COLUMN claims.auto_approved IS 'Whether claim was auto-approved by system';
COMMENT ON COLUMN claims.approved_by_system IS 'Whether approval was done by system vs manual';
COMMENT ON COLUMN claims.public_report_token IS 'Token for public/shareable claim reports';
COMMENT ON COLUMN claims.assistance_fee_billed IS 'Whether assistance fee has been billed for shipping_damage claims';
COMMENT ON COLUMN organization_claim_settings.enable_claim_assistance IS 'Enable automatic billing for shipping damage claim assistance';
COMMENT ON COLUMN organization_claim_settings.claim_assistance_flat_fee IS 'Flat fee for claim assistance services';
COMMENT ON COLUMN organization_claim_settings.enable_ai_analysis IS 'Enable AI-powered claim analysis';
COMMENT ON COLUMN organization_claim_settings.auto_approval_threshold IS 'Claims under this amount can be auto-approved';
