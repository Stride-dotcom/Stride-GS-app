-- Create technicians table for external repair contractors
-- These are NOT system users - they access via magic links only

CREATE TABLE IF NOT EXISTS public.technicians (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,

  -- Basic info
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,

  -- Pricing
  markup_percent NUMERIC(5,2) DEFAULT 0, -- e.g., 25.00 = 25% markup on their quotes
  hourly_rate NUMERIC(10,2), -- Display only, for reference when assigning

  -- Specialties (for filtering when assigning)
  specialties TEXT[] DEFAULT '{}', -- e.g., ['wood', 'leather', 'upholstery', 'metal', 'fabric']

  -- Status
  is_active BOOLEAN DEFAULT true,
  notes TEXT, -- Internal notes about this tech

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),

  -- Constraints
  CONSTRAINT technicians_email_tenant_unique UNIQUE (tenant_id, email)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_technicians_tenant_id ON public.technicians(tenant_id);
CREATE INDEX IF NOT EXISTS idx_technicians_is_active ON public.technicians(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_technicians_specialties ON public.technicians USING GIN(specialties);

-- Enable RLS
ALTER TABLE public.technicians ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can view technicians in their tenant" ON public.technicians;
CREATE POLICY "Users can view technicians in their tenant"
  ON public.technicians FOR SELECT
  TO authenticated
  USING (tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Users can insert technicians in their tenant" ON public.technicians;
CREATE POLICY "Users can insert technicians in their tenant"
  ON public.technicians FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Users can update technicians in their tenant" ON public.technicians;
CREATE POLICY "Users can update technicians in their tenant"
  ON public.technicians FOR UPDATE
  TO authenticated
  USING (tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Users can delete technicians in their tenant" ON public.technicians;
CREATE POLICY "Users can delete technicians in their tenant"
  ON public.technicians FOR DELETE
  TO authenticated
  USING (tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

-- Add updated_at trigger
DROP TRIGGER IF EXISTS set_technicians_updated_at ON public.technicians;
CREATE TRIGGER set_technicians_updated_at
  BEFORE UPDATE ON public.technicians
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- Add comments
COMMENT ON TABLE public.technicians IS 'External repair contractors who receive quote requests via magic links';
COMMENT ON COLUMN public.technicians.markup_percent IS 'Percentage markup applied to tech quotes for customer pricing (e.g., 25 = 25%)';
COMMENT ON COLUMN public.technicians.hourly_rate IS 'Reference hourly rate for display when assigning techs (e.g., "John Smith ($100/hr)")';
COMMENT ON COLUMN public.technicians.specialties IS 'Array of repair specialties: wood, leather, upholstery, metal, fabric, electronics, etc.';