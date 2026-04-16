-- Add remaining missing columns on items table
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.locations(id);
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS category text;