-- Backfill storage_billing_items.billable_days from amount / rate
-- ================================================================
-- The storage commit (handleCommitStorageRows_ / commit-storage-charges-sb)
-- wrote each per-item row's `amount` and `rate` but never the day count
-- (`billable_days`), so the Storage tab's Invoiced view rendered "—" under
-- DAYS and the export carried no per-day proof — exactly the data a client
-- needs to confirm "this item was billed N days in this period".
--
-- For storage, amount = daily_rate × days EXACTLY, so days = round(amount/rate).
-- Verified safe across the full table before writing this: all 2,456 rows had
-- billable_days NULL, every row has rate > 0, every amount/rate is an integer
-- (0 non-integer ratios), and none round below 1. So this reconstructs the
-- precise day count with no data loss or guesswork.
--
-- Idempotent: only fills NULLs. Re-running after the commit path starts writing
-- billable_days (forward fix) is a no-op.

UPDATE public.storage_billing_items
SET billable_days = ROUND(amount / rate)::int
WHERE billable_days IS NULL
  AND rate IS NOT NULL AND rate > 0
  AND amount IS NOT NULL;

-- Assert no derivable row was left behind (rate>0 rows must now all carry days).
DO $$
DECLARE
  remaining int;
BEGIN
  SELECT count(*) INTO remaining
  FROM public.storage_billing_items
  WHERE billable_days IS NULL AND rate > 0 AND amount IS NOT NULL;
  IF remaining > 0 THEN
    RAISE EXCEPTION 'billable_days backfill incomplete: % derivable rows still NULL', remaining;
  END IF;
END $$;
