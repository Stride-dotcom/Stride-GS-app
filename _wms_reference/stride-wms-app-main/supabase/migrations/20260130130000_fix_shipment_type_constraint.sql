-- Fix shipment_type check constraint to allow 'return' and 'disposal' types
-- The original constraint only allowed 'inbound' and 'outbound'

-- Drop the old constraint
ALTER TABLE public.shipments
DROP CONSTRAINT IF EXISTS shipments_shipment_type_check;

-- Add new constraint with all valid shipment types
ALTER TABLE public.shipments
ADD CONSTRAINT shipments_shipment_type_check
CHECK (shipment_type IN ('inbound', 'outbound', 'return', 'disposal'));

-- Add comment for documentation
COMMENT ON COLUMN public.shipments.shipment_type IS 'Type of shipment: inbound (receiving), outbound (shipping out), return (customer return), disposal';
