-- ============================================================
-- Insurance auto-billing PRORATION.
--
-- The daily insurance_bill_due() cron previously charged a flat 30-day
-- rate for every period regardless of when a client signed up, changed
-- their declared value, or cancelled. This migration adds full day-for-
-- day proration for three cases:
--
--   1. First-month proration — a mid-month signup whose first billing
--      period is shorter than 30 days is charged only for the days from
--      inception_date to next_billing_date. (Realized by the companion
--      React/EF change that calendar-anchors the first next_billing_date
--      to the 1st of the next month; the function itself prorates any
--      sub-30-day first period generically.)
--
--   2. Cancellation (last-month) proration — a cancelled client
--      (active=false + cancelled_at set) gets one final charge for the
--      days from the start of their in-progress period to cancelled_at.
--      A new `final_billed_at` column makes this idempotent. Paused
--      rows (active=false, cancelled_at NULL) are NOT final-billed.
--
--   3. Mid-period coverage change — when declared_value changes mid
--      period the charge splits: old value for the days before the
--      change, new value for the days after. A new `coverage_changes`
--      audit table records every change (populated automatically by a
--      trigger on client_insurance) and the billing run consumes the
--      in-period changes, marking them billed.
--
-- This migration also:
--   * Captures the CURRENT production function shape — index-inference
--     `ON CONFLICT (ledger_row_id) WHERE svc_code='INSURANCE' ...`.
--     The on-disk 20260501 migration still carries the broken
--     `ON CONFLICT ON CONSTRAINT billing_insurance_ledger_unique` form
--     (a unique INDEX is not a named constraint, so that errors at
--     runtime); prod was hotfixed but never had a committed migration.
--     This file is now the git source of truth for the function.
--   * Switches the idempotency tag from YYYYMM to YYYYMMDD. The 30-day
--     cadence can land two bills in the same calendar month (e.g. Jul 1
--     and Jul 31); a YYYYMM key collapses them into one ledger_row_id,
--     so the second bill hits ON CONFLICT, never advances
--     next_billing_date, and the client silently stops being billed.
--     The full-date tag makes every period's key distinct while keeping
--     same-day-rerun idempotency intact.
--
-- The $30/month minimum is preserved for full (>=30 day) periods and is
-- intentionally NOT applied to partial first/final periods (a half month
-- bills at half rate, which may be < $30).
--
-- 2026-06-04 PST
-- ============================================================

-- ------------------------------------------------------------
-- 1. client_insurance: track that a cancelled row's final partial
--    period has been billed, so it drops out of the cancellation scan.
-- ------------------------------------------------------------
ALTER TABLE public.client_insurance
  ADD COLUMN IF NOT EXISTS final_billed_at timestamptz;

COMMENT ON COLUMN public.client_insurance.final_billed_at IS
  'Set by insurance_bill_due() once the final prorated cancellation charge has been issued (or determined to be $0). NULL = a cancelled row still awaiting its final charge.';

-- ------------------------------------------------------------
-- 2. coverage_changes — audit log of declared-value changes. One row
--    per change; the billing run reads unbilled in-period rows to split
--    the charge, then stamps billed_at.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.coverage_changes (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             text        NOT NULL,
  insurance_id          uuid        REFERENCES public.client_insurance(id) ON DELETE CASCADE,
  old_declared_value    numeric     NOT NULL DEFAULT 0,
  new_declared_value    numeric     NOT NULL DEFAULT 0,
  -- Frozen per-$10K rate captured at change time (declared value is what
  -- normally changes; the rate is recorded for auditability).
  monthly_rate_per_10k  numeric     NOT NULL DEFAULT 30,
  -- The date the change takes effect for proration (defaults to the day
  -- the change was made).
  effective_date        date        NOT NULL DEFAULT CURRENT_DATE,
  changed_at            timestamptz NOT NULL DEFAULT now(),
  -- Stamped by the billing run once the change has been folded into a
  -- charge; NULL = not yet billed.
  billed_at             timestamptz,
  billing_ledger_row_id text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.coverage_changes IS
  'Audit log of client_insurance declared-value changes, written automatically by the log_coverage_change trigger. insurance_bill_due() reads unbilled rows whose effective_date falls inside the period being billed to split the charge day-for-day, then stamps billed_at + billing_ledger_row_id.';

-- Hot path for the billing run + the UI''s "pending changes" read.
CREATE INDEX IF NOT EXISTS idx_coverage_changes_tenant_unbilled
  ON public.coverage_changes(tenant_id, effective_date)
  WHERE billed_at IS NULL;

-- 4-step Data API contract (grants + RLS + policies).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.coverage_changes TO authenticated;
GRANT ALL ON public.coverage_changes TO service_role;

ALTER TABLE public.coverage_changes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "coverage_changes_staff_all" ON public.coverage_changes;
CREATE POLICY "coverage_changes_staff_all" ON public.coverage_changes
  FOR ALL TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('admin','staff'))
  WITH CHECK ((auth.jwt()->'user_metadata'->>'role') IN ('admin','staff'));

DROP POLICY IF EXISTS "coverage_changes_client_read" ON public.coverage_changes;
CREATE POLICY "coverage_changes_client_read" ON public.coverage_changes
  FOR SELECT TO authenticated
  USING (
    (auth.jwt()->'user_metadata'->>'role') = 'client'
    AND tenant_id = (auth.jwt()->'user_metadata'->>'clientSheetId')
  );

-- Realtime — the Insurance card subscribes to surface pending changes.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='coverage_changes'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.coverage_changes';
  END IF;
END $$;

-- ------------------------------------------------------------
-- 3. Trigger: auto-record a coverage_changes row whenever
--    client_insurance.declared_value changes. SECURITY DEFINER so the
--    insert lands regardless of which authenticated role (or Edge
--    Function) performed the update. Fires only on a real value change,
--    so the cron's own next_billing_date / last_billed_at /
--    final_billed_at updates never spawn a spurious row.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_coverage_change() RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.declared_value IS DISTINCT FROM OLD.declared_value THEN
    INSERT INTO public.coverage_changes (
      tenant_id, insurance_id, old_declared_value, new_declared_value,
      monthly_rate_per_10k, effective_date, changed_at
    ) VALUES (
      NEW.tenant_id,
      NEW.id,
      COALESCE(OLD.declared_value, 0),
      COALESCE(NEW.declared_value, 0),
      COALESCE(NEW.monthly_rate_per_10k, 30),
      CURRENT_DATE,
      now()
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS client_insurance_log_coverage_change ON public.client_insurance;
CREATE TRIGGER client_insurance_log_coverage_change
  AFTER UPDATE ON public.client_insurance
  FOR EACH ROW EXECUTE FUNCTION public.log_coverage_change();

-- ------------------------------------------------------------
-- 4. Helper: day-weighted charge for a period [p_start, p_end),
--    splitting on any unbilled declared-value changes that fall strictly
--    inside the period. Returns the RAW (unrounded, unfloored) amount;
--    the caller rounds and applies the monthly minimum.
--
--    The first in-range change's old_declared_value is the value in
--    force at the start of the period; with no in-range changes the
--    passed-in current declared value held for the whole period.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._insurance_charge_for_period(
  p_tenant   text,
  p_rate     numeric,
  p_declared numeric,
  p_start    date,
  p_end      date
) RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  cc          RECORD;
  seg_start   date    := p_start;
  cur_val     numeric;
  raw_total   numeric := 0;
  seg_days    integer;
  have_change boolean := false;
BEGIN
  IF p_end <= p_start THEN
    RETURN 0;
  END IF;

  FOR cc IN
    SELECT effective_date, old_declared_value, new_declared_value
      FROM public.coverage_changes
     WHERE tenant_id = p_tenant
       AND billed_at IS NULL
       AND effective_date >  p_start
       AND effective_date <  p_end
     ORDER BY effective_date, changed_at
  LOOP
    IF NOT have_change THEN
      cur_val     := COALESCE(cc.old_declared_value, p_declared);
      have_change := true;
    END IF;
    seg_days := cc.effective_date - seg_start;
    IF seg_days > 0 THEN
      raw_total := raw_total + (COALESCE(cur_val, 0) / 10000.0 * p_rate) * seg_days / 30.0;
    END IF;
    seg_start := cc.effective_date;
    cur_val   := cc.new_declared_value;
  END LOOP;

  IF NOT have_change THEN
    cur_val := p_declared;
  END IF;

  -- Final (or only) segment.
  seg_days := p_end - seg_start;
  IF seg_days > 0 THEN
    raw_total := raw_total + (COALESCE(cur_val, 0) / 10000.0 * p_rate) * seg_days / 30.0;
  END IF;

  RETURN raw_total;
END;
$$;

COMMENT ON FUNCTION public._insurance_charge_for_period(text, numeric, numeric, date, date) IS
  'Day-weighted (per-30) raw insurance charge for [start,end), splitting on unbilled coverage_changes. Caller rounds + applies the $30 monthly floor.';

-- ------------------------------------------------------------
-- 5. Rewrite insurance_bill_due() with proration.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.insurance_bill_due() RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r              RECORD;
  charge         numeric;
  raw_charge     numeric;
  period_start   date;
  period_end     date;
  total_days     integer;
  period_tag     text;
  ledger_id      text;
  billed_count   integer := 0;
  row_count      integer;
BEGIN
  -- ========================================================
  -- 1. NORMAL recurring billing. Charge covers the in-progress period
  --    [period_start, period_end=next_billing_date). Mid-period declared
  --    -value changes split the charge; a sub-30-day first period
  --    prorates automatically.
  -- ========================================================
  FOR r IN
    SELECT *
      FROM public.client_insurance
     WHERE active = true
       AND coverage_type = 'stride_coverage'
       AND next_billing_date <= CURRENT_DATE
  LOOP
    period_end   := r.next_billing_date;
    period_start := CASE
                      WHEN r.last_billed_at IS NULL THEN r.inception_date
                      ELSE (r.next_billing_date - 30)
                    END;
    total_days := period_end - period_start;

    IF total_days <= 0 THEN
      -- Defensive (bad/backdated data): advance so we never spin.
      UPDATE public.client_insurance
         SET next_billing_date = (next_billing_date + INTERVAL '30 days')::date
       WHERE id = r.id;
      CONTINUE;
    END IF;

    raw_charge := public._insurance_charge_for_period(
                    r.tenant_id,
                    COALESCE(r.monthly_rate_per_10k, 30),
                    COALESCE(r.declared_value, 0),
                    period_start,
                    period_end);

    IF total_days >= 30 THEN
      charge := GREATEST(30, ROUND(raw_charge, 2));
    ELSE
      charge := ROUND(raw_charge, 2);
    END IF;

    period_tag := to_char(r.next_billing_date, 'YYYYMMDD');
    ledger_id  := 'INSURANCE-' || r.tenant_id || '-' || period_tag;

    INSERT INTO public.billing (
      tenant_id, ledger_row_id, status, client_name, date, svc_code, svc_name,
      category, qty, rate, total
    ) VALUES (
      r.tenant_id,
      ledger_id,
      'Unbilled',
      r.client_name,
      r.next_billing_date::text,
      'INSURANCE',
      'Stride Coverage (per $10K declared/month)',
      'Admin',
      ROUND(COALESCE(r.declared_value, 0) / 10000.0, 4),
      charge,
      charge
    )
    ON CONFLICT (ledger_row_id) WHERE svc_code = 'INSURANCE' AND ledger_row_id IS NOT NULL DO NOTHING;

    GET DIAGNOSTICS row_count = ROW_COUNT;

    IF row_count > 0 THEN
      UPDATE public.coverage_changes
         SET billed_at             = now(),
             billing_ledger_row_id = ledger_id
       WHERE tenant_id = r.tenant_id
         AND billed_at IS NULL
         AND effective_date < period_end;

      UPDATE public.client_insurance
         SET next_billing_date = (next_billing_date + INTERVAL '30 days')::date,
             last_billed_at    = now()
       WHERE id = r.id;

      billed_count := billed_count + 1;
    END IF;
  END LOOP;

  -- ========================================================
  -- 2. FINAL (cancellation) billing. One prorated charge for the days
  --    from the start of the in-progress period to cancelled_at. Paused
  --    rows (cancelled_at NULL) are excluded. final_billed_at is always
  --    stamped so the row processes at most once.
  -- ========================================================
  FOR r IN
    SELECT *
      FROM public.client_insurance
     WHERE active = false
       AND coverage_type = 'stride_coverage'
       AND cancelled_at IS NOT NULL
       AND final_billed_at IS NULL
  LOOP
    period_start := CASE
                      WHEN r.last_billed_at IS NULL THEN r.inception_date
                      ELSE (r.next_billing_date - 30)
                    END;
    period_end := r.cancelled_at::date;
    total_days := period_end - period_start;

    IF total_days > 0 THEN
      raw_charge := public._insurance_charge_for_period(
                      r.tenant_id,
                      COALESCE(r.monthly_rate_per_10k, 30),
                      COALESCE(r.declared_value, 0),
                      period_start,
                      period_end);

      IF total_days >= 30 THEN
        charge := GREATEST(30, ROUND(raw_charge, 2));
      ELSE
        charge := ROUND(raw_charge, 2);
      END IF;

      IF charge > 0 THEN
        period_tag := to_char(period_end, 'YYYYMMDD');
        ledger_id  := 'INSURANCE-' || r.tenant_id || '-' || period_tag || '-FINAL';

        INSERT INTO public.billing (
          tenant_id, ledger_row_id, status, client_name, date, svc_code, svc_name,
          category, qty, rate, total
        ) VALUES (
          r.tenant_id,
          ledger_id,
          'Unbilled',
          r.client_name,
          period_end::text,
          'INSURANCE',
          'Stride Coverage (per $10K declared/month)',
          'Admin',
          ROUND(COALESCE(r.declared_value, 0) / 10000.0, 4),
          charge,
          charge
        )
        ON CONFLICT (ledger_row_id) WHERE svc_code = 'INSURANCE' AND ledger_row_id IS NOT NULL DO NOTHING;

        GET DIAGNOSTICS row_count = ROW_COUNT;

        IF row_count > 0 THEN
          UPDATE public.coverage_changes
             SET billed_at             = now(),
                 billing_ledger_row_id = ledger_id
           WHERE tenant_id = r.tenant_id
             AND billed_at IS NULL
             AND effective_date < period_end;
          billed_count := billed_count + 1;
        END IF;
      END IF;
    END IF;

    UPDATE public.client_insurance
       SET final_billed_at = now()
     WHERE id = r.id;
  END LOOP;

  RETURN billed_count;
END;
$$;

COMMENT ON FUNCTION public.insurance_bill_due() IS
  'Daily insurance auto-billing with proration. (1) Normal: charges the in-progress period, splitting on mid-period declared-value changes and prorating a sub-30-day first period. (2) Cancellation: one final prorated charge to cancelled_at, gated by final_billed_at. Idempotent via partial unique index on svc_code=INSURANCE with a YYYYMMDD ledger tag; advances next_billing_date only when the INSERT actually inserts.';

NOTIFY pgrst, 'reload schema';
