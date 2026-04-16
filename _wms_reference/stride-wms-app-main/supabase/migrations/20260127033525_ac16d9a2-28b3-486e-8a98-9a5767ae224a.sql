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
  non_inventory_ref TEXT,
  coverage_type TEXT,
  declared_value NUMERIC(12,2),
  weight_lbs NUMERIC(10,2),
  coverage_rate NUMERIC(6,4),
  requested_amount NUMERIC(12,2),
  calculated_amount NUMERIC(12,2),
  approved_amount NUMERIC(12,2),
  deductible_applied NUMERIC(12,2) DEFAULT 0,
  repairable BOOLEAN,
  repair_quote_id UUID,
  repair_cost NUMERIC(12,2),
  payout_method TEXT CHECK (payout_method IN ('credit', 'check', 'repair_vendor_pay')),
  payout_processed BOOLEAN DEFAULT FALSE,
  payout_processed_at TIMESTAMPTZ,
  item_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_claim_items_tenant ON claim_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_claim_items_claim ON claim_items(claim_id);
CREATE INDEX IF NOT EXISTS idx_claim_items_item ON claim_items(item_id);

ALTER TABLE claim_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "claim_items_tenant_isolation" ON claim_items;
CREATE POLICY "claim_items_tenant_isolation" ON claim_items
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "claim_items_insert_policy" ON claim_items;
CREATE POLICY "claim_items_insert_policy" ON claim_items
  FOR INSERT WITH CHECK (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

DROP TRIGGER IF EXISTS claim_items_updated_at ON claim_items;
CREATE TRIGGER claim_items_updated_at
  BEFORE UPDATE ON claim_items
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE claims ADD COLUMN IF NOT EXISTS incident_date DATE;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS public_notes TEXT;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS internal_notes TEXT;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS client_initiated BOOLEAN DEFAULT FALSE;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS total_requested_amount NUMERIC(12,2);
ALTER TABLE claims ADD COLUMN IF NOT EXISTS total_approved_amount NUMERIC(12,2);
ALTER TABLE claims ADD COLUMN IF NOT EXISTS total_deductible NUMERIC(12,2);

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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION sync_legacy_claim_to_claim_items()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.item_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM claim_items WHERE claim_id = NEW.id) THEN
      INSERT INTO claim_items (
        tenant_id, claim_id, item_id, coverage_type, declared_value, requested_amount, approved_amount
      )
      SELECT NEW.tenant_id, NEW.id, NEW.item_id, i.coverage_type, i.declared_value, NEW.claim_value_requested, NEW.approved_amount
      FROM items i WHERE i.id = NEW.item_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS sync_legacy_claim_items ON claims;
CREATE TRIGGER sync_legacy_claim_items
  AFTER INSERT ON claims
  FOR EACH ROW
  EXECUTE FUNCTION sync_legacy_claim_to_claim_items();

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

GRANT SELECT ON v_claims_with_items TO authenticated;
GRANT ALL ON claim_items TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_claim_totals(UUID) TO authenticated;