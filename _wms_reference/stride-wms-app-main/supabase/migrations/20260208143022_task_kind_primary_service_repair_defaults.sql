-- =============================================================================
-- Migration: task_kind ENUM, primary_service_code on task_types, repair resolver columns
-- =============================================================================
-- Moves task categorization and service code binding to task_types (single source of truth).
-- Adds resolver columns to accounts and tenant_company_settings for repair automation.
-- Backfills task_type_id on tasks, task_kind and primary_service_code on task_types.
-- =============================================================================

-- =============================================================================
-- STEP 1: CREATE ENUM TYPE task_kind (if not exists)
-- =============================================================================
DO $$ BEGIN
  CREATE TYPE task_kind AS ENUM ('inspection', 'assembly', 'repair', 'disposal', 'other');
  RAISE NOTICE 'Created enum task_kind';
EXCEPTION
  WHEN duplicate_object THEN
    RAISE NOTICE 'Enum task_kind already exists; skipping';
END $$;

-- =============================================================================
-- STEP 2: ADD task_types.task_kind (if not exists)
-- =============================================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'task_types'
      AND column_name = 'task_kind'
  ) THEN
    ALTER TABLE public.task_types
      ADD COLUMN task_kind task_kind NOT NULL DEFAULT 'other';
    RAISE NOTICE 'Added column task_types.task_kind';
  ELSE
    RAISE NOTICE 'Column task_types.task_kind already exists; skipping';
  END IF;
END $$;

-- =============================================================================
-- STEP 3: ADD task_types.primary_service_code (if not exists)
-- =============================================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'task_types'
      AND column_name = 'primary_service_code'
  ) THEN
    ALTER TABLE public.task_types
      ADD COLUMN primary_service_code TEXT;
    RAISE NOTICE 'Added column task_types.primary_service_code';
  ELSE
    RAISE NOTICE 'Column task_types.primary_service_code already exists; skipping';
  END IF;
END $$;

COMMENT ON COLUMN public.task_types.task_kind IS
  'Categorizes task type for routing and automation (ENUM: inspection, assembly, repair, disposal, other).';
COMMENT ON COLUMN public.task_types.primary_service_code IS
  'Charge code (from charge_types.charge_code) for the primary billable service. E.g. INSP, REPAIR, 1HRO, DISPOSAL.';

-- =============================================================================
-- STEP 4: ADD repair resolver columns to accounts
-- =============================================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'accounts'
      AND column_name = 'repair_task_type_id_for_damage'
  ) THEN
    ALTER TABLE public.accounts
      ADD COLUMN repair_task_type_id_for_damage UUID REFERENCES public.task_types(id),
      ADD COLUMN repair_task_type_id_for_quote UUID REFERENCES public.task_types(id);
    RAISE NOTICE 'Added repair resolver columns to accounts';
  ELSE
    RAISE NOTICE 'Repair resolver columns already exist on accounts; skipping';
  END IF;
END $$;

COMMENT ON COLUMN public.accounts.repair_task_type_id_for_damage IS
  'Account-level override: which repair task type to use when damage is detected.';
COMMENT ON COLUMN public.accounts.repair_task_type_id_for_quote IS
  'Account-level override: which repair task type to use when creating repair from quote.';

-- =============================================================================
-- STEP 5: ADD repair resolver columns to tenant_company_settings
-- =============================================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tenant_company_settings'
      AND column_name = 'default_repair_task_type_id_for_damage'
  ) THEN
    ALTER TABLE public.tenant_company_settings
      ADD COLUMN default_repair_task_type_id_for_damage UUID REFERENCES public.task_types(id),
      ADD COLUMN default_repair_task_type_id_for_quote UUID REFERENCES public.task_types(id);
    RAISE NOTICE 'Added repair resolver columns to tenant_company_settings';
  ELSE
    RAISE NOTICE 'Repair resolver columns already exist on tenant_company_settings; skipping';
  END IF;
END $$;

COMMENT ON COLUMN public.tenant_company_settings.default_repair_task_type_id_for_damage IS
  'Org-level default: which repair task type to use when damage is detected.';
COMMENT ON COLUMN public.tenant_company_settings.default_repair_task_type_id_for_quote IS
  'Org-level default: which repair task type to use when creating repair from quote.';

-- =============================================================================
-- STEP 6: BACKFILL tasks.task_type_id where NULL (best-effort, match by name + tenant)
-- =============================================================================
UPDATE public.tasks t
SET task_type_id = tt.id
FROM public.task_types tt
WHERE t.task_type_id IS NULL
  AND t.tenant_id = tt.tenant_id
  AND lower(trim(t.task_type)) = lower(trim(tt.name));

-- =============================================================================
-- STEP 7: BACKFILL task_types.task_kind FROM name patterns
-- =============================================================================
UPDATE public.task_types
SET task_kind = 'inspection'
WHERE task_kind = 'other'
  AND lower(name) IN ('inspection', 'inspect');

UPDATE public.task_types
SET task_kind = 'assembly'
WHERE task_kind = 'other'
  AND lower(name) IN ('assembly', 'assemble');

UPDATE public.task_types
SET task_kind = 'repair'
WHERE task_kind = 'other'
  AND lower(name) IN ('repair');

UPDATE public.task_types
SET task_kind = 'disposal'
WHERE task_kind = 'other'
  AND lower(name) IN ('disposal', 'dispose');

-- =============================================================================
-- STEP 8: BACKFILL task_types.primary_service_code from existing service code columns
-- =============================================================================
UPDATE public.task_types
SET primary_service_code = COALESCE(default_service_code, billing_service_code)
WHERE primary_service_code IS NULL
  AND COALESCE(default_service_code, billing_service_code) IS NOT NULL;

-- =============================================================================
-- STEP 9: DROP stale columns from tasks table (if added by previous version of migration)
-- =============================================================================
ALTER TABLE public.tasks DROP COLUMN IF EXISTS primary_service_code;
ALTER TABLE public.tasks DROP COLUMN IF EXISTS task_kind;

-- Drop the partial index if it was created on tasks.primary_service_code
DROP INDEX IF EXISTS idx_tasks_primary_service_code;

-- =============================================================================
-- STEP 10: CREATE index on task_types.primary_service_code for billing queries
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_task_types_primary_service_code
  ON public.task_types (primary_service_code)
  WHERE primary_service_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_task_types_task_kind
  ON public.task_types (task_kind);
