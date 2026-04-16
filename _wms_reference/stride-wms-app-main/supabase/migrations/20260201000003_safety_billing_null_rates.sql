-- Safety Billing Migration: Allow NULL rates for pending pricing
-- ============================================================================
-- This migration enables the "safety billing" feature where Assembly/Repair tasks
-- create billing events with NULL rates that must be set before invoicing.
-- ============================================================================

-- 1. Allow NULL for unit_rate (pending pricing state)
ALTER TABLE public.billing_events
ALTER COLUMN unit_rate DROP NOT NULL;

-- 2. Allow NULL for total_amount (calculated when rate is set)
ALTER TABLE public.billing_events
ALTER COLUMN total_amount DROP NOT NULL;

-- 3. Add requires_manual_rate flag to task_types for identifying manual-priced tasks
-- This allows admins to configure which task types need manual rate entry
ALTER TABLE public.task_types
ADD COLUMN IF NOT EXISTS requires_manual_rate BOOLEAN DEFAULT false;

-- 4. Update existing Assembly and Repair task types to require manual rate
UPDATE public.task_types
SET requires_manual_rate = true
WHERE LOWER(name) IN ('assembly', 'repair');

-- 5. Add index for quick lookup of pending-rate billing events
CREATE INDEX IF NOT EXISTS idx_billing_events_pending_rate
ON public.billing_events(task_id)
WHERE unit_rate IS NULL AND status = 'unbilled';

-- 6. Add comment documentation
COMMENT ON COLUMN public.billing_events.unit_rate IS 'Price per unit. NULL indicates pending pricing - rate must be set before invoicing.';
COMMENT ON COLUMN public.task_types.requires_manual_rate IS 'If true, task creates billing events with NULL rate that must be manually set before invoicing.';

-- 7. Update the TypeScript types to reflect nullable unit_rate
-- (This is a reminder - actual TypeScript type updates happen in code)
