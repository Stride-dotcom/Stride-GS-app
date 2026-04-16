-- =============================================================================
-- BUILD 38: Add waive charges fields to tasks
-- =============================================================================
-- Adds task-level waive state so managers can waive all billing on a task.
-- When waive is toggled ON, all unbilled billing_events for the task are voided.
-- Waive is locked once any billing_event for the task is invoiced.
-- =============================================================================

-- A) Add waive columns to public.tasks (IF NOT EXISTS)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'waive_charges'
  ) THEN
    ALTER TABLE public.tasks ADD COLUMN waive_charges boolean NOT NULL DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'waived_at'
  ) THEN
    ALTER TABLE public.tasks ADD COLUMN waived_at timestamptz NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'waived_by'
  ) THEN
    ALTER TABLE public.tasks ADD COLUMN waived_by uuid NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'waive_reason'
  ) THEN
    ALTER TABLE public.tasks ADD COLUMN waive_reason text NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'waive_notes'
  ) THEN
    ALTER TABLE public.tasks ADD COLUMN waive_notes text NULL;
  END IF;
END $$;

-- B) Ensure public.task_types.primary_service_code exists (safety)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'task_types' AND column_name = 'primary_service_code'
  ) THEN
    ALTER TABLE public.task_types ADD COLUMN primary_service_code text NULL;
  END IF;
END $$;

-- C) Optional index for waive queries
CREATE INDEX IF NOT EXISTS idx_tasks_tenant_waive
  ON public.tasks (tenant_id, waive_charges);
