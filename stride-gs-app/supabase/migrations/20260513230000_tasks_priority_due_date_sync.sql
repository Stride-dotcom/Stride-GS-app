-- v2026-05-13 — Extend tasks auto-due-date trigger to bidirectionally
-- sync due_date with priority transitions.
--
-- PR #399 wired the High→today direction (React-side: clicking High
-- fires postUpdateTaskDueDate({dueDate: today}) alongside the priority
-- update). Operator feedback today: the reverse should mirror —
-- toggling High → Normal should revert due_date back to the SLA-based
-- date so the row falls out of "top of the list" and back into its
-- natural SLA placement.
--
-- Putting both directions in the trigger consolidates the rule. The
-- React side can keep its optimistic UI (it already paints due_date =
-- today on the High click, the trigger now matches and no longer
-- requires a separate companion API call to be correct). Direct DB
-- updates and any future client also get the right behavior.
--
-- Trigger semantics, in priority order:
--   A. priority transitions Normal/null → High  ⇒ due_date := today.
--   B. priority transitions High → Normal/other ⇒ due_date := created
--                                                    + SLA hours (or
--                                                    null if no SLA).
--   C. due_date IS NULL ⇒ fill from SLA (existing behavior).
-- Case A wins over Case C — an INSERT with priority='High' AND
-- due_date=null stamps today, not SLA.

CREATE OR REPLACE FUNCTION public.tasks_auto_stamp_due_date()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sla_hours numeric;
  is_old_high boolean := false;
  is_new_high boolean;
BEGIN
  is_new_high := UPPER(COALESCE(NEW.priority, '')) = 'HIGH';
  IF TG_OP = 'UPDATE' THEN
    is_old_high := UPPER(COALESCE(OLD.priority, '')) = 'HIGH';
  END IF;

  -- Case A: priority transitions INTO High.
  -- Fires on INSERT with priority='High' (when due_date isn't already
  -- explicitly set — so an operator inserting both High AND a custom
  -- future due_date keeps the date) and on UPDATE Normal→High (always,
  -- matching the user-visible "click High = today" intent).
  IF is_new_high AND NOT is_old_high
     AND (TG_OP = 'UPDATE' OR NEW.due_date IS NULL) THEN
    NEW.due_date := CURRENT_DATE;
    RETURN NEW;
  END IF;

  -- Case B: priority transitions OUT of High.
  -- Recompute due_date from the catalog SLA. Overrides whatever the
  -- previous click into High stamped (today's date). If the catalog
  -- has no SLA configured for this svcCode, fall back to null
  -- (operator can set manually).
  IF TG_OP = 'UPDATE' AND is_old_high AND NOT is_new_high THEN
    sla_hours := NULL;
    IF NEW.type IS NOT NULL AND NEW.type <> '' THEN
      SELECT default_sla_hours
        INTO sla_hours
        FROM public.service_catalog
       WHERE UPPER(code) = UPPER(NEW.type)
         AND active = true
       LIMIT 1;
    END IF;
    IF sla_hours IS NOT NULL AND sla_hours > 0 THEN
      sla_hours := LEAST(sla_hours, 720);
      NEW.due_date := (COALESCE(NEW.created_at, NOW()) +
                       make_interval(hours => sla_hours::int))::date;
    ELSE
      NEW.due_date := NULL;
    END IF;
    RETURN NEW;
  END IF;

  -- Case C: due_date IS NULL → fill from SLA (existing behavior).
  IF NEW.due_date IS NULL AND NEW.type IS NOT NULL AND NEW.type <> '' THEN
    SELECT default_sla_hours
      INTO sla_hours
      FROM public.service_catalog
     WHERE UPPER(code) = UPPER(NEW.type)
       AND active = true
     LIMIT 1;
    IF sla_hours IS NOT NULL AND sla_hours > 0 THEN
      sla_hours := LEAST(sla_hours, 720);
      NEW.due_date := (COALESCE(NEW.created_at, NOW()) +
                       make_interval(hours => sla_hours::int))::date;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Add `priority` to the column-trigger list so priority-only UPDATEs
-- fire the function (the React postUpdateTaskPriority call sends only
-- priority; without `priority` in the list the trigger wouldn't see
-- the transition).
DROP TRIGGER IF EXISTS tasks_auto_stamp_due_date_trigger ON public.tasks;
CREATE TRIGGER tasks_auto_stamp_due_date_trigger
BEFORE INSERT OR UPDATE OF due_date, type, created_at, priority ON public.tasks
FOR EACH ROW
EXECUTE FUNCTION public.tasks_auto_stamp_due_date();
