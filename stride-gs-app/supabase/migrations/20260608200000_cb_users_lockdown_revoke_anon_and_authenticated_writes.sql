-- ============================================================================
-- Lock down public.cb_users (the user directory).
--
-- FINDING (2026-06-08 security audit): cb_users granted full
-- INSERT/UPDATE/DELETE/SELECT to BOTH anon and authenticated, plus a policy
-- (`cb_users_service_role_all`) scoped `TO public USING (true)`. So the entire
-- staff/client directory — emails, roles, tenant assignments — was readable AND
-- writable by anyone holding the public anon key (one of 14 rls_policy_always_true
-- advisor findings). A logged-in user could also self-promote with
-- `supabase.from('cb_users').update({role:'admin'})`.
--
-- SAFE TO LOCK DOWN: the React app only READS cb_users, as an authenticated
-- admin/staff user (src/lib/supabaseQueries.ts, src/hooks/useProfiles.ts,
-- ComposeMessageModal). All WRITES are the service-role "Resync Users" path
-- (CB Users tab -> cb_users). The two edge functions that read it
-- (impersonate-mint-session, send-onboarding-email) use the service-role key.
-- service_role keeps every privilege, so none of those paths are affected.
--
-- FIX: revoke anon entirely + remove authenticated WRITE privileges. Keep
-- authenticated SELECT so the app's directory reads keep working. Reversible
-- (re-GRANT to restore). Applied via MCP 2026-06-08 (user-authorized).
--
-- NOTE: this does NOT address the broader rls_references_user_metadata issue
-- (136 policies trust user-editable user_metadata claims) — see the security
-- remediation plan for the access-token-hook fix.
-- ============================================================================

REVOKE ALL PRIVILEGES ON public.cb_users FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES ON public.cb_users FROM authenticated;
