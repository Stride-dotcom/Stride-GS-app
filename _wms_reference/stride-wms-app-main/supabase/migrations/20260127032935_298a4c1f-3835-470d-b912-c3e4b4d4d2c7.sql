-- Fix item_notes visibility check constraint to accept 'public' and 'internal' values
-- Error 23514 was occurring because the constraint didn't include 'public'

-- Drop any existing check constraint on visibility
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  FOR constraint_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE rel.relname = 'item_notes'
      AND nsp.nspname = 'public'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%visibility%'
  LOOP
    EXECUTE format('ALTER TABLE public.item_notes DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Add corrected check constraint allowing public, internal, and private
ALTER TABLE public.item_notes
ADD CONSTRAINT item_notes_visibility_check
CHECK (visibility IS NULL OR visibility IN ('public', 'internal', 'private'));

-- Fix any existing rows that have invalid visibility values
UPDATE public.item_notes
SET visibility = 'public'
WHERE visibility = 'client';