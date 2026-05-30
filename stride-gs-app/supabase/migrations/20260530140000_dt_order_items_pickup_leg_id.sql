-- 20260530140000_dt_order_items_pickup_leg_id.sql
--
-- Multi-pickup Phase 2 — per-leg item tracking on delivery items.
--
-- Background: Phase 1 (PR #577) added the dt_pickup_links join table so
-- one delivery can have N pickup legs. Phase 1.5 (PR #578) made each
-- additional leg billable. But the items table stayed leg-agnostic —
-- delivery items only had `parent_pickup_item_id` pointing at the
-- specific pickup-side item. When a pickup leg completed, the
-- stamp-pickup-on-linked-delivery helper's blanket pass (added 2026-05-29
-- to fix JAS-00096-ROZE) stamped picked_up_at on EVERY delivery item
-- where it was still NULL — including items that belong to a different
-- pickup leg that hasn't completed yet. Net effect on multi-pickup
-- orders: completing leg 1 falsely marks leg 2's items as picked up.
--
-- This migration adds `dt_order_items.pickup_leg_id` — a direct FK to
-- the dt_pickup_links row that owns the item. With that column the
-- stamp helper can scope its writes to "items belonging to this leg",
-- and the UI can group items by their pickup source.
--
-- Backfill strategy:
--   For every delivery item with `parent_pickup_item_id` set, look up
--   the pickup-side item → its dt_orders row → the dt_pickup_links row
--   that joins that pickup to a delivery, and stamp the leg id. This
--   covers the forward path (CreateDeliveryOrderModal sets
--   parent_pickup_item_id on the delivery mirror at create time).
--   Items with no parent_pickup_item_id stay NULL — those are
--   warehouse items (no pickup) OR legacy P+D rows from before the
--   parent_pickup_item_id backfill; the stamp helper falls back to
--   the existing blanket pass for them.
--
-- Behavior-neutral on existing single-pickup orders: every item that
-- gets a pickup_leg_id is mapped to the SAME leg (the primary
-- sort_order=0 leg, since single-pickup orders have only one link
-- row), so the stamp helper's leg-aware path produces identical
-- output to today's blanket pass. The win shows up only on real
-- multi-pickup orders.

ALTER TABLE public.dt_order_items
  ADD COLUMN IF NOT EXISTS pickup_leg_id uuid REFERENCES public.dt_pickup_links(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.dt_order_items.pickup_leg_id IS
  'For DELIVERY items only: FK to the dt_pickup_links row identifying '
  'which pickup leg this item came from. Set by CreateDeliveryOrderModal '
  '(primary -P leg, sort_order=0) and AddPickupLegModal (additional legs) '
  'at item-create or leg-create time. NULL means either (a) the item '
  'came from warehouse inventory (no pickup) or (b) the row predates '
  'this migration''s backfill. The stamp-pickup-on-linked-delivery '
  'helper uses this to scope its picked_up_at writes to items from the '
  'completing leg only — pre-fix, a leg completing stamped ALL still-'
  'unstamped items on the delivery, including items belonging to a '
  'different leg that hasn''t completed yet.';

-- Index for the stamp helper's per-leg lookup pattern:
--   SELECT ... WHERE dt_order_id = ? AND pickup_leg_id = ?
CREATE INDEX IF NOT EXISTS idx_dt_order_items_pickup_leg
  ON public.dt_order_items (pickup_leg_id)
  WHERE pickup_leg_id IS NOT NULL;

-- ── Backfill ──────────────────────────────────────────────────────────
-- Resolve pickup_leg_id from the parent_pickup_item_id chain:
--   delivery_item.parent_pickup_item_id
--     → pickup_item.dt_order_id  (the pickup dt_orders row)
--     → dt_pickup_links.pickup_order_id  (the join row)
-- Only updates rows where pickup_leg_id IS NULL so re-running is a
-- no-op. Excludes pickup-side items themselves (we only stamp delivery
-- items — pickup items belong to the pickup row, not a leg).
UPDATE public.dt_order_items AS dit
SET pickup_leg_id = lnk.id
FROM public.dt_order_items AS pit
JOIN public.dt_pickup_links AS lnk
  ON lnk.pickup_order_id = pit.dt_order_id
JOIN public.dt_orders AS dord
  ON dord.id = dit.dt_order_id
WHERE dit.parent_pickup_item_id = pit.id
  AND dit.pickup_leg_id IS NULL
  AND dord.order_type <> 'pickup';

-- Diagnostic — surfaces in psql output. Counts how many delivery items
-- on multi-pickup orders still have NULL pickup_leg_id after backfill
-- (= warehouse-inventory items or legacy un-FK'd rows). Non-zero is
-- expected (warehouse items are real), the value is just informational
-- for the operator running the migration so they know what coverage
-- the backfill achieved.
DO $$
DECLARE
  v_backfilled int;
  v_remaining  int;
BEGIN
  SELECT COUNT(*) INTO v_backfilled
  FROM public.dt_order_items
  WHERE pickup_leg_id IS NOT NULL;

  SELECT COUNT(*) INTO v_remaining
  FROM public.dt_order_items dit
  JOIN public.dt_orders dord ON dord.id = dit.dt_order_id
  WHERE dord.order_type = 'pickup_and_delivery'
    AND dit.pickup_leg_id IS NULL
    AND dit.removed_at IS NULL;

  RAISE NOTICE 'dt_order_items.pickup_leg_id backfill: % delivery items stamped, % multi-pickup-order items still NULL (warehouse + legacy).',
    v_backfilled, v_remaining;
END
$$;
