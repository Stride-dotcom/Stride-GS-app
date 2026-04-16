-- Drop deprecated billing rate columns from item_types table
-- All billing rates now come from service_events (Price List) table
-- These columns are no longer used and cause confusion with the new billing system

-- Drop deprecated rate columns from item_types
ALTER TABLE public.item_types
  DROP COLUMN IF EXISTS receiving_rate,
  DROP COLUMN IF EXISTS shipping_rate,
  DROP COLUMN IF EXISTS assembly_rate,
  DROP COLUMN IF EXISTS inspection_fee,
  DROP COLUMN IF EXISTS minor_touchup_rate;

-- Add comment explaining the change
COMMENT ON TABLE public.item_types IS 'Product catalog types with dimensions. Note: Billing rates are now managed in service_events table (Price List), not here.';
