-- Phase 1 — schema for insurance auto-billing.
--
-- Clients who elect Stride coverage declare a dollar amount to insure;
-- Stride bills them a monthly processing fee ($300 per $100,000
-- declared, $300 minimum). An admin sets up insurance once at client
-- activation; a daily cron (Phase 4) creates the billing entry when
-- each client's next_billing_date arrives.
--
-- Pieces in this file:
--   1. service_catalog.unit CHECK gains 'per_declared_value' so the
--      INSURANCE service can declare that its rate is evaluated against
--      a declared-value input rather than per-item / per-day / etc.
--   2. INSURANCE row in service_catalog — single source of truth for
--      the monthly rate per $100K. Admin can edit the rate on the
--      Price List page; future billing runs pick up the change
--      (historical monthly_rate_per_100k is frozen per-client in
--      client_insurance so rate changes are prospective).
--   3. client_intakes.insurance_declared_value captures the prospect's
--      declared value at signing time.
--   4. client_insurance — authoritative per-client insurance state.
--      Supabase-only, not mirrored to CB Clients sheet — this is a
--      new feature that GAS billing doesn't know about.
--   5. pg_cron extension enabled; the daily cron + plpgsql function
--      ship in the companion Phase 4 migration.

-- 1. service_catalog unit CHECK
ALTER TABLE public.service_catalog DROP CONSTRAINT IF EXISTS service_catalog_unit_check;
ALTER TABLE public.service_catalog ADD CONSTRAINT service_catalog_unit_check
  CHECK (unit IN ('per_item','per_day','per_task','per_hour','per_declared_value'));

-- 2. INSURANCE service row. $300 per $100,000 declared value, monthly.
--    flat_rate carries the $300 figure — the billing job computes the
--    actual charge as GREATEST(300, (declared_value / 100000) * flat_rate).
INSERT INTO public.service_catalog (code, name, category, billing, flat_rate, unit, taxable, active, display_order)
VALUES (
  'INSURANCE',
  'Stride Coverage (per $100K declared/month)',
  'Admin',
  'flat',
  300,
  'per_declared_value',
  false,
  true,
  300
)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  billing = EXCLUDED.billing,
  flat_rate = EXCLUDED.flat_rate,
  unit = EXCLUDED.unit,
  taxable = EXCLUDED.taxable,
  active = EXCLUDED.active,
  display_order = EXCLUDED.display_order,
  updated_at = now();

-- 3. Intake row carries the declared value from signing time until
--    activation, when it's copied into client_insurance.declared_value.
ALTER TABLE public.client_intakes
  ADD COLUMN IF NOT EXISTS insurance_declared_value numeric DEFAULT 0;

-- 4. client_insurance — per-client insurance state. One row per client
--    keyed on tenant_id (the client's spreadsheet id, same as
--    billing.tenant_id). Rows persist across cancellation with
--    active=false so we can see a history.
CREATE TABLE IF NOT EXISTS public.client_insurance (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             text        NOT NULL UNIQUE,
  client_name           text        NOT NULL,
  coverage_type         text        NOT NULL DEFAULT 'stride_coverage'
                                      CHECK (coverage_type IN ('own_policy','stride_coverage')),
  declared_value        numeric     NOT NULL DEFAULT 0,
  -- Frozen rate at activation. Not strictly required (we can always
  -- read the service_catalog row) but protects historical clients from
  -- rate changes they weren't notified about.
  monthly_rate_per_100k numeric     NOT NULL DEFAULT 300,
  inception_date        date        NOT NULL DEFAULT CURRENT_DATE,
  next_billing_date     date        NOT NULL DEFAULT (CURRENT_DATE + INTERVAL '30 days')::date,
  last_billed_at        timestamptz,
  active                boolean     NOT NULL DEFAULT true,
  cancelled_at          timestamptz,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_insurance_next_billing ON public.client_insurance(next_billing_date) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_client_insurance_tenant      ON public.client_insurance(tenant_id);

ALTER TABLE public.client_insurance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "client_insurance_staff_all" ON public.client_insurance;
CREATE POLICY "client_insurance_staff_all" ON public.client_insurance
  FOR ALL TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('admin','staff'))
  WITH CHECK ((auth.jwt()->'user_metadata'->>'role') IN ('admin','staff'));

DROP POLICY IF EXISTS "client_insurance_client_read" ON public.client_insurance;
CREATE POLICY "client_insurance_client_read" ON public.client_insurance
  FOR SELECT TO authenticated
  USING (
    (auth.jwt()->'user_metadata'->>'role') = 'client'
    AND tenant_id = (auth.jwt()->'user_metadata'->>'clientSheetId')
  );

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.client_insurance_set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS client_insurance_updated_at ON public.client_insurance;
CREATE TRIGGER client_insurance_updated_at
  BEFORE UPDATE ON public.client_insurance
  FOR EACH ROW EXECUTE FUNCTION public.client_insurance_set_updated_at();

-- Realtime — the client-settings Insurance card subscribes
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='client_insurance'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.client_insurance';
  END IF;
END $$;

-- 5. pg_cron — used by the Phase 4 auto-billing cron schedule.
CREATE EXTENSION IF NOT EXISTS pg_cron;
