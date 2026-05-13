-- Clean PU-mirror audit columns on dt_order_items
-- ================================================
-- Replaces the sentinel-marker merge approach in
-- stamp-pickup-on-linked-delivery's first cut. Original plan was to
-- prepend "[FROM PICKUP] <note>\n---\n" into item_note and strip+re-add
-- on each sync. Code review flagged that as brittle: a user editing
-- the merged note (removing the `---` separator, prepending their
-- own text) breaks the strip regex and the marker accumulates
-- unboundedly each sync cycle.
--
-- The fix: store PU-synced values in their own audit columns, leave
-- item_note / return_codes alone (those belong to the delivery leg's
-- own driver). UI renders pickup_* fields as a "From pickup" sub-row,
-- and a future dt-push-order revision can choose whether to merge
-- pickup_item_note into the DT delivery manifest.
--
-- pickup_delivered_quantity is recorded even when delivery.quantity
-- is also updated, so we always have an audit trail of what the PU
-- driver tapped (vs. what the delivery row settled on).

ALTER TABLE public.dt_order_items
  ADD COLUMN IF NOT EXISTS pickup_item_note text,
  ADD COLUMN IF NOT EXISTS pickup_return_codes jsonb,
  ADD COLUMN IF NOT EXISTS pickup_delivered_quantity numeric;

COMMENT ON COLUMN public.dt_order_items.pickup_item_note IS
  'Read-only mirror of the linked pickup item driver note (item_note '
  'on the pickup-side row). Set on delivery items only, by the PU→D '
  'item-sync helper, when the linked PU item has delivered=true. '
  'NULL until the linked pickup completes. Independent of item_note '
  'which is the delivery leg driver own note.';

COMMENT ON COLUMN public.dt_order_items.pickup_return_codes IS
  'Read-only mirror of the linked pickup item return codes. Same '
  'population path as pickup_item_note.';

COMMENT ON COLUMN public.dt_order_items.pickup_delivered_quantity IS
  'Driver-counted quantity from the pickup leg (delivered_quantity '
  'on the PU row). Recorded even when delivery.quantity is also '
  'updated from this value — keeps an audit trail of what the PU '
  'driver tapped vs what the delivery row settled on.';
