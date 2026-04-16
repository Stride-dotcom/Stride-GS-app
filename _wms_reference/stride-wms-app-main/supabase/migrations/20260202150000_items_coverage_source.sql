-- Add coverage_source column to items table
-- Tracks whether coverage was applied at item level or shipment level

ALTER TABLE items
ADD COLUMN IF NOT EXISTS coverage_source TEXT DEFAULT 'item'
CHECK (coverage_source IN ('item', 'shipment'));

-- Add index for querying items by coverage source
CREATE INDEX IF NOT EXISTS idx_items_coverage_source ON items(coverage_source) WHERE coverage_source IS NOT NULL;

-- Add comment
COMMENT ON COLUMN items.coverage_source IS 'Source of coverage: item (applied directly) or shipment (inherited from shipment-level coverage)';
