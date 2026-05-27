-- Migration: item_classes_cubic_feet
--
-- Adds a `cubic_feet` column to item_classes for the DispatchTrack
-- payload's <cube> field. Previously the React modal used
-- `storage_size` as cubic feet, but storage_size is a storage-billing
-- multiplier (XS=5, S=15, M=45, L=75, XL=100, XXL=150) — those values
-- are ~3–10× the realistic per-piece cubic footage, so DT loads were
-- wildly inflated (e.g. NIP-00127 reported ~12,000 ft³, should be
-- ~1,200). Adding a dedicated column means storage billing (which
-- uses storage_size × STOR rate) and the Quote Tool stay unchanged,
-- while DT routing gets realistic volume.
--
-- Defaults are best-estimate furniture/freight piece volumes:
--   XS  =  1  (lamp shade, small box)
--   S   =  3  (chair, small table)
--   M   = 10  (dresser, desk)
--   L   = 20  (sofa, large table)
--   XL  = 35  (sectional piece, armoire)
--   XXL = 50  (large sectional, piano)
--   NC  =  0  (non-cubic / billable extras, no volume contribution)
--
-- Admins can tune values per class in Price List → Classes.

ALTER TABLE public.item_classes
  ADD COLUMN IF NOT EXISTS cubic_feet numeric NOT NULL DEFAULT 0;

UPDATE public.item_classes SET cubic_feet =  1 WHERE id = 'XS'  AND cubic_feet = 0;
UPDATE public.item_classes SET cubic_feet =  3 WHERE id = 'S'   AND cubic_feet = 0;
UPDATE public.item_classes SET cubic_feet = 10 WHERE id = 'M'   AND cubic_feet = 0;
UPDATE public.item_classes SET cubic_feet = 20 WHERE id = 'L'   AND cubic_feet = 0;
UPDATE public.item_classes SET cubic_feet = 35 WHERE id = 'XL'  AND cubic_feet = 0;
UPDATE public.item_classes SET cubic_feet = 50 WHERE id = 'XXL' AND cubic_feet = 0;
UPDATE public.item_classes SET cubic_feet =  0 WHERE id = 'NC';

COMMENT ON COLUMN public.item_classes.cubic_feet IS
  'Per-piece cubic feet sent to DispatchTrack as the <cube> field for routing/load planning. Distinct from storage_size (the storage-billing multiplier).';
