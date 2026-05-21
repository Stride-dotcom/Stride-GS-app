-- Add UPDATE policies on public.tasks so authenticated React callers
-- can write directly via supabase.from('tasks').update(...).
--
-- Pre-this-migration tasks had only SELECT policies (tasks_select_client,
-- tasks_select_staff from 20260504210000) + the standard service_role
-- catch-all. An authenticated UPDATE was silently filtered to zero rows
-- by RLS — no error returned, just nothing changed. Same gap that
-- 20260513142109_will_calls_update_rls.sql fixed for will_calls.
--
-- This PR's primary-qty edit (TaskDetailPanel.tsx handleUpdatePrimaryQty)
-- writes directly to public.tasks.qty since completeTask is already
-- Supabase-authoritative. Without these policies the React handler would
-- look like it succeeded — Supabase returns {data: null, error: null} —
-- but the row wouldn't change, and the next refetch would bounce the
-- displayed qty back to 1. Catastrophic UX: operator types 3, sees 3
-- briefly, watches it revert, no error message anywhere.
--
-- Mirrors the existing select-policy split AND the will_calls pattern:
--   • tasks_update_client — tenant-scoped callers (clients with this
--     tenant in accessibleClientSheetIds, plus admin/staff via the same
--     helper) can UPDATE rows in their tenant.
--   • tasks_update_staff — admin/staff role bypasses tenant scope
--     entirely.
-- Matching USING + WITH CHECK prevents row-level tenant_id swaps at
-- write time.

DROP POLICY IF EXISTS tasks_update_client ON public.tasks;
CREATE POLICY tasks_update_client
  ON public.tasks FOR UPDATE TO authenticated
  USING      (public.user_has_tenant_access(tenant_id))
  WITH CHECK (public.user_has_tenant_access(tenant_id));

DROP POLICY IF EXISTS tasks_update_staff ON public.tasks;
CREATE POLICY tasks_update_staff
  ON public.tasks FOR UPDATE TO authenticated
  USING      (((auth.jwt() -> 'user_metadata') ->> 'role') = ANY (ARRAY['admin','staff']))
  WITH CHECK (((auth.jwt() -> 'user_metadata') ->> 'role') = ANY (ARRAY['admin','staff']));

COMMENT ON POLICY tasks_update_client ON public.tasks IS
  'Lets tenant-scoped authenticated callers UPDATE tasks rows in their own tenant. WITH CHECK prevents row-level tenant_id swaps.';
COMMENT ON POLICY tasks_update_staff ON public.tasks IS
  'Admin/staff role bypass for tasks UPDATE. Mirrors tasks_select_staff and will_calls_update_staff.';
