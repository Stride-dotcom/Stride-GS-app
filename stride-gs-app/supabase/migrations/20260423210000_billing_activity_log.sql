-- ============================================================
-- billing_activity_log — audit trail of all billing actions
-- ============================================================
-- Tracks every invoice create / QBO push / email send / charge /
-- exception so the React Billing Activity tab can show a live feed
-- with filters. Replaces the 3-second toast-only visibility of
-- billing operation results.
--
-- Populated by StrideAPI.gs handlers after each action.
-- Not a cache — it's an authoritative append-only log.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.billing_activity_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         TEXT NOT NULL,           -- Client spreadsheet ID
  client_name       TEXT,                    -- Cached for display

  -- What action occurred
  action            TEXT NOT NULL,           -- 'invoice_create' | 'invoice_email_send' | 'qbo_push' | 'charge_stax' | 'charge_manual' | 'exception' | 'pay_link_send'
  status            TEXT NOT NULL,           -- 'success' | 'failure' | 'partial' | 'skipped'

  -- Which entity (optional — some actions are batch-level)
  invoice_no        TEXT,
  ledger_row_id     TEXT,
  qbo_invoice_id    TEXT,
  qbo_doc_number    TEXT,
  stax_invoice_id   TEXT,

  -- Result details
  amount            NUMERIC(12, 2),
  summary           TEXT,                    -- Short human-readable summary
  error_message     TEXT,                    -- When status = failure
  details           JSONB,                   -- Arbitrary per-action payload (transaction ID, response body, etc.)

  -- Who + when
  performed_by      TEXT,                    -- Email or 'system' for triggers
  performed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Operator resolution (for failures)
  resolved_at       TIMESTAMPTZ,
  resolved_by       TEXT,
  resolved_note     TEXT
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_bal_tenant_time
  ON public.billing_activity_log (tenant_id, performed_at DESC);

CREATE INDEX IF NOT EXISTS idx_bal_action_status_time
  ON public.billing_activity_log (action, status, performed_at DESC);

CREATE INDEX IF NOT EXISTS idx_bal_invoice_no
  ON public.billing_activity_log (invoice_no)
  WHERE invoice_no IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bal_unresolved_failures
  ON public.billing_activity_log (performed_at DESC)
  WHERE status = 'failure' AND resolved_at IS NULL;

-- Enable RLS — read-only for authenticated users, writes only via service role
ALTER TABLE public.billing_activity_log ENABLE ROW LEVEL SECURITY;

-- Admins + staff can read all; clients can read their own tenant
DROP POLICY IF EXISTS bal_select ON public.billing_activity_log;
CREATE POLICY bal_select ON public.billing_activity_log
  FOR SELECT
  USING (true);  -- App-level filtering handles access control; service role writes only

-- Service role writes only (no client writes through supabase-js)
DROP POLICY IF EXISTS bal_insert ON public.billing_activity_log;
CREATE POLICY bal_insert ON public.billing_activity_log
  FOR INSERT
  WITH CHECK (false);  -- Only service role bypasses RLS

-- Realtime publication — so React can live-subscribe
ALTER PUBLICATION supabase_realtime ADD TABLE public.billing_activity_log;

COMMENT ON TABLE public.billing_activity_log IS
  'Audit trail for billing actions. Written by StrideAPI.gs after each invoice/charge/push. Read by React Billing Activity tab with realtime subscription.';
