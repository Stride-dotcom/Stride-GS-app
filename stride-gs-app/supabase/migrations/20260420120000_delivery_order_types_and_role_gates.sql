-- ============================================================
-- Stride GS App — Delivery Order Types + Role-Gated Accessorials
-- (Phase 2c)
--
-- Adds:
--   1. delivery_accessorials.visible_to_client — role gate for the
--      Create Delivery modal. Clients see only what they can request;
--      staff see everything.
--   2. dt_orders.order_type — 'delivery' | 'pickup' | 'pickup_and_delivery'
--      | 'service_only'. Supersedes the is_pickup boolean (kept for
--      webhook-path compatibility).
--   3. New accessorials: DISPOSAL (haul-away) + FELT_PADS (apply felt pads).
--   4. Staff-only flags on DETENTION / OUT_OF_AREA / DRIVE_OUT — these
--      are applied post-hoc by dispatch, not requested upfront by clients.
-- ============================================================

-- 1. visible_to_client column
ALTER TABLE public.delivery_accessorials
  ADD COLUMN IF NOT EXISTS visible_to_client boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.delivery_accessorials.visible_to_client IS
  'When true, clients see this accessorial in the Create Delivery form. '
  'When false, only staff/admin see it (e.g., detention time is added '
  'post-delivery by dispatch, not requested by the client upfront).';

-- Mark staff-only accessorials
UPDATE public.delivery_accessorials SET visible_to_client = false
 WHERE code IN ('DETENTION', 'OUT_OF_AREA', 'DRIVE_OUT', 'EXTRA_ITEM');

-- 2. New client-facing accessorials
INSERT INTO public.delivery_accessorials (
  code, name, rate, rate_unit, description, display_order, visible_to_client
) VALUES
  ('DISPOSAL',  'Disposal / Haul-Away',   0,   'per_item',  'Remove and dispose of existing item(s) at delivery. Rate varies by size — confirmed at quote.', 7, true),
  ('FELT_PADS', 'Apply Felt Pads',        25,  'per_item',  'Apply felt pads to the feet of furniture items at delivery to protect floors.', 8, true)
ON CONFLICT (code) DO UPDATE SET
  name              = EXCLUDED.name,
  description       = EXCLUDED.description,
  rate              = EXCLUDED.rate,
  rate_unit         = EXCLUDED.rate_unit,
  display_order     = EXCLUDED.display_order,
  visible_to_client = EXCLUDED.visible_to_client;

-- 3. order_type column on dt_orders
ALTER TABLE public.dt_orders
  ADD COLUMN IF NOT EXISTS order_type text;

-- Backfill from is_pickup for existing rows
UPDATE public.dt_orders
   SET order_type = CASE WHEN is_pickup = true THEN 'pickup' ELSE 'delivery' END
 WHERE order_type IS NULL;

-- Default + CHECK constraint
ALTER TABLE public.dt_orders
  ALTER COLUMN order_type SET DEFAULT 'delivery';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'dt_orders_order_type_check'
  ) THEN
    ALTER TABLE public.dt_orders
      ADD CONSTRAINT dt_orders_order_type_check
      CHECK (order_type IN ('delivery','pickup','pickup_and_delivery','service_only','transfer'));
  END IF;
END $$;

COMMENT ON COLUMN public.dt_orders.order_type IS
  'Order category: delivery (warehouse→customer), pickup (customer→warehouse), '
  'pickup_and_delivery (customer→customer, two linked rows via linked_order_id), '
  'service_only (on-site visit, no items), transfer (internal, reserved).';

-- 4. Index to speed up linked-order lookups (used by Review Queue + DT push)
CREATE INDEX IF NOT EXISTS idx_dt_orders_linked_order
  ON public.dt_orders (linked_order_id) WHERE linked_order_id IS NOT NULL;

-- 5. Relax `source` CHECK to allow pickup-only orders to also be source='app'
-- (already allowed in the existing check — no change needed; we just note the
-- expectation that pickup_and_delivery pairs are both source='app' when
-- created from the portal.)
