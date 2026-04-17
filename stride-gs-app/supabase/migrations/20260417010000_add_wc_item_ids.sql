-- Add item_ids JSON array to will_calls so React can look up WC items
-- from the inventory table without hitting GAS.
-- Part of session 71 "inventory as single source of truth" work.

ALTER TABLE public.will_calls
  ADD COLUMN IF NOT EXISTS item_ids jsonb DEFAULT '[]'::jsonb;
