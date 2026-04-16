-- Enhanced Claims Module: Multi-Item Support and Claim Items Table
-- This migration adds support for multiple items per claim with individual
-- valuation, repair tracking, and payout handling

-- Create payout method enum type if it doesn't exist
DO $$ BEGIN
  CREATE TYPE payout_method_enum AS ENUM ('credit', 'check', 'repair_vendor_pay');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create claim_items junction table for multi-item claims
CREATE TABLE IF NOT EXISTS claim_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  claim_id UUID NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  item_id UUID REFERENCES items(id) ON DELETE SET NULL,
  non_inventory_ref TEXT, -- For non-inventory items (ninv_ref)

  -- Coverage snapshot at time of claim creation
  coverage_type TEXT, -- 'standard', 'full_replacement_deductible', 'full_replacement_no_deductible'
  declared_value NUMERIC(12,2),
  weight_lbs NUMERIC(10,2),
  coverage_rate NUMERIC(6,4), -- Rate per lb for standard coverage

  -- Valuation
  requested_amount NUMERIC(12,2), -- Amount client is requesting
  calculated_amount NUMERIC(12,2), -- System-calculated max based on coverage
  approved_amount NUMERIC(12,2), -- Final approved amount
  deductible_applied NUMERIC(12,2) DEFAULT 0, -- Deductible amount subtracted

  -- Repair tracking
  repairable BOOLEAN,
  repair_quote_id UUID, -- Link to repair quotes if exists
  repair_cost NUMERIC(12,2), -- Cost if repair is chosen

  -- Payout
  payout_method TEXT CHECK (payout_method IN ('credit', 'check', 'repair_vendor_pay')),
  payout_processed BOOLEAN DEFAULT FALSE,
  payout_processed_at TIMESTAMPTZ,

  -- Notes
  item_notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_claim_items_tenant ON claim_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_claim_items_claim ON claim_items(claim_id);
CREATE INDEX IF NOT EXISTS idx_claim_items_item ON claim_items(item_id);

-- Enable RLS
ALTER TABLE claim_items ENABLE ROW LEVEL SECURITY;

-- RLS policies for claim_items
CREATE POLICY "claim_items_tenant_isolation" ON claim_items
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

CREATE POLICY "claim_items_insert_policy" ON claim_items
  FOR INSERT WITH CHECK (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- Create updated_at trigger for claim_items
CREATE TRIGGER claim_items_updated_at
  BEFORE UPDATE ON claim_items
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Add incident_date column to claims table if it doesn't exist
DO $$ BEGIN
  ALTER TABLE claims ADD COLUMN IF NOT EXISTS incident_date DATE;
EXCEPTION
  WHEN duplicate_column THEN null;
END $$;

-- Add public/internal notes columns if they don't exist
DO $$ BEGIN
  ALTER TABLE claims ADD COLUMN IF NOT EXISTS public_notes TEXT;
EXCEPTION
  WHEN duplicate_column THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE claims ADD COLUMN IF NOT EXISTS internal_notes TEXT;
EXCEPTION
  WHEN duplicate_column THEN null;
END $$;

-- Add client_initiated flag (for claims filed via client portal)
DO $$ BEGIN
  ALTER TABLE claims ADD COLUMN IF NOT EXISTS client_initiated BOOLEAN DEFAULT FALSE;
EXCEPTION
  WHEN duplicate_column THEN null;
END $$;

-- Add total_requested_amount and total_approved_amount for multi-item totals
DO $$ BEGIN
  ALTER TABLE claims ADD COLUMN IF NOT EXISTS total_requested_amount NUMERIC(12,2);
EXCEPTION
  WHEN duplicate_column THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE claims ADD COLUMN IF NOT EXISTS total_approved_amount NUMERIC(12,2);
EXCEPTION
  WHEN duplicate_column THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE claims ADD COLUMN IF NOT EXISTS total_deductible NUMERIC(12,2);
EXCEPTION
  WHEN duplicate_column THEN null;
END $$;

-- Function to calculate claim totals from claim_items
CREATE OR REPLACE FUNCTION calculate_claim_totals(p_claim_id UUID)
RETURNS TABLE(
  total_requested NUMERIC(12,2),
  total_approved NUMERIC(12,2),
  total_deductible NUMERIC(12,2),
  item_count INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(SUM(ci.requested_amount), 0)::NUMERIC(12,2) AS total_requested,
    COALESCE(SUM(ci.approved_amount), 0)::NUMERIC(12,2) AS total_approved,
    COALESCE(SUM(ci.deductible_applied), 0)::NUMERIC(12,2) AS total_deductible,
    COUNT(*)::INTEGER AS item_count
  FROM claim_items ci
  WHERE ci.claim_id = p_claim_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to sync legacy single-item claims to claim_items
-- This ensures backward compatibility with existing claims that have item_id set
CREATE OR REPLACE FUNCTION sync_legacy_claim_to_claim_items()
RETURNS TRIGGER AS $$
BEGIN
  -- If this is a new claim with item_id set directly (legacy behavior)
  -- and no claim_items exist yet, create one
  IF NEW.item_id IS NOT NULL THEN
    -- Check if claim_items already exist for this claim
    IF NOT EXISTS (SELECT 1 FROM claim_items WHERE claim_id = NEW.id) THEN
      INSERT INTO claim_items (
        tenant_id,
        claim_id,
        item_id,
        coverage_type,
        declared_value,
        requested_amount,
        approved_amount
      )
      SELECT
        NEW.tenant_id,
        NEW.id,
        NEW.item_id,
        i.coverage_type,
        i.declared_value,
        NEW.claim_value_requested,
        NEW.approved_amount
      FROM items i
      WHERE i.id = NEW.item_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for legacy sync (fires after insert on claims)
DROP TRIGGER IF EXISTS sync_legacy_claim_items ON claims;
CREATE TRIGGER sync_legacy_claim_items
  AFTER INSERT ON claims
  FOR EACH ROW
  EXECUTE FUNCTION sync_legacy_claim_to_claim_items();

-- Create view for claims with item counts
CREATE OR REPLACE VIEW v_claims_with_items AS
SELECT
  c.*,
  COALESCE(ci_stats.item_count, 0) AS item_count,
  COALESCE(ci_stats.total_requested, 0) AS items_total_requested,
  COALESCE(ci_stats.total_approved, 0) AS items_total_approved,
  a.account_name,
  s.sidemark_name
FROM claims c
LEFT JOIN accounts a ON a.id = c.account_id
LEFT JOIN sidemarks s ON s.id = c.sidemark_id
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) AS item_count,
    SUM(requested_amount) AS total_requested,
    SUM(approved_amount) AS total_approved
  FROM claim_items
  WHERE claim_id = c.id
) ci_stats ON TRUE
WHERE c.deleted_at IS NULL;

-- Grant permissions on new objects
GRANT SELECT ON v_claims_with_items TO authenticated;
GRANT ALL ON claim_items TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_claim_totals(UUID) TO authenticated;

-- Comment documentation
COMMENT ON TABLE claim_items IS 'Junction table for multi-item claims with individual valuation and payout tracking';
COMMENT ON COLUMN claim_items.non_inventory_ref IS 'Reference for non-inventory items (e.g., property damage claims)';
COMMENT ON COLUMN claim_items.coverage_type IS 'Snapshot of coverage type at claim creation: standard, full_replacement_deductible, full_replacement_no_deductible';
COMMENT ON COLUMN claim_items.calculated_amount IS 'System-calculated maximum payout based on coverage rules';
COMMENT ON COLUMN claim_items.repair_quote_id IS 'Link to repair quote if item is marked as repairable';
COMMENT ON VIEW v_claims_with_items IS 'Claims with aggregated item counts and totals';
