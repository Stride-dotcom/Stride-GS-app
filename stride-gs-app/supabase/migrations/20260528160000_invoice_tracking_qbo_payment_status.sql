-- 2026-05-28 — invoice_tracking payment-status columns for QBO reconciliation.
--
-- Companion to the qboReconcileInvoices handler. The reconcile pass queries
-- QBO for every pushed invoice, captures (Id, DocNumber, TotalAmt, Balance),
-- and writes back here. Operators can run on demand or on a schedule —
-- closes the visibility gap between "Stride pushed the invoice" and
-- "QBO actually has it AND the customer has paid it."
--
--   qbo_balance          : QBO's Balance field for the invoice. Balance=0
--                          means fully paid; Balance>0 means unpaid or
--                          partial. NULL = never reconciled.
--   qbo_paid             : Derived boolean (qbo_balance = 0). Materialized
--                          so React filters can use it without a CASE
--                          expression. Set together with qbo_balance.
--   qbo_last_verified_at : Last time the reconcile pass confirmed this
--                          invoice's QBO state. NULL = never reconciled.
--                          Operators can use this to spot stale rows.
--
-- All three nullable for backwards compatibility — pre-reconcile rows
-- keep their existing qbo_pushed_at + (post-v38.241.0) qbo_invoice_id
-- and pick up payment status on the first reconcile pass.

ALTER TABLE public.invoice_tracking
  ADD COLUMN IF NOT EXISTS qbo_balance numeric;

ALTER TABLE public.invoice_tracking
  ADD COLUMN IF NOT EXISTS qbo_paid boolean DEFAULT false;

ALTER TABLE public.invoice_tracking
  ADD COLUMN IF NOT EXISTS qbo_last_verified_at timestamptz;

-- Partial index for the common Billing-report filter "show unpaid pushed
-- invoices" so the realtime-backed React tab doesn't full-scan the table.
CREATE INDEX IF NOT EXISTS invoice_tracking_qbo_unpaid_idx
  ON public.invoice_tracking (qbo_last_verified_at DESC)
  WHERE qbo_paid = false AND qbo_invoice_id IS NOT NULL;

COMMENT ON COLUMN public.invoice_tracking.qbo_balance IS
  'QBO Invoice.Balance from the last reconcile pass. 0 = paid, >0 = unpaid/partial. NULL = never reconciled. Updated by qboReconcileInvoices handler.';

COMMENT ON COLUMN public.invoice_tracking.qbo_paid IS
  'Boolean shortcut: TRUE iff qbo_balance = 0. Materialized so React filters can index on it directly. Set in lock-step with qbo_balance.';

COMMENT ON COLUMN public.invoice_tracking.qbo_last_verified_at IS
  'Last time qboReconcileInvoices confirmed this invoice''s state in QBO. Stale values flag candidates for the next scheduled reconcile.';
