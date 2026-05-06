-- 2026-05-05 — invoice_tracking: per-invoice push-state ledger.
--
-- Decoupling invoice push-state (QBO + Stax) from per-row billing state.
-- The Invoice Review tab needs (a) one row per invoice (not per line item),
-- (b) separate timestamps for QBO + Stax pushes, (c) snapshot of the
-- client-level auto_charge flag at invoice creation time so a later flag
-- flip doesn't retroactively change which invoices were "auto-charge
-- clients". Schema mirrors what handleQbExport_ + handleQboCreateInvoice_
-- already write into stax_invoices, but unified across all push paths +
-- always populated regardless of which paths an invoice has gone through.
--
-- Design notes:
--   - invoice_no is the natural primary key. The atomic SEQUENCE in
--     next_invoice_no() (v38.182.0) guarantees uniqueness, so no surrogate
--     id needed.
--   - tenant_id + client_name denormalized so the React Invoices tab can
--     render without joining clients on every read.
--   - invoice_date / total / line_count snapshotted at create time. They
--     would drift on a Re-issue (D) or Void (B3), so the Re-issue handler
--     and voidInvoice both DELETE the invoice_tracking row to avoid
--     showing stale state — same shape as the CB cleanup.
--   - auto_charge snapshotted at create time so a future client config
--     change doesn't retroactively change historical "should this have
--     gone to Stax?" — important for the Stax push status filter.
--   - qbo_pushed_at / stax_pushed_at remain NULL until the corresponding
--     push handler succeeds; React UI shows a green check + date when
--     populated, em-dash when null.
--   - RLS: staff/admin only via JWT user_metadata.role. service_role
--     bypass for backend writes from GAS + edge functions.
--   - Realtime: Postgres logical replication enabled so the React
--     Invoices tab can re-render the moment another operator pushes.

CREATE TABLE IF NOT EXISTS public.invoice_tracking (
  invoice_no       text PRIMARY KEY,
  tenant_id        text NOT NULL,
  client_name      text NOT NULL,
  invoice_date     date,
  total            numeric DEFAULT 0,
  line_count       integer DEFAULT 0,
  auto_charge      boolean DEFAULT false,
  created_at       timestamptz DEFAULT now(),
  qbo_pushed_at    timestamptz,
  stax_pushed_at   timestamptz
);

CREATE INDEX IF NOT EXISTS invoice_tracking_tenant_idx ON public.invoice_tracking (tenant_id);
CREATE INDEX IF NOT EXISTS invoice_tracking_invoice_date_idx ON public.invoice_tracking (invoice_date DESC);
CREATE INDEX IF NOT EXISTS invoice_tracking_created_at_idx ON public.invoice_tracking (created_at DESC);

ALTER TABLE public.invoice_tracking ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invoice_tracking_staff ON public.invoice_tracking;
CREATE POLICY invoice_tracking_staff ON public.invoice_tracking
  FOR ALL
  USING (
    (auth.jwt()->'user_metadata'->>'role') IN ('admin', 'staff')
  )
  WITH CHECK (
    (auth.jwt()->'user_metadata'->>'role') IN ('admin', 'staff')
  );

DROP POLICY IF EXISTS invoice_tracking_service ON public.invoice_tracking;
CREATE POLICY invoice_tracking_service ON public.invoice_tracking
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Backfill from existing invoiced billing rows. One row per invoice_no with
-- the natural aggregations (sum total, count lines, min invoice_date, min
-- created_at). auto_charge inherited from clients table by tenant_id;
-- defaults to false on missing match. ON CONFLICT skips invoices that
-- already have a tracking row (e.g., a manual seed).
INSERT INTO public.invoice_tracking
  (invoice_no, tenant_id, client_name, invoice_date, total, line_count, auto_charge, created_at)
SELECT
  b.invoice_no,
  b.tenant_id,
  COALESCE(MAX(b.client_name), ''),
  MIN(b.invoice_date),
  COALESCE(SUM(b.total::numeric), 0),
  COUNT(*),
  COALESCE(MAX(c.auto_charge::int)::boolean, false),
  COALESCE(MIN(b.created_at), now())
FROM public.billing b
LEFT JOIN public.clients c ON c.spreadsheet_id = b.tenant_id
WHERE b.invoice_no IS NOT NULL
  AND b.invoice_no <> ''
  AND b.status = 'Invoiced'
GROUP BY b.invoice_no, b.tenant_id
ON CONFLICT (invoice_no) DO NOTHING;

-- Backfill qbo_pushed_at / stax_pushed_at from stax_invoices where
-- already-pushed invoices exist. stax_invoices.created_at is when
-- handleQbExport_ first wrote the row → that's the Stax push timestamp.
-- For QBO, public.stax_invoices doesn't track a separate qbo_pushed_at,
-- but if the invoice has stax_invoices presence it MUST have gone through
-- the IIF flow first (which creates qb_invoice_no), so we can mark
-- qbo_pushed_at from the same timestamp as a reasonable proxy until
-- next push refines it. New pushes will overwrite both columns with
-- accurate per-path timestamps.
UPDATE public.invoice_tracking it
SET stax_pushed_at = s.created_at,
    qbo_pushed_at  = COALESCE(it.qbo_pushed_at, s.created_at)
FROM public.stax_invoices s
WHERE s.qb_invoice_no = it.invoice_no
  AND it.stax_pushed_at IS NULL;

-- Realtime publication so the React Invoices tab gets postgres_changes
-- INSERT/UPDATE events. Wrap in a DO block so a re-run doesn't error
-- if the table was already added to the publication.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'invoice_tracking'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.invoice_tracking';
  END IF;
END
$$;
