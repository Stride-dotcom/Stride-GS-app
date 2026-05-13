-- Top-up backfill: fungible-items case
-- =====================================
-- The 20260513140000 migration only linked PU/Delivery item pairs
-- where the description matched 1:1 (pu_count = 1 AND del_count = 1).
-- That misses the common case where a P+D pair has multiple copies
-- of the same item — e.g. MRS-00029 has 2 × "Moroso square side chair",
-- 2 × "Foscarini Gregg floor lamp", etc. With pu_count = del_count = 2,
-- the first pass skipped both as ambiguous.
--
-- Fungible items are interchangeable, so when pu_count = del_count > 1,
-- we can pair them in row-id order without losing information — each
-- delivery item points at SOME corresponding pickup item, and which
-- specific one doesn't matter (they're the same physical object class).
--
-- Idempotent via the IS NULL filter so re-running is safe.

WITH pairs AS (
  SELECT p.id AS pickup_id, p.linked_order_id AS delivery_id
  FROM public.dt_orders p
  WHERE p.order_type = 'pickup'
    AND p.linked_order_id IS NOT NULL
),
norm AS (
  SELECT
    pr.pickup_id, pr.delivery_id,
    it.id AS item_id, it.dt_order_id AS order_id,
    LOWER(
      REGEXP_REPLACE(
        REGEXP_REPLACE(COALESCE(it.description, ''), '^\s*(PICK\s*UP:\s*)?(PU:\s*)?', '', 'i'),
        '\s+', ' ', 'g'
      )
    ) AS norm_desc
  FROM pairs pr
  JOIN public.dt_order_items it ON it.dt_order_id IN (pr.pickup_id, pr.delivery_id)
  WHERE it.removed_at IS NULL
    AND COALESCE(it.description, '') <> ''
    -- Only consider rows that aren't already linked. Pickup-side
    -- never has parent_pickup_item_id set; the filter applies to the
    -- delivery side via the join below, but we keep the broad scope
    -- here for symmetry.
),
pu_ordered AS (
  SELECT
    pickup_id, delivery_id, norm_desc, item_id AS pickup_item_id,
    ROW_NUMBER() OVER (PARTITION BY pickup_id, norm_desc ORDER BY item_id) AS rn
  FROM norm
  WHERE order_id IN (SELECT pickup_id FROM pairs)
),
del_ordered AS (
  SELECT
    pickup_id, delivery_id, norm_desc, item_id AS delivery_item_id,
    ROW_NUMBER() OVER (PARTITION BY delivery_id, norm_desc ORDER BY item_id) AS rn
  FROM norm
  WHERE order_id IN (SELECT delivery_id FROM pairs)
),
-- Only proceed for pair × norm_desc where counts are equal AND > 0
-- on both sides. Different counts (e.g. pu=3 del=2) stay unlinked,
-- because we can't tell which two deliveries should map to which
-- two pickups without more signal.
matched_counts AS (
  SELECT
    pu.pickup_id, pu.delivery_id, pu.norm_desc,
    MAX(pu.rn) AS pu_max,
    MAX(del.rn) AS del_max
  FROM pu_ordered pu
  JOIN del_ordered del
    ON del.pickup_id  = pu.pickup_id
   AND del.delivery_id = pu.delivery_id
   AND del.norm_desc  = pu.norm_desc
  GROUP BY pu.pickup_id, pu.delivery_id, pu.norm_desc
  HAVING MAX(pu.rn) = MAX(del.rn)
),
links AS (
  SELECT del.delivery_item_id, pu.pickup_item_id
  FROM matched_counts mc
  JOIN pu_ordered  pu
    ON pu.pickup_id  = mc.pickup_id
   AND pu.norm_desc  = mc.norm_desc
  JOIN del_ordered del
    ON del.delivery_id = mc.delivery_id
   AND del.norm_desc   = mc.norm_desc
   AND del.rn          = pu.rn
)
UPDATE public.dt_order_items dit
SET parent_pickup_item_id = l.pickup_item_id
FROM links l
WHERE dit.id = l.delivery_item_id
  AND dit.parent_pickup_item_id IS NULL;
