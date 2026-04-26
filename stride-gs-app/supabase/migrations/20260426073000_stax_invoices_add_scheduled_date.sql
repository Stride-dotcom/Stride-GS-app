-- ============================================================
-- Add missing `scheduled_date` column to stax_invoices.
--
-- Backstory: StrideAPI v38.120.0 added scheduledDate to the Stax
-- invoice upsert payload (api_sbUpsertStaxInvoice_, _Resync_,
-- _Backfill_) and to fetchStaxInvoicesFromSupabase's mapper, but
-- no migration was applied to add the column. PostgREST then 400s
-- every upsert with PGRST204 ("Could not find the 'scheduled_date'
-- column of 'stax_invoices' in the schema cache"), failing silently
-- inside supabaseBatchUpsert_'s try/catch.
--
-- Effect on the live system: every IIF import, reset, link, push,
-- and run of seedAllStaxToSupabase has been a no-op against
-- stax_invoices for as long as v38.120.0 has been deployed. The
-- mirror only kept the rows that pre-dated the breakage. Symptom
-- in the React Payments page: empty Review and Charge Queue tabs
-- after every reload, and stax_customers/exceptions counts also
-- failed to refresh (because the seed function aborts the whole
-- _sbBatchUpsert call on the first failed chunk).
--
-- Type chosen: TEXT to match the existing invoice_date / due_date
-- columns in this table. The Sheet stores these as date strings
-- formatted by formatDate_(); no need for a typed date column.
--
-- 2026-04-26 PST
-- ============================================================

ALTER TABLE public.stax_invoices
  ADD COLUMN IF NOT EXISTS scheduled_date text;

-- Force PostgREST schema cache reload so the next request sees the column.
NOTIFY pgrst, 'reload schema';
