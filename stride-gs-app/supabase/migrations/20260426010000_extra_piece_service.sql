-- 20260426010000_extra_piece_service.sql
--
-- Adds an "Extra Piece" service to service_catalog so the delivery
-- modal stops hardcoding "first 3 pieces included, $25 per additional
-- piece". Single source of truth = the price list (Settings → Pricing
-- → Delivery). Admin can edit rate + included-count in one place and
-- the value flows through every estimate immediately.
--
-- Schema change: new nullable `included_quantity` int column on
-- service_catalog. NULL on every existing row (no behavior change for
-- non-extra services). Only XTRA_PC reads it today; future "first N
-- included" services can reuse the same column.
--
-- Seed: XTRA_PC at $25 / per_item with included_quantity=3, matching
-- the values that were hardcoded in CreateDeliveryOrderModal.tsx
-- before this change. show_as_delivery_service=true so it appears in
-- the delivery accessorial picker; visible_to_client=true so the
-- public rate page can pick it up.

ALTER TABLE public.service_catalog
  ADD COLUMN IF NOT EXISTS included_quantity int;

COMMENT ON COLUMN public.service_catalog.included_quantity IS
  'For per-piece overage charges: the number of pieces included in some other base fee before this charge applies. NULL means not applicable. Read by the delivery modal for the XTRA_PC service.';

INSERT INTO public.service_catalog (
  code, name, category, billing, flat_rate, unit, taxable, active,
  show_in_matrix, show_as_task, show_as_delivery_service,
  show_as_receiving_addon, display_order, visible_to_client,
  description, included_quantity
) VALUES (
  'XTRA_PC',
  'Extra Piece (over included quantity)',
  'Delivery',
  'flat',
  25,
  'per_item',
  true,
  true,
  false,    -- not in service matrix; surfaces in delivery flow only
  false,    -- not a standalone task
  true,     -- shows up in delivery service picker
  false,    -- not a receiving add-on
  90,       -- after the existing per-item delivery extras
  true,     -- visible on public rate page
  'Charged on each piece beyond the included quantity in the base delivery fee.',
  3
)
ON CONFLICT (code) DO NOTHING;
