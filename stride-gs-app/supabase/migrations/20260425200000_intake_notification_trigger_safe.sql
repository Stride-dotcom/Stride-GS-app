-- notify_admins_on_intake_submit — wrap the INSERT in BEGIN/EXCEPTION so a
-- notification failure cannot roll back the parent intake transaction.
--
-- The original migration (20260424080000) is owned by `postgres` (which has
-- BYPASSRLS), so under normal operation the SECURITY DEFINER trigger ALWAYS
-- writes to in_app_notifications without RLS getting in the way. But "normal
-- operation" is a guarantee about today, not tomorrow — if a future RLS
-- change, constraint, or table rename ever caused the INSERT to throw, the
-- ENTIRE intake submit transaction would roll back and the prospect's row
-- would be lost. The email channel is independent and can compensate, but
-- the row-loss is silent and unrecoverable without logs.
--
-- This migration replaces the function with a defensive version that catches
-- any INSERT failure, raises a WARNING (visible in pg logs), and lets the
-- parent transaction commit. The intake row ALWAYS lands. The notification
-- is best-effort.

CREATE OR REPLACE FUNCTION public.notify_admins_on_intake_submit()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  biz text := COALESCE(NEW.business_name, 'unnamed business');
  ctc text := COALESCE(NEW.contact_name,  'unknown contact');
BEGIN
  BEGIN
    INSERT INTO public.in_app_notifications
      (tenant_id, user_id, title, body, icon, category,
       related_entity_type, related_entity_id, action_url, priority)
    SELECT
      '__intake__',
      p.id,
      '📝 New Client Intake — ' || biz,
      ctc || ' submitted the onboarding form. Review and activate.',
      'clipboard-check',
      'intake',
      'client_intake',
      NEW.id::text,
      '/#/settings?tab=clients&subtab=intakes&intake=' || NEW.id::text,
      'high'
    FROM public.profiles p
    WHERE p.role = 'admin'
      AND COALESCE(p.is_active, true) = true;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_admins_on_intake_submit failed (intake still saved): %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;
