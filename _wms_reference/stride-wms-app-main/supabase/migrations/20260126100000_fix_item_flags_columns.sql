-- Migration to add missing set_by and set_at columns to item_flags table
-- These columns were expected by the set_item_flag RPC function but weren't added
-- when the table already existed from an earlier migration

-- Add set_by column if it doesn't exist
ALTER TABLE public.item_flags
ADD COLUMN IF NOT EXISTS set_by UUID REFERENCES auth.users(id);

-- Add set_at column if it doesn't exist
ALTER TABLE public.item_flags
ADD COLUMN IF NOT EXISTS set_at TIMESTAMPTZ DEFAULT now();

-- Migrate data from applied_by/applied_at to set_by/set_at if the old columns have data
-- and the new columns are null
UPDATE public.item_flags
SET
  set_by = COALESCE(set_by, applied_by),
  set_at = COALESCE(set_at, applied_at)
WHERE set_by IS NULL OR set_at IS NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.item_flags.set_by IS 'User who set this flag on the item';
COMMENT ON COLUMN public.item_flags.set_at IS 'Timestamp when this flag was set on the item';
