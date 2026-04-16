-- Add needs_minor_touchup column to items table
ALTER TABLE public.items 
ADD COLUMN IF NOT EXISTS needs_minor_touchup BOOLEAN DEFAULT false;

-- Add minor_touchup_status column for workflow tracking
ALTER TABLE public.items 
ADD COLUMN IF NOT EXISTS minor_touchup_status TEXT DEFAULT NULL;