-- Atomic shipment number generator — eliminates the Master sheet RPC race
-- for shipment numbering. Mirror of the v38.182.0 invoice-counter fix.
--
-- Background: api_nextShipmentNo_ in StrideAPI.gs calls a separate Apps
-- Script project (Master Price List) with `action: "getNextShipmentId"`,
-- which reads-then-writes a `GLOBAL_SHIPMENT_COUNTER` cell on the Master
-- Settings sheet inside a `LockService.getScriptLock().waitLock(30000)`.
-- The lock serializes calls WITHIN the Master script's own execution,
-- but real-world lock contention + timeout corner cases still allowed
-- dup-number outcomes — the v38.182 INV-000131 invoice incident proved
-- the same lock shape isn't actually race-free under load. Shipment
-- numbering inherits the same risk class.
--
-- The invoice race got fixed in v38.182.0 (2026-05-04) by replacing
-- the Master RPC with a Postgres SEQUENCE atomic counter. The shipment
-- counter was never migrated — surfaced 2026-05-11 by the function
-- inventory pass. This migration closes the cousin gap.
--
-- Fix: Postgres SEQUENCE. nextval() is atomic by design. StrideAPI's
-- api_nextShipmentNo_ switches to call public.next_shipment_no()
-- instead of the Master RPC. Once the sequence is the source of truth,
-- shipment numbering can never produce duplicates and concurrent
-- receiveShipment calls become race-free.
--
-- Seeding: max numeric value in production today is 358 (verified
-- 2026-05-11 against public.shipments table — 343 rows total, with one
-- legacy SHP-MIGRATED-* outlier ignored). Master RPC counter is at
-- LEAST that, possibly slightly higher if there are gaps from
-- aborted-but-counter-advanced creations. Seed sequence at 1000 to
-- give 640+ headroom — shipment numbers don't need to be contiguous,
-- and the gap is harmless (matches the v38.182 invoice seed approach).
-- Worst case if any in-flight Master RPC pushes past 1000, the operator
-- can run setval() to jump higher post-deploy.

CREATE SEQUENCE IF NOT EXISTS public.shipment_no_seq;

DO $$
BEGIN
  -- Set sequence so first nextval() returns 1000. setval(seq, 999, true)
  -- means is_called=true → next nextval returns 1000.
  -- Idempotent: if the sequence is already past 999 (e.g. from a re-run
  -- or manual jump), only advance, never rewind.
  IF (SELECT last_value FROM public.shipment_no_seq) < 999 THEN
    PERFORM setval('public.shipment_no_seq', 999, true);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.next_shipment_no()
RETURNS text
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 'SHP-' || LPAD(nextval('public.shipment_no_seq')::text, 6, '0');
$$;

COMMENT ON FUNCTION public.next_shipment_no()
  IS 'Atomic shipment number generator. Returns next "SHP-XXXXXX" string from public.shipment_no_seq. Replaces the Master sheet RPC counter (action=getNextShipmentId) that had a read-then-write race — same race class as the v38.182 invoice counter fix.';

GRANT EXECUTE ON FUNCTION public.next_shipment_no() TO authenticated, service_role;

-- Convenience function to peek at the current sequence value without
-- consuming. Useful for diagnostics + the future Migration tab dashboard.
CREATE OR REPLACE FUNCTION public.peek_shipment_no_seq()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT last_value FROM public.shipment_no_seq;
$$;

GRANT EXECUTE ON FUNCTION public.peek_shipment_no_seq() TO authenticated, service_role;
