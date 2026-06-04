-- 20260604160000_profiles_is_active_default_true.sql
--
-- Make public.profiles.is_active default to TRUE explicit + version-controlled.
--
-- Context: new users were being created deactivated (is_active = false / null),
-- so staff had to remember to manually toggle the account on before the user
-- could log in. They routinely forgot, locking new users out of the whole app.
-- The fix defaults Active=TRUE at every creation path:
--   * GAS handleCreateUser_ (CB Users sheet) — v38.262.0
--   * React Add User modal (Settings.tsx) — Active toggle defaults ON
--   * onboarding path api_upsertClientUser_ already created users Active=TRUE
--
-- The live DB column already carries DEFAULT true, but there was no migration
-- recording it (the profiles table predates this repo's migration history).
-- This statement is idempotent — it pins the intended default in git so a
-- future rebuild can never regress to a NULL/false default.

ALTER TABLE public.profiles
  ALTER COLUMN is_active SET DEFAULT true;

-- Heal any pre-existing rows that were left NULL (treated as active by the app's
-- `is_active !== false` reads, but normalize them so DB filters agree).
UPDATE public.profiles
  SET is_active = true
  WHERE is_active IS NULL;
