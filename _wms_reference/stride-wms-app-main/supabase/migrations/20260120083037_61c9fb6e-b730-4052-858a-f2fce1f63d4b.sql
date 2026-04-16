-- Migration: Simplify item statuses to 'active' and 'released'
-- 1. Update all existing non-released/non-disposed items to 'active'
UPDATE public.items 
SET status = 'active'
WHERE status NOT IN ('released', 'disposed')
  AND deleted_at IS NULL;

-- 2. Change the default value for new items from 'in_stock' to 'active'
ALTER TABLE public.items 
ALTER COLUMN status SET DEFAULT 'active';