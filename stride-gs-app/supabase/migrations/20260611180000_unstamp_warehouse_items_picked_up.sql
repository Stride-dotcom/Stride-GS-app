-- Data repair: clear bogus pickup stamps on warehouse delivery items.
--
-- The blanket-stamp pass in _shared/stamp-pickup-on-linked-delivery.ts
-- (legacy !anyLegTagged fallback) stamped EVERY unstamped delivery item
-- as picked up when a pickup leg completed. On pickup_and_delivery
-- orders that mix picked-up items with warehouse inventory, the
-- warehouse items were wrongly marked "picked up by <driver>".
--
-- A delivery item with inventory_id set rides from our warehouse and is
-- never picked up on a pickup leg, so picked_up_at / pickup_return_codes
-- / pickup_delivered_quantity / pickup_item_note on such a row is bogus
-- by definition. This repair clears those fields for every affected row.
--
-- Affected at time of fix (2026-06-11): JOD-00168-D (20), JAS-00096-ROZE-D
-- (8), LIG-00146-D (3), MRS-00047-D (1) = 32 rows.
--
-- The code fix (skip inventory_id rows in the blanket pass) prevents
-- recurrence; this only cleans up rows already written.

UPDATE public.dt_order_items
SET picked_up_at              = NULL,
    pickup_return_codes       = NULL,
    pickup_delivered_quantity = NULL,
    pickup_item_note          = NULL
WHERE inventory_id IS NOT NULL
  AND picked_up_at IS NOT NULL
  AND removed_at IS NULL;
