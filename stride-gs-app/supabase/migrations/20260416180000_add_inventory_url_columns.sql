-- Add missing Inventory sheet columns to Supabase inventory table
-- These columns exist on the Google Sheet but were not mirrored to Supabase.
-- Part of the "Inventory as single source of truth" initiative (session 71).

ALTER TABLE public.inventory
  ADD COLUMN IF NOT EXISTS shipment_photos_url text,
  ADD COLUMN IF NOT EXISTS inspection_photos_url text,
  ADD COLUMN IF NOT EXISTS repair_photos_url text,
  ADD COLUMN IF NOT EXISTS invoice_url text,
  ADD COLUMN IF NOT EXISTS transfer_date text;
