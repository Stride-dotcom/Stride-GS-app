-- 2026-05-06 — qbo_push_jobs: persistent QBO push job ledger.
--
-- Backs the App-level QboPushJobsContext + toast. Pre-fix, clicking "QBO Push"
-- (toolbar) or running the Create Invoices "Push to QuickBooks Online" checkbox
-- worked server-side regardless of navigation, but the UI feedback (success
-- counts, per-invoice errors, retry IDs) lived in component-local React state
-- and disappeared the moment the operator left the Billing page or refreshed
-- the browser. The push completed, but the operator had no way to see the
-- result.
--
-- Workflow:
--   1. React INSERTs a row with status='pending' and the targeted
--      ledger_row_ids, returns the id
--   2. React fires GAS handleQboCreateInvoice_({ledgerRowIds, jobId})
--   3. GAS PATCHes status='running' on entry, every 5 invoices throughout the
--      loop (incremental progress), and a final status='succeeded' /
--      'partial' / 'failed' with full results at the end
--   4. React subscribes to realtime on qbo_push_jobs; the App-level
--      QboPushJobsContext receives every PATCH and re-renders the toast
--   5. Browser close / refresh / navigation: GAS keeps running (Apps Script
--      runs to completion regardless of caller disconnect, up to the 6-min
--      execution limit). On React reload the context queries
--      `created_at >= NOW() - 30 minutes OR finished_at IS NULL` and rehydrates
--      the toast for any in-flight or recently-finished jobs.
--
-- Status state machine:
--   pending  → INSERTed by React, GAS hasn't started
--   running  → GAS handler entered, processing invoices
--   succeeded → all invoices pushed cleanly (failed_count = 0)
--   partial  → at least one push succeeded, at least one failed
--   failed   → no invoices pushed (zero successes)
--   cancelled → operator manually marked stale (UI affordance)
--
-- Per-invoice details live in `results` jsonb — array of
-- { strideInvoiceNumber, success, qboInvoiceId?, qboDocNumber?, error?, skipped? }.

CREATE TABLE IF NOT EXISTS public.qbo_push_jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  started_at      timestamptz,
  finished_at     timestamptz,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'running', 'succeeded', 'partial', 'failed', 'cancelled')),
  initiated_by    text,
  -- 'toolbar' (QBO Push button) | 'create_flow' (Create Invoices QBO checkbox)
  source          text,
  ledger_row_ids  text[] NOT NULL,
  invoice_nos     text[] DEFAULT '{}'::text[],
  total_count     integer NOT NULL DEFAULT 0,
  succeeded_count integer NOT NULL DEFAULT 0,
  failed_count    integer NOT NULL DEFAULT 0,
  skipped_count   integer NOT NULL DEFAULT 0,
  results         jsonb NOT NULL DEFAULT '[]'::jsonb,
  error_message   text,
  -- Force re-push: if true, GAS bypasses the "already pushed" skip check
  force_re_push   boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS qbo_push_jobs_created_at_idx     ON public.qbo_push_jobs (created_at DESC);
CREATE INDEX IF NOT EXISTS qbo_push_jobs_status_idx         ON public.qbo_push_jobs (status);
CREATE INDEX IF NOT EXISTS qbo_push_jobs_initiated_by_idx   ON public.qbo_push_jobs (initiated_by);
-- Partial index for fast "what's still in flight?" queries on App mount.
CREATE INDEX IF NOT EXISTS qbo_push_jobs_in_flight_idx      ON public.qbo_push_jobs (created_at DESC)
  WHERE finished_at IS NULL;

ALTER TABLE public.qbo_push_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS qbo_push_jobs_staff ON public.qbo_push_jobs;
CREATE POLICY qbo_push_jobs_staff ON public.qbo_push_jobs
  FOR ALL
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('admin', 'staff'))
  WITH CHECK ((auth.jwt()->'user_metadata'->>'role') IN ('admin', 'staff'));

DROP POLICY IF EXISTS qbo_push_jobs_service ON public.qbo_push_jobs;
CREATE POLICY qbo_push_jobs_service ON public.qbo_push_jobs
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DO $migration_realtime$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'qbo_push_jobs'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.qbo_push_jobs';
  END IF;
END
$migration_realtime$;
