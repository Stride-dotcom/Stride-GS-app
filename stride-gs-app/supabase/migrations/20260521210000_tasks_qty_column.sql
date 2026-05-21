-- tasks.qty — editable count of items handled by a single task.
--
-- Pre-fix, tasks had no qty concept. The complete_task_atomic RPC
-- hardcoded `qty = 1` in the billing-row insert, so a single
-- inspection task always billed as "Inspection × 1 @ $X" even when
-- the inspector opened a box and found multiple pieces inside.
-- Operators had to fake the count by editing the rate to be the
-- total amount, which produced confusing invoice lines like
-- "Inspection × 1 @ $150" when the customer expected "Inspection
-- × 3 @ $50".
--
-- This migration introduces a per-task quantity multiplier. The RPC
-- update (paired migration 20260521210100) reads this column and
-- bills `qty × rate` so the ledger row is honest. UI editor on
-- BillingPreviewCard's primary line lets staff bump the qty when
-- they discover the actual count differs from receiving.
--
-- Default = 1 to preserve every existing task's current billing
-- behaviour exactly. Schema is additive only; no data migration
-- needed beyond the default backfill.

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS qty integer NOT NULL DEFAULT 1
  CHECK (qty >= 1);

COMMENT ON COLUMN public.tasks.qty IS
  'Number of items this task covers — defaults to 1, editable by staff '
  'when the actual count differs (e.g. inspection finds extras in a box). '
  'complete_task_atomic multiplies qty × rate when inserting the billing row.';
