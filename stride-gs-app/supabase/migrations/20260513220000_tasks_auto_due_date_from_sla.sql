-- v2026-05-13 — Auto-stamp tasks.due_date from service_catalog.default_sla_hours
--
-- The dashboard reads public.tasks (Supabase) and sorts by due_date. Pre-fix
-- only handleBatchCreateTasks_ in GAS (the manual "Create Task" modal flow)
-- stamped Due Date from the catalog. The auto-create-on-receive path
-- (handleCompleteShipment_ → INSP/ASM tasks) didn't, so every shipment-
-- generated Inspection task landed with due_date = NULL even though
-- service_catalog.default_sla_hours = 48 was configured for INSP. Operators
-- saw the dashboard "—" in the Due Date column for every new INSP.
--
-- Rather than touch GAS + the React Receiving page to plumb the SLA map
-- through a third call site (the price list is Supabase-only, the dashboard
-- is Supabase-only — keep this Supabase-only too), we stamp due_date at the
-- database layer. Trigger fires BEFORE INSERT OR UPDATE whenever NEW.due_date
-- IS NULL — preserving any operator-set value and re-filling on accidental
-- nulls. Cap matches the React-side 720h (30 days) sanity guard from PR #399.
--
-- Backfill is a single UPDATE — idempotent, only touches rows that are
-- currently NULL on due_date.

-- ── Trigger function ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tasks_auto_stamp_due_date()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sla_hours numeric;
BEGIN
  -- Only fill when due_date is empty AND the row carries a svcCode we can
  -- look up. Manual / operator-set due_dates are never overwritten.
  IF NEW.due_date IS NULL AND NEW.type IS NOT NULL AND NEW.type <> '' THEN
    SELECT default_sla_hours
      INTO sla_hours
      FROM public.service_catalog
     WHERE UPPER(code) = UPPER(NEW.type)
       AND active = true
     LIMIT 1;

    IF sla_hours IS NOT NULL AND sla_hours > 0 THEN
      -- Sanity-cap at 720h (30 days). Matches the React-side guard added
      -- in PR #399 so a fat-finger "9999h" in the price list can't push
      -- due dates years out and pollute the dashboard sort.
      sla_hours := LEAST(sla_hours, 720);
      NEW.due_date := (COALESCE(NEW.created_at, NOW()) +
                       make_interval(hours => sla_hours::int))::date;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ── Trigger ─────────────────────────────────────────────────────────────────
-- BEFORE INSERT OR UPDATE: fires on new rows AND on UPDATEs that re-null
-- due_date (e.g. a full GAS resync that doesn't carry due_date in its
-- payload). The IS NULL guard inside the function means operator-set values
-- always win — UPDATE with a real due_date is a no-op for the trigger.
DROP TRIGGER IF EXISTS tasks_auto_stamp_due_date_trigger ON public.tasks;
CREATE TRIGGER tasks_auto_stamp_due_date_trigger
BEFORE INSERT OR UPDATE OF due_date, type, created_at ON public.tasks
FOR EACH ROW
EXECUTE FUNCTION public.tasks_auto_stamp_due_date();

-- ── Backfill ────────────────────────────────────────────────────────────────
-- Existing rows where due_date IS NULL and the svcCode has a configured SLA.
-- Same logic as the trigger inlined for the one-shot pass.
UPDATE public.tasks t
   SET due_date = (
         t.created_at +
         make_interval(hours => LEAST(sc.default_sla_hours, 720)::int)
       )::date
  FROM public.service_catalog sc
 WHERE t.due_date IS NULL
   AND t.type IS NOT NULL
   AND t.type <> ''
   AND UPPER(sc.code) = UPPER(t.type)
   AND sc.active = true
   AND sc.default_sla_hours IS NOT NULL
   AND sc.default_sla_hours > 0;
