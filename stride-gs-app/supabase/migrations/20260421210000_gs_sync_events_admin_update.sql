-- Allow admin/staff to UPDATE (resolve / dismiss) any user's gs_sync_events row,
-- mirroring the existing SELECT policy. Previously UPDATE was restricted to
-- requested_by = auth.email(), so an admin clicking Dismiss or Retry on a
-- coworker's failure silently affected 0 rows (UPDATE blocked by RLS → no
-- error, row stays sync_failed → reappears on next refetch).

DROP POLICY IF EXISTS users_update_own_events ON public.gs_sync_events;

CREATE POLICY users_update_own_or_admin
  ON public.gs_sync_events
  FOR UPDATE
  TO authenticated
  USING (
    requested_by = auth.email()
    OR ((auth.jwt() -> 'user_metadata') ->> 'role') = ANY (ARRAY['admin','staff'])
  )
  WITH CHECK (
    requested_by = auth.email()
    OR ((auth.jwt() -> 'user_metadata') ->> 'role') = ANY (ARRAY['admin','staff'])
  );
