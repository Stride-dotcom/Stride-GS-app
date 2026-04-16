-- Migration: Add field_suggestions table for autocomplete, sales tax config, and return shipment alert

-- 1. Create field_suggestions table for autocomplete functionality
CREATE TABLE IF NOT EXISTS public.field_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  value TEXT NOT NULL,
  usage_count INT DEFAULT 1,
  last_used_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, field_name, value)
);

-- Enable RLS on field_suggestions
ALTER TABLE public.field_suggestions ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for field_suggestions
CREATE POLICY "Users can view their tenant's suggestions" 
  ON public.field_suggestions FOR SELECT 
  USING (tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "Users can insert suggestions" 
  ON public.field_suggestions FOR INSERT 
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "Users can update their tenant's suggestions"
  ON public.field_suggestions FOR UPDATE
  USING (tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

-- 2. Add sales_tax_rate to tenant_preferences if it doesn't exist
ALTER TABLE public.tenant_preferences 
  ADD COLUMN IF NOT EXISTS sales_tax_rate DECIMAL(5,4) DEFAULT 0;

-- 3. Add is_taxable to rate_card_details if it doesn't exist
ALTER TABLE public.rate_card_details 
  ADD COLUMN IF NOT EXISTS is_taxable BOOLEAN DEFAULT false;

-- 4. Create index for faster lookups on field_suggestions
CREATE INDEX IF NOT EXISTS idx_field_suggestions_tenant_field 
  ON public.field_suggestions(tenant_id, field_name);

CREATE INDEX IF NOT EXISTS idx_field_suggestions_value 
  ON public.field_suggestions(value);

-- 5. Add return_type column to shipments for distinguishing return shipments
ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS return_type TEXT DEFAULT NULL;

-- Add comment for return_type
COMMENT ON COLUMN public.shipments.return_type IS 'Type of return: return, exchange, warranty, etc.';