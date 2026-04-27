-- ============================================================
-- Add tax exemption + resale certificate fields to clients.
--
-- 3PL serves wholesale customers (resellers) who provide a state
-- resale certificate to claim tax exemption. WA DOR requires the
-- cert on file before granting exempt status to any customer.
--
-- Most existing clients are wholesale → default `tax_exempt = true`.
-- Direct-to-consumer clients (rare) flip this to false; the app's
-- invoice / quote / DO math gates tax application on
-- `tax_exempt = false AND service.taxable = true`.
--
-- These fields live in Supabase ONLY (not the CB Clients sheet).
-- The CB Clients sheet has a long history of three-way sync
-- problems (sheet ↔ Supabase ↔ React). New fields owned by the
-- React app start clean: Supabase is authoritative, React reads
-- and writes via Supabase, CB Apps Script invoice generation
-- reads via REST when needed.
--
-- 2026-04-26 PST
-- ============================================================

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS tax_exempt          boolean      NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS tax_exempt_reason   text         NOT NULL DEFAULT 'Resale',
  ADD COLUMN IF NOT EXISTS resale_cert_url     text,
  ADD COLUMN IF NOT EXISTS resale_cert_expires date,
  ADD COLUMN IF NOT EXISTS resale_cert_uploaded_at timestamp with time zone;

COMMENT ON COLUMN public.clients.tax_exempt IS
  'When true, all sales tax is waived for this customer. Defaults true (most clients are wholesale resellers). Set false for direct-to-consumer customers.';
COMMENT ON COLUMN public.clients.tax_exempt_reason IS
  'Reason for exemption: Resale, Out-of-state, Government, Non-profit, Other. Required by WA DOR for audit.';
COMMENT ON COLUMN public.clients.resale_cert_url IS
  'Drive URL of the uploaded resale certificate PDF. Required to legally claim wholesale exemption.';
COMMENT ON COLUMN public.clients.resale_cert_expires IS
  'Date the resale certificate expires. WA cert is typically 4 years from issue. App alerts at <60 days.';
COMMENT ON COLUMN public.clients.resale_cert_uploaded_at IS
  'Timestamp when the cert was uploaded (audit trail).';

-- Index for the daily expiry-email scan
CREATE INDEX IF NOT EXISTS idx_clients_resale_cert_expires
  ON public.clients (resale_cert_expires)
  WHERE tax_exempt = true AND resale_cert_expires IS NOT NULL;

NOTIFY pgrst, 'reload schema';
