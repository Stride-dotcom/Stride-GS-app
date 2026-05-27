-- Migration: dt_order_items_cubic_feet_per_unit_backfill
--
-- Backfill existing rows so dt_order_items.cubic_feet stores PER-UNIT
-- cubic feet (matching the new modal convention from the same PR).
--
-- Bug: NIP-00127 reported ~12,000 ft³ in DispatchTrack instead of the
-- ~1,200 real volume. Root cause was that the React modal stored
-- cubic_feet as TOTAL (per-unit × qty) on most write sites, then the
-- dt-push-order EF emitted that total as <cube>, and DT multiplied by
-- <quantity> for load — giving qty × (qty × per-unit) = qty² × per-unit.
-- With NIP-00127's mean qty ~10, that's the ~10× inflation.
--
-- Fix going forward: modal now writes per-unit. EF unchanged (emits as-is,
-- DT multiplies by qty for total). This backfill converts the existing
-- TOTAL-convention rows to PER-UNIT so all data is consistent and any
-- re-push of an open order produces the correct DT load.
--
-- Convention before the fix (audited from CreateDeliveryOrderModal.tsx):
--   • Inventory write sites at lines 1601, 2865, 3796: stored PER-UNIT
--     (`cubic_feet: classToCuFt(itemClass) ?? null` — no qty multiplier).
--     These rows are already in the right convention — DO NOT touch.
--   • Inventory write site at line 4224 (single-leg CREATE-NEW): stored
--     TOTAL (`cubic_feet: cuFt * qty`). Needs divide-by-qty.
--   • All 4 ad-hoc write sites (buildPDItemRows, draft-save, edit-save,
--     create-new): stored TOTAL (`cuFtPerUnit * qty`). Needs divide.
--   • PublicServiceRequest ad-hoc (line 946): stored TOTAL. Needs divide.
--
-- Distinguishing TOTAL vs PER-UNIT rows post-hoc:
--   • Inventory rows (class_name IS NOT NULL): TOTAL if
--     cubic_feet ≈ quantity × class.storage_size (within 0.01 ft³).
--     PER-UNIT if cubic_feet ≈ class.storage_size. We divide only when
--     the TOTAL identity holds AND quantity > 1, leaving everything
--     else alone.
--   • Ad-hoc rows (class_name IS NULL, cubic_feet IS NOT NULL,
--     quantity > 1): all four React ad-hoc paths stored TOTAL, so any
--     ad-hoc row with qty > 1 and cubic_feet set is divisible.

-- ── Inventory rows: divide cubic_feet by quantity where the TOTAL identity holds ──
WITH affected AS (
  SELECT doi.id, doi.quantity, doi.cubic_feet, ic.storage_size
  FROM public.dt_order_items doi
  JOIN public.item_classes ic ON ic.id = doi.class_name
  WHERE doi.quantity > 1
    AND doi.cubic_feet IS NOT NULL
    AND doi.cubic_feet > 0
    AND doi.removed_at IS NULL
    AND ic.storage_size > 0
    -- TOTAL identity: cubic_feet ≈ quantity × storage_size (within rounding tolerance).
    AND ABS(doi.cubic_feet - (doi.quantity * ic.storage_size)) < 0.01
)
UPDATE public.dt_order_items doi
SET cubic_feet = affected.storage_size
FROM affected
WHERE doi.id = affected.id;

-- ── Ad-hoc rows: divide cubic_feet by quantity ──
-- class_name IS NULL identifies ad-hoc lines; all four React modal ad-hoc
-- write sites + the public-form path stored TOTAL = cuftPerUnit × qty.
-- For qty=1 the division is a no-op so we filter to qty > 1 to avoid
-- meaningless writes.
UPDATE public.dt_order_items
SET cubic_feet = cubic_feet / quantity
WHERE class_name IS NULL
  AND quantity > 1
  AND cubic_feet IS NOT NULL
  AND cubic_feet > 0
  AND removed_at IS NULL;
