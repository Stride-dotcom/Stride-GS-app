-- Create shipments table for tracking inbound and outbound shipments
CREATE TABLE public.shipments (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES public.tenants(id),
    shipment_number TEXT NOT NULL,
    shipment_type TEXT NOT NULL DEFAULT 'inbound' CHECK (shipment_type IN ('inbound', 'outbound')),
    status TEXT NOT NULL DEFAULT 'expected' CHECK (status IN ('expected', 'in_progress', 'received', 'released', 'completed', 'cancelled')),
    account_id UUID REFERENCES public.accounts(id),
    warehouse_id UUID REFERENCES public.warehouses(id),
    -- For inbound shipments
    expected_arrival_date DATE,
    carrier TEXT,
    tracking_number TEXT,
    po_number TEXT,
    -- For outbound/releases
    release_type TEXT CHECK (release_type IN ('will_call', 'disposal')),
    bill_to TEXT CHECK (bill_to IN ('account', 'customer', 'no_charge')),
    release_to_name TEXT,
    release_to_phone TEXT,
    release_to_email TEXT,
    -- Signature & payment (for completed releases)
    signature_data TEXT,
    signature_name TEXT,
    signature_timestamp TIMESTAMPTZ,
    payment_amount NUMERIC(10,2),
    payment_status TEXT CHECK (payment_status IN ('pending', 'paid', 'not_required')),
    payment_method TEXT,
    payment_reference TEXT,
    -- Timestamps
    received_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    -- Created by
    created_by UUID REFERENCES public.users(id),
    completed_by UUID REFERENCES public.users(id),
    -- Notes and metadata
    notes TEXT,
    metadata JSONB,
    -- Unique constraint on shipment number per tenant
    CONSTRAINT unique_shipment_number_per_tenant UNIQUE (tenant_id, shipment_number)
);

-- Create shipment_items table for expected items on a shipment
CREATE TABLE public.shipment_items (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    shipment_id UUID NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
    item_id UUID REFERENCES public.items(id),
    -- For expected items (before receiving)
    expected_quantity INTEGER NOT NULL DEFAULT 1,
    expected_vendor TEXT,
    expected_description TEXT,
    expected_item_type_id UUID REFERENCES public.item_types(id),
    expected_sidemark TEXT,
    -- Actual received/released info
    actual_quantity INTEGER,
    received_at TIMESTAMPTZ,
    released_at TIMESTAMPTZ,
    -- Status
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'received', 'released', 'cancelled')),
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Notes
    notes TEXT
);

-- Create sequence for shipment numbers
CREATE SEQUENCE IF NOT EXISTS shipment_number_seq START 1000;

-- Function to generate shipment number
CREATE OR REPLACE FUNCTION public.generate_shipment_number()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
    next_val INTEGER;
BEGIN
    next_val := nextval('shipment_number_seq');
    RETURN 'SHP-' || LPAD(next_val::TEXT, 6, '0');
END;
$$;

-- Trigger to auto-generate shipment number
CREATE OR REPLACE FUNCTION public.set_shipment_number()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.shipment_number IS NULL OR NEW.shipment_number = '' THEN
        NEW.shipment_number := generate_shipment_number();
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_set_shipment_number
    BEFORE INSERT ON public.shipments
    FOR EACH ROW
    EXECUTE FUNCTION public.set_shipment_number();

-- Trigger to update updated_at
CREATE TRIGGER update_shipments_updated_at
    BEFORE UPDATE ON public.shipments
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_shipment_items_updated_at
    BEFORE UPDATE ON public.shipment_items
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- Create indexes
CREATE INDEX idx_shipments_tenant_id ON public.shipments(tenant_id);
CREATE INDEX idx_shipments_status ON public.shipments(status);
CREATE INDEX idx_shipments_type ON public.shipments(shipment_type);
CREATE INDEX idx_shipments_account ON public.shipments(account_id);
CREATE INDEX idx_shipment_items_shipment ON public.shipment_items(shipment_id);
CREATE INDEX idx_shipment_items_item ON public.shipment_items(item_id);

-- Enable RLS
ALTER TABLE public.shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipment_items ENABLE ROW LEVEL SECURITY;

-- RLS Policies for shipments
CREATE POLICY "Users can view shipments in their tenant"
    ON public.shipments FOR SELECT
    USING (tenant_id = public.user_tenant_id());

CREATE POLICY "Users can create shipments in their tenant"
    ON public.shipments FOR INSERT
    WITH CHECK (tenant_id = public.user_tenant_id());

CREATE POLICY "Users can update shipments in their tenant"
    ON public.shipments FOR UPDATE
    USING (tenant_id = public.user_tenant_id());

-- RLS Policies for shipment_items
CREATE POLICY "Users can view shipment items via shipment tenant"
    ON public.shipment_items FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.shipments s 
        WHERE s.id = shipment_items.shipment_id 
        AND s.tenant_id = public.user_tenant_id()
    ));

CREATE POLICY "Users can create shipment items via shipment tenant"
    ON public.shipment_items FOR INSERT
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.shipments s 
        WHERE s.id = shipment_items.shipment_id 
        AND s.tenant_id = public.user_tenant_id()
    ));

CREATE POLICY "Users can update shipment items via shipment tenant"
    ON public.shipment_items FOR UPDATE
    USING (EXISTS (
        SELECT 1 FROM public.shipments s 
        WHERE s.id = shipment_items.shipment_id 
        AND s.tenant_id = public.user_tenant_id()
    ));