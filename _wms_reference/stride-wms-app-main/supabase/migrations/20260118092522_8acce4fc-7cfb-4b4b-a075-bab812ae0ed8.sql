-- Add new columns to item_types table based on the user's spreadsheet
-- Converting all pricing/rate columns to numeric and boolean fields for flags

ALTER TABLE public.item_types
  -- Drop the category column (user doesn't want it)
  DROP COLUMN IF EXISTS category,
  
  -- Rename 'name' to match spreadsheet convention
  -- Already exists as 'name', keep it
  
  -- Physical/Operational attributes
  ADD COLUMN IF NOT EXISTS delivery_pieces integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS billing_pieces integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS cubic_feet numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS model_number text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS default_item_notes text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS people_to_deliver integer DEFAULT 2,
  
  -- Time-based fields (in minutes)
  ADD COLUMN IF NOT EXISTS minutes_to_deliver integer DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS minutes_to_move integer DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS minutes_to_assemble integer DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS minutes_to_load integer DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS minutes_to_inspect integer DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS minutes_to_put_in_warehouse integer DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS minutes_per_felt_pad integer DEFAULT NULL,
  
  -- Rate/Pricing fields
  ADD COLUMN IF NOT EXISTS assembly_rate numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS same_day_assembly_rate numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS move_rate numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS felt_pad_price numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS extra_fee numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS oversize_rate numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS inspection_fee numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS removal_rate numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS will_call_rate numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS storage_rate_per_day numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS unstackable_extra_fee numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS pull_for_delivery_rate numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS assemblies_in_base_rate integer DEFAULT 0,
  
  -- Boolean flags (converting YES/NO from spreadsheet)
  ADD COLUMN IF NOT EXISTS allow_on_reservation boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS notify_dispatch boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS allow_on_order_entry boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS auto_add_assembly_fee boolean DEFAULT false;

-- Add comment for documentation
COMMENT ON TABLE public.item_types IS 'Item types with pricing rates and operational attributes. Used for billing calculations.';

-- Create an index on sort_order for efficient ordering
CREATE INDEX IF NOT EXISTS idx_item_types_sort_order ON public.item_types(tenant_id, sort_order);

-- Create an index on name for search
CREATE INDEX IF NOT EXISTS idx_item_types_name ON public.item_types(tenant_id, name);