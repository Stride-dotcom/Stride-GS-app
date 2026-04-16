-- Migration: Update billing_events.class_id to reference 'classes' table instead of 'item_types'
-- This aligns billing with the new unified pricing system

-- Step 1: Drop the old foreign key constraint
ALTER TABLE public.billing_events
DROP CONSTRAINT IF EXISTS billing_events_class_id_fkey;

-- Step 2: Clear existing class_id values (old item_types IDs won't match new classes IDs)
-- This is safe because class is optional for billing events
UPDATE public.billing_events SET class_id = NULL WHERE class_id IS NOT NULL;

-- Step 3: Add new foreign key constraint to classes table
ALTER TABLE public.billing_events
ADD CONSTRAINT billing_events_class_id_fkey
FOREIGN KEY (class_id) REFERENCES public.classes(id) ON DELETE SET NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.billing_events.class_id IS 'References classes table for pricing tier (XS-XL). Migrated from item_types.';
