-- Atomic invoice number generator — eliminates the Master sheet RPC race.
--
-- Background: api_nextInvoiceNo_ called a separate Apps Script project's
-- `getNextInvoiceId` action which reads-then-writes a counter on the Master
-- Price List sheet WITHOUT a transaction lock. Two concurrent createInvoice
-- calls could both grab the same number — caused the INV-000131 duplicate
-- on 2026-05-03 (NIPTUCK + NORTON submitted within ~1.2s). v38.157.0
-- hardened the half-write recovery, and Billing.tsx pinned the per-group
-- invoice loop to concurrency=1 as a workaround. That serialization is the
-- main bottleneck: a 5-client storage batch takes ~30-50 sec because
-- invoices fire one-at-a-time waiting on the Master RPC.
--
-- Fix: Postgres SEQUENCE. nextval() is atomic by design, no race possible.
-- handleCreateInvoice_ switches to call public.next_invoice_no() instead
-- of the Master RPC. Once the sequence is the source of truth, Billing.tsx
-- can bump concurrency back to 3 — ~3x speed-up on multi-client batches.
--
-- Seeding: max committed invoice is INV-000144 (verified 2026-05-04).
-- Master RPC counter is at LEAST that, possibly higher if there are gaps
-- from aborted-but-counter-advanced creations. Seed sequence at 1000 to
-- give 850+ headroom — invoice numbers don't need to be contiguous, and
-- the gap is harmless. Worst case if any in-flight Master RPC pushes past
-- 1000 the operator can run setval() to jump higher.

CREATE SEQUENCE IF NOT EXISTS public.invoice_no_seq;

DO $$
BEGIN
  -- Set sequence so first nextval() returns 1000. setval(seq, 999, true)
  -- means is_called=true → next nextval returns 1000.
  -- Idempotent: if the sequence is already past 1000 (e.g. from a re-run),
  -- only advance, never rewind.
  IF (SELECT last_value FROM public.invoice_no_seq) < 999 THEN
    PERFORM setval('public.invoice_no_seq', 999, true);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.next_invoice_no()
RETURNS text
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 'INV-' || LPAD(nextval('public.invoice_no_seq')::text, 6, '0');
$$;

COMMENT ON FUNCTION public.next_invoice_no()
  IS 'Atomic invoice number generator. Returns next "INV-XXXXXX" string from public.invoice_no_seq. Replaces the Master sheet RPC counter that had a read-then-write race causing INV-000131 duplicates 2026-05-03.';

GRANT EXECUTE ON FUNCTION public.next_invoice_no() TO authenticated, service_role;

-- Optional: convenience function to peek at the current sequence value
-- without consuming. Useful for ParityMonitor / admin diagnostics.
CREATE OR REPLACE FUNCTION public.peek_invoice_no_seq()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT last_value FROM public.invoice_no_seq;
$$;

GRANT EXECUTE ON FUNCTION public.peek_invoice_no_seq() TO authenticated, service_role;
