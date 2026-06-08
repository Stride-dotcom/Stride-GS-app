-- ============================================================================
-- Seed app_metadata authZ claims from CURRENT user_metadata (one-time backfill)
--
-- Prerequisite for enabling public.custom_access_token_hook: the hook serves
-- role / clientSheetId / accessibleClientSheetIds from the SERVICE-ROLE-ONLY
-- app_metadata bag. This snapshots each user's CURRENT (working) user_metadata
-- into app_metadata so that turning the hook on is a provable no-op — every
-- user keeps byte-for-byte the access they had, including the special accounts
-- (info@/dispatch@ = staff) whose role in the cb_users mirror is stale.
--
-- Applied via MCP execute_sql 2026-06-08 (158 users had authZ keys to copy;
-- the other 7 had none and correctly got nothing). Verified: app_metadata ==
-- user_metadata for all 165 users on role + clientSheetId + accessible list.
--
-- Nothing read app_metadata before this (0 policies / 0 functions / 0 app code),
-- so the copy itself changed no behavior. Idempotent (re-runs copy whatever is
-- in user_metadata; a no-op on a fresh DB with no users).
--
-- Going-forward freshness for NEW users / role changes is maintained by GAS via
-- public.set_app_metadata_by_email (see that migration) — NOT by re-running this.
-- ============================================================================

UPDATE auth.users u
   SET raw_app_meta_data = COALESCE(u.raw_app_meta_data, '{}'::jsonb)
     || jsonb_strip_nulls(jsonb_build_object(
          'role',                     u.raw_user_meta_data->'role',
          'clientSheetId',            u.raw_user_meta_data->'clientSheetId',
          'accessibleClientSheetIds', u.raw_user_meta_data->'accessibleClientSheetIds'))
 WHERE u.raw_user_meta_data ?| array['role','clientSheetId','accessibleClientSheetIds'];
