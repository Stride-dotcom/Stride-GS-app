-- Add new rate columns to item_types table for accessorial services
ALTER TABLE public.item_types 
ADD COLUMN IF NOT EXISTS overweight_rate numeric(10,2) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS crated_rate numeric(10,2) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS received_without_id_rate numeric(10,2) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS disposal_rate numeric(10,2) DEFAULT NULL;

-- Add received_without_id flag to items table
ALTER TABLE public.items
ADD COLUMN IF NOT EXISTS received_without_id boolean DEFAULT false;

-- Add category and item_type_id columns to rate_card_details for proper rate organization
ALTER TABLE public.rate_card_details
ADD COLUMN IF NOT EXISTS category text DEFAULT 'item_service',
ADD COLUMN IF NOT EXISTS item_type_id uuid REFERENCES public.item_types(id);

-- Add rate_source column to billing_events to track where the rate came from
ALTER TABLE public.billing_events
ADD COLUMN IF NOT EXISTS rate_source text DEFAULT NULL,
ADD COLUMN IF NOT EXISTS service_category text DEFAULT NULL;

-- Create index for efficient rate lookups
CREATE INDEX IF NOT EXISTS idx_rate_card_details_category ON public.rate_card_details(category);
CREATE INDEX IF NOT EXISTS idx_rate_card_details_item_type ON public.rate_card_details(item_type_id);
CREATE INDEX IF NOT EXISTS idx_billing_events_rate_source ON public.billing_events(rate_source);