-- Migration: stax_invoice_batches grouping + batch_id on stax_invoices.
--
-- Why: each Billing → Create Invoices click that includes "Send to
-- Payments" produces a group of stax_invoices rows. Today there's no
-- way to find an old group except by browsing Drive for the IIF file.
-- This adds a first-class batch record so the Payments page can show
-- a "Batches" view instead of "Drive Files".
--
-- Additive only — every column on stax_invoices stays untouched, and
-- batch_id is nullable so historical rows continue to work without
-- migration. The IIF file generation in handleQbExport_ is unchanged
-- by this migration; it's the read-side that gains the batches view.

CREATE TABLE IF NOT EXISTS stax_invoice_batches (
  batch_id          text PRIMARY KEY,
  created_at        timestamptz NOT NULL DEFAULT NOW(),
  created_by        text NOT NULL DEFAULT '',
  source            text NOT NULL DEFAULT 'billing_page',
  invoice_count     integer NOT NULL DEFAULT 0,
  line_count        integer NOT NULL DEFAULT 0,
  total_amount      numeric(12,2) NOT NULL DEFAULT 0,
  client_summary    text NOT NULL DEFAULT '',
  notes             text NOT NULL DEFAULT '',
  CONSTRAINT stax_invoice_batches_batch_id_nonempty CHECK (batch_id <> '')
);

CREATE INDEX IF NOT EXISTS stax_invoice_batches_created_at_idx
  ON stax_invoice_batches (created_at DESC);

ALTER TABLE stax_invoices
  ADD COLUMN IF NOT EXISTS batch_id text REFERENCES stax_invoice_batches(batch_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS stax_invoices_batch_id_idx
  ON stax_invoices (batch_id) WHERE batch_id IS NOT NULL;

-- Read access for app users.
GRANT SELECT ON stax_invoice_batches TO anon, authenticated, service_role;
GRANT INSERT, UPDATE ON stax_invoice_batches TO service_role;
