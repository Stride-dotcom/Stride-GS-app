-- Service Events Pricing System
CREATE TABLE IF NOT EXISTS public.service_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  class_code TEXT,
  service_code TEXT NOT NULL,
  service_name TEXT NOT NULL,
  billing_unit TEXT NOT NULL DEFAULT 'Item' CHECK (billing_unit IN ('Day', 'Item', 'Task')),
  service_time_minutes INTEGER,
  rate NUMERIC(10,2) NOT NULL DEFAULT 0,
  taxable BOOLEAN NOT NULL DEFAULT true,
  uses_class_pricing BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  add_flag BOOLEAN NOT NULL DEFAULT false,
  add_to_service_event_scan BOOLEAN NOT NULL DEFAULT false,
  alert_rule TEXT DEFAULT 'none',
  billing_trigger TEXT NOT NULL DEFAULT 'SCAN EVENT',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, class_code, service_code)
);

CREATE INDEX IF NOT EXISTS idx_service_events_tenant ON public.service_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_service_events_service_code ON public.service_events(tenant_id, service_code);
CREATE INDEX IF NOT EXISTS idx_service_events_class ON public.service_events(tenant_id, class_code);
CREATE INDEX IF NOT EXISTS idx_service_events_scan ON public.service_events(tenant_id, add_to_service_event_scan) WHERE add_to_service_event_scan = true AND is_active = true;
CREATE INDEX IF NOT EXISTS idx_service_events_flag ON public.service_events(tenant_id, add_flag) WHERE add_flag = true AND is_active = true;

ALTER TABLE public.service_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_events_tenant_isolation" ON public.service_events;
CREATE POLICY "service_events_tenant_isolation" ON public.service_events
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

GRANT ALL ON public.service_events TO authenticated;

ALTER TABLE public.classes ADD COLUMN IF NOT EXISTS class_code TEXT;
ALTER TABLE public.classes ADD COLUMN IF NOT EXISTS class_name TEXT;
ALTER TABLE public.classes ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;
ALTER TABLE public.classes ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

ALTER TABLE public.items ADD COLUMN IF NOT EXISTS class_id UUID REFERENCES public.classes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_items_class_id ON public.items(class_id);

ALTER TABLE public.billing_events ADD COLUMN IF NOT EXISTS has_rate_error BOOLEAN DEFAULT false;
ALTER TABLE public.billing_events ADD COLUMN IF NOT EXISTS rate_error_message TEXT;

ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS billing_rate NUMERIC(10,2);
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS billing_rate_locked BOOLEAN DEFAULT false;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS billing_rate_set_by UUID REFERENCES public.users(id);
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS billing_rate_set_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.get_service_rate(
  p_tenant_id UUID, p_service_code TEXT, p_class_code TEXT DEFAULT NULL
) RETURNS TABLE (
  rate NUMERIC(10,2), service_name TEXT, billing_unit TEXT, service_time_minutes INTEGER, taxable BOOLEAN, has_error BOOLEAN, error_message TEXT
) AS $$
DECLARE v_service RECORD;
BEGIN
  IF p_class_code IS NOT NULL THEN
    SELECT se.* INTO v_service FROM public.service_events se WHERE se.tenant_id = p_tenant_id AND se.service_code = p_service_code AND se.class_code = p_class_code AND se.is_active = true;
    IF FOUND THEN
      RETURN QUERY SELECT v_service.rate, v_service.service_name, v_service.billing_unit, v_service.service_time_minutes, v_service.taxable, false::BOOLEAN, NULL::TEXT;
      RETURN;
    END IF;
  END IF;
  SELECT se.* INTO v_service FROM public.service_events se WHERE se.tenant_id = p_tenant_id AND se.service_code = p_service_code AND se.class_code IS NULL AND se.is_active = true;
  IF FOUND THEN
    IF v_service.uses_class_pricing AND p_class_code IS NULL THEN
      RETURN QUERY SELECT v_service.rate, v_service.service_name, v_service.billing_unit, v_service.service_time_minutes, v_service.taxable, true::BOOLEAN, 'Item has no class assigned - using default rate'::TEXT;
      RETURN;
    END IF;
    RETURN QUERY SELECT v_service.rate, v_service.service_name, v_service.billing_unit, v_service.service_time_minutes, v_service.taxable, false::BOOLEAN, NULL::TEXT;
    RETURN;
  END IF;
  RETURN QUERY SELECT 0::NUMERIC(10,2), p_service_code::TEXT, 'Item'::TEXT, NULL::INTEGER, true::BOOLEAN, true::BOOLEAN, ('Service not found: ' || p_service_code)::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.get_service_rate(UUID, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_service_billing_event(
  p_tenant_id UUID, p_item_id UUID, p_service_code TEXT, p_created_by UUID
) RETURNS UUID AS $$
DECLARE v_item RECORD; v_rate_info RECORD; v_billing_event_id UUID; v_class_code TEXT;
BEGIN
  SELECT i.*, c.code as class_code, i.account_id, i.sidemark_id INTO v_item FROM public.items i LEFT JOIN public.classes c ON c.id = i.class_id WHERE i.id = p_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item not found: %', p_item_id; END IF;
  v_class_code := v_item.class_code;
  SELECT * INTO v_rate_info FROM public.get_service_rate(p_tenant_id, p_service_code, v_class_code);
  INSERT INTO public.billing_events (tenant_id, account_id, item_id, sidemark_id, event_type, charge_type, description, quantity, unit_rate, status, created_by, has_rate_error, rate_error_message)
  VALUES (p_tenant_id, v_item.account_id, p_item_id, v_item.sidemark_id, 'service_scan', p_service_code, v_rate_info.service_name || ' - ' || v_item.item_code, 1, v_rate_info.rate, 'unbilled', p_created_by, v_rate_info.has_error, v_rate_info.error_message)
  RETURNING id INTO v_billing_event_id;
  RETURN v_billing_event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.create_service_billing_event(UUID, UUID, TEXT, UUID) TO authenticated;

DROP TRIGGER IF EXISTS set_service_events_updated_at ON public.service_events;
CREATE TRIGGER set_service_events_updated_at
  BEFORE UPDATE ON public.service_events
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();