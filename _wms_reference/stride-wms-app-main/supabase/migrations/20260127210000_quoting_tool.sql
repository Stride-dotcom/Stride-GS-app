-- Quoting Tool Database Schema
-- Uses existing classes and service_events tables for dynamic pricing

-- ============================================================================
-- SECTION 1: Extend accounts table with billing/tax fields
-- ============================================================================

-- Add new columns to accounts table if they don't exist
DO $$
BEGIN
  -- Wholesale flag
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'accounts' AND column_name = 'is_wholesale') THEN
    ALTER TABLE public.accounts ADD COLUMN is_wholesale BOOLEAN DEFAULT false;
  END IF;

  -- Default tax rate
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'accounts' AND column_name = 'default_tax_rate_percent') THEN
    ALTER TABLE public.accounts ADD COLUMN default_tax_rate_percent NUMERIC(5,2);
  END IF;

  -- Billing email
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'accounts' AND column_name = 'billing_email') THEN
    ALTER TABLE public.accounts ADD COLUMN billing_email TEXT;
  END IF;

  -- Billing address fields
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'accounts' AND column_name = 'billing_address_line1') THEN
    ALTER TABLE public.accounts ADD COLUMN billing_address_line1 TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'accounts' AND column_name = 'billing_address_line2') THEN
    ALTER TABLE public.accounts ADD COLUMN billing_address_line2 TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'accounts' AND column_name = 'billing_city') THEN
    ALTER TABLE public.accounts ADD COLUMN billing_city TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'accounts' AND column_name = 'billing_state') THEN
    ALTER TABLE public.accounts ADD COLUMN billing_state TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'accounts' AND column_name = 'billing_postal_code') THEN
    ALTER TABLE public.accounts ADD COLUMN billing_postal_code TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'accounts' AND column_name = 'billing_country') THEN
    ALTER TABLE public.accounts ADD COLUMN billing_country TEXT DEFAULT 'US';
  END IF;
END $$;

-- ============================================================================
-- SECTION 2: Organization settings for quoting
-- ============================================================================

-- Add quoting-related columns to tenant_settings if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tenant_settings' AND column_name = 'default_currency') THEN
    ALTER TABLE public.tenant_settings ADD COLUMN default_currency TEXT DEFAULT 'USD';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tenant_settings' AND column_name = 'default_tax_rate_percent') THEN
    ALTER TABLE public.tenant_settings ADD COLUMN default_tax_rate_percent NUMERIC(5,2);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tenant_settings' AND column_name = 'quote_validity_days') THEN
    ALTER TABLE public.tenant_settings ADD COLUMN quote_validity_days INTEGER DEFAULT 30;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tenant_settings' AND column_name = 'quote_terms_and_conditions') THEN
    ALTER TABLE public.tenant_settings ADD COLUMN quote_terms_and_conditions TEXT;
  END IF;
END $$;

-- ============================================================================
-- SECTION 3: Quote Number Sequence
-- ============================================================================

CREATE SEQUENCE IF NOT EXISTS quote_number_seq START WITH 1 INCREMENT BY 1;

-- ============================================================================
-- SECTION 4: Quotes (main quote table)
-- ============================================================================

-- Quote status enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'quote_status') THEN
    CREATE TYPE quote_status AS ENUM ('draft', 'sent', 'accepted', 'declined', 'expired', 'void');
  END IF;
END $$;

-- Discount type enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'discount_type') THEN
    CREATE TYPE discount_type AS ENUM ('percent', 'fixed');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,

  -- Quote identification
  quote_number TEXT UNIQUE NOT NULL,
  status quote_status DEFAULT 'draft',

  -- Currency and tax
  currency TEXT DEFAULT 'USD',
  tax_enabled BOOLEAN DEFAULT false,
  tax_rate_percent NUMERIC(5,2),
  tax_rate_source TEXT, -- 'auto', 'manual', 'account', 'org'

  -- Storage duration
  storage_days INTEGER DEFAULT 0,
  storage_months_input INTEGER,
  storage_days_input INTEGER,

  -- Rate locking
  rates_locked BOOLEAN DEFAULT false,

  -- Validity
  expiration_date DATE,

  -- Quote-level discount/markup
  quote_discount_type discount_type,
  quote_discount_value NUMERIC(12,2),

  -- Computed totals
  subtotal_before_discounts NUMERIC(12,2) DEFAULT 0,
  subtotal_after_discounts NUMERIC(12,2) DEFAULT 0,
  tax_amount NUMERIC(12,2) DEFAULT 0,
  grand_total NUMERIC(12,2) DEFAULT 0,

  -- Notes
  notes TEXT,
  internal_notes TEXT,

  -- Decline info
  decline_reason TEXT,

  -- Magic link for acceptance
  magic_link_token UUID UNIQUE DEFAULT gen_random_uuid(),

  -- Audit timestamps
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  sent_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  declined_at TIMESTAMPTZ,
  voided_at TIMESTAMPTZ,
  voided_by UUID REFERENCES auth.users(id),
  void_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_quotes_tenant ON public.quotes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_quotes_account ON public.quotes(account_id);
CREATE INDEX IF NOT EXISTS idx_quotes_status ON public.quotes(status);
CREATE INDEX IF NOT EXISTS idx_quotes_number ON public.quotes(quote_number);
CREATE INDEX IF NOT EXISTS idx_quotes_magic_link ON public.quotes(magic_link_token);
CREATE INDEX IF NOT EXISTS idx_quotes_expiration ON public.quotes(expiration_date);

-- ============================================================================
-- SECTION 5: Quote Class Lines (quantities per class)
-- References existing classes table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.quote_class_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE RESTRICT,
  qty INTEGER DEFAULT 0,

  -- Per-line discount/markup
  line_discount_type discount_type,
  line_discount_value NUMERIC(12,2),

  -- Computed totals
  line_subtotal_before_discounts NUMERIC(12,2) DEFAULT 0,
  line_subtotal_after_discounts NUMERIC(12,2) DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(quote_id, class_id)
);

CREATE INDEX IF NOT EXISTS idx_quote_class_lines_quote ON public.quote_class_lines(quote_id);

-- ============================================================================
-- SECTION 6: Quote Selected Services
-- References existing service_events table (Price List)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.quote_selected_services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES public.service_events(id) ON DELETE RESTRICT,
  is_selected BOOLEAN DEFAULT true,

  -- Hours input (for per_hour services)
  hours_input NUMERIC(10,2),

  -- Computed values
  computed_billable_qty NUMERIC(12,2) DEFAULT 0,
  applied_rate_amount NUMERIC(12,2) DEFAULT 0,
  line_total NUMERIC(12,2) DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(quote_id, service_id)
);

CREATE INDEX IF NOT EXISTS idx_quote_selected_services_quote ON public.quote_selected_services(quote_id);

-- ============================================================================
-- SECTION 7: Quote Rate Overrides
-- References existing service_events and classes tables
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.quote_rate_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES public.service_events(id) ON DELETE CASCADE,
  class_id UUID REFERENCES public.classes(id) ON DELETE SET NULL, -- Optional class-specific override
  override_rate_amount NUMERIC(12,2) NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(quote_id, service_id, class_id)
);

CREATE INDEX IF NOT EXISTS idx_quote_rate_overrides_quote ON public.quote_rate_overrides(quote_id);

-- ============================================================================
-- SECTION 8: Quote Class Service Selections
-- Stores per-class service selections and qty overrides
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.quote_class_service_selections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE RESTRICT,
  service_id UUID NOT NULL REFERENCES public.service_events(id) ON DELETE RESTRICT,
  is_selected BOOLEAN DEFAULT true,
  qty_override NUMERIC(10,2), -- Optional override for service qty per class

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(quote_id, class_id, service_id)
);

CREATE INDEX IF NOT EXISTS idx_quote_class_service_selections_quote ON public.quote_class_service_selections(quote_id);

-- ============================================================================
-- SECTION 9: Quote Events (audit log)
-- ============================================================================

-- Quote event type enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'quote_event_type') THEN
    CREATE TYPE quote_event_type AS ENUM (
      'created', 'updated', 'emailed', 'email_failed',
      'exported_pdf', 'exported_excel', 'viewed',
      'accepted', 'declined', 'expired', 'voided'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.quote_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  quote_id UUID NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  event_type quote_event_type NOT NULL,
  payload_json JSONB DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES auth.users(id), -- null for customer actions
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quote_events_quote ON public.quote_events(quote_id);
CREATE INDEX IF NOT EXISTS idx_quote_events_type ON public.quote_events(event_type);
CREATE INDEX IF NOT EXISTS idx_quote_events_created ON public.quote_events(created_at);

-- ============================================================================
-- SECTION 10: Global Edit Locks (concurrency control)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.edit_locks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL, -- 'quote', 'account', 'shipment', etc.
  resource_id UUID NOT NULL,
  locked_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  locked_by_name TEXT NOT NULL,
  locked_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ, -- optional auto-expiry

  UNIQUE(resource_type, resource_id)
);

CREATE INDEX IF NOT EXISTS idx_edit_locks_resource ON public.edit_locks(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_edit_locks_user ON public.edit_locks(locked_by);

-- ============================================================================
-- SECTION 11: RLS Policies
-- ============================================================================

-- Enable RLS
ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_class_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_selected_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_rate_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_class_service_selections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.edit_locks ENABLE ROW LEVEL SECURITY;

-- Quotes RLS
DROP POLICY IF EXISTS "Users can view quotes in their tenant" ON public.quotes;
CREATE POLICY "Users can view quotes in their tenant"
  ON public.quotes FOR SELECT
  TO authenticated
  USING (tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Users can manage quotes in their tenant" ON public.quotes;
CREATE POLICY "Users can manage quotes in their tenant"
  ON public.quotes FOR ALL
  TO authenticated
  USING (tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

-- Public access for magic link viewing
DROP POLICY IF EXISTS "Public can view quotes by magic link" ON public.quotes;
CREATE POLICY "Public can view quotes by magic link"
  ON public.quotes FOR SELECT
  TO anon
  USING (magic_link_token IS NOT NULL);

-- Quote Class Lines RLS
DROP POLICY IF EXISTS "Users can manage quote class lines" ON public.quote_class_lines;
CREATE POLICY "Users can manage quote class lines"
  ON public.quote_class_lines FOR ALL
  TO authenticated
  USING (quote_id IN (SELECT id FROM public.quotes WHERE tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid())))
  WITH CHECK (quote_id IN (SELECT id FROM public.quotes WHERE tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid())));

-- Quote Selected Services RLS
DROP POLICY IF EXISTS "Users can manage quote selected services" ON public.quote_selected_services;
CREATE POLICY "Users can manage quote selected services"
  ON public.quote_selected_services FOR ALL
  TO authenticated
  USING (quote_id IN (SELECT id FROM public.quotes WHERE tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid())))
  WITH CHECK (quote_id IN (SELECT id FROM public.quotes WHERE tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid())));

-- Quote Rate Overrides RLS
DROP POLICY IF EXISTS "Users can manage quote rate overrides" ON public.quote_rate_overrides;
CREATE POLICY "Users can manage quote rate overrides"
  ON public.quote_rate_overrides FOR ALL
  TO authenticated
  USING (quote_id IN (SELECT id FROM public.quotes WHERE tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid())))
  WITH CHECK (quote_id IN (SELECT id FROM public.quotes WHERE tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid())));

-- Quote Class Service Selections RLS
DROP POLICY IF EXISTS "Users can manage quote class service selections" ON public.quote_class_service_selections;
CREATE POLICY "Users can manage quote class service selections"
  ON public.quote_class_service_selections FOR ALL
  TO authenticated
  USING (quote_id IN (SELECT id FROM public.quotes WHERE tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid())))
  WITH CHECK (quote_id IN (SELECT id FROM public.quotes WHERE tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid())));

-- Quote Events RLS
DROP POLICY IF EXISTS "Users can view quote events in their tenant" ON public.quote_events;
CREATE POLICY "Users can view quote events in their tenant"
  ON public.quote_events FOR SELECT
  TO authenticated
  USING (tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Users can create quote events" ON public.quote_events;
CREATE POLICY "Users can create quote events"
  ON public.quote_events FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

-- Allow anonymous to create events (for magic link views/accepts)
DROP POLICY IF EXISTS "Anon can create quote events" ON public.quote_events;
CREATE POLICY "Anon can create quote events"
  ON public.quote_events FOR INSERT
  TO anon
  WITH CHECK (true);

-- Edit Locks RLS
DROP POLICY IF EXISTS "Users can view edit locks in their tenant" ON public.edit_locks;
CREATE POLICY "Users can view edit locks in their tenant"
  ON public.edit_locks FOR SELECT
  TO authenticated
  USING (tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Users can manage edit locks in their tenant" ON public.edit_locks;
CREATE POLICY "Users can manage edit locks in their tenant"
  ON public.edit_locks FOR ALL
  TO authenticated
  USING (tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

-- ============================================================================
-- SECTION 12: Helper Functions
-- ============================================================================

-- Function to generate next quote number
CREATE OR REPLACE FUNCTION generate_quote_number()
RETURNS TEXT AS $$
DECLARE
  next_num INTEGER;
BEGIN
  SELECT nextval('quote_number_seq') INTO next_num;
  RETURN 'EST-' || LPAD(next_num::TEXT, 5, '0');
END;
$$ LANGUAGE plpgsql;

-- Function to compute storage days from inputs
CREATE OR REPLACE FUNCTION compute_storage_days(months_input INTEGER, days_input INTEGER)
RETURNS INTEGER AS $$
BEGIN
  RETURN COALESCE(days_input, 0) + (COALESCE(months_input, 0) * 30);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Updated_at triggers
CREATE OR REPLACE FUNCTION set_quote_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_quotes_updated_at ON public.quotes;
CREATE TRIGGER set_quotes_updated_at
  BEFORE UPDATE ON public.quotes
  FOR EACH ROW
  EXECUTE FUNCTION set_quote_updated_at();

DROP TRIGGER IF EXISTS set_quote_class_lines_updated_at ON public.quote_class_lines;
CREATE TRIGGER set_quote_class_lines_updated_at
  BEFORE UPDATE ON public.quote_class_lines
  FOR EACH ROW
  EXECUTE FUNCTION set_quote_updated_at();

DROP TRIGGER IF EXISTS set_quote_selected_services_updated_at ON public.quote_selected_services;
CREATE TRIGGER set_quote_selected_services_updated_at
  BEFORE UPDATE ON public.quote_selected_services
  FOR EACH ROW
  EXECUTE FUNCTION set_quote_updated_at();

DROP TRIGGER IF EXISTS set_quote_class_service_selections_updated_at ON public.quote_class_service_selections;
CREATE TRIGGER set_quote_class_service_selections_updated_at
  BEFORE UPDATE ON public.quote_class_service_selections
  FOR EACH ROW
  EXECUTE FUNCTION set_quote_updated_at();

-- ============================================================================
-- SECTION 13: Comments
-- ============================================================================

COMMENT ON TABLE public.quotes IS 'Quote records with status tracking and magic link acceptance';
COMMENT ON TABLE public.quote_class_lines IS 'Quantities per class in a quote - references classes table';
COMMENT ON TABLE public.quote_selected_services IS 'Services selected for a quote - references service_events (Price List)';
COMMENT ON TABLE public.quote_rate_overrides IS 'Per-quote rate overrides for services';
COMMENT ON TABLE public.quote_class_service_selections IS 'Per-class service selections with optional qty overrides';
COMMENT ON TABLE public.quote_events IS 'Audit log of all quote-related events';
COMMENT ON TABLE public.edit_locks IS 'Global concurrency locking for edit operations';
COMMENT ON FUNCTION generate_quote_number() IS 'Generates sequential quote numbers in format EST-00001';
COMMENT ON FUNCTION compute_storage_days(INTEGER, INTEGER) IS 'Computes total storage days from months and days input (30 days per month)';
