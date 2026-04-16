-- ============================================================================
-- INVOICE BUILDER FEATURE - DATABASE MIGRATION
-- ============================================================================

-- Add batch_id to invoices table for tracking invoices created together
ALTER TABLE invoices
ADD COLUMN IF NOT EXISTS batch_id UUID;

CREATE INDEX IF NOT EXISTS idx_invoices_batch_id ON invoices(batch_id);

-- Add invoice settings to tenant_preferences
ALTER TABLE tenant_preferences
ADD COLUMN IF NOT EXISTS default_net_terms INTEGER DEFAULT 30;

ALTER TABLE tenant_preferences
ADD COLUMN IF NOT EXISTS invoice_payment_tracking_mode TEXT DEFAULT 'simple'
CHECK (invoice_payment_tracking_mode IN ('simple', 'full'));

-- Add payment tracking fields to invoices
ALTER TABLE invoices
ADD COLUMN IF NOT EXISTS payment_status TEXT CHECK (payment_status IN ('pending', 'partial', 'paid'));

ALTER TABLE invoices
ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(15, 2) DEFAULT 0;

ALTER TABLE invoices
ADD COLUMN IF NOT EXISTS paid_date DATE;

ALTER TABLE invoices
ADD COLUMN IF NOT EXISTS payment_method TEXT;

ALTER TABLE invoices
ADD COLUMN IF NOT EXISTS payment_reference TEXT;

ALTER TABLE invoices
ADD COLUMN IF NOT EXISTS payment_notes TEXT;

ALTER TABLE invoices
ADD COLUMN IF NOT EXISTS marked_paid_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE invoices
ADD COLUMN IF NOT EXISTS marked_paid_by UUID REFERENCES profiles(id);

-- Add additional fields to invoice_lines for better display
ALTER TABLE invoice_lines
ADD COLUMN IF NOT EXISTS charge_type TEXT;

ALTER TABLE invoice_lines
ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE invoice_lines
ADD COLUMN IF NOT EXISTS sidemark_name TEXT;

-- Create global invoice number function (replace existing if any)
-- Uses advisory lock to ensure concurrency safety
CREATE OR REPLACE FUNCTION next_global_invoice_number()
RETURNS TEXT AS $$
DECLARE
  next_num INTEGER;
  invoice_num TEXT;
  lock_key BIGINT := 8675309; -- Unique lock key for invoice numbering
BEGIN
  -- Acquire advisory lock to prevent concurrent access
  PERFORM pg_advisory_xact_lock(lock_key);

  SELECT COALESCE(
    MAX(
      CASE
        WHEN invoice_number ~ '^INV-[0-9]+$'
        THEN CAST(SUBSTRING(invoice_number FROM 5) AS INTEGER)
        ELSE 0
      END
    ), 0
  ) + 1
  INTO next_num
  FROM invoices;

  invoice_num := 'INV-' || LPAD(next_num::TEXT, 5, '0');

  RETURN invoice_num;
END;
$$ LANGUAGE plpgsql;

-- Add index for faster invoice queries
CREATE INDEX IF NOT EXISTS idx_invoices_account_status ON invoices(account_id, status);
CREATE INDEX IF NOT EXISTS idx_invoices_invoice_date ON invoices(invoice_date);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice_id ON invoice_lines(invoice_id);
