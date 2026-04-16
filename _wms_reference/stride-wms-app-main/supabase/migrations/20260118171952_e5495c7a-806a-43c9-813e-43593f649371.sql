-- Add link and room columns to items table
ALTER TABLE public.items 
ADD COLUMN IF NOT EXISTS link TEXT,
ADD COLUMN IF NOT EXISTS room TEXT;

-- Add comment for documentation
COMMENT ON COLUMN public.items.link IS 'External URL link associated with the item';
COMMENT ON COLUMN public.items.room IS 'Room/area designation for the item';