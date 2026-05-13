-- Pickup-to-delivery linkage propagation
-- =======================================
-- When a pickup leg completes (Service_Route_Finished + status_id=3),
-- the linked delivery order should reflect that the pickup is done:
--   • Delivery `dt_orders` row gets the pickup's completion timestamp + driver
--   • Each delivery `dt_order_items` row whose dt_item_code matches a
--     PU-side item gets `picked_up_at` stamped
--
-- These are *cache* fields populated by the going-forward
-- pickup-completion path (notify-pickup-completed + dt-sync-statuses
-- + new shared helper). They are NOT authoritative — the pickup
-- order's own status_id=3 + dt_order_items.delivered=true remains
-- the source of truth.
--
-- Backward-compat: every field is nullable. Existing rows stay null
-- until either (a) a future pickup completion stamps them, or (b)
-- someone runs a one-shot backfill function (not built — Justin
-- requested "going forward only").

ALTER TABLE public.dt_orders
  ADD COLUMN IF NOT EXISTS linked_pickup_finished_at timestamptz,
  ADD COLUMN IF NOT EXISTS linked_pickup_driver_name text;

COMMENT ON COLUMN public.dt_orders.linked_pickup_finished_at IS
  'When the linked pickup leg completed (Service_Route_Finished). '
  'Stamped on the delivery row by the pickup-completion edge function. '
  'NULL for: standalone deliveries, deliveries whose linked PU has not '
  'completed yet, deliveries created before 2026-05-13.';

COMMENT ON COLUMN public.dt_orders.linked_pickup_driver_name IS
  'Driver who completed the linked pickup leg. Populated from the '
  'pickup row''s driver_name once dt-sync-statuses has refreshed it '
  'from DT export.xml. May lag by a poll cycle on the webhook path.';

ALTER TABLE public.dt_order_items
  ADD COLUMN IF NOT EXISTS picked_up_at timestamptz;

COMMENT ON COLUMN public.dt_order_items.picked_up_at IS
  'When this item was picked up on its linked PU leg. Set only on '
  'delivery-side items (the items on dt_orders rows where order_type '
  'is not pickup). Matched by (linked_order.dt_item_code = pickup_item.dt_item_code) '
  'when the linked pickup completes. NULL for: standalone deliveries, '
  'items not yet picked up, items refused on the PU leg.';

-- Index supports the UI query "show me deliveries whose pickup is done"
-- (Orders list filter / drawer indicators). Partial index keeps it tiny
-- — most deliveries are standalone and stay NULL forever.
CREATE INDEX IF NOT EXISTS idx_dt_orders_linked_pickup_finished_at
  ON public.dt_orders (linked_pickup_finished_at)
  WHERE linked_pickup_finished_at IS NOT NULL;
