-- Add default notes fields to accounts table
-- These allow account-level default notes that populate into items and shipments

ALTER TABLE accounts
ADD COLUMN IF NOT EXISTS default_item_notes text,
ADD COLUMN IF NOT EXISTS highlight_item_notes boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS default_shipment_notes text,
ADD COLUMN IF NOT EXISTS highlight_shipment_notes boolean DEFAULT false;

-- Add highlight flag to shipments table (to store per-shipment setting)
ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS highlight_notes boolean DEFAULT false;

-- Add comments for clarity
COMMENT ON COLUMN accounts.default_item_notes IS 'Default notes displayed on item details page for this account';
COMMENT ON COLUMN accounts.highlight_item_notes IS 'Whether to highlight default item notes with amber/yellow background';
COMMENT ON COLUMN accounts.default_shipment_notes IS 'Default notes pre-filled in shipment notes field for this account';
COMMENT ON COLUMN accounts.highlight_shipment_notes IS 'Whether to highlight shipment notes for better visibility';
COMMENT ON COLUMN shipments.highlight_notes IS 'Whether this specific shipment notes should be highlighted';
