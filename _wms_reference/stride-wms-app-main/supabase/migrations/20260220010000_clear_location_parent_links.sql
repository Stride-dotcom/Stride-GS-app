-- Decision DL-2026-02-15-009:
-- Parent location hierarchy is not used; clear existing parent links.
UPDATE public.locations
SET parent_location_id = NULL
WHERE parent_location_id IS NOT NULL;
