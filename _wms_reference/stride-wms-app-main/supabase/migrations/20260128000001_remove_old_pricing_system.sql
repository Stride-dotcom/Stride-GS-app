-- Remove Old Pricing System
-- ============================================================================
-- This migration removes the old pricing tables and functions that have been
-- replaced by the unified Price List (service_events) system.
-- ============================================================================

-- Drop RPC functions that are no longer needed
DROP FUNCTION IF EXISTS public.set_item_flag(UUID, TEXT, UUID, TEXT);
DROP FUNCTION IF EXISTS public.unset_item_flag(UUID, TEXT, UUID);
DROP FUNCTION IF EXISTS public.get_item_flags(UUID);
DROP FUNCTION IF EXISTS public.get_available_flags(UUID, BOOLEAN);
DROP FUNCTION IF EXISTS public.seed_default_pricing(UUID);

-- Drop old pricing tables in correct order (respecting foreign keys)

-- First drop item_flags (references pricing_flags)
DROP TABLE IF EXISTS public.item_flags CASCADE;

-- Drop flag_service_rules (references pricing_flags)
DROP TABLE IF EXISTS public.flag_service_rules CASCADE;

-- Drop pricing_flags
DROP TABLE IF EXISTS public.pricing_flags CASCADE;

-- Drop rate_card_details (references rate_cards)
DROP TABLE IF EXISTS public.rate_card_details CASCADE;

-- Drop service_rates (references rate_cards if exists)
DROP TABLE IF EXISTS public.service_rates CASCADE;

-- Drop rate_cards
DROP TABLE IF EXISTS public.rate_cards CASCADE;

-- Drop assembly_tiers
DROP TABLE IF EXISTS public.assembly_tiers CASCADE;

-- Drop account_rate_adjustments / account_pricing_overrides
DROP TABLE IF EXISTS public.account_rate_adjustments CASCADE;
DROP TABLE IF EXISTS public.account_pricing_overrides CASCADE;

-- Drop global_service_rates if it exists
DROP TABLE IF EXISTS public.global_service_rates CASCADE;

-- Drop billable_services if it exists and is not used elsewhere
-- Note: Keep billable_services if it's still referenced by other parts of the system
-- DROP TABLE IF EXISTS public.billable_services CASCADE;

-- ============================================================================
-- Update accounts table to remove rate_card_id reference if column exists
-- ============================================================================
DO $$
BEGIN
  -- Remove rate_card_id column from accounts if it exists
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'accounts'
    AND column_name = 'rate_card_id'
  ) THEN
    ALTER TABLE public.accounts DROP COLUMN rate_card_id;
  END IF;
END $$;

-- ============================================================================
-- Comment on the new pricing architecture
-- ============================================================================
COMMENT ON TABLE public.service_events IS 'Price List - Single source of truth for all service pricing. Used for flags (add_flag=true), scan events (add_to_service_event_scan=true), task billing, shipment billing, and auto-calculated charges.';
