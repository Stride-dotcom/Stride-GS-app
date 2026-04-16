-- Service Events Pricing System
-- New unified pricing table for all billable services
-- ============================================================================

-- 1. Create service_events table (the new price list)
CREATE TABLE IF NOT EXISTS public.service_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,

  -- Service identification
  class_code TEXT, -- NULL for non-class-based services, XS/S/M/L/XL/XXL for class-based
  service_code TEXT NOT NULL,
  service_name TEXT NOT NULL,

  -- Billing configuration
  billing_unit TEXT NOT NULL DEFAULT 'Item' CHECK (billing_unit IN ('Day', 'Item', 'Task')),
  service_time_minutes INTEGER, -- Estimated time for labor tracking
  rate NUMERIC(10,2) NOT NULL DEFAULT 0,
  taxable BOOLEAN NOT NULL DEFAULT true,
  uses_class_pricing BOOLEAN NOT NULL DEFAULT false,

  -- Status
  is_active BOOLEAN NOT NULL DEFAULT true,

  -- Description
  notes TEXT,

  -- UI/Workflow configuration
  add_flag BOOLEAN NOT NULL DEFAULT false, -- Show checkbox in Item Details
  add_to_service_event_scan BOOLEAN NOT NULL DEFAULT false, -- Show in Service Event Scan
  alert_rule TEXT DEFAULT 'none', -- none, email_office, etc.
  billing_trigger TEXT NOT NULL DEFAULT 'SCAN EVENT', -- How charge is created

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- Unique constraint for tenant + class + service combination
  UNIQUE(tenant_id, class_code, service_code)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_service_events_tenant ON public.service_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_service_events_service_code ON public.service_events(tenant_id, service_code);
CREATE INDEX IF NOT EXISTS idx_service_events_class ON public.service_events(tenant_id, class_code);
CREATE INDEX IF NOT EXISTS idx_service_events_scan ON public.service_events(tenant_id, add_to_service_event_scan)
  WHERE add_to_service_event_scan = true AND is_active = true;
CREATE INDEX IF NOT EXISTS idx_service_events_flag ON public.service_events(tenant_id, add_flag)
  WHERE add_flag = true AND is_active = true;

-- RLS
ALTER TABLE public.service_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_events_tenant_isolation" ON public.service_events;
CREATE POLICY "service_events_tenant_isolation" ON public.service_events
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

-- Grant permissions
GRANT ALL ON public.service_events TO authenticated;

-- Comments
COMMENT ON TABLE public.service_events IS 'Unified price list for all billable services';
COMMENT ON COLUMN public.service_events.class_code IS 'Size class code (XS, S, M, L, XL, XXL) - NULL for non-class services';
COMMENT ON COLUMN public.service_events.billing_unit IS 'How the service is billed: Day, Item, or Task';
COMMENT ON COLUMN public.service_events.uses_class_pricing IS 'Whether rate varies by item class';
COMMENT ON COLUMN public.service_events.add_flag IS 'Show checkbox in Item Details page';
COMMENT ON COLUMN public.service_events.add_to_service_event_scan IS 'Include in Service Event Scan page';
COMMENT ON COLUMN public.service_events.billing_trigger IS 'How billing event is created: SCAN EVENT, AUTOCALCULATE, Flag, Per Item Auto Calculated, Shipment, Stocktake, TASK, Task - Assign Rate, Through Task';

-- 2. Update Classes table to be simple size categories
-- First ensure the classes table has the right structure
ALTER TABLE public.classes
ADD COLUMN IF NOT EXISTS class_code TEXT,
ADD COLUMN IF NOT EXISTS class_name TEXT,
ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- 3. Add class_id to items if not exists (for assigning size class to items)
ALTER TABLE public.items
ADD COLUMN IF NOT EXISTS class_id UUID REFERENCES public.classes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_items_class_id ON public.items(class_id);

-- 4. Add has_rate_error column to billing_events for tracking pricing issues
ALTER TABLE public.billing_events
ADD COLUMN IF NOT EXISTS has_rate_error BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS rate_error_message TEXT;

COMMENT ON COLUMN public.billing_events.has_rate_error IS 'True if rate could not be determined (e.g., missing class on item)';
COMMENT ON COLUMN public.billing_events.rate_error_message IS 'Error message explaining the rate issue';

-- 5. Add billing_rate to tasks for manager/admin override
ALTER TABLE public.tasks
ADD COLUMN IF NOT EXISTS billing_rate NUMERIC(10,2),
ADD COLUMN IF NOT EXISTS billing_rate_locked BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS billing_rate_set_by UUID REFERENCES public.users(id),
ADD COLUMN IF NOT EXISTS billing_rate_set_at TIMESTAMPTZ;

COMMENT ON COLUMN public.tasks.billing_rate IS 'Override billing rate for this task (manager/admin editable)';
COMMENT ON COLUMN public.tasks.billing_rate_locked IS 'Whether the billing rate has been manually locked';

-- 6. Function to get service rate for an item
CREATE OR REPLACE FUNCTION public.get_service_rate(
  p_tenant_id UUID,
  p_service_code TEXT,
  p_class_code TEXT DEFAULT NULL
)
RETURNS TABLE (
  rate NUMERIC(10,2),
  service_name TEXT,
  billing_unit TEXT,
  service_time_minutes INTEGER,
  taxable BOOLEAN,
  has_error BOOLEAN,
  error_message TEXT
) AS $$
DECLARE
  v_service RECORD;
BEGIN
  -- First try to find class-specific rate
  IF p_class_code IS NOT NULL THEN
    SELECT se.* INTO v_service
    FROM public.service_events se
    WHERE se.tenant_id = p_tenant_id
      AND se.service_code = p_service_code
      AND se.class_code = p_class_code
      AND se.is_active = true;

    IF FOUND THEN
      RETURN QUERY SELECT
        v_service.rate,
        v_service.service_name,
        v_service.billing_unit,
        v_service.service_time_minutes,
        v_service.taxable,
        false::BOOLEAN,
        NULL::TEXT;
      RETURN;
    END IF;
  END IF;

  -- Try to find non-class-specific rate
  SELECT se.* INTO v_service
  FROM public.service_events se
  WHERE se.tenant_id = p_tenant_id
    AND se.service_code = p_service_code
    AND se.class_code IS NULL
    AND se.is_active = true;

  IF FOUND THEN
    -- Check if this service uses class pricing but no class was provided
    IF v_service.uses_class_pricing AND p_class_code IS NULL THEN
      RETURN QUERY SELECT
        v_service.rate,
        v_service.service_name,
        v_service.billing_unit,
        v_service.service_time_minutes,
        v_service.taxable,
        true::BOOLEAN,
        'Item has no class assigned - using default rate'::TEXT;
      RETURN;
    END IF;

    RETURN QUERY SELECT
      v_service.rate,
      v_service.service_name,
      v_service.billing_unit,
      v_service.service_time_minutes,
      v_service.taxable,
      false::BOOLEAN,
      NULL::TEXT;
    RETURN;
  END IF;

  -- Service not found
  RETURN QUERY SELECT
    0::NUMERIC(10,2),
    p_service_code::TEXT,
    'Item'::TEXT,
    NULL::INTEGER,
    true::BOOLEAN,
    true::BOOLEAN,
    ('Service not found: ' || p_service_code)::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.get_service_rate(UUID, TEXT, TEXT) TO authenticated;

-- 7. Function to create billing event from service event scan
CREATE OR REPLACE FUNCTION public.create_service_billing_event(
  p_tenant_id UUID,
  p_item_id UUID,
  p_service_code TEXT,
  p_created_by UUID
)
RETURNS UUID AS $$
DECLARE
  v_item RECORD;
  v_rate_info RECORD;
  v_billing_event_id UUID;
  v_class_code TEXT;
BEGIN
  -- Get item details including class
  SELECT i.*, c.code as class_code, i.account_id, i.sidemark_id
  INTO v_item
  FROM public.items i
  LEFT JOIN public.classes c ON c.id = i.class_id
  WHERE i.id = p_item_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item not found: %', p_item_id;
  END IF;

  v_class_code := v_item.class_code;

  -- Get service rate
  SELECT * INTO v_rate_info
  FROM public.get_service_rate(p_tenant_id, p_service_code, v_class_code);

  -- Create billing event
  INSERT INTO public.billing_events (
    tenant_id,
    account_id,
    item_id,
    sidemark_id,
    event_type,
    charge_type,
    description,
    quantity,
    unit_rate,
    status,
    created_by,
    has_rate_error,
    rate_error_message
  )
  VALUES (
    p_tenant_id,
    v_item.account_id,
    p_item_id,
    v_item.sidemark_id,
    'service_scan',
    p_service_code,
    v_rate_info.service_name || ' - ' || v_item.item_code,
    1,
    v_rate_info.rate,
    'unbilled',
    p_created_by,
    v_rate_info.has_error,
    v_rate_info.error_message
  )
  RETURNING id INTO v_billing_event_id;

  RETURN v_billing_event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.create_service_billing_event(UUID, UUID, TEXT, UUID) TO authenticated;

-- 8. Updated_at trigger for service_events
DROP TRIGGER IF EXISTS set_service_events_updated_at ON public.service_events;
CREATE TRIGGER set_service_events_updated_at
  BEFORE UPDATE ON public.service_events
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();
