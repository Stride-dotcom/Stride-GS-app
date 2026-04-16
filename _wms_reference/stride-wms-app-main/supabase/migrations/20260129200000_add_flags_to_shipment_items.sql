-- Add flags column to shipment_items for storing flags before item is received
-- Flags are stored as an array of service_code strings
-- When item is received, these flags are converted to billing_events

ALTER TABLE public.shipment_items
ADD COLUMN IF NOT EXISTS flags TEXT[] DEFAULT '{}';

COMMENT ON COLUMN public.shipment_items.flags IS 'Array of flag service codes to apply when item is received';
