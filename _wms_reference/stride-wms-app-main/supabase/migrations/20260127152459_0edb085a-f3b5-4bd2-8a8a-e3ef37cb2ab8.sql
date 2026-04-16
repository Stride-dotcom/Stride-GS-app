-- ============================================
-- OUTBOUND SHIPMENTS REDESIGN
-- Converts will call from task type to proper outbound shipment
-- ============================================

-- ============================================
-- 1. Create outbound_types table (configurable types)
-- ============================================
CREATE TABLE IF NOT EXISTS public.outbound_types (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    is_system BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    color TEXT DEFAULT '#6366f1',
    icon TEXT DEFAULT 'Truck',
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Unique name per tenant
    CONSTRAINT unique_outbound_type_name_per_tenant UNIQUE (tenant_id, name)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_outbound_types_tenant ON public.outbound_types(tenant_id);
CREATE INDEX IF NOT EXISTS idx_outbound_types_active ON public.outbound_types(tenant_id, is_active);

-- RLS
ALTER TABLE public.outbound_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view outbound types in their tenant"
    ON public.outbound_types FOR SELECT
    USING (tenant_id = public.user_tenant_id());

CREATE POLICY "Users can manage outbound types in their tenant"
    ON public.outbound_types FOR ALL
    USING (tenant_id = public.user_tenant_id());

-- Trigger for updated_at
CREATE TRIGGER update_outbound_types_updated_at
    BEFORE UPDATE ON public.outbound_types
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- 2. Add outbound fields to shipments table
-- ============================================

-- Add outbound_type_id to reference configurable types
ALTER TABLE public.shipments
    ADD COLUMN IF NOT EXISTS outbound_type_id UUID REFERENCES public.outbound_types(id);

-- Add driver_name for completion
ALTER TABLE public.shipments
    ADD COLUMN IF NOT EXISTS driver_name TEXT;

-- Add liability_disclaimer_accepted for signature confirmation
ALTER TABLE public.shipments
    ADD COLUMN IF NOT EXISTS liability_accepted BOOLEAN DEFAULT false;

-- Add shipped_at timestamp
ALTER TABLE public.shipments
    ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMPTZ;

-- Update status constraint to include 'shipped' for outbound
-- First drop the existing constraint, then add the new one
ALTER TABLE public.shipments DROP CONSTRAINT IF EXISTS shipments_status_check;
ALTER TABLE public.shipments ADD CONSTRAINT shipments_status_check
    CHECK (status IN ('expected', 'pending', 'in_progress', 'received', 'released', 'shipped', 'completed', 'cancelled'));

-- Index for outbound type
CREATE INDEX IF NOT EXISTS idx_shipments_outbound_type ON public.shipments(outbound_type_id);

-- ============================================
-- 3. Add released_at to items table if not exists
-- ============================================
ALTER TABLE public.items
    ADD COLUMN IF NOT EXISTS released_at TIMESTAMPTZ;

-- ============================================
-- 4. Create function to seed default outbound types per tenant
-- ============================================
CREATE OR REPLACE FUNCTION public.seed_default_outbound_types(p_tenant_id UUID)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    -- Insert default outbound types if they don't exist
    INSERT INTO public.outbound_types (tenant_id, name, description, is_system, is_active, color, icon, sort_order)
    VALUES
        (p_tenant_id, 'Will Call', 'Customer pickup at warehouse', true, true, '#3b82f6', 'UserCheck', 1),
        (p_tenant_id, 'Delivery', 'Warehouse delivery to customer', true, true, '#10b981', 'Truck', 2),
        (p_tenant_id, 'Freight', 'Third-party freight carrier', true, true, '#f59e0b', 'Package', 3)
    ON CONFLICT (tenant_id, name) DO NOTHING;
END;
$$;

-- Seed outbound types for all existing tenants
DO $$
DECLARE
    tenant_record RECORD;
BEGIN
    FOR tenant_record IN SELECT id FROM public.tenants LOOP
        PERFORM public.seed_default_outbound_types(tenant_record.id);
    END LOOP;
END $$;

-- ============================================
-- 5. Deactivate Will Call from task_types
-- ============================================
UPDATE public.task_types
SET is_active = false
WHERE name = 'Will Call';