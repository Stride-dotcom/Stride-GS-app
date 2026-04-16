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
-- 5. Create alert for shipment completion
-- ============================================

-- Add shipment.completed alert type to alert_types if not exists
INSERT INTO public.alert_types (code, name, description, category, default_channels, template_subject, template_body)
VALUES (
    'shipment.completed',
    'Shipment Completed',
    'Triggered when an outbound shipment is marked as shipped/completed',
    'shipment',
    ARRAY['email'],
    'Shipment {{shipment_number}} Completed',
    'Your shipment {{shipment_number}} has been completed and items have been released.

Items shipped:
{{item_list}}

Driver/Recipient: {{driver_name}}
Shipped at: {{shipped_at}}

Thank you for your business!'
)
ON CONFLICT (code) DO NOTHING;

-- Function to queue shipment completed alert
CREATE OR REPLACE FUNCTION public.queue_shipment_completed_alert(
    p_tenant_id UUID,
    p_shipment_id UUID,
    p_shipment_number TEXT,
    p_driver_name TEXT,
    p_account_email TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_alert_id UUID;
    v_alert_type_id UUID;
BEGIN
    -- Get alert type ID
    SELECT id INTO v_alert_type_id FROM public.alert_types WHERE code = 'shipment.completed';

    IF v_alert_type_id IS NULL THEN
        RETURN NULL;
    END IF;

    -- Insert alert
    INSERT INTO public.alerts (
        tenant_id,
        alert_type_id,
        status,
        payload,
        recipient_email
    ) VALUES (
        p_tenant_id,
        v_alert_type_id,
        'pending',
        jsonb_build_object(
            'shipment_id', p_shipment_id,
            'shipment_number', p_shipment_number,
            'driver_name', p_driver_name,
            'shipped_at', now()
        ),
        p_account_email
    )
    RETURNING id INTO v_alert_id;

    RETURN v_alert_id;
END;
$$;

-- ============================================
-- 6. Migrate existing will call tasks to outbound shipments
-- ============================================

-- This creates outbound shipments from existing will call tasks
-- Run this as a one-time migration
DO $$
DECLARE
    task_record RECORD;
    v_outbound_type_id UUID;
    v_shipment_id UUID;
    v_shipment_number TEXT;
BEGIN
    -- Process each will call task
    FOR task_record IN
        SELECT t.*,
               t.tenant_id as t_tenant_id,
               t.account_id as t_account_id,
               t.warehouse_id as t_warehouse_id
        FROM public.tasks t
        WHERE t.task_type = 'Will Call'
        AND t.deleted_at IS NULL
    LOOP
        -- Get the Will Call outbound type for this tenant
        SELECT id INTO v_outbound_type_id
        FROM public.outbound_types
        WHERE tenant_id = task_record.t_tenant_id
        AND name = 'Will Call'
        LIMIT 1;

        -- Skip if no outbound type found (shouldn't happen after seeding)
        IF v_outbound_type_id IS NULL THEN
            CONTINUE;
        END IF;

        -- Generate shipment number
        v_shipment_number := public.generate_shipment_number();

        -- Create the outbound shipment
        INSERT INTO public.shipments (
            tenant_id,
            shipment_number,
            shipment_type,
            status,
            account_id,
            warehouse_id,
            outbound_type_id,
            notes,
            created_at,
            created_by,
            -- If task was completed, copy completion info
            completed_at,
            completed_by,
            driver_name,
            signature_name,
            shipped_at
        ) VALUES (
            task_record.t_tenant_id,
            v_shipment_number,
            'outbound',
            CASE
                WHEN task_record.status = 'completed' THEN 'shipped'
                WHEN task_record.status = 'cancelled' THEN 'cancelled'
                ELSE 'pending'
            END,
            task_record.t_account_id,
            task_record.t_warehouse_id,
            v_outbound_type_id,
            task_record.description,
            task_record.created_at,
            task_record.created_by,
            task_record.completed_at,
            task_record.completed_by,
            task_record.pickup_name,
            task_record.pickup_name,
            task_record.completed_at
        )
        RETURNING id INTO v_shipment_id;

        -- Link task items to shipment items
        INSERT INTO public.shipment_items (
            shipment_id,
            item_id,
            expected_quantity,
            actual_quantity,
            status,
            released_at
        )
        SELECT
            v_shipment_id,
            ti.item_id,
            COALESCE(ti.quantity, 1),
            CASE WHEN task_record.status = 'completed' THEN COALESCE(ti.quantity, 1) ELSE NULL END,
            CASE WHEN task_record.status = 'completed' THEN 'released' ELSE 'pending' END,
            CASE WHEN task_record.status = 'completed' THEN task_record.completed_at ELSE NULL END
        FROM public.task_items ti
        WHERE ti.task_id = task_record.id;

        -- Soft delete the original task (mark as migrated)
        UPDATE public.tasks
        SET deleted_at = now(),
            metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('migrated_to_shipment', v_shipment_id)
        WHERE id = task_record.id;

    END LOOP;
END $$;

-- ============================================
-- 7. Remove Will Call from task_types (optional - keep for history)
-- ============================================
-- We'll deactivate rather than delete to preserve historical data
UPDATE public.task_types
SET is_active = false
WHERE name = 'Will Call';
