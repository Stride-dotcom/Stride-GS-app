-- Enable Fabric Protection services as task types (2026-05-28)
--
-- Per operator request: every Fabric Protection service (FAB_RUG, FAB_BED,
-- FAB_CARPET, FAB_CHAIR, FAB_DIN, FAB_HEAD, FAB_LOVE, FAB_OTT, FAB_PILL,
-- FAB_SECT, FAB_SOFA, …) should be usable as a task type. The category as
-- a whole is "all-on by policy" — operators don't want to maintain a per-
-- service toggle on a category where every service should be a task.
--
-- Companion React change in CreateTaskModal.tsx (PR #559 added the
-- show_as_task gate; this PR enables the gate for fabric protection AND
-- sorts those codes to the END of the picker so the everyday picks
-- (INSP, ASM, etc.) stay at the top — fabric protection is used rarely
-- but the ~11 codes would push common picks below the fold without the
-- sort.

UPDATE service_catalog
SET show_as_task = true,
    updated_at = now()
WHERE category = 'Fabric Protection'
  AND show_as_task = false;

-- Assertion: every active Fabric Protection service is now task-enabled.
-- Aborts the migration if any row still has show_as_task=false after the
-- UPDATE (e.g. if an admin edited one out-of-band between audit and apply)
-- so the operator can review before letting it land.
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(code, ', ' ORDER BY code)
    INTO missing
    FROM service_catalog
   WHERE category = 'Fabric Protection'
     AND active = true
     AND show_as_task = false;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'fabric_protection_show_as_task: code(s) % still have show_as_task=false after update — inspect service_catalog before re-running.', missing;
  END IF;
END $$;
