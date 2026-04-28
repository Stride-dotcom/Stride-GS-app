-- Fix: client_intake_links.used_at stays NULL after a public intake submit
-- because anon RLS doesn't allow UPDATE on that table. The submit handler
-- in useClientIntake.ts already TRIES the update best-effort, but it's
-- silently rejected and the admin "Intake Invitations" panel forever shows
-- the link as "unused" even after the prospect completed the form.
--
-- Cleanest fix: piggyback on the trigger that's already firing AFTER INSERT
-- on client_intakes (which created notify_admins_on_intake_submit for the
-- admin notifications). That function runs with SECURITY DEFINER as
-- postgres, which has BYPASSRLS, so it can UPDATE client_intake_links
-- without needing a public RLS hole on that table.
--
-- We extend the existing trigger function rather than adding a second
-- trigger so the two writes (notification rows + used_at marker) stay in a
-- single before-RETURN-NEW block. If the link UPDATE fails for any reason
-- it falls into the same EXCEPTION-WHEN-OTHERS swallow as the notification
-- INSERT — the parent intake row still lands.

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
  -- 1. Fan-out in-app notifications to every active admin.
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
    RAISE WARNING 'notify_admins_on_intake_submit notif INSERT failed (intake still saved): %', SQLERRM;
  END;

  -- 2. Mark the intake link consumed. Anon can't do this via PostgREST,
  --    so the trigger is the authority. Match by link_id (the public-facing
  --    short token) — the intake row carries it as a plain text column.
  --    Skip rows whose used_at is already set so a re-INSERT (admin manually
  --    duplicating an intake from the dashboard) doesn't bump the timestamp.
  IF NEW.link_id IS NOT NULL THEN
    BEGIN
      UPDATE public.client_intake_links
         SET used_at = COALESCE(used_at, now())
       WHERE link_id = NEW.link_id
         AND used_at IS NULL;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'notify_admins_on_intake_submit link UPDATE failed (intake still saved): %', SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$$;

-- Backfill: for every existing client_intakes row whose link wasn't marked
-- used (because the bug pre-dates this migration), flip used_at to the
-- intake's submitted_at. This is a one-shot — uses MIN(submitted_at) per
-- link in case a single link somehow has multiple intakes (e.g. retries
-- before the unique constraint, if any).
UPDATE public.client_intake_links cil
   SET used_at = sub.first_submit
  FROM (
    SELECT link_id, MIN(submitted_at) AS first_submit
      FROM public.client_intakes
     WHERE link_id IS NOT NULL
       AND submitted_at IS NOT NULL
     GROUP BY link_id
  ) sub
 WHERE cil.link_id = sub.link_id
   AND cil.used_at IS NULL;
