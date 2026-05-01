-- ============================================================
-- Insurance coverage rate granularity change.
--
-- Old: $300/month per $100,000 declared, $300 monthly minimum
-- New: $30/month per $10,000 declared, $30 monthly minimum
--
-- Same effective rate (0.3% / month) but finer granularity so the
-- monthly charge scales smoothly for clients with declared values
-- under $100k. The minimum drops from $300 → $30 by design (option
-- A in the rate-change discussion: makes the coverage accessible to
-- small clients).
--
-- Existing client_insurance rows have monthly_rate_per_100k=300
-- locked in at activation — we DIVIDE by 10 to convert each row to
-- the new per-$10K basis (300/10 = 30) so historical math is
-- preserved. The math: declared/10000 × 30 ≡ declared/100000 × 300.
--
-- Cron function is replaced to use the new column + divisor + floor.
-- service_catalog INSURANCE row updated to reflect the new unit so
-- the Price List + any synced Stax catalog entry shows the new copy.
--
-- 2026-05-01 PST
-- ============================================================

-- 1. Rename the frozen-rate column on client_insurance + update default.
ALTER TABLE public.client_insurance
  RENAME COLUMN monthly_rate_per_100k TO monthly_rate_per_10k;

ALTER TABLE public.client_insurance
  ALTER COLUMN monthly_rate_per_10k SET DEFAULT 30;

-- 2. Convert existing frozen rates: 300 → 30 (and any other historical
--    value scales by /10). New rows write 30 directly.
UPDATE public.client_insurance
   SET monthly_rate_per_10k = monthly_rate_per_10k / 10;

-- 3. Update the service_catalog INSURANCE row.
UPDATE public.service_catalog
   SET name      = 'Stride Coverage (per $10K declared/month)',
       flat_rate = 30,
       updated_at = now()
 WHERE code = 'INSURANCE';

-- 4. Replace the daily cron function with the new math + floor.
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
    -- New formula: GREATEST($30, declared/$10K × frozen_rate). Floor
    -- enforced for de-minimis declared values; the rate column on each
    -- row is the per-$10K monthly rate frozen at activation.
    charge := GREATEST(
      30,
      ROUND((COALESCE(r.declared_value, 0) / 10000.0) * COALESCE(r.monthly_rate_per_10k, 30), 2)
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
      'Stride Coverage (per $10K declared/month)',
      'Admin',
      ROUND(COALESCE(r.declared_value, 0) / 10000.0, 4),
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
  'Daily insurance auto-billing. Per-$10K granularity (2026-05-01 rate change). Inserts INSURANCE billing entries, advances next_billing_date only when the INSERT actually inserted (skips ON CONFLICT no-ops to prevent month-skipping on retry).';

NOTIFY pgrst, 'reload schema';
