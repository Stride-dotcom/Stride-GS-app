-- billing_parity_log — event-level shadow-mode parity record.
--
-- Phase 5 billing rate cutover runs `api_lookupRate_` in shadow mode:
-- reads from both the Master Price List sheet AND `service_catalog`,
-- logs the comparison. Until now the log only went to Apps Script's
-- Logger.log where it was invisible to the app. This table captures
-- every comparison as a structured row so the Billing page's Rate
-- Parity tab can render a live feed + surface mismatches.
--
-- Writer: StrideAPI.gs service role (service_key bypasses RLS, so the
-- service_write policy with `true` is fine; the read policy is what
-- actually gates access).
-- Readers: admin + staff (via Supabase anon key + role claim).

CREATE TABLE IF NOT EXISTS public.billing_parity_log (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         text,
  client_name       text,
  item_id           text,
  svc_code          text,
  svc_name          text,
  item_class        text,
  sheet_rate        numeric,
  supabase_rate     numeric,
  sheet_total       numeric,
  supabase_total    numeric,
  qty               numeric     DEFAULT 1,
  match             boolean,
  delta             numeric,
  event_source      text,
  billing_ledger_id text,
  created_at        timestamptz DEFAULT now()
);

ALTER TABLE public.billing_parity_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "parity_log_admin_read" ON public.billing_parity_log;
CREATE POLICY "parity_log_admin_read" ON public.billing_parity_log
  FOR SELECT TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('admin','staff'));

DROP POLICY IF EXISTS "parity_log_service_write" ON public.billing_parity_log;
CREATE POLICY "parity_log_service_write" ON public.billing_parity_log
  FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_parity_log_created ON public.billing_parity_log(created_at DESC);
-- Partial index: most dashboards query "show me the failures first".
CREATE INDEX IF NOT EXISTS idx_parity_log_match ON public.billing_parity_log(match) WHERE match = false;

-- Realtime so the Rate Parity tab updates live as billing events fire.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='billing_parity_log'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.billing_parity_log';
  END IF;
END $$;
