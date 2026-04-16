-- =============================================================================
-- Locations type rename: aisle -> row
-- =============================================================================
-- Purpose:
-- - Correct terminology: "aisle" is the space between rows; stored location type should be "row".
-- - Safe to run before production data is loaded.
-- - Idempotent data migration (no schema changes).
--
-- Notes:
-- - Does NOT touch billing objects.
-- - locations.type is TEXT and not constrained by an enum CHECK constraint (location_type has its own CHECK).
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'locations'
      AND column_name = 'type'
  ) THEN
    UPDATE public.locations
    SET type = 'row'
    WHERE type = 'aisle';
  END IF;
END $$;

