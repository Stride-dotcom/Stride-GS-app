-- insurance_bill_due() — add entity_audit_log rows for auto-generated
-- insurance charges so they surface in the ActivityTimeline.
--
-- Identical to the 20260604190000 (proration) version EXCEPT: each loop's
-- `IF row_count > 0` block now also inserts an audit row
--   entity_type='billing', entity_id=<ledger_id>, action='insurance_charge'
--   changes = { client, periodStart, periodEnd, total, declaredValue, final }
--   performed_by='insurance_bill_due', source='supabase'
-- Audit inserts are wrapped in their own BEGIN/EXCEPTION so a failure can
-- never block the billing INSERT or the next_billing_date advance.

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

      -- Audit (best-effort) — surfaces in the ActivityTimeline.
      BEGIN
        INSERT INTO public.entity_audit_log
          (entity_type, entity_id, tenant_id, action, changes, performed_by, source)
        VALUES (
          'billing', ledger_id, r.tenant_id, 'insurance_charge',
          jsonb_build_object(
            'client',        r.client_name,
            'periodStart',   period_start::text,
            'periodEnd',     period_end::text,
            'total',         charge,
            'declaredValue', COALESCE(r.declared_value, 0),
            'final',         false
          ),
          'insurance_bill_due', 'supabase'
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'insurance_bill_due audit insert failed for %: %', ledger_id, SQLERRM;
      END;

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

          -- Audit (best-effort) — final/cancellation charge.
          BEGIN
            INSERT INTO public.entity_audit_log
              (entity_type, entity_id, tenant_id, action, changes, performed_by, source)
            VALUES (
              'billing', ledger_id, r.tenant_id, 'insurance_charge',
              jsonb_build_object(
                'client',        r.client_name,
                'periodStart',   period_start::text,
                'periodEnd',     period_end::text,
                'total',         charge,
                'declaredValue', COALESCE(r.declared_value, 0),
                'final',         true
              ),
              'insurance_bill_due', 'supabase'
            );
          EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'insurance_bill_due audit insert failed for %: %', ledger_id, SQLERRM;
          END;

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
  'Daily insurance auto-billing with proration. (1) Normal: charges the in-progress period, splitting on mid-period declared-value changes and prorating a sub-30-day first period. (2) Cancellation: one final prorated charge to cancelled_at, gated by final_billed_at. Idempotent via partial unique index on svc_code=INSURANCE with a YYYYMMDD ledger tag; advances next_billing_date only when the INSERT actually inserts. v20260613: writes an insurance_charge entity_audit_log row per generated charge (best-effort).';

NOTIFY pgrst, 'reload schema';
