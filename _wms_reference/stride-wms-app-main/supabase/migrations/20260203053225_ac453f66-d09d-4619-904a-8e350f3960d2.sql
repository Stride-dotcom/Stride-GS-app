-- Fix: Add 'flag_change' to billing_events event_type check constraint

-- First, drop the existing constraint
ALTER TABLE public.billing_events DROP CONSTRAINT IF EXISTS billing_events_event_type_check;

-- Re-create with 'flag_change' included
ALTER TABLE public.billing_events ADD CONSTRAINT billing_events_event_type_check
CHECK (event_type = ANY (ARRAY[
  'receiving'::text,
  'inspection'::text,
  'assembly'::text,
  'repair'::text,
  'storage'::text,
  'addon'::text,
  'coverage'::text,
  'claim'::text,
  'task_completion'::text,
  'flag_change'::text,
  'will_call'::text,
  'disposal'::text,
  'shipping'::text,
  'handling'::text,
  'labor'::text,
  'other'::text
]));
