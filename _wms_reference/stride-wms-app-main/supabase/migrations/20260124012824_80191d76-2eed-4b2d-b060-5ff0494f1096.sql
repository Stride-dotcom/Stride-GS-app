-- Phase 4: Billing Engine Enhancements
-- Add missing columns to billing_events for full Phase 4 support

-- Add status column for invoice tracking (unbilled/invoiced/void)
ALTER TABLE public.billing_events
ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'unbilled'
  CHECK (status IN ('unbilled', 'invoiced', 'void'));

-- Add sidemark_id for filtering (tag only, not billing)
ALTER TABLE public.billing_events
ADD COLUMN IF NOT EXISTS sidemark_id uuid REFERENCES public.sidemarks(id) ON DELETE SET NULL;

-- Add class_id for service rate lookups
ALTER TABLE public.billing_events
ADD COLUMN IF NOT EXISTS class_id uuid REFERENCES public.item_types(id) ON DELETE SET NULL;

-- Add shipment_id for receiving events
ALTER TABLE public.billing_events
ADD COLUMN IF NOT EXISTS shipment_id uuid REFERENCES public.shipments(id) ON DELETE SET NULL;

-- Add service_id for linking to billable_services catalog
ALTER TABLE public.billing_events
ADD COLUMN IF NOT EXISTS service_id uuid REFERENCES public.billable_services(id) ON DELETE SET NULL;

-- Add occurred_at for when the event actually happened (vs created_at for record creation)
ALTER TABLE public.billing_events
ADD COLUMN IF NOT EXISTS occurred_at timestamptz NOT NULL DEFAULT now();

-- Add metadata for storing time_minutes, pull_prep_minutes, and other context
ALTER TABLE public.billing_events
ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_billing_events_status ON public.billing_events(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_billing_events_sidemark ON public.billing_events(tenant_id, sidemark_id);
CREATE INDEX IF NOT EXISTS idx_billing_events_occurred ON public.billing_events(tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_events_shipment ON public.billing_events(tenant_id, shipment_id);
CREATE INDEX IF NOT EXISTS idx_billing_events_service ON public.billing_events(tenant_id, service_id);
CREATE INDEX IF NOT EXISTS idx_billing_events_class ON public.billing_events(tenant_id, class_id);

-- Function to move unbilled billing events when item sidemark changes
CREATE OR REPLACE FUNCTION public.move_item_sidemark_and_unbilled_events(
  p_item_id uuid,
  p_new_sidemark_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant_id uuid;
  v_old_sidemark_id uuid;
  v_moved_count int := 0;
  v_invoiced_count int := 0;
BEGIN
  -- Get tenant_id and current sidemark from item
  SELECT tenant_id, sidemark_id INTO v_tenant_id, v_old_sidemark_id
  FROM items
  WHERE id = p_item_id;
  
  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Item not found', 'success', false);
  END IF;
  
  -- Count invoiced events that won't be moved
  SELECT COUNT(*) INTO v_invoiced_count
  FROM billing_events
  WHERE item_id = p_item_id
    AND status = 'invoiced';
  
  -- Update item sidemark
  UPDATE items
  SET sidemark_id = p_new_sidemark_id,
      updated_at = now()
  WHERE id = p_item_id;
  
  -- Move only unbilled events to new sidemark
  UPDATE billing_events
  SET sidemark_id = p_new_sidemark_id
  WHERE item_id = p_item_id
    AND status = 'unbilled';
  
  GET DIAGNOSTICS v_moved_count = ROW_COUNT;
  
  RETURN jsonb_build_object(
    'success', true,
    'item_updated', true,
    'moved_events_count', v_moved_count,
    'invoiced_events_count', v_invoiced_count,
    'old_sidemark_id', v_old_sidemark_id,
    'new_sidemark_id', p_new_sidemark_id
  );
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.move_item_sidemark_and_unbilled_events(uuid, uuid) TO authenticated;

-- Add account_rate_adjustments table for per-account percent adjustments
CREATE TABLE IF NOT EXISTS public.account_rate_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  percent_adjust numeric(7,4) NOT NULL DEFAULT 0, -- 0.10 = +10%, -0.10 = -10%
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (tenant_id, account_id)
);

-- Enable RLS on account_rate_adjustments
ALTER TABLE public.account_rate_adjustments ENABLE ROW LEVEL SECURITY;

-- RLS policies for account_rate_adjustments
CREATE POLICY "Tenant isolation for account_rate_adjustments"
ON public.account_rate_adjustments
FOR ALL
USING (tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

-- Add free_storage_days to accounts table if not exists
ALTER TABLE public.accounts
ADD COLUMN IF NOT EXISTS free_storage_days int DEFAULT NULL;

-- Add free_storage_days to tenant_settings if table exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tenant_settings' AND table_schema = 'public') THEN
    ALTER TABLE public.tenant_settings
    ADD COLUMN IF NOT EXISTS free_storage_days int DEFAULT 0;
  END IF;
END $$;