-- Add missing columns to repair_quotes table for office pricing
ALTER TABLE public.repair_quotes 
  ADD COLUMN IF NOT EXISTS customer_price NUMERIC,
  ADD COLUMN IF NOT EXISTS internal_cost NUMERIC,
  ADD COLUMN IF NOT EXISTS office_notes TEXT,
  ADD COLUMN IF NOT EXISTS pricing_locked BOOLEAN DEFAULT FALSE;