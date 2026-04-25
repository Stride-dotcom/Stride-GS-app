-- 20260425030000_service_catalog_delivery_fields.sql
--
-- Adds delivery-specific columns to service_catalog so admins can configure
-- a service that is exposed in the Create Delivery Order modal:
--   delivery_rate_unit  — how the rate is interpreted in the delivery context
--   visible_to_client   — false hides the service from the client-facing form
--   description         — short text shown next to the toggle in the modal
--   quote_required      — true => the service requires a quote (no inline price)
--
-- The existing show_as_delivery_service flag still gates whether the row is
-- pulled into the delivery modal at all; these new columns shape how it
-- renders once it is pulled in.
ALTER TABLE public.service_catalog
  ADD COLUMN IF NOT EXISTS delivery_rate_unit text
    CHECK (delivery_rate_unit IN ('flat','per_mile','per_15min','plus_base','per_item'))
    DEFAULT 'flat',
  ADD COLUMN IF NOT EXISTS visible_to_client  boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS description        text,
  ADD COLUMN IF NOT EXISTS quote_required     boolean DEFAULT false;

COMMENT ON COLUMN public.service_catalog.delivery_rate_unit IS
  'How the flat_rate is interpreted when this service is offered as a delivery add-on. flat=one-time, per_mile/per_15min=quantity-multiplied, plus_base=base+per_item, per_item=per piece.';
COMMENT ON COLUMN public.service_catalog.visible_to_client IS
  'When false, the service is admin-only and is hidden from client-facing surfaces like the Create Delivery Order modal.';
COMMENT ON COLUMN public.service_catalog.description IS
  'Short helper copy shown next to the service in the Create Delivery Order modal.';
COMMENT ON COLUMN public.service_catalog.quote_required IS
  'When true, the service is shown without a price and the order is flagged for manual pricing review.';
