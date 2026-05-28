-- 2026-05-28 — invoice_tracking.qbo_invoice_id + qbo_doc_number
--
-- INV-001132 surfaced a silent-success bug in the QBO push path: the GAS
-- handler stamped qbo_pushed_at unconditionally on what it thought was
-- success, but the QBO invoice never actually landed in QBO. Stax stores
-- stax_id back on success as durable proof of confirmation — QBO returns
-- Id + DocNumber on a successful invoice create, but we were dropping
-- both on the floor.
--
-- Add two nullable columns so the post-push stamp can record:
--   - qbo_invoice_id : QBO's internal Invoice.Id (the durable cross-reference,
--                      what Stride pivots on to query QBO for status / void)
--   - qbo_doc_number : QBO's invoice DocNumber (what the customer sees on
--                      the QBO-generated invoice — usually QBO-auto-assigned
--                      since v38.121.0)
--
-- Diagnostic state going forward:
--   qbo_pushed_at SET + qbo_invoice_id NULL  → push may have failed silently
--   qbo_pushed_at NULL                       → not yet pushed (or failed
--                                              before the stamp)
--   qbo_pushed_at SET + qbo_invoice_id SET   → confirmed by QBO
--
-- Both columns nullable for backwards compatibility — historical rows
-- (pre-fix pushes) keep their qbo_pushed_at but show null IDs, and the
-- React Billing report renders a warning state for that combo so operators
-- can audit and re-push if QBO actually has no record.

ALTER TABLE public.invoice_tracking
  ADD COLUMN IF NOT EXISTS qbo_invoice_id text;

ALTER TABLE public.invoice_tracking
  ADD COLUMN IF NOT EXISTS qbo_doc_number text;

-- Partial index on qbo_invoice_id for the "lookup by QBO Id" path used
-- when an operator needs to find a Stride invoice by its QBO Id (e.g.
-- correlating a QBO-side issue back to Stride).
CREATE INDEX IF NOT EXISTS invoice_tracking_qbo_invoice_id_idx
  ON public.invoice_tracking (qbo_invoice_id)
  WHERE qbo_invoice_id IS NOT NULL;

COMMENT ON COLUMN public.invoice_tracking.qbo_invoice_id IS
  'QBO Invoice.Id returned on successful push. Proof QBO confirmed creation. NULL with qbo_pushed_at SET indicates a pre-fix push or a silent failure — operator should audit in QBO.';

COMMENT ON COLUMN public.invoice_tracking.qbo_doc_number IS
  'QBO Invoice.DocNumber returned on successful push. Usually QBO-auto-assigned (v38.121.0 default). The number the customer sees on the QBO-generated PDF.';
