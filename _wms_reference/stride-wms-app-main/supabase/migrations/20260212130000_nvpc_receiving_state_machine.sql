-- =============================================================================
-- NVPC Phase 3 supplement: Database-level state machine for receiving workflow
-- Adds CHECK constraint on inbound_status + transition-validation trigger.
-- Valid statuses: NULL, draft, stage1_complete, receiving, closed
-- Valid transitions (UPDATE only):
--   NULL             → draft
--   draft            → stage1_complete
--   stage1_complete  → receiving   (confirm)
--   stage1_complete  → draft       (Go Back)
--   receiving        → closed      (complete Stage 2)
-- =============================================================================

-- 1) CHECK constraint – restrict column to known values
--    Uses NOT VALID so existing rows aren't scanned (safe for zero-downtime deploys).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'shipments_inbound_status_values'
      AND conrelid = 'public.shipments'::regclass
  ) THEN
    ALTER TABLE public.shipments
      ADD CONSTRAINT shipments_inbound_status_values
      CHECK (inbound_status IS NULL OR inbound_status IN (
        'draft', 'stage1_complete', 'receiving', 'closed'
      ))
      NOT VALID;

    -- Validate asynchronously (lightweight lock)
    ALTER TABLE public.shipments VALIDATE CONSTRAINT shipments_inbound_status_values;
  END IF;
END $$;

-- 2) Transition-validation trigger function
CREATE OR REPLACE FUNCTION public.fn_validate_inbound_status_transition()
RETURNS TRIGGER AS $$
DECLARE
  old_s TEXT;
  new_s TEXT;
BEGIN
  old_s := OLD.inbound_status;
  new_s := NEW.inbound_status;

  -- No change → allow
  IF old_s IS NOT DISTINCT FROM new_s THEN
    RETURN NEW;
  END IF;

  -- NULL → draft
  IF old_s IS NULL AND new_s = 'draft' THEN RETURN NEW; END IF;
  -- draft → stage1_complete
  IF old_s = 'draft' AND new_s = 'stage1_complete' THEN RETURN NEW; END IF;
  -- stage1_complete → receiving
  IF old_s = 'stage1_complete' AND new_s = 'receiving' THEN RETURN NEW; END IF;
  -- stage1_complete → draft  (Go Back)
  IF old_s = 'stage1_complete' AND new_s = 'draft' THEN RETURN NEW; END IF;
  -- receiving → closed
  IF old_s = 'receiving' AND new_s = 'closed' THEN RETURN NEW; END IF;

  -- Everything else is illegal
  RAISE EXCEPTION 'Invalid inbound_status transition: % → %',
    COALESCE(old_s, 'NULL'), COALESCE(new_s, 'NULL');
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- INBOUND STATUS STATE MACHINE (PHASE 3 — RECEIVING EXECUTION LAYER)
--
-- IMPORTANT:
-- inbound_status transitions are STRICTLY enforced by this trigger.
--
-- Valid transitions:
--   NULL → draft
--   draft → stage1_complete
--   stage1_complete → receiving
--   stage1_complete → draft      (Go Back from confirmation guard)
--   receiving → closed
--
-- ANY other transition will RAISE EXCEPTION.
--
-- Developers:
-- Do NOT update inbound_status directly in application code without ensuring
-- the transition is valid per this state machine.
-- If modifying receiving logic, update this trigger accordingly.
-- ============================================================================

-- 3) Attach trigger (idempotent: drop first if exists)
DROP TRIGGER IF EXISTS trg_validate_inbound_status ON public.shipments;

CREATE TRIGGER trg_validate_inbound_status
  BEFORE UPDATE OF inbound_status ON public.shipments
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_validate_inbound_status_transition();
