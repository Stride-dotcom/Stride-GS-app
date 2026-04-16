-- =============================================================================
-- SMS add-on terms version fixed guard (Phase 5 policy enforcement)
-- Migration: 20260215110000_sms_terms_version_fixed_guard.sql
-- =============================================================================
-- Purpose:
--   Enforce DL-2026-02-14-090 server-side by allowing only `sms-addon-v1`
--   when terms_version is written on tenant_sms_addon_activation rows.
-- Notes:
--   Implemented as a trigger guard (instead of CHECK constraint) so any legacy
--   historical rows with alternate values can remain readable without blocking
--   unrelated updates, while new writes are strictly enforced.

CREATE OR REPLACE FUNCTION public.enforce_sms_addon_terms_version_fixed()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only validate on insert or when terms_version is changed.
  IF TG_OP = 'INSERT' OR NEW.terms_version IS DISTINCT FROM OLD.terms_version THEN
    IF NEW.terms_version IS NOT NULL AND BTRIM(NEW.terms_version) <> 'sms-addon-v1' THEN
      RAISE EXCEPTION 'Invalid terms_version "%". Phase 5 policy requires sms-addon-v1.',
        NEW.terms_version;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_sms_addon_terms_version_fixed_trigger
  ON public.tenant_sms_addon_activation;

CREATE TRIGGER enforce_sms_addon_terms_version_fixed_trigger
  BEFORE INSERT OR UPDATE ON public.tenant_sms_addon_activation
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_sms_addon_terms_version_fixed();

COMMENT ON FUNCTION public.enforce_sms_addon_terms_version_fixed() IS
'Phase 5 guard: only sms-addon-v1 is allowed when terms_version changes on tenant_sms_addon_activation.';
