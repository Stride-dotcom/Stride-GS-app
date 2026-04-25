-- Fix: insurance_bill_due() must not advance next_billing_date when the
-- INSERT was a no-op due to ON CONFLICT (duplicate / retry of same period).
--
-- Bug: previously the UPDATE to advance next_billing_date and stamp
-- last_billed_at ran unconditionally inside the loop. On a retry hitting
-- ON CONFLICT DO NOTHING the row was already billed for the period, but
-- next_billing_date still advanced another 30 days — silently skipping
-- a month of billing.
--
-- Fix: capture row_count via GET DIAGNOSTICS after the INSERT, and only
-- run the UPDATE / increment billed_count when the INSERT actually
-- inserted a row.

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
  row_count         integer;
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

    GET DIAGNOSTICS row_count = ROW_COUNT;

    IF row_count > 0 THEN
      UPDATE public.client_insurance
         SET next_billing_date = (next_billing_date + INTERVAL '30 days')::date,
             last_billed_at    = now()
       WHERE id = r.id;

      billed_count := billed_count + 1;
    END IF;
  END LOOP;

  RETURN billed_count;
END;
$$;

COMMENT ON FUNCTION public.insurance_bill_due() IS
  'Daily insurance auto-billing. Scans client_insurance for due rows, inserts INSURANCE billing entries, advances next_billing_date only when the INSERT actually inserted (skips ON CONFLICT no-ops to prevent month-skipping on retry).';
