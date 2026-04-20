-- ============================================================
-- entity_notes: collapse visibility to two values (public | internal)
--
-- Session 73 follow-up. The `staff_only` visibility option was a
-- middle tier that overlapped semantically with `internal` for
-- clients (both are hidden from clients via RLS). Simplify the UI
-- to two clearly-distinct options:
--   • public   — visible to everyone with access to the entity
--   • internal — staff/admin only; rendered with a prominent
--                warning label in the UI so nobody accidentally
--                leaks sensitive content in the wrong mode
--
-- The RLS policies already only permit clients to SELECT rows with
-- visibility='public' (see entity_notes_select_client), so this is
-- a constraint-tightening change only.
-- ============================================================

-- 1. Migrate any existing `staff_only` rows to `internal` first so
--    the CHECK replacement doesn't reject them. (Currently zero rows
--    at time of writing — no-op in practice.)
UPDATE public.entity_notes
SET visibility = 'internal'
WHERE visibility = 'staff_only';

-- 2. Drop the old CHECK constraint (name discovered via pg_constraint)
DO $$
DECLARE
  cname text;
BEGIN
  SELECT conname INTO cname
    FROM pg_constraint
    WHERE conrelid = 'public.entity_notes'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%visibility%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.entity_notes DROP CONSTRAINT %I', cname);
  END IF;
END $$;

-- 3. Add the tightened CHECK constraint
ALTER TABLE public.entity_notes
  ADD CONSTRAINT entity_notes_visibility_check
  CHECK (visibility IN ('public','internal'));
