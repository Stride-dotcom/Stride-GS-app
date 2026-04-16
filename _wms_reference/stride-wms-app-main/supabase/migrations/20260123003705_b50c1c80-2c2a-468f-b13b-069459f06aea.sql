
-- =============================================
-- PHASE 3: PRICING & TASKS
-- =============================================

-- Classes table (XS to XL pricing tiers)
CREATE TABLE IF NOT EXISTS public.classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  min_cubic_feet NUMERIC(10,2),
  max_cubic_feet NUMERIC(10,2),
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, code)
);

-- Billable services catalog
CREATE TABLE IF NOT EXISTS public.billable_services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'item_service',
  charge_unit TEXT NOT NULL DEFAULT 'per_item',
  is_taxable BOOLEAN DEFAULT true,
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, code),
  CONSTRAINT valid_category CHECK (category IN ('item_service', 'accessorial', 'storage', 'labor', 'addon')),
  CONSTRAINT valid_charge_unit CHECK (charge_unit IN ('per_item', 'per_hour', 'per_day', 'per_cubic_foot', 'flat', 'per_event'))
);

-- Service rates (links services to rate cards with class-based pricing)
CREATE TABLE IF NOT EXISTS public.service_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  rate_card_id UUID NOT NULL REFERENCES public.rate_cards(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES public.billable_services(id) ON DELETE CASCADE,
  class_id UUID REFERENCES public.classes(id) ON DELETE SET NULL,
  rate NUMERIC(10,2) NOT NULL DEFAULT 0,
  minimum_charge NUMERIC(10,2),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(rate_card_id, service_id, class_id)
);

-- Add-ons catalog (NINV items)
CREATE TABLE IF NOT EXISTS public.add_ons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  default_rate NUMERIC(10,2) DEFAULT 0,
  is_taxable BOOLEAN DEFAULT true,
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, code)
);

-- Task add-on lines (NINV tracking per task)
CREATE TABLE IF NOT EXISTS public.task_addon_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  add_on_id UUID REFERENCES public.add_ons(id) ON DELETE SET NULL,
  ninv_number TEXT NOT NULL,
  description TEXT NOT NULL,
  quantity INTEGER DEFAULT 1,
  unit_rate NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(10,2) GENERATED ALWAYS AS (quantity * unit_rate) STORED,
  is_taxable BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- NINV sequence for add-on numbering
CREATE SEQUENCE IF NOT EXISTS public.ninv_number_seq START 1;

-- Function to generate NINV numbers
CREATE OR REPLACE FUNCTION public.generate_ninv_number()
RETURNS TEXT
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  next_val INTEGER;
BEGIN
  next_val := nextval('ninv_number_seq');
  RETURN 'NINV-' || LPAD(next_val::TEXT, 6, '0');
END;
$$;

-- Trigger to auto-set NINV number
CREATE OR REPLACE FUNCTION public.set_ninv_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.ninv_number IS NULL OR NEW.ninv_number = '' THEN
    NEW.ninv_number := public.generate_ninv_number();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_ninv_number_trigger ON public.task_addon_lines;
CREATE TRIGGER set_ninv_number_trigger
  BEFORE INSERT ON public.task_addon_lines
  FOR EACH ROW EXECUTE FUNCTION public.set_ninv_number();

-- Add class_id to items if not exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'items' AND column_name = 'class_id') THEN
    ALTER TABLE public.items ADD COLUMN class_id UUID REFERENCES public.classes(id) ON DELETE SET NULL;
  END IF;
END $$;

-- =============================================
-- PHASE 4: INVOICING
-- =============================================

-- Invoice status enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'invoice_status') THEN
    CREATE TYPE public.invoice_status AS ENUM ('draft', 'pending', 'sent', 'paid', 'partial', 'overdue', 'cancelled', 'void');
  END IF;
END $$;

-- Invoice mode enum  
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'invoice_mode') THEN
    CREATE TYPE public.invoice_mode AS ENUM ('standard', 'rolling', 'manual');
  END IF;
END $$;

-- Add columns to invoices table if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = 'sidemark_id') THEN
    ALTER TABLE public.invoices ADD COLUMN sidemark_id UUID REFERENCES public.sidemarks(id) ON DELETE SET NULL;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = 'qbo_invoice_id') THEN
    ALTER TABLE public.invoices ADD COLUMN qbo_invoice_id TEXT;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = 'qbo_sync_status') THEN
    ALTER TABLE public.invoices ADD COLUMN qbo_sync_status TEXT DEFAULT 'pending';
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = 'qbo_synced_at') THEN
    ALTER TABLE public.invoices ADD COLUMN qbo_synced_at TIMESTAMPTZ;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = 'storage_through_date') THEN
    ALTER TABLE public.invoices ADD COLUMN storage_through_date DATE;
  END IF;
END $$;

-- Invoice lines table (detailed breakdown)
CREATE TABLE IF NOT EXISTS public.invoice_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  billing_event_id UUID REFERENCES public.billing_events(id) ON DELETE SET NULL,
  service_id UUID REFERENCES public.billable_services(id) ON DELETE SET NULL,
  item_id UUID REFERENCES public.items(id) ON DELETE SET NULL,
  task_id UUID REFERENCES public.tasks(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  quantity NUMERIC(10,2) DEFAULT 1,
  unit_rate NUMERIC(10,2) NOT NULL DEFAULT 0,
  subtotal NUMERIC(10,2) GENERATED ALWAYS AS (quantity * unit_rate) STORED,
  tax_rate NUMERIC(5,4) DEFAULT 0,
  tax_amount NUMERIC(10,2) DEFAULT 0,
  total_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  is_taxable BOOLEAN DEFAULT true,
  line_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Storage calculation helper function
CREATE OR REPLACE FUNCTION public.calculate_storage_charges(
  p_account_id UUID,
  p_from_date DATE,
  p_to_date DATE
)
RETURNS TABLE (
  item_id UUID,
  item_code TEXT,
  sidemark_id UUID,
  cubic_feet NUMERIC,
  days_in_storage INTEGER,
  daily_rate NUMERIC,
  total_charge NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    i.id AS item_id,
    i.item_code,
    i.sidemark_id,
    COALESCE(i.cubic_feet, 0) AS cubic_feet,
    (LEAST(COALESCE(i.released_date, p_to_date), p_to_date) - 
     GREATEST(COALESCE(i.received_date, i.created_at::date), p_from_date) + 1)::INTEGER AS days_in_storage,
    COALESCE(
      (SELECT sr.rate FROM service_rates sr
       JOIN billable_services bs ON sr.service_id = bs.id
       JOIN rate_cards rc ON sr.rate_card_id = rc.id
       JOIN accounts a ON a.rate_card_id = rc.id
       WHERE a.id = p_account_id
         AND bs.code = 'STORAGE'
         AND sr.is_active = true
       LIMIT 1),
      0
    ) AS daily_rate,
    0::NUMERIC AS total_charge
  FROM items i
  WHERE i.account_id = p_account_id
    AND i.deleted_at IS NULL
    AND i.status IN ('active', 'released')
    AND COALESCE(i.received_date, i.created_at::date) <= p_to_date
    AND (i.released_date IS NULL OR i.released_date >= p_from_date)
    AND (i.last_storage_invoiced_through IS NULL OR i.last_storage_invoiced_through < p_to_date);
END;
$$;

-- =============================================
-- PHASE 5: SPECIALIZED MODULES
-- =============================================

-- Repair quote status enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'repair_quote_status') THEN
    CREATE TYPE public.repair_quote_status AS ENUM ('pending', 'submitted', 'approved', 'declined', 'expired', 'completed');
  END IF;
END $$;

-- Tech responses for repair quotes
CREATE TABLE IF NOT EXISTS public.repair_tech_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  repair_quote_id UUID NOT NULL REFERENCES public.repair_quotes(id) ON DELETE CASCADE,
  technician_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  response_type TEXT NOT NULL DEFAULT 'estimate',
  labor_hours NUMERIC(10,2),
  labor_rate NUMERIC(10,2),
  materials_cost NUMERIC(10,2) DEFAULT 0,
  total_estimate NUMERIC(10,2) NOT NULL,
  notes TEXT,
  photos JSONB DEFAULT '[]',
  submitted_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT valid_response_type CHECK (response_type IN ('estimate', 'fixed_price', 'hourly'))
);

-- Client offers/approvals for repair quotes
CREATE TABLE IF NOT EXISTS public.repair_client_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  repair_quote_id UUID NOT NULL REFERENCES public.repair_quotes(id) ON DELETE CASCADE,
  tech_response_id UUID REFERENCES public.repair_tech_responses(id) ON DELETE SET NULL,
  offered_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  offer_amount NUMERIC(10,2) NOT NULL,
  client_response TEXT,
  client_responded_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT valid_client_response CHECK (client_response IS NULL OR client_response IN ('accepted', 'declined', 'counter'))
);

-- Claims table
CREATE TABLE IF NOT EXISTS public.claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  claim_number TEXT NOT NULL,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  sidemark_id UUID REFERENCES public.sidemarks(id) ON DELETE SET NULL,
  item_id UUID REFERENCES public.items(id) ON DELETE SET NULL,
  shipment_id UUID REFERENCES public.shipments(id) ON DELETE SET NULL,
  claim_type TEXT NOT NULL DEFAULT 'damage',
  status TEXT NOT NULL DEFAULT 'open',
  description TEXT NOT NULL,
  claimed_amount NUMERIC(10,2),
  approved_amount NUMERIC(10,2),
  coverage_type TEXT,
  deductible NUMERIC(10,2) DEFAULT 0,
  filed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  filed_at TIMESTAMPTZ DEFAULT now(),
  resolved_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  resolution_notes TEXT,
  photos JSONB DEFAULT '[]',
  documents JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT valid_claim_type CHECK (claim_type IN ('damage', 'loss', 'shortage', 'delay', 'other')),
  CONSTRAINT valid_claim_status CHECK (status IN ('open', 'investigating', 'pending_approval', 'approved', 'denied', 'paid', 'closed'))
);

-- Claim number sequence
CREATE SEQUENCE IF NOT EXISTS public.claim_number_seq START 1;

CREATE OR REPLACE FUNCTION public.generate_claim_number()
RETURNS TEXT
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  next_val INTEGER;
BEGIN
  next_val := nextval('claim_number_seq');
  RETURN 'CLM-' || LPAD(next_val::TEXT, 6, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.set_claim_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.claim_number IS NULL OR NEW.claim_number = '' THEN
    NEW.claim_number := public.generate_claim_number();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_claim_number_trigger ON public.claims;
CREATE TRIGGER set_claim_number_trigger
  BEFORE INSERT ON public.claims
  FOR EACH ROW EXECUTE FUNCTION public.set_claim_number();

-- Stocktakes (cycle counts)
CREATE TABLE IF NOT EXISTS public.stocktakes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  stocktake_number TEXT NOT NULL,
  warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  location_id UUID REFERENCES public.locations(id) ON DELETE SET NULL,
  account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  scheduled_date DATE,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  assigned_to UUID REFERENCES public.users(id) ON DELETE SET NULL,
  notes TEXT,
  expected_item_count INTEGER DEFAULT 0,
  counted_item_count INTEGER DEFAULT 0,
  variance_count INTEGER DEFAULT 0,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT valid_stocktake_status CHECK (status IN ('draft', 'planned', 'in_progress', 'completed', 'cancelled'))
);

-- Stocktake items (individual counts)
CREATE TABLE IF NOT EXISTS public.stocktake_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  stocktake_id UUID NOT NULL REFERENCES public.stocktakes(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  expected_location_id UUID REFERENCES public.locations(id) ON DELETE SET NULL,
  found_location_id UUID REFERENCES public.locations(id) ON DELETE SET NULL,
  expected_quantity INTEGER DEFAULT 1,
  counted_quantity INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  counted_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  counted_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT valid_count_status CHECK (status IN ('pending', 'found', 'missing', 'discrepancy', 'resolved'))
);

-- Stocktake number sequence
CREATE SEQUENCE IF NOT EXISTS public.stocktake_number_seq START 1;

CREATE OR REPLACE FUNCTION public.generate_stocktake_number()
RETURNS TEXT
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  next_val INTEGER;
BEGIN
  next_val := nextval('stocktake_number_seq');
  RETURN 'STK-' || LPAD(next_val::TEXT, 6, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.set_stocktake_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.stocktake_number IS NULL OR NEW.stocktake_number = '' THEN
    NEW.stocktake_number := public.generate_stocktake_number();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_stocktake_number_trigger ON public.stocktakes;
CREATE TRIGGER set_stocktake_number_trigger
  BEFORE INSERT ON public.stocktakes
  FOR EACH ROW EXECUTE FUNCTION public.set_stocktake_number();

-- =============================================
-- RLS POLICIES FOR ALL NEW TABLES
-- =============================================

ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billable_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.add_ons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_addon_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repair_tech_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repair_client_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stocktakes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stocktake_items ENABLE ROW LEVEL SECURITY;

-- Classes policies
DROP POLICY IF EXISTS "Tenant isolation for classes" ON public.classes;
CREATE POLICY "Tenant isolation for classes" ON public.classes
  FOR ALL USING (tenant_id = public.user_tenant_id());

-- Billable services policies
DROP POLICY IF EXISTS "Tenant isolation for billable_services" ON public.billable_services;
CREATE POLICY "Tenant isolation for billable_services" ON public.billable_services
  FOR ALL USING (tenant_id = public.user_tenant_id());

-- Service rates policies
DROP POLICY IF EXISTS "Tenant isolation for service_rates" ON public.service_rates;
CREATE POLICY "Tenant isolation for service_rates" ON public.service_rates
  FOR ALL USING (tenant_id = public.user_tenant_id());

-- Add-ons policies
DROP POLICY IF EXISTS "Tenant isolation for add_ons" ON public.add_ons;
CREATE POLICY "Tenant isolation for add_ons" ON public.add_ons
  FOR ALL USING (tenant_id = public.user_tenant_id());

-- Task addon lines policies
DROP POLICY IF EXISTS "Tenant isolation for task_addon_lines" ON public.task_addon_lines;
CREATE POLICY "Tenant isolation for task_addon_lines" ON public.task_addon_lines
  FOR ALL USING (tenant_id = public.user_tenant_id());

-- Invoice lines policies
DROP POLICY IF EXISTS "Tenant isolation for invoice_lines" ON public.invoice_lines;
CREATE POLICY "Tenant isolation for invoice_lines" ON public.invoice_lines
  FOR ALL USING (tenant_id = public.user_tenant_id());

-- Repair tech responses policies
DROP POLICY IF EXISTS "Tenant isolation for repair_tech_responses" ON public.repair_tech_responses;
CREATE POLICY "Tenant isolation for repair_tech_responses" ON public.repair_tech_responses
  FOR ALL USING (tenant_id = public.user_tenant_id());

-- Repair client offers policies
DROP POLICY IF EXISTS "Tenant isolation for repair_client_offers" ON public.repair_client_offers;
CREATE POLICY "Tenant isolation for repair_client_offers" ON public.repair_client_offers
  FOR ALL USING (tenant_id = public.user_tenant_id());

-- Claims policies
DROP POLICY IF EXISTS "Tenant isolation for claims" ON public.claims;
CREATE POLICY "Tenant isolation for claims" ON public.claims
  FOR ALL USING (tenant_id = public.user_tenant_id());

-- Stocktakes policies
DROP POLICY IF EXISTS "Tenant isolation for stocktakes" ON public.stocktakes;
CREATE POLICY "Tenant isolation for stocktakes" ON public.stocktakes
  FOR ALL USING (tenant_id = public.user_tenant_id());

-- Stocktake items policies
DROP POLICY IF EXISTS "Tenant isolation for stocktake_items" ON public.stocktake_items;
CREATE POLICY "Tenant isolation for stocktake_items" ON public.stocktake_items
  FOR ALL USING (tenant_id = public.user_tenant_id());

-- =============================================
-- INDEXES FOR PERFORMANCE
-- =============================================

CREATE INDEX IF NOT EXISTS idx_classes_tenant ON public.classes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_billable_services_tenant ON public.billable_services(tenant_id);
CREATE INDEX IF NOT EXISTS idx_billable_services_code ON public.billable_services(tenant_id, code);
CREATE INDEX IF NOT EXISTS idx_service_rates_rate_card ON public.service_rates(rate_card_id);
CREATE INDEX IF NOT EXISTS idx_service_rates_service ON public.service_rates(service_id);
CREATE INDEX IF NOT EXISTS idx_add_ons_tenant ON public.add_ons(tenant_id);
CREATE INDEX IF NOT EXISTS idx_task_addon_lines_task ON public.task_addon_lines(task_id);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON public.invoice_lines(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_item ON public.invoice_lines(item_id);
CREATE INDEX IF NOT EXISTS idx_claims_account ON public.claims(account_id);
CREATE INDEX IF NOT EXISTS idx_claims_item ON public.claims(item_id);
CREATE INDEX IF NOT EXISTS idx_stocktakes_warehouse ON public.stocktakes(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_stocktake_items_stocktake ON public.stocktake_items(stocktake_id);
CREATE INDEX IF NOT EXISTS idx_stocktake_items_item ON public.stocktake_items(item_id);

-- =============================================
-- SEED DEFAULT BILLABLE SERVICES
-- =============================================

-- This will be handled by application code on tenant creation
-- but here's the reference list:
-- RECEIVING, INSPECTION, ASSEMBLY, REPAIR, WILL_CALL, DISPOSAL, 
-- STORAGE, MOVE, PACKING, UNPACKING, CRATING, UNCRATING,
-- OVERWEIGHT, OVERSIZE, UNSTACKABLE, FRAGILE, CRATE_DISPOSAL
