-- Backfill dt_order_items.inventory_id from (tenant_id, dt_item_code) +
-- self-healing trigger so future inserts/updates can't drift back to NULL.
--
-- Root cause discovered 2026-05-12 while building the auto-release backfill:
-- the inventory_id UUID column on dt_order_items has been silently NULL on
-- every row ever inserted (legacy + recent), even though CreateDeliveryOrderModal
-- writes `inventory_id: i.inventoryRowId ?? null` — `inventoryRowId` was never
-- being populated by useInventory's row shape. The functional linkage is
-- carried by `dt_item_code` (human Item ID) matched against inventory.item_id
-- within the same tenant, but every code path that expects the UUID FK ends
-- up empty-handed:
--   • OrderPage.tsx releasableItems filter drops every row → "Release Items..."
--     button never shows (PR #1 regression caught here).
--   • Future auto-release path (PR #2) would fail the same way.
--   • Reports / joins that prefer inventory_id over dt_item_code see no data.
--
-- This migration does two things:
--   1. One-shot UPDATE of every existing dt_order_items.inventory_id where it's
--      NULL and dt_item_code resolves cleanly. Safe — confirmed (tenant_id,
--      item_id) is unique on public.inventory, so the JOIN never picks the
--      wrong row.
--   2. BEFORE INSERT OR UPDATE trigger so any future row that lands with a
--      NULL inventory_id + non-empty dt_item_code gets the lookup auto-applied
--      at write time. Belt-and-braces — eventually the modal write path
--      should populate inventoryRowId correctly too, but the trigger means
--      we never re-create the drift in the meantime.

-- ── 1. One-shot backfill ────────────────────────────────────────────────────
UPDATE public.dt_order_items oi
SET inventory_id = inv.id
FROM public.dt_orders o, public.inventory inv
WHERE oi.dt_order_id = o.id
  AND inv.tenant_id   = o.tenant_id
  AND inv.item_id     = oi.dt_item_code
  AND oi.inventory_id IS NULL
  AND oi.dt_item_code IS NOT NULL
  AND oi.dt_item_code <> '';

-- ── 2. Self-healing trigger for future rows ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.dt_order_items_resolve_inventory_id()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_tenant_id text;
BEGIN
  -- Only resolve when the caller didn't supply the FK AND we have a
  -- dt_item_code to match against. Skip otherwise — preserves the
  -- caller's explicit intent (including explicit NULL for ad-hoc items
  -- with no inventory linkage).
  IF NEW.inventory_id IS NOT NULL
     OR NEW.dt_item_code IS NULL
     OR NEW.dt_item_code = '' THEN
    RETURN NEW;
  END IF;

  -- Find the parent order's tenant. dt_order_items doesn't carry tenant_id
  -- itself, so we join through dt_orders.
  SELECT o.tenant_id INTO v_tenant_id
  FROM public.dt_orders o
  WHERE o.id = NEW.dt_order_id;

  IF v_tenant_id IS NULL THEN
    RETURN NEW;  -- public-form orphans (tenant_id NULL) skip silently
  END IF;

  -- Lookup. (tenant_id, item_id) is unique on inventory so this picks
  -- at most one row.
  SELECT inv.id INTO NEW.inventory_id
  FROM public.inventory inv
  WHERE inv.tenant_id = v_tenant_id
    AND inv.item_id   = NEW.dt_item_code
  LIMIT 1;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS dt_order_items_resolve_inventory_id_trg ON public.dt_order_items;

CREATE TRIGGER dt_order_items_resolve_inventory_id_trg
BEFORE INSERT OR UPDATE OF dt_item_code, inventory_id ON public.dt_order_items
FOR EACH ROW
EXECUTE FUNCTION public.dt_order_items_resolve_inventory_id();

COMMENT ON FUNCTION public.dt_order_items_resolve_inventory_id() IS
  'Auto-resolves dt_order_items.inventory_id from (parent tenant_id, dt_item_code) when not explicitly supplied. Prevents the silent-NULL drift that hid every dt_order_items row from the inventory_id-keyed release flow. Skips when inventory_id is already set or dt_item_code is empty.';
