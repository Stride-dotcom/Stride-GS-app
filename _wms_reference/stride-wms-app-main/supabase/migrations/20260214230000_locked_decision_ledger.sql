-- ============================================================================
-- Locked Decision Ledger (Immutable / Append-only)
-- ============================================================================
-- Purpose:
--   Provide an append-only ledger to record implementation/product decisions and
--   their status changes over time. Entries are immutable: no UPDATE/DELETE.
--
-- Access model:
--   - authenticated users with public.current_user_is_admin_dev() can SELECT/INSERT
--   - no client UPDATE/DELETE policies
--   - DB trigger blocks UPDATE/DELETE for all roles (including service_role)
-- ============================================================================

-- 1) Table
CREATE TABLE IF NOT EXISTS public.decision_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Grouping key for a single decision thread
  decision_key text NOT NULL,

  -- Entry type: decision creation, status update, or note
  entry_type text NOT NULL CHECK (entry_type IN ('decision', 'status', 'note')),

  -- Optional descriptive fields (recommended for entry_type='decision')
  title text NULL,

  -- Freeform content for the entry
  body text NOT NULL,

  -- Optional status; typically set for entry_type='decision' and 'status'
  status text NULL,

  -- Optional phase/version tags for build tracking (e.g., "Phase 5", "v3")
  phase text NULL,
  version text NULL,

  -- Extra machine-readable info (links, external IDs, etc.)
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_decision_ledger_entries_decision_key_created_at
  ON public.decision_ledger_entries (decision_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_decision_ledger_entries_created_at
  ON public.decision_ledger_entries (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_decision_ledger_entries_status
  ON public.decision_ledger_entries (status)
  WHERE status IS NOT NULL;

-- 2) Immutability trigger (blocks UPDATE/DELETE for all roles)
CREATE OR REPLACE FUNCTION public.prevent_decision_ledger_entry_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'decision_ledger_entries is append-only; % is not allowed', TG_OP
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_decision_ledger_entry_update ON public.decision_ledger_entries;
CREATE TRIGGER trg_prevent_decision_ledger_entry_update
  BEFORE UPDATE ON public.decision_ledger_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_decision_ledger_entry_mutation();

DROP TRIGGER IF EXISTS trg_prevent_decision_ledger_entry_delete ON public.decision_ledger_entries;
CREATE TRIGGER trg_prevent_decision_ledger_entry_delete
  BEFORE DELETE ON public.decision_ledger_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_decision_ledger_entry_mutation();

-- 3) RLS
ALTER TABLE public.decision_ledger_entries ENABLE ROW LEVEL SECURITY;

-- Admin-dev only: read
DROP POLICY IF EXISTS "decision_ledger_entries_select_admin_dev" ON public.decision_ledger_entries;
CREATE POLICY "decision_ledger_entries_select_admin_dev"
  ON public.decision_ledger_entries
  FOR SELECT
  USING (public.current_user_is_admin_dev());

-- Admin-dev only: insert
DROP POLICY IF EXISTS "decision_ledger_entries_insert_admin_dev" ON public.decision_ledger_entries;
CREATE POLICY "decision_ledger_entries_insert_admin_dev"
  ON public.decision_ledger_entries
  FOR INSERT
  WITH CHECK (public.current_user_is_admin_dev());

-- No UPDATE/DELETE policies for clients (immutability enforced by trigger anyway).

COMMENT ON TABLE public.decision_ledger_entries IS 'Locked decision ledger entries (append-only, immutable).';
COMMENT ON COLUMN public.decision_ledger_entries.decision_key IS 'Stable key grouping entries for a single decision thread.';
COMMENT ON COLUMN public.decision_ledger_entries.entry_type IS 'decision | status | note';
COMMENT ON COLUMN public.decision_ledger_entries.metadata IS 'Extra machine-readable context (links, external IDs, etc.)';

