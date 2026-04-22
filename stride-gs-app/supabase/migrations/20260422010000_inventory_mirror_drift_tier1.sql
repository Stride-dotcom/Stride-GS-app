-- Tier 1 mirror drift fix: inventory
-- Adds 3 columns that handleGetInventory_ returns but sbInventoryRow_ never mirrored.
--   shipment_folder_url — per-row Drive folder URL (read from Shipment # cell RichText hyperlink)
--   needs_inspection    — boolean flag on inventory row
--   needs_assembly      — boolean flag on inventory row
-- Fix for shipment folder button breakage on legacy imported items: Supabase-first reads
-- were returning undefined for shipmentFolderUrl since the column didn't exist.

ALTER TABLE public.inventory
  ADD COLUMN IF NOT EXISTS shipment_folder_url TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS needs_inspection    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS needs_assembly      BOOLEAN NOT NULL DEFAULT FALSE;
