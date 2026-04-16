-- QuickBooks Online Integration Tables
-- Migration: 20260128200000_qbo_integration.sql

-- QBO OAuth connections (one per tenant)
CREATE TABLE IF NOT EXISTS qbo_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  realm_id TEXT NOT NULL, -- QBO Company ID
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  access_token_expires_at TIMESTAMPTZ NOT NULL,
  refresh_token_expires_at TIMESTAMPTZ NOT NULL,
  company_name TEXT,
  connected_by UUID REFERENCES users(id),
  connected_at TIMESTAMPTZ DEFAULT NOW(),
  last_sync_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id)
);

-- QBO Customer mapping (links Stride accounts to QBO customers)
CREATE TABLE IF NOT EXISTS qbo_customer_map (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  qbo_customer_id TEXT NOT NULL, -- QBO's customer ID
  qbo_display_name TEXT, -- Cached display name from QBO
  last_synced_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, account_id)
);

-- QBO Product/Service mapping (links Stride service types to QBO items)
CREATE TABLE IF NOT EXISTS qbo_item_map (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  service_type TEXT NOT NULL, -- e.g., 'receiving', 'storage', 'assembly'
  qbo_item_id TEXT NOT NULL, -- QBO's item ID
  qbo_item_name TEXT, -- Cached name from QBO
  last_synced_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, service_type)
);

-- QBO Invoice sync log (tracks what was pushed)
CREATE TABLE IF NOT EXISTS qbo_invoice_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id),
  qbo_invoice_id TEXT NOT NULL,
  qbo_invoice_number TEXT,
  qbo_doc_number TEXT,
  billing_report_id UUID, -- Optional: if you have a billing_reports table
  period_start DATE,
  period_end DATE,
  line_count INTEGER,
  subtotal DECIMAL(12,2),
  tax_amount DECIMAL(12,2),
  total_amount DECIMAL(12,2),
  billing_event_ids UUID[], -- Array of billing_event IDs included
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  synced_by UUID REFERENCES users(id),
  status TEXT DEFAULT 'success', -- 'success', 'failed', 'partial'
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_qbo_customer_map_account ON qbo_customer_map(account_id);
CREATE INDEX IF NOT EXISTS idx_qbo_item_map_service ON qbo_item_map(tenant_id, service_type);
CREATE INDEX IF NOT EXISTS idx_qbo_invoice_sync_account ON qbo_invoice_sync_log(account_id);
CREATE INDEX IF NOT EXISTS idx_qbo_invoice_sync_period ON qbo_invoice_sync_log(tenant_id, period_start, period_end);

-- RLS Policies
ALTER TABLE qbo_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE qbo_customer_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE qbo_item_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE qbo_invoice_sync_log ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for idempotency)
DROP POLICY IF EXISTS "Users can view own tenant QBO connection" ON qbo_connections;
DROP POLICY IF EXISTS "Admins can manage QBO connection" ON qbo_connections;
DROP POLICY IF EXISTS "Users can view QBO customer mappings" ON qbo_customer_map;
DROP POLICY IF EXISTS "Users can manage QBO customer mappings" ON qbo_customer_map;
DROP POLICY IF EXISTS "Users can view QBO item mappings" ON qbo_item_map;
DROP POLICY IF EXISTS "Users can manage QBO item mappings" ON qbo_item_map;
DROP POLICY IF EXISTS "Users can view QBO sync logs" ON qbo_invoice_sync_log;
DROP POLICY IF EXISTS "Users can create QBO sync logs" ON qbo_invoice_sync_log;

-- Create RLS policies
CREATE POLICY "Users can view own tenant QBO connection"
  ON qbo_connections FOR SELECT
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Admins can manage QBO connection"
  ON qbo_connections FOR ALL
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Users can view QBO customer mappings"
  ON qbo_customer_map FOR SELECT
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Users can manage QBO customer mappings"
  ON qbo_customer_map FOR ALL
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Users can view QBO item mappings"
  ON qbo_item_map FOR SELECT
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Users can manage QBO item mappings"
  ON qbo_item_map FOR ALL
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Users can view QBO sync logs"
  ON qbo_invoice_sync_log FOR SELECT
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Users can create QBO sync logs"
  ON qbo_invoice_sync_log FOR INSERT
  WITH CHECK (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- Add invoiced_at column to billing_events if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'billing_events' AND column_name = 'invoiced_at'
  ) THEN
    ALTER TABLE billing_events ADD COLUMN invoiced_at TIMESTAMPTZ;
  END IF;
END $$;
