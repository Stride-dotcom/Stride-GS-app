-- dt_credentials: allow authenticated admins to write the row.
--
-- Bug: the Settings → Integrations → "Manage Account Mapping" side panel
-- writes directly to dt_credentials.account_name_map from the browser via
-- the user's authenticated Supabase session. The Phase-1a schema only
-- shipped SELECT-for-admin and ALL-for-service_role policies, so every
-- save attempt was silently rejected with 42501 (insufficient privilege)
-- and surfaced in the UI as a small "Save error" string.
--
-- Fix: grant INSERT / UPDATE / DELETE to authenticated admins, scoped the
-- same way the existing SELECT policy already is — by the JWT claim
-- user_metadata.role = 'admin'. Service role retains its full-power
-- policy untouched; this only widens the authenticated path.

DROP POLICY IF EXISTS "dt_credentials_insert_admin" ON public.dt_credentials;
CREATE POLICY "dt_credentials_insert_admin" ON public.dt_credentials
  FOR INSERT TO authenticated
  WITH CHECK (((auth.jwt() -> 'user_metadata'::text) ->> 'role'::text) = 'admin');

DROP POLICY IF EXISTS "dt_credentials_update_admin" ON public.dt_credentials;
CREATE POLICY "dt_credentials_update_admin" ON public.dt_credentials
  FOR UPDATE TO authenticated
  USING      (((auth.jwt() -> 'user_metadata'::text) ->> 'role'::text) = 'admin')
  WITH CHECK (((auth.jwt() -> 'user_metadata'::text) ->> 'role'::text) = 'admin');

DROP POLICY IF EXISTS "dt_credentials_delete_admin" ON public.dt_credentials;
CREATE POLICY "dt_credentials_delete_admin" ON public.dt_credentials
  FOR DELETE TO authenticated
  USING (((auth.jwt() -> 'user_metadata'::text) ->> 'role'::text) = 'admin');
