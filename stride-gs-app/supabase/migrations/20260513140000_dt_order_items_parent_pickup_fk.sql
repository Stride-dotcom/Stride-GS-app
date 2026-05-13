-- Cross-order PU↔Delivery item linkage
-- =====================================
-- Adds `parent_pickup_item_id` on dt_order_items so a delivery-side
-- item explicitly points at its pickup-side counterpart. Required by
-- the PU→Delivery item-sync engine — `dt_item_code` is per-order
-- (DT generates a fresh UUID per push) so the previous matching key
-- was unreliable across the two orders in a P+D pair.
--
-- Forward path: CreateDeliveryOrderModal sets this FK at creation
-- time for new P+D pairs. (Following commit in this PR.)
--
-- Historical backfill: heuristic match by stripped description.
-- DT prefixes the pickup-leg description with "PICK UP: PU: " when
-- it builds the manifest, so the delivery's "Foscarini Gregg floor lamp"
-- is the same physical item as the pickup's "PICK UP: PU: Foscarini
-- Gregg floor lamp". We match on the normalized (lowercased, prefix-
-- stripped, trimmed) description WITHIN a single P+D pair (delivery
-- whose linked_order_id is the pickup). Multiple matches on either
-- side → skip both (ambiguous). Single match → link.
--
-- Self-referential FK on the same table: SET NULL on delete keeps the
-- delivery row alive if the pickup item disappears. ON UPDATE CASCADE
-- is the default; we keep it implicit.

ALTER TABLE public.dt_order_items
  ADD COLUMN IF NOT EXISTS parent_pickup_item_id uuid
    REFERENCES public.dt_order_items(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.dt_order_items.parent_pickup_item_id IS
  'For delivery-side items in a P+D pair: pointer to the pickup-side '
  'counterpart. Set by CreateDeliveryOrderModal when the pair is created '
  '(forward) or by description-match backfill (historical). NULL on '
  'standalone deliveries, on pickup-side items themselves, and on '
  'delivery items where no PU counterpart could be matched.';

CREATE INDEX IF NOT EXISTS idx_dt_order_items_parent_pickup_item_id
  ON public.dt_order_items (parent_pickup_item_id)
  WHERE parent_pickup_item_id IS NOT NULL;

-- ── Heuristic backfill for existing P+D pairs ──────────────────────
-- Build a normalized key from description + match each delivery item
-- against its pickup pair's items by that key. Skip rows already
-- linked. Skip ambiguous matches (more than one candidate on either
-- side). Idempotent via the NULL filter so re-running is safe.

WITH pairs AS (
  SELECT p.id AS pickup_id, p.linked_order_id AS delivery_id
  FROM public.dt_orders p
  WHERE p.order_type = 'pickup'
    AND p.linked_order_id IS NOT NULL
),
-- Normalized: strip the DT "PICK UP: PU:" / "PU:" prefix, lower-case,
-- collapse whitespace. The two variants are both observed in live data.
norm AS (
  SELECT
    pr.pickup_id,
    pr.delivery_id,
    it.id                                         AS item_id,
    it.dt_order_id                                AS order_id,
    LOWER(
      REGEXP_REPLACE(
        REGEXP_REPLACE(
          COALESCE(it.description, ''),
          '^\s*(PICK\s*UP:\s*)?(PU:\s*)?',
          '', 'i'
        ),
        '\s+', ' ', 'g'
      )
    )                                             AS norm_desc
  FROM pairs pr
  JOIN public.dt_order_items it
    ON it.dt_order_id IN (pr.pickup_id, pr.delivery_id)
  WHERE it.removed_at IS NULL
    AND COALESCE(it.description, '') <> ''
),
-- Pickup-side rows
pu_side AS (
  SELECT pickup_id, delivery_id, item_id AS pickup_item_id, norm_desc
  FROM norm
  WHERE order_id IN (SELECT pickup_id FROM pairs)
),
-- Delivery-side rows
del_side AS (
  SELECT pickup_id, delivery_id, item_id AS delivery_item_id, norm_desc
  FROM norm
  WHERE order_id IN (SELECT delivery_id FROM pairs)
),
-- For each pair × norm_desc, count occurrences on each side
counts AS (
  SELECT
    pr.pickup_id,
    pr.delivery_id,
    pu.norm_desc,
    COUNT(DISTINCT pu.pickup_item_id)   AS pu_count,
    COUNT(DISTINCT del.delivery_item_id) AS del_count
  FROM pairs pr
  LEFT JOIN pu_side  pu  ON pu.pickup_id   = pr.pickup_id
  LEFT JOIN del_side del ON del.delivery_id = pr.delivery_id AND del.norm_desc = pu.norm_desc
  WHERE pu.norm_desc IS NOT NULL
  GROUP BY pr.pickup_id, pr.delivery_id, pu.norm_desc
),
unambiguous AS (
  SELECT c.pickup_id, c.delivery_id, c.norm_desc
  FROM counts c
  WHERE c.pu_count = 1 AND c.del_count = 1
),
links AS (
  SELECT
    del.delivery_item_id,
    pu.pickup_item_id
  FROM unambiguous u
  JOIN pu_side  pu  ON pu.pickup_id   = u.pickup_id   AND pu.norm_desc  = u.norm_desc
  JOIN del_side del ON del.delivery_id = u.delivery_id AND del.norm_desc = u.norm_desc
)
UPDATE public.dt_order_items dit
SET parent_pickup_item_id = l.pickup_item_id
FROM links l
WHERE dit.id = l.delivery_item_id
  AND dit.parent_pickup_item_id IS NULL;
