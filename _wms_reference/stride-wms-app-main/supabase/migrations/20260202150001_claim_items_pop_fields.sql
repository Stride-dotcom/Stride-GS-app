-- Add POP (Proof of Purchase) and proration fields to claim_items table
-- These fields support the claims policy for shipment-level coverage

-- POP tracking fields
ALTER TABLE claim_items
ADD COLUMN IF NOT EXISTS pop_required BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS pop_provided BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS pop_value NUMERIC(12,2),
ADD COLUMN IF NOT EXISTS pop_document_id UUID REFERENCES documents(id);

-- Valuation method fields
ALTER TABLE claim_items
ADD COLUMN IF NOT EXISTS valuation_method TEXT DEFAULT 'standard'
CHECK (valuation_method IN ('proof', 'prorated', 'standard')),
ADD COLUMN IF NOT EXISTS valuation_basis NUMERIC(12,2),
ADD COLUMN IF NOT EXISTS prorated_cap NUMERIC(12,2);

-- Coverage source snapshot (at time of claim)
ALTER TABLE claim_items
ADD COLUMN IF NOT EXISTS coverage_source TEXT
CHECK (coverage_source IN ('item', 'shipment', 'standard')),
ADD COLUMN IF NOT EXISTS coverage_snapshot JSONB;

-- Add comments
COMMENT ON COLUMN claim_items.pop_required IS 'Whether Proof of Purchase is required for full valuation';
COMMENT ON COLUMN claim_items.pop_provided IS 'Whether Proof of Purchase was provided';
COMMENT ON COLUMN claim_items.pop_value IS 'Value shown on Proof of Purchase document';
COMMENT ON COLUMN claim_items.pop_document_id IS 'Reference to uploaded POP document';
COMMENT ON COLUMN claim_items.valuation_method IS 'Method used: proof (with POP), prorated (shipment without POP), standard (weight-based)';
COMMENT ON COLUMN claim_items.valuation_basis IS 'Final valuation basis used for payout calculation';
COMMENT ON COLUMN claim_items.prorated_cap IS 'Prorated cap when POP not provided for shipment coverage';
COMMENT ON COLUMN claim_items.coverage_source IS 'Coverage source at claim time: item, shipment, or standard';
COMMENT ON COLUMN claim_items.coverage_snapshot IS 'Snapshot of coverage settings at claim creation time';

-- Index for querying by valuation method
CREATE INDEX IF NOT EXISTS idx_claim_items_valuation_method ON claim_items(valuation_method);
