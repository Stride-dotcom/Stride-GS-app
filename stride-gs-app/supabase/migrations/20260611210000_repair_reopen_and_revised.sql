-- Repair reopen (un-cancel) + revised-quote support.
--
-- 1. status_before_cancel — captured by cancel-repair-sb at cancel time so
--    reopen-cancelled-repair-sb can restore the prior status instead of a
--    blanket "Pending Quote". Null on rows never cancelled (or cancelled
--    before this column shipped — those fall back to Pending Quote on reopen).
--
-- 2. quote_revised — set true by send-repair-quote-sb when isRevision=true
--    (the "edit quote + resend" flow). Drives the "Revised" status badge in
--    the React Repairs list + detail panel and the "Revised Repair Quote"
--    email subject. Status stays 'Quote Sent' under the hood so every
--    approve/decline/edit gate keeps working unchanged.
--
-- public.repairs already has table-level GRANTs + RLS (authenticated SELECT,
-- service_role ALL). New columns inherit those grants — no new GRANT needed.
-- Both columns are SB-authoritative: the GAS forward sync (sbRepairRow_) does
-- not project them, so a sheet round-trip never nulls them back.

ALTER TABLE public.repairs
  ADD COLUMN IF NOT EXISTS status_before_cancel text;

ALTER TABLE public.repairs
  ADD COLUMN IF NOT EXISTS quote_revised boolean NOT NULL DEFAULT false;
