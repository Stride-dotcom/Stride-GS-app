-- 20260608210000_backfill_shipments_received_status.sql
--
-- One-time data backfill — flip genuinely-received shipments from the default
-- inbound_status='expected' to 'received', and populate dock_piece_count.
--
-- CONTEXT
--   public.shipments.inbound_status (a Supabase-ONLY column — not on the
--   Google Sheet) DEFAULTS to 'expected'. The GAS completeShipment
--   write-through creates the shipment row at that default; a React reconcile
--   step in Receiving.tsx is supposed to flip it to 'received' (+ stamp
--   dock_piece_count), but it has only ever succeeded on 4 of 570 shipments.
--   Result: 565 genuinely-received shipments (every one has item_count > 0 and
--   a receive_date) across 55 tenants render as "Expected" on the Shipments
--   page, because statusLabel() maps 'expected' -> "Expected". (NOTE: a BLANK
--   inbound_status maps to "Received", so these are explicitly stuck at the
--   'expected' default, not merely empty.)
--
-- WHY THIS IS SAFE
--   * inbound_status is a Supabase-only DISPLAY field for the 2-stage dock
--     workflow. The ONLY trigger on public.shipments is set_updated_at — no
--     billing or cascade fires on this change.
--   * Billing (RCVG receiving charges) already happened in GAS when the items
--     were received (item_count > 0 proves it). This does NOT create or alter
--     any billing row.
--   * GAS write-through deliberately SKIPS inbound_status / dock_piece_count
--     (StrideAPI.gs comment), so the corrected value will stick across syncs.
--
-- SCOPE
--   Only rows that were actually received (item_count > 0). The single
--   'in_progress' row (a mid-receiving "Save for Later" dock intake) and the
--   4 already-'received' rows are left untouched.
--
-- REVERSIBILITY
--   dock_completed_at / dock_completed_by are intentionally left NULL: no dock
--   count was physically taken for these historical rows, and leaving them
--   NULL also marks exactly the backfilled set (a real reconcile stamps
--   dock_completed_at). To reverse:
--     UPDATE public.shipments
--        SET inbound_status = 'expected', dock_piece_count = NULL
--      WHERE inbound_status = 'received'
--        AND dock_completed_at IS NULL
--        AND dock_piece_count IS NOT NULL;
--
-- IDEMPOTENT: re-running matches no 'expected' rows once applied (no-op).
--
-- The root cause (why the React reconcile fails ~99% of the time, so new
-- receipts keep defaulting to 'expected') is addressed in a separate change.

UPDATE public.shipments
SET inbound_status   = 'received',
    dock_piece_count = item_count
WHERE inbound_status = 'expected'
  AND COALESCE(item_count, 0) > 0;
