-- ============================================================================
-- Custom Access Token Hook — serve authZ claims from the locked app_metadata
--
-- SECURITY FIX (2026-06-08): RLS across the app (136 policies + every RPC gate)
-- trusted user_metadata.{role,clientSheetId,accessibleClientSheetIds} — but
-- user_metadata is USER-WRITABLE (supabase.auth.updateUser({data})), so any
-- authenticated user could self-escalate to admin + all-tenant access. There
-- was no access-token hook, so the JWT reflected the editable user_metadata.
--
-- FIX: this access-token hook copies the SERVICE-ROLE-ONLY app_metadata authZ
-- keys into the user_metadata CLAIM at token mint. The 136 policies read
-- user_metadata.* unchanged, but now get trusted (un-editable) values. A user
-- editing their own user_metadata can no longer change role/tenant access.
--
-- Enabled in Dashboard -> Authentication -> Hooks -> "Customize Access Token
-- (JWT) Claims" (Postgres function public.custom_access_token_hook).
--
-- Cutover was provably zero-change: app_metadata was seeded == current
-- user_metadata for all 165 users first (see the seed migration), so enabling
-- changed nobody's effective access. Verified live: logins (admin/staff/client)
-- succeeding, no hook errors.
--
-- Fail-open (errors return the original event so token issuance never breaks).
-- Copy-when-present (keys absent from app_metadata are left as-is).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  claims  jsonb := COALESCE(event->'claims', '{}'::jsonb);
  app_md  jsonb := COALESCE(claims->'app_metadata', '{}'::jsonb);
  user_md jsonb := COALESCE(claims->'user_metadata', '{}'::jsonb);
BEGIN
  IF app_md ? 'role' THEN
    user_md := user_md || jsonb_build_object('role', app_md->'role');
  END IF;
  IF app_md ? 'clientSheetId' THEN
    user_md := user_md || jsonb_build_object('clientSheetId', app_md->'clientSheetId');
  END IF;
  IF app_md ? 'accessibleClientSheetIds' THEN
    user_md := user_md || jsonb_build_object('accessibleClientSheetIds', app_md->'accessibleClientSheetIds');
  END IF;

  claims := jsonb_set(claims, '{user_metadata}', user_md);
  event  := jsonb_set(event, '{claims}', claims);
  RETURN event;
EXCEPTION WHEN OTHERS THEN
  RETURN event;  -- never block token issuance
END;
$$;

GRANT USAGE   ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM authenticated, anon, public;
