-- 2026-06-03 — Fix the inspection-due-date re-stamp incident.
--
-- Symptom: every open INSP task showed due_date = today + 48h (the INSP SLA),
-- regardless of when it was created, and a worker STARTING a task re-bumped
-- its due date to today+48h again. The dashboard "work next" ordering was
-- useless because nothing looked overdue.
--
-- Root cause: the tasks_auto_stamp_due_date trigger filled a blank due_date
-- with COALESCE(NEW.created_at, NOW()) + SLA. GAS resyncs a task to Supabase
-- after writes via sbTaskRow_ (StrideAPI.gs), which sends `created` (text)
-- and `due_date` but OMITS `created_at`. On an UPSERT
-- (INSERT … ON CONFLICT DO UPDATE), the INSERT phase therefore defaults
-- NEW.created_at to now() (today); the BEFORE INSERT trigger stamps
-- due = today + SLA; ON CONFLICT then propagates that EXCLUDED.due_date onto
-- the existing row, while the stored created_at stays the real (old) value.
-- Net: any blank-due task (auto-created INSP tasks land with a blank Due Date
-- cell) gets due re-stamped to today+SLA on every start / sync.
--
-- Fix: base the SLA on the BUSINESS `created` date (text 'YYYY-MM-DD', which
-- sbTaskRow_ DOES carry on every upsert), not created_at. created is the real
-- creation date and is upsert-stable, so due = created + SLA is correct and
-- no longer drifts to "today". Falls back to created_at then CURRENT_DATE if
-- `created` is missing/non-ISO. The High-priority paths (due = today) are
-- unchanged.

CREATE OR REPLACE FUNCTION public.tasks_auto_stamp_due_date()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  sla_hours   numeric;
  is_old_high boolean := false;
  is_new_high boolean;
  v_base      date;
BEGIN
  is_new_high := UPPER(COALESCE(NEW.priority, '')) = 'HIGH';
  IF TG_OP = 'UPDATE' THEN
    is_old_high := UPPER(COALESCE(OLD.priority, '')) = 'HIGH';
  END IF;

  -- High transition → due today (unchanged).
  IF is_new_high AND NOT is_old_high
     AND (TG_OP = 'UPDATE' OR NEW.due_date IS NULL) THEN
    NEW.due_date := CURRENT_DATE;
    RETURN NEW;
  END IF;

  -- Stable SLA base: the business `created` date, NOT created_at (see header).
  v_base := CASE
    WHEN NEW.created ~ '^\d{4}-\d{2}-\d{2}$' THEN NEW.created::date
    WHEN NEW.created_at IS NOT NULL          THEN (NEW.created_at)::date
    ELSE CURRENT_DATE
  END;

  -- High → Normal transition → re-stamp SLA from the create date.
  IF TG_OP = 'UPDATE' AND is_old_high AND NOT is_new_high THEN
    sla_hours := NULL;
    IF NEW.type IS NOT NULL AND NEW.type <> '' THEN
      SELECT default_sla_hours INTO sla_hours
        FROM public.service_catalog
       WHERE UPPER(code) = UPPER(NEW.type) AND active = true
       LIMIT 1;
    END IF;
    IF sla_hours IS NOT NULL AND sla_hours > 0 THEN
      sla_hours := LEAST(sla_hours, 720);
      NEW.due_date := (v_base + make_interval(hours => sla_hours::int))::date;
    ELSE
      NEW.due_date := NULL;
    END IF;
    RETURN NEW;
  END IF;

  -- Fill a blank due_date from the catalog SLA, based on the create date.
  IF NEW.due_date IS NULL AND NEW.type IS NOT NULL AND NEW.type <> '' THEN
    SELECT default_sla_hours INTO sla_hours
      FROM public.service_catalog
     WHERE UPPER(code) = UPPER(NEW.type) AND active = true
     LIMIT 1;
    IF sla_hours IS NOT NULL AND sla_hours > 0 THEN
      sla_hours := LEAST(sla_hours, 720);
      NEW.due_date := (v_base + make_interval(hours => sla_hours::int))::date;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- ── One-shot heal ──────────────────────────────────────────────────────────
-- Correct open / in-progress tasks whose due_date was drifted to today+SLA by
-- the pre-fix trigger, back to created+SLA. Idempotent (only touches rows that
-- differ). Completed/cancelled rows are cosmetic and left as-is.
UPDATE public.tasks t
   SET due_date = (t.created::date + make_interval(hours => LEAST(sc.default_sla_hours, 720)::int))::date,
       updated_at = now()
  FROM public.service_catalog sc
 WHERE t.status IN ('Open', 'In Progress')
   AND t.created ~ '^\d{4}-\d{2}-\d{2}$'
   AND UPPER(sc.code) = UPPER(t.type)
   AND sc.active = true
   AND sc.default_sla_hours > 0
   AND t.due_date IS DISTINCT FROM
       (t.created::date + make_interval(hours => LEAST(sc.default_sla_hours, 720)::int))::date;
