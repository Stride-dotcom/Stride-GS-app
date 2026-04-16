-- Fix stocktake status constraint to include 'draft'
-- This migration fixes the valid_stocktake_status constraint that was missing 'draft'

-- Drop the old constraint if it exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'valid_stocktake_status'
  ) THEN
    ALTER TABLE public.stocktakes DROP CONSTRAINT valid_stocktake_status;
  END IF;
END $$;

-- Add the updated constraint with 'draft' included
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'valid_stocktake_status'
  ) THEN
    ALTER TABLE public.stocktakes
      ADD CONSTRAINT valid_stocktake_status CHECK (status IN ('draft', 'planned', 'in_progress', 'completed', 'cancelled'));
  END IF;
END $$;

-- Also ensure the freeze_moves column exists (from enhanced_stocktakes migration)
ALTER TABLE public.stocktakes
ADD COLUMN IF NOT EXISTS freeze_moves BOOLEAN DEFAULT false;
