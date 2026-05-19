-- dt_order_items: structural duplicate-line safeguard
-- ===================================================
-- Symptom: standalone delivery ALL-00097 had all 6 of its
-- inventory-sourced lines inserted twice with identical created_at —
-- the modal's edit/promote delete-then-insert ran against the same
-- order id more than once in a single submit flow (re-entrant submit /
-- stale-ref no-op delete; both hardened in CreateDeliveryOrderModal.tsx).
--
-- dt-push-order's pruneDuplicateOrderItems() has been collapsing these
-- on every DT push since 2026-05-04, but that is a band-aid that only
-- fires on push and only for orders that reach DT. The DB had NO
-- uniqueness guarantee on a logical line. This migration makes the
-- invariant structural so any write path (modal, backfill, future code)
-- that double-inserts the same SKU on the same order is rejected by
-- Postgres instead of silently doubling.
--
-- Scope of the constraint — matches pruneDuplicateOrderItems' dedup key:
--   • Inventory-sourced lines key on dt_item_code: the same SKU on the
--     same order is the same physical item by system invariant (the
--     item picker is scoped + de-duped per itemId; quantity lives on
--     the row, never split into sibling rows).
--   • Ad-hoc free-text lines (dt_item_code IS NULL) are intentionally
--     EXCLUDED — two free-text lines worded the same are a legitimate
--     operator choice and have no stable key. The push-time prune still
--     collapses those by normalized description; that stays the only
--     guard for ad-hoc.
--   • removed_at IS NULL: soft-removed rows are excluded so a line can
--     be removed and the same SKU re-added later without colliding with
--     the tombstone.
--
-- A partial UNIQUE INDEX (not a table constraint) is required because
-- the predicate is conditional.

-- ── 1. Collapse existing duplicates so the index can be built ─────────
-- Soft-remove (set removed_at) rather than hard-delete: dt_order_items.id
-- is referenced by parent_pickup_item_id (self-FK on P+D pairs), so a
-- hard DELETE of a losing duplicate could orphan a linked pickup line.
-- Soft-remove keeps the row, satisfies the index predicate, and matches
-- how the app already tombstones lines. Keep the newest row per logical
-- line (updated_at, then created_at, then id — same ordering as
-- pruneDuplicateOrderItems' newest-wins).
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY dt_order_id, dt_item_code
      ORDER BY updated_at DESC NULLS LAST,
               created_at DESC NULLS LAST,
               id DESC
    ) AS rn
  FROM public.dt_order_items
  WHERE dt_item_code IS NOT NULL
    AND removed_at IS NULL
)
UPDATE public.dt_order_items t
SET removed_at = now()
FROM ranked r
WHERE t.id = r.id
  AND r.rn > 1;

-- ── 2. Enforce the invariant going forward ───────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS dt_order_items_order_code_active_uniq
  ON public.dt_order_items (dt_order_id, dt_item_code)
  WHERE dt_item_code IS NOT NULL AND removed_at IS NULL;

COMMENT ON INDEX public.dt_order_items_order_code_active_uniq IS
  'One active row per (dt_order_id, dt_item_code) for inventory-sourced '
  'lines. Backstops the modal edit/promote delete-then-insert against '
  're-entrant submits (ALL-00097 dup-line incident, 2026-05-19). Ad-hoc '
  'lines (dt_item_code IS NULL) and soft-removed rows are excluded — '
  'see migration header.';
