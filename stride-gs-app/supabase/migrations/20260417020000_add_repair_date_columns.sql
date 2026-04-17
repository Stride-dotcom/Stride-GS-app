-- Add missing date columns to repairs table for quote sent, scheduled, start date, created by.
-- These exist in the GS Repairs sheet but were not mirrored to Supabase.
-- Session 71.

ALTER TABLE public.repairs
  ADD COLUMN IF NOT EXISTS quote_sent_date text,
  ADD COLUMN IF NOT EXISTS scheduled_date text,
  ADD COLUMN IF NOT EXISTS start_date text,
  ADD COLUMN IF NOT EXISTS created_by text;
