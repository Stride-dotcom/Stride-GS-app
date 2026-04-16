-- Pricing Audit Tables Migration
-- Implements audit logging for service_events and account_service_settings
-- ============================================================================

-- ============================================================================
-- 1. SERVICE_EVENTS_AUDIT TABLE
-- Track all changes to the price list
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.service_events_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_event_id UUID, -- NULL if deleted
  tenant_id UUID NOT NULL,
  service_code TEXT NOT NULL,
  class_code TEXT,
  action TEXT NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  old_values JSONB,
  new_values JSONB,
  changed_fields TEXT[], -- List of fields that changed (for UPDATE)
  changed_by UUID REFERENCES public.users(id),
  changed_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_service_events_audit_tenant ON public.service_events_audit(tenant_id);
CREATE INDEX idx_service_events_audit_service ON public.service_events_audit(service_code);
CREATE INDEX idx_service_events_audit_date ON public.service_events_audit(changed_at DESC);
CREATE INDEX idx_service_events_audit_user ON public.service_events_audit(changed_by);

COMMENT ON TABLE public.service_events_audit IS 'Audit log for service_events (price list) changes';
COMMENT ON COLUMN public.service_events_audit.changed_fields IS 'Array of field names that were changed in UPDATE operations';

-- RLS for service_events_audit
ALTER TABLE public.service_events_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_events_audit_tenant_isolation" ON public.service_events_audit;
CREATE POLICY "service_events_audit_tenant_isolation" ON public.service_events_audit
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

GRANT ALL ON public.service_events_audit TO authenticated;

-- ============================================================================
-- 2. ACCOUNT_SERVICE_SETTINGS_AUDIT TABLE
-- Track all changes to account pricing adjustments
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.account_service_settings_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_service_setting_id UUID, -- NULL if deleted
  account_id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  service_code TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  old_values JSONB,
  new_values JSONB,
  changed_fields TEXT[], -- List of fields that changed (for UPDATE)
  changed_by UUID REFERENCES public.users(id),
  changed_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_account_service_audit_account ON public.account_service_settings_audit(account_id);
CREATE INDEX idx_account_service_audit_tenant ON public.account_service_settings_audit(tenant_id);
CREATE INDEX idx_account_service_audit_date ON public.account_service_settings_audit(changed_at DESC);
CREATE INDEX idx_account_service_audit_user ON public.account_service_settings_audit(changed_by);

COMMENT ON TABLE public.account_service_settings_audit IS 'Audit log for account service settings (pricing adjustments) changes';

-- RLS for account_service_settings_audit
ALTER TABLE public.account_service_settings_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "account_service_audit_tenant_isolation" ON public.account_service_settings_audit;
CREATE POLICY "account_service_audit_tenant_isolation" ON public.account_service_settings_audit
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

GRANT ALL ON public.account_service_settings_audit TO authenticated;

-- ============================================================================
-- 3. TRIGGER FUNCTION FOR SERVICE_EVENTS AUDIT
-- ============================================================================

CREATE OR REPLACE FUNCTION public.audit_service_events()
RETURNS TRIGGER AS $$
DECLARE
  v_changed_fields TEXT[] := ARRAY[]::TEXT[];
  v_changed_by UUID;
BEGIN
  -- Try to get the current user
  BEGIN
    v_changed_by := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_changed_by := NULL;
  END;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.service_events_audit (
      service_event_id,
      tenant_id,
      service_code,
      class_code,
      action,
      old_values,
      new_values,
      changed_by
    ) VALUES (
      NEW.id,
      NEW.tenant_id,
      NEW.service_code,
      NEW.class_code,
      'INSERT',
      NULL,
      to_jsonb(NEW),
      v_changed_by
    );
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    -- Determine which fields changed
    IF OLD.rate IS DISTINCT FROM NEW.rate THEN
      v_changed_fields := array_append(v_changed_fields, 'rate');
    END IF;
    IF OLD.service_name IS DISTINCT FROM NEW.service_name THEN
      v_changed_fields := array_append(v_changed_fields, 'service_name');
    END IF;
    IF OLD.billing_unit IS DISTINCT FROM NEW.billing_unit THEN
      v_changed_fields := array_append(v_changed_fields, 'billing_unit');
    END IF;
    IF OLD.service_time_minutes IS DISTINCT FROM NEW.service_time_minutes THEN
      v_changed_fields := array_append(v_changed_fields, 'service_time_minutes');
    END IF;
    IF OLD.taxable IS DISTINCT FROM NEW.taxable THEN
      v_changed_fields := array_append(v_changed_fields, 'taxable');
    END IF;
    IF OLD.is_active IS DISTINCT FROM NEW.is_active THEN
      v_changed_fields := array_append(v_changed_fields, 'is_active');
    END IF;
    IF OLD.notes IS DISTINCT FROM NEW.notes THEN
      v_changed_fields := array_append(v_changed_fields, 'notes');
    END IF;
    IF OLD.add_flag IS DISTINCT FROM NEW.add_flag THEN
      v_changed_fields := array_append(v_changed_fields, 'add_flag');
    END IF;
    IF OLD.add_to_service_event_scan IS DISTINCT FROM NEW.add_to_service_event_scan THEN
      v_changed_fields := array_append(v_changed_fields, 'add_to_service_event_scan');
    END IF;
    IF OLD.alert_rule IS DISTINCT FROM NEW.alert_rule THEN
      v_changed_fields := array_append(v_changed_fields, 'alert_rule');
    END IF;
    IF OLD.billing_trigger IS DISTINCT FROM NEW.billing_trigger THEN
      v_changed_fields := array_append(v_changed_fields, 'billing_trigger');
    END IF;
    IF OLD.uses_class_pricing IS DISTINCT FROM NEW.uses_class_pricing THEN
      v_changed_fields := array_append(v_changed_fields, 'uses_class_pricing');
    END IF;

    -- Only log if something actually changed
    IF array_length(v_changed_fields, 1) > 0 THEN
      INSERT INTO public.service_events_audit (
        service_event_id,
        tenant_id,
        service_code,
        class_code,
        action,
        old_values,
        new_values,
        changed_fields,
        changed_by
      ) VALUES (
        NEW.id,
        NEW.tenant_id,
        NEW.service_code,
        NEW.class_code,
        'UPDATE',
        to_jsonb(OLD),
        to_jsonb(NEW),
        v_changed_fields,
        v_changed_by
      );
    END IF;
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.service_events_audit (
      service_event_id,
      tenant_id,
      service_code,
      class_code,
      action,
      old_values,
      new_values,
      changed_by
    ) VALUES (
      OLD.id,
      OLD.tenant_id,
      OLD.service_code,
      OLD.class_code,
      'DELETE',
      to_jsonb(OLD),
      NULL,
      v_changed_by
    );
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 4. TRIGGER FUNCTION FOR ACCOUNT_SERVICE_SETTINGS AUDIT
-- ============================================================================

CREATE OR REPLACE FUNCTION public.audit_account_service_settings()
RETURNS TRIGGER AS $$
DECLARE
  v_changed_fields TEXT[] := ARRAY[]::TEXT[];
  v_changed_by UUID;
BEGIN
  -- Try to get the current user
  BEGIN
    v_changed_by := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_changed_by := NULL;
  END;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.account_service_settings_audit (
      account_service_setting_id,
      account_id,
      tenant_id,
      service_code,
      action,
      old_values,
      new_values,
      changed_by
    ) VALUES (
      NEW.id,
      NEW.account_id,
      NEW.tenant_id,
      NEW.service_code,
      'INSERT',
      NULL,
      to_jsonb(NEW),
      v_changed_by
    );
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    -- Determine which fields changed
    IF OLD.is_enabled IS DISTINCT FROM NEW.is_enabled THEN
      v_changed_fields := array_append(v_changed_fields, 'is_enabled');
    END IF;
    IF OLD.custom_rate IS DISTINCT FROM NEW.custom_rate THEN
      v_changed_fields := array_append(v_changed_fields, 'custom_rate');
    END IF;
    IF OLD.custom_percent_adjust IS DISTINCT FROM NEW.custom_percent_adjust THEN
      v_changed_fields := array_append(v_changed_fields, 'custom_percent_adjust');
    END IF;
    IF OLD.notes IS DISTINCT FROM NEW.notes THEN
      v_changed_fields := array_append(v_changed_fields, 'notes');
    END IF;

    -- Only log if something actually changed
    IF array_length(v_changed_fields, 1) > 0 THEN
      INSERT INTO public.account_service_settings_audit (
        account_service_setting_id,
        account_id,
        tenant_id,
        service_code,
        action,
        old_values,
        new_values,
        changed_fields,
        changed_by
      ) VALUES (
        NEW.id,
        NEW.account_id,
        NEW.tenant_id,
        NEW.service_code,
        'UPDATE',
        to_jsonb(OLD),
        to_jsonb(NEW),
        v_changed_fields,
        v_changed_by
      );
    END IF;
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.account_service_settings_audit (
      account_service_setting_id,
      account_id,
      tenant_id,
      service_code,
      action,
      old_values,
      new_values,
      changed_by
    ) VALUES (
      OLD.id,
      OLD.account_id,
      OLD.tenant_id,
      OLD.service_code,
      'DELETE',
      to_jsonb(OLD),
      NULL,
      v_changed_by
    );
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 5. CREATE AUDIT TRIGGERS
-- ============================================================================

DROP TRIGGER IF EXISTS audit_service_events_trigger ON public.service_events;
CREATE TRIGGER audit_service_events_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.service_events
  FOR EACH ROW EXECUTE FUNCTION public.audit_service_events();

DROP TRIGGER IF EXISTS audit_account_service_settings_trigger ON public.account_service_settings;
CREATE TRIGGER audit_account_service_settings_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.account_service_settings
  FOR EACH ROW EXECUTE FUNCTION public.audit_account_service_settings();

-- ============================================================================
-- 6. GRANT PERMISSIONS
-- ============================================================================

GRANT EXECUTE ON FUNCTION public.audit_service_events() TO authenticated;
GRANT EXECUTE ON FUNCTION public.audit_account_service_settings() TO authenticated;
