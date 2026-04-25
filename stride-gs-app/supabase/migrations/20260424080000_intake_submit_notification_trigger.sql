-- client_intakes INSERT → in-app notification for every active admin.
--
-- The email channel is handled by GAS handleNotifyIntakeSubmitted_ and fired
-- from the React form fire-and-forget. The email has two classic failure
-- modes: GAS Web App is down OR the admin distribution list isn't set.
-- This trigger is the redundant channel — it runs inside Supabase on the
-- same transaction as the intake insert, so if the row lands the
-- notification lands, regardless of anything else.
--
-- Every row in profiles where role='admin' AND is_active IS NOT FALSE gets
-- one notification. The notification links straight to the intake review
-- screen via action_url.
--
-- tenant_id on in_app_notifications is NOT NULL but intake is pre-tenant
-- (the whole point — the client hasn't been activated yet). We use the
-- sentinel '__intake__' so the row is filterable out of per-tenant views
-- and grouped for admin-inbox rendering.

CREATE OR REPLACE FUNCTION public.notify_admins_on_intake_submit()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  biz  text := COALESCE(NEW.business_name, 'unnamed business');
  ctc  text := COALESCE(NEW.contact_name,  'unknown contact');
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

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_admins_on_intake_submit ON public.client_intakes;
CREATE TRIGGER trg_notify_admins_on_intake_submit
  AFTER INSERT ON public.client_intakes
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_admins_on_intake_submit();
