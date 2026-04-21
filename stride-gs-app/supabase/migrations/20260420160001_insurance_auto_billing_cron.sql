-- Phase 4 — insurance auto-billing daily cron.
--
-- Runs daily at 08:00 UTC (01:00 PST / midnight PDT) via pg_cron. For
-- every active client_insurance row with next_billing_date <= today:
--
--   1. Computes charge = max(300, (declared_value / 100000) * rate).
--      $300 minimum enforced per the T&C §2.B Option B.
--   2. Inserts a billing mirror row with svc_code='INSURANCE',
--      status='Unbilled', category='Admin', date=today.
--   3. Advances next_billing_date by 30 days + stamps last_billed_at.
--
-- Idempotency:
--   ledger_row_id = 'INSURANCE-<tenant_id>-<YYYYMM>'. A partial unique
--   index on svc_code='INSURANCE' enforces one row per client per month
--   — duplicate runs on the same day hit ON CONFLICT DO NOTHING.
--   The partial scope leaves non-INSURANCE rows alone (the existing
--   billing table has pre-historical RCVG ledger_row_id duplicates we
--   don't want to touch).
--
-- Proration:
--   The first month is full-price — next_billing_date defaults to
--   inception + 30 at activation. If an admin backdates inception to
--   the past, the first run still charges a full month (deliberate —
--   backdating is an admin override).
--
-- Cancellation:
--   Setting client_insurance.active=false drops the row out of the
--   scan. No final-month prorate is built into this job; that's an
--   admin manual adjustment if ever needed.

-- Partial unique index — only INSURANCE rows are deduped by
-- ledger_row_id, so pre-existing duplicates elsewhere are untouched.
CREATE UNIQUE INDEX IF NOT EXISTS billing_insurance_ledger_unique
  ON public.billing(ledger_row_id)
  WHERE svc_code = 'INSURANCE' AND ledger_row_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.insurance_bill_due() RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r                 RECORD;
  charge            numeric;
  period_tag        text;
  ledger_id         text;
  billed_count      integer := 0;
BEGIN
  FOR r IN
    SELECT *
      FROM public.client_insurance
     WHERE active = true
       AND coverage_type = 'stride_coverage'
       AND next_billing_date <= CURRENT_DATE
  LOOP
    charge := GREATEST(
      300,
      ROUND((COALESCE(r.declared_value, 0) / 100000.0) * COALESCE(r.monthly_rate_per_100k, 300), 2)
    );

    period_tag := to_char(r.next_billing_date, 'YYYYMM');
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
      'Stride Coverage (per $100K declared/month)',
      'Admin',
      ROUND(COALESCE(r.declared_value, 0) / 100000.0, 4),
      charge,
      charge
    )
    ON CONFLICT ON CONSTRAINT billing_insurance_ledger_unique DO NOTHING;

    UPDATE public.client_insurance
       SET next_billing_date = (next_billing_date + INTERVAL '30 days')::date,
           last_billed_at    = now()
     WHERE id = r.id;

    billed_count := billed_count + 1;
  END LOOP;

  RETURN billed_count;
END;
$$;

COMMENT ON FUNCTION public.insurance_bill_due() IS
  'Daily insurance auto-billing. Scans client_insurance for due rows, inserts INSURANCE billing entries, advances next_billing_date. Idempotent via partial unique index on svc_code=INSURANCE.';

-- Schedule: 08:00 UTC daily (01:00 PST / midnight PDT). Stride runs in
-- America/Los_Angeles; overnight runs mean the Unbilled row is waiting
-- for the operator when they open the app the next morning.
DO $$
DECLARE
  jid bigint;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'insurance-auto-billing';
  IF jid IS NOT NULL THEN
    PERFORM cron.unschedule(jid);
  END IF;
END $$;

SELECT cron.schedule(
  'insurance-auto-billing',
  '0 8 * * *',
  $$SELECT public.insurance_bill_due();$$
);
