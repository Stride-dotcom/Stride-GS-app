-- Drop the unconditional unique constraint and replace with partial unique index
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS unique_user_role;
DROP INDEX IF EXISTS public.unique_user_role;
CREATE UNIQUE INDEX IF NOT EXISTS unique_user_role
  ON public.user_roles (user_id, role_id)
  WHERE deleted_at IS NULL;