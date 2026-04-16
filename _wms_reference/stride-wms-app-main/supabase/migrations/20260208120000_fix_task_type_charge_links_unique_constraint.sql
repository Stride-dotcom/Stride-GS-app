-- ============================================================================
-- Fix task_type_charge_links unique constraint
-- ============================================================================
-- Problem: A UNIQUE constraint on task_type_id alone prevents linking multiple
--          charge types to a single task type (multi-service templates).
--
-- Fix: Replace UNIQUE(task_type_id) with a composite unique on
--      (tenant_id, task_type_id, charge_type_id) to allow multiple services
--      per task type while preventing duplicate links.
-- ============================================================================

-- Step 1: Find and drop the existing unique constraint on task_type_id
DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT c.conname INTO constraint_name
  FROM pg_constraint c
  JOIN pg_class t ON c.conrelid = t.oid
  WHERE t.relname = 'task_type_charge_links'
    AND c.contype = 'u'
    AND array_length(c.conkey, 1) = 1
    AND EXISTS (
      SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = t.oid
        AND a.attnum = c.conkey[1]
        AND a.attname = 'task_type_id'
    );

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE task_type_charge_links DROP CONSTRAINT %I', constraint_name);
    RAISE NOTICE 'Dropped unique constraint: %', constraint_name;
  ELSE
    RAISE NOTICE 'No single-column unique constraint on task_type_id found — skipping drop.';
  END IF;
END $$;

-- Step 2: Add composite unique constraint
-- Allows multiple charge types per task type, but prevents the same
-- (tenant, task_type, charge_type) combination from being linked twice.
ALTER TABLE task_type_charge_links
  ADD CONSTRAINT task_type_charge_links_tenant_tasktype_chargetype_key
  UNIQUE (tenant_id, task_type_id, charge_type_id);
