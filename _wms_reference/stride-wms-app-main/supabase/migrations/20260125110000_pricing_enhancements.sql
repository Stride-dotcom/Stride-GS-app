-- Pricing Enhancements Migration
-- Implements: Flag Rules per Service, Account Service Settings, Billing Metadata, Additional Flags
-- ============================================================================

-- ============================================================================
-- 1. FLAG SERVICE RULES TABLE
-- Allows flags to have different adjustments per service type
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.flag_service_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  flag_id UUID NOT NULL REFERENCES public.pricing_flags(id) ON DELETE CASCADE,
  service_code TEXT NOT NULL,
  adds_percent NUMERIC(5,2) DEFAULT 0,
  adds_flat_fee NUMERIC(10,2) DEFAULT 0,
  adds_minutes INTEGER DEFAULT 0,
  multiplier NUMERIC(5,2) DEFAULT 1,
  is_active BOOLEAN DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(flag_id, service_code)
);

CREATE INDEX IF NOT EXISTS idx_flag_service_rules_flag ON public.flag_service_rules(flag_id);
CREATE INDEX IF NOT EXISTS idx_flag_service_rules_tenant ON public.flag_service_rules(tenant_id);
CREATE INDEX IF NOT EXISTS idx_flag_service_rules_service ON public.flag_service_rules(service_code);

COMMENT ON TABLE public.flag_service_rules IS 'Per-service adjustment rules for flags (e.g., Overweight adds +10% to Storage but +20% to Delivery)';
COMMENT ON COLUMN public.flag_service_rules.adds_percent IS 'Percentage adjustment for this service (e.g., 10 = +10%)';
COMMENT ON COLUMN public.flag_service_rules.adds_flat_fee IS 'Flat fee to add for this service';
COMMENT ON COLUMN public.flag_service_rules.adds_minutes IS 'Extra minutes to add for time tracking';
COMMENT ON COLUMN public.flag_service_rules.multiplier IS 'Rate multiplier (e.g., 1.5 = 150% of base rate)';

-- Enable RLS
ALTER TABLE public.flag_service_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation for flag_service_rules"
ON public.flag_service_rules FOR ALL
USING (tenant_id IN (
  SELECT tenant_id FROM public.users WHERE id = auth.uid()
));

-- Trigger for updated_at
DROP TRIGGER IF EXISTS set_flag_service_rules_updated_at ON public.flag_service_rules;
CREATE TRIGGER set_flag_service_rules_updated_at
  BEFORE UPDATE ON public.flag_service_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 2. ACCOUNT SERVICE SETTINGS TABLE
-- Enable/disable specific services per account
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.account_service_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  service_code TEXT NOT NULL,
  is_enabled BOOLEAN DEFAULT true,
  custom_rate NUMERIC(10,2),
  custom_percent_adjust NUMERIC(5,2),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(account_id, service_code)
);

CREATE INDEX IF NOT EXISTS idx_account_service_settings_account ON public.account_service_settings(account_id);
CREATE INDEX IF NOT EXISTS idx_account_service_settings_tenant ON public.account_service_settings(tenant_id);

COMMENT ON TABLE public.account_service_settings IS 'Per-account service configuration (enable/disable services, custom rates)';
COMMENT ON COLUMN public.account_service_settings.is_enabled IS 'Whether this service is available for this account';
COMMENT ON COLUMN public.account_service_settings.custom_rate IS 'Optional: Override base rate for this account';
COMMENT ON COLUMN public.account_service_settings.custom_percent_adjust IS 'Optional: Percent adjustment for this service only';

-- Enable RLS
ALTER TABLE public.account_service_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation for account_service_settings"
ON public.account_service_settings FOR ALL
USING (tenant_id IN (
  SELECT tenant_id FROM public.users WHERE id = auth.uid()
));

-- Trigger for updated_at
DROP TRIGGER IF EXISTS set_account_service_settings_updated_at ON public.account_service_settings;
CREATE TRIGGER set_account_service_settings_updated_at
  BEFORE UPDATE ON public.account_service_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 3. ADD METADATA COLUMN TO BILLING_EVENTS
-- Store calculation breakdown for transparency
-- ============================================================================

ALTER TABLE public.billing_events
ADD COLUMN IF NOT EXISTS calculation_metadata JSONB DEFAULT '{}';

COMMENT ON COLUMN public.billing_events.calculation_metadata IS 'JSON breakdown of how the rate was calculated (base_rate, flags_applied, adjustments, etc.)';

-- ============================================================================
-- 4. ENHANCED PRICING CALCULATION FUNCTION
-- Now stores metadata and respects flag service rules
-- ============================================================================

CREATE OR REPLACE FUNCTION public.calculate_service_price_v2(
  p_tenant_id UUID,
  p_account_id UUID,
  p_service_code TEXT,
  p_class_id UUID DEFAULT NULL,
  p_assembly_tier_id UUID DEFAULT NULL,
  p_item_id UUID DEFAULT NULL
)
RETURNS TABLE (
  rate NUMERIC,
  minutes INTEGER,
  source TEXT,
  flags_applied TEXT[],
  calculation_breakdown JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_service RECORD;
  v_class RECORD;
  v_assembly RECORD;
  v_base_rate NUMERIC := 0;
  v_total_minutes INTEGER := 0;
  v_account_adjustment NUMERIC := 0;
  v_flag_percent_adjustment NUMERIC := 0;
  v_flag_flat_adjustment NUMERIC := 0;
  v_flag_minutes_adjustment INTEGER := 0;
  v_flags_applied TEXT[] := ARRAY[]::TEXT[];
  v_flag RECORD;
  v_rule RECORD;
  v_breakdown JSONB;
  v_flag_details JSONB[] := ARRAY[]::JSONB[];
  v_account_service RECORD;
BEGIN
  -- Initialize breakdown
  v_breakdown := jsonb_build_object(
    'service_code', p_service_code,
    'calculated_at', now()
  );

  -- Check account service settings
  SELECT * INTO v_account_service
  FROM public.account_service_settings
  WHERE tenant_id = p_tenant_id
    AND account_id = p_account_id
    AND service_code = p_service_code;

  IF FOUND AND NOT v_account_service.is_enabled THEN
    RETURN QUERY SELECT
      0::NUMERIC,
      0::INTEGER,
      'service_disabled'::TEXT,
      ARRAY[]::TEXT[],
      jsonb_build_object('error', 'Service disabled for this account');
    RETURN;
  END IF;

  -- Get service details
  SELECT * INTO v_service FROM public.billable_services
  WHERE tenant_id = p_tenant_id AND code = p_service_code AND is_active = true;

  IF NOT FOUND THEN
    RETURN QUERY SELECT
      0::NUMERIC,
      0::INTEGER,
      'service_not_found'::TEXT,
      ARRAY[]::TEXT[],
      jsonb_build_object('error', 'Service not found');
    RETURN;
  END IF;

  -- Calculate base rate based on pricing mode
  CASE v_service.pricing_mode
    WHEN 'flat' THEN
      -- Check for account custom rate first
      IF v_account_service.custom_rate IS NOT NULL THEN
        v_base_rate := v_account_service.custom_rate;
        v_breakdown := v_breakdown || jsonb_build_object('base_rate_source', 'account_custom');
      ELSE
        v_base_rate := COALESCE(v_service.base_rate, 0);
        v_breakdown := v_breakdown || jsonb_build_object('base_rate_source', 'service_default');
      END IF;
      v_total_minutes := 5;

    WHEN 'per_size' THEN
      IF p_class_id IS NOT NULL THEN
        SELECT * INTO v_class FROM public.classes WHERE id = p_class_id;
        IF FOUND THEN
          IF p_service_code = 'STORAGE' THEN
            v_base_rate := COALESCE(v_class.storage_rate_per_day, 0);
            v_total_minutes := 0;
          ELSIF p_service_code = 'INSPECTION' THEN
            v_base_rate := COALESCE(v_class.inspection_fee_per_item, 0);
            v_total_minutes := COALESCE(v_class.default_inspection_minutes, 10);
          END IF;
          v_breakdown := v_breakdown || jsonb_build_object(
            'base_rate_source', 'size_category',
            'size_category', v_class.code
          );
        END IF;
      END IF;

    WHEN 'assembly_tier' THEN
      IF p_assembly_tier_id IS NOT NULL THEN
        SELECT * INTO v_assembly FROM public.assembly_tiers WHERE id = p_assembly_tier_id;
        IF FOUND THEN
          v_base_rate := COALESCE(v_assembly.rate, 0);
          v_total_minutes := COALESCE(v_assembly.default_minutes, 0);
          v_breakdown := v_breakdown || jsonb_build_object(
            'base_rate_source', 'assembly_tier',
            'assembly_tier', v_assembly.tier_number
          );
        END IF;
      END IF;

    WHEN 'manual' THEN
      v_base_rate := 0;
      v_total_minutes := 0;
      v_breakdown := v_breakdown || jsonb_build_object('base_rate_source', 'manual_quote_required');
  END CASE;

  v_breakdown := v_breakdown || jsonb_build_object('base_rate', v_base_rate);

  -- Apply flag adjustments if item_id provided
  IF p_item_id IS NOT NULL THEN
    FOR v_flag IN
      SELECT pf.* FROM public.pricing_flags pf
      JOIN public.item_flags if2 ON if2.flag_id = pf.id
      WHERE if2.item_id = p_item_id
        AND pf.is_active = true
    LOOP
      -- Check for service-specific rule first
      SELECT * INTO v_rule FROM public.flag_service_rules
      WHERE flag_id = v_flag.id
        AND service_code = p_service_code
        AND is_active = true;

      IF FOUND THEN
        -- Use service-specific adjustments
        v_flag_percent_adjustment := v_flag_percent_adjustment + COALESCE(v_rule.adds_percent, 0);
        v_flag_flat_adjustment := v_flag_flat_adjustment + COALESCE(v_rule.adds_flat_fee, 0);
        v_flag_minutes_adjustment := v_flag_minutes_adjustment + COALESCE(v_rule.adds_minutes, 0);
        v_flags_applied := array_append(v_flags_applied, v_flag.flag_key);
        v_flag_details := array_append(v_flag_details, jsonb_build_object(
          'flag', v_flag.flag_key,
          'source', 'service_specific',
          'adds_percent', v_rule.adds_percent,
          'adds_flat', v_rule.adds_flat_fee,
          'adds_minutes', v_rule.adds_minutes
        ));
      ELSIF v_flag.applies_to_services = 'ALL' OR v_flag.applies_to_services LIKE '%' || p_service_code || '%' THEN
        -- Use default flag adjustments
        v_flag_percent_adjustment := v_flag_percent_adjustment + COALESCE(v_flag.adds_percent, 0);
        v_flag_flat_adjustment := v_flag_flat_adjustment + COALESCE(v_flag.flat_fee, 0);
        v_flag_minutes_adjustment := v_flag_minutes_adjustment + COALESCE(v_flag.adds_minutes, 0);
        v_flags_applied := array_append(v_flags_applied, v_flag.flag_key);
        v_flag_details := array_append(v_flag_details, jsonb_build_object(
          'flag', v_flag.flag_key,
          'source', 'default',
          'adds_percent', v_flag.adds_percent,
          'adds_flat', v_flag.flat_fee,
          'adds_minutes', v_flag.adds_minutes
        ));
      END IF;
    END LOOP;
  END IF;

  -- Apply flag percentage adjustment
  IF v_flag_percent_adjustment > 0 THEN
    v_base_rate := v_base_rate * (1 + v_flag_percent_adjustment / 100);
  END IF;

  -- Apply flag flat fee adjustment
  v_base_rate := v_base_rate + v_flag_flat_adjustment;

  -- Apply flag minutes adjustment
  v_total_minutes := v_total_minutes + v_flag_minutes_adjustment;

  v_breakdown := v_breakdown || jsonb_build_object(
    'flags_applied', v_flag_details,
    'rate_after_flags', v_base_rate
  );

  -- Get account adjustment
  SELECT COALESCE(percent_adjust, 0) INTO v_account_adjustment
  FROM public.account_rate_adjustments
  WHERE tenant_id = p_tenant_id AND account_id = p_account_id;

  -- Also check service-specific account adjustment
  IF v_account_service.custom_percent_adjust IS NOT NULL THEN
    v_account_adjustment := v_account_adjustment + v_account_service.custom_percent_adjust;
  END IF;

  -- Apply account adjustment
  IF v_account_adjustment != 0 THEN
    v_base_rate := v_base_rate * (1 + v_account_adjustment / 100);
    v_breakdown := v_breakdown || jsonb_build_object(
      'account_adjustment_percent', v_account_adjustment,
      'rate_after_account_adj', v_base_rate
    );
  END IF;

  v_breakdown := v_breakdown || jsonb_build_object(
    'final_rate', ROUND(v_base_rate, 2),
    'final_minutes', v_total_minutes
  );

  RETURN QUERY SELECT
    ROUND(v_base_rate, 2)::NUMERIC,
    v_total_minutes,
    v_service.pricing_mode,
    v_flags_applied,
    v_breakdown;
END;
$$;

COMMENT ON FUNCTION public.calculate_service_price_v2 IS 'Enhanced price calculation with metadata tracking and per-service flag rules';

-- ============================================================================
-- 5. UPDATE SET_ITEM_FLAG FUNCTION TO INCLUDE METADATA
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_item_flag(
  p_item_id UUID,
  p_flag_key TEXT,
  p_user_id UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_flag RECORD;
  v_item RECORD;
  v_tenant_id UUID;
  v_item_flag_id UUID;
  v_billing_event_id UUID;
  v_task_id UUID;
  v_calculation RECORD;
BEGIN
  -- Get tenant from item
  SELECT i.*, a.id as account_id INTO v_item
  FROM public.items i
  LEFT JOIN public.accounts a ON i.account_id = a.id
  WHERE i.id = p_item_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Item not found');
  END IF;

  v_tenant_id := v_item.tenant_id;

  -- Get flag definition
  SELECT * INTO v_flag
  FROM public.pricing_flags
  WHERE tenant_id = v_tenant_id AND flag_key = p_flag_key AND is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Flag not found or inactive');
  END IF;

  -- Check if already set
  SELECT id INTO v_item_flag_id
  FROM public.item_flags
  WHERE item_id = p_item_id AND flag_id = v_flag.id;

  IF FOUND THEN
    RETURN jsonb_build_object('success', true, 'item_flag_id', v_item_flag_id, 'message', 'Flag already set');
  END IF;

  -- Insert item flag
  INSERT INTO public.item_flags (tenant_id, item_id, flag_id, set_by, notes)
  VALUES (v_tenant_id, p_item_id, v_flag.id, p_user_id, p_notes)
  RETURNING id INTO v_item_flag_id;

  -- Create billing event if configured
  IF v_flag.creates_billing_event AND v_flag.is_billable THEN
    -- Calculate the charge with metadata
    SELECT * INTO v_calculation
    FROM public.calculate_service_price_v2(
      v_tenant_id,
      v_item.account_id,
      COALESCE(v_flag.billing_charge_type, 'FLAG_' || v_flag.flag_key),
      v_item.class_id,
      v_item.assembly_tier_id,
      p_item_id
    );

    INSERT INTO public.billing_events (
      tenant_id,
      account_id,
      item_id,
      event_type,
      description,
      quantity,
      unit_price,
      total_amount,
      calculation_metadata
    ) VALUES (
      v_tenant_id,
      v_item.account_id,
      p_item_id,
      COALESCE(v_flag.billing_charge_type, 'FLAG_CHARGE'),
      v_flag.display_name || ' flag applied',
      1,
      COALESCE(v_flag.flat_fee, v_calculation.rate, 0),
      COALESCE(v_flag.flat_fee, v_calculation.rate, 0),
      v_calculation.calculation_breakdown || jsonb_build_object(
        'flag_key', v_flag.flag_key,
        'flag_display_name', v_flag.display_name,
        'triggered_by', 'flag_set'
      )
    )
    RETURNING id INTO v_billing_event_id;

    -- Update item_flag with billing_event_id
    UPDATE public.item_flags SET billing_event_id = v_billing_event_id WHERE id = v_item_flag_id;
  END IF;

  -- Create task if configured
  IF v_flag.triggers_task_type IS NOT NULL THEN
    INSERT INTO public.tasks (
      tenant_id,
      item_id,
      task_type,
      title,
      status,
      created_by
    ) VALUES (
      v_tenant_id,
      p_item_id,
      v_flag.triggers_task_type,
      v_flag.display_name || ' - ' || COALESCE(v_item.sku, v_item.description, 'Item'),
      'pending',
      p_user_id
    )
    RETURNING id INTO v_task_id;

    -- Update item_flag with task_id
    UPDATE public.item_flags SET task_id = v_task_id WHERE id = v_item_flag_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'item_flag_id', v_item_flag_id,
    'billing_event_id', v_billing_event_id,
    'task_id', v_task_id
  );
END;
$$;

-- ============================================================================
-- 6. ADD MORE DEFAULT FLAGS
-- Warehouse industry-specific flags
-- ============================================================================

CREATE OR REPLACE FUNCTION public.seed_enhanced_flags(p_tenant_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Handling & Storage Flags
  INSERT INTO public.pricing_flags (tenant_id, flag_key, display_name, description, flag_type, visible_to_client, client_can_set, is_billable, creates_billing_event, flat_fee, adds_percent, adds_minutes, applies_to_services, triggers_task_type, triggers_alert, icon, color, sort_order)
  VALUES
    (p_tenant_id, 'FRAGILE', 'Fragile', 'Requires careful handling - fragile contents', 'boolean', true, true, false, false, 0, 0, 5, 'ALL', NULL, false, 'alert-triangle', 'warning', 10),
    (p_tenant_id, 'TEMPERATURE_SENSITIVE', 'Temperature Sensitive', 'Requires climate-controlled storage', 'boolean', true, true, true, true, 25, 15, 0, 'STORAGE', NULL, true, 'thermometer', 'warning', 11),
    (p_tenant_id, 'HIGH_VALUE', 'High Value', 'Requires secured storage area', 'boolean', true, false, true, true, 50, 20, 0, 'STORAGE', NULL, true, 'gem', 'warning', 12),
    (p_tenant_id, 'FLOOR_ONLY', 'Floor Only', 'Cannot be racked - must stay on floor', 'boolean', true, false, false, false, 0, 5, 0, 'STORAGE', NULL, false, 'package-x', 'default', 13),
    (p_tenant_id, 'HAZMAT', 'Hazardous Materials', 'Contains hazardous materials - special handling required', 'boolean', true, false, true, true, 75, 25, 15, 'ALL', 'inspection', true, 'biohazard', 'destructive', 14)
  ON CONFLICT (tenant_id, flag_key) DO NOTHING;

  -- Condition Flags
  INSERT INTO public.pricing_flags (tenant_id, flag_key, display_name, description, flag_type, visible_to_client, client_can_set, is_billable, creates_billing_event, flat_fee, adds_percent, adds_minutes, applies_to_services, triggers_task_type, triggers_alert, icon, color, sort_order)
  VALUES
    (p_tenant_id, 'WATER_DAMAGE', 'Water Damage', 'Item has water damage', 'boolean', true, false, false, false, 0, 0, 0, 'ALL', 'inspection', true, 'glass-water', 'destructive', 20),
    (p_tenant_id, 'MISSING_PARTS', 'Missing Parts', 'Item is missing components', 'boolean', true, false, false, false, 0, 0, 0, 'ALL', NULL, true, 'puzzle', 'warning', 21),
    (p_tenant_id, 'COSMETIC_DAMAGE', 'Cosmetic Damage', 'Minor scratches, dents, or cosmetic issues', 'boolean', true, false, false, false, 0, 0, 0, 'ALL', NULL, false, 'paintbrush', 'default', 22),
    (p_tenant_id, 'NEEDS_PHOTOS', 'Needs Photos', 'Requires photo documentation', 'boolean', true, false, false, false, 0, 0, 10, 'INSPECTION', 'photo_documentation', false, 'file-question', 'default', 23),
    (p_tenant_id, 'HOLD_FOR_INSPECTION', 'Hold for Inspection', 'Do not process until inspected', 'boolean', true, false, false, false, 0, 0, 0, 'ALL', 'inspection', true, 'hand', 'warning', 24)
  ON CONFLICT (tenant_id, flag_key) DO NOTHING;

  -- Delivery & Service Flags
  INSERT INTO public.pricing_flags (tenant_id, flag_key, display_name, description, flag_type, visible_to_client, client_can_set, is_billable, creates_billing_event, flat_fee, adds_percent, adds_minutes, applies_to_services, triggers_task_type, triggers_alert, icon, color, sort_order)
  VALUES
    (p_tenant_id, 'WHITE_GLOVE', 'White Glove Service', 'Premium handling and delivery service', 'boolean', true, true, true, true, 150, 50, 30, 'ALL', NULL, false, 'hand', 'success', 30),
    (p_tenant_id, 'RUSH_PRIORITY', 'Rush Priority', 'Priority processing requested', 'boolean', true, true, true, true, 75, 25, 0, 'ALL', NULL, true, 'zap', 'warning', 31),
    (p_tenant_id, 'APPOINTMENT_REQUIRED', 'Appointment Required', 'Delivery requires scheduling appointment', 'boolean', true, true, false, false, 0, 0, 0, 'DELIVERY', NULL, false, 'bell', 'default', 32),
    (p_tenant_id, 'INSIDE_DELIVERY', 'Inside Delivery', 'Inside delivery requested', 'boolean', true, true, true, true, 50, 0, 15, 'DELIVERY', NULL, false, 'box', 'default', 33),
    (p_tenant_id, 'LIFTGATE_REQUIRED', 'Liftgate Required', 'Needs liftgate equipment for delivery', 'boolean', true, true, true, true, 75, 0, 10, 'DELIVERY', NULL, false, 'layers', 'default', 34),
    (p_tenant_id, 'TWO_PERSON_DELIVERY', 'Two Person Delivery', 'Requires 2-person delivery team', 'boolean', true, true, true, true, 100, 0, 20, 'DELIVERY', NULL, false, 'weight', 'default', 35)
  ON CONFLICT (tenant_id, flag_key) DO NOTHING;
END;
$$;

COMMENT ON FUNCTION public.seed_enhanced_flags IS 'Add warehouse industry-specific flags for a tenant';

-- ============================================================================
-- 7. GET PRICING EXPORT DATA FUNCTION
-- For dynamic CSV/XLSX export matching tenant's pricing structure
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_pricing_export_data(p_tenant_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'size_categories', (
      SELECT jsonb_agg(jsonb_build_object(
        'code', code,
        'name', name,
        'min_cubic_feet', min_cubic_feet,
        'max_cubic_feet', max_cubic_feet,
        'storage_rate_per_day', storage_rate_per_day,
        'inspection_fee_per_item', inspection_fee_per_item,
        'default_inspection_minutes', default_inspection_minutes
      ) ORDER BY sort_order)
      FROM public.classes WHERE tenant_id = p_tenant_id AND is_active = true
    ),
    'assembly_tiers', (
      SELECT jsonb_agg(jsonb_build_object(
        'tier_number', tier_number,
        'display_name', display_name,
        'billing_mode', billing_mode,
        'rate', rate,
        'default_minutes', default_minutes,
        'requires_special_installer', requires_special_installer,
        'requires_manual_quote', requires_manual_quote
      ) ORDER BY sort_order)
      FROM public.assembly_tiers WHERE tenant_id = p_tenant_id AND is_active = true
    ),
    'services', (
      SELECT jsonb_agg(jsonb_build_object(
        'code', code,
        'name', name,
        'base_rate', base_rate,
        'pricing_mode', pricing_mode,
        'description', description
      ) ORDER BY code)
      FROM public.billable_services WHERE tenant_id = p_tenant_id AND is_active = true
    ),
    'flags', (
      SELECT jsonb_agg(jsonb_build_object(
        'flag_key', flag_key,
        'display_name', display_name,
        'description', description,
        'is_billable', is_billable,
        'flat_fee', flat_fee,
        'adds_percent', adds_percent,
        'adds_minutes', adds_minutes,
        'applies_to_services', applies_to_services,
        'triggers_task_type', triggers_task_type,
        'triggers_alert', triggers_alert,
        'visible_to_client', visible_to_client,
        'client_can_set', client_can_set
      ) ORDER BY sort_order)
      FROM public.pricing_flags WHERE tenant_id = p_tenant_id AND is_active = true
    ),
    'flag_service_rules', (
      SELECT jsonb_agg(jsonb_build_object(
        'flag_key', pf.flag_key,
        'service_code', fsr.service_code,
        'adds_percent', fsr.adds_percent,
        'adds_flat_fee', fsr.adds_flat_fee,
        'adds_minutes', fsr.adds_minutes,
        'multiplier', fsr.multiplier
      ))
      FROM public.flag_service_rules fsr
      JOIN public.pricing_flags pf ON pf.id = fsr.flag_id
      WHERE fsr.tenant_id = p_tenant_id AND fsr.is_active = true
    ),
    'export_timestamp', now(),
    'tenant_id', p_tenant_id
  ) INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_pricing_export_data IS 'Export all pricing configuration for a tenant as JSON (for CSV/XLSX generation)';

-- ============================================================================
-- 8. IMPORT PRICING DATA FUNCTION
-- For importing pricing configuration from JSON
-- ============================================================================

CREATE OR REPLACE FUNCTION public.import_pricing_data(
  p_tenant_id UUID,
  p_data JSONB,
  p_overwrite BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_item JSONB;
  v_counts JSONB := jsonb_build_object(
    'size_categories', 0,
    'assembly_tiers', 0,
    'services', 0,
    'flags', 0,
    'flag_service_rules', 0
  );
BEGIN
  -- Import size categories
  IF p_data ? 'size_categories' AND p_data->'size_categories' IS NOT NULL THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_data->'size_categories')
    LOOP
      IF p_overwrite THEN
        INSERT INTO public.classes (tenant_id, code, name, min_cubic_feet, max_cubic_feet, storage_rate_per_day, inspection_fee_per_item, default_inspection_minutes)
        VALUES (
          p_tenant_id,
          v_item->>'code',
          v_item->>'name',
          (v_item->>'min_cubic_feet')::NUMERIC,
          (v_item->>'max_cubic_feet')::NUMERIC,
          (v_item->>'storage_rate_per_day')::NUMERIC,
          (v_item->>'inspection_fee_per_item')::NUMERIC,
          (v_item->>'default_inspection_minutes')::INTEGER
        )
        ON CONFLICT (tenant_id, code) DO UPDATE SET
          name = EXCLUDED.name,
          min_cubic_feet = EXCLUDED.min_cubic_feet,
          max_cubic_feet = EXCLUDED.max_cubic_feet,
          storage_rate_per_day = EXCLUDED.storage_rate_per_day,
          inspection_fee_per_item = EXCLUDED.inspection_fee_per_item,
          default_inspection_minutes = EXCLUDED.default_inspection_minutes;
      ELSE
        INSERT INTO public.classes (tenant_id, code, name, min_cubic_feet, max_cubic_feet, storage_rate_per_day, inspection_fee_per_item, default_inspection_minutes)
        VALUES (
          p_tenant_id,
          v_item->>'code',
          v_item->>'name',
          (v_item->>'min_cubic_feet')::NUMERIC,
          (v_item->>'max_cubic_feet')::NUMERIC,
          (v_item->>'storage_rate_per_day')::NUMERIC,
          (v_item->>'inspection_fee_per_item')::NUMERIC,
          (v_item->>'default_inspection_minutes')::INTEGER
        )
        ON CONFLICT (tenant_id, code) DO NOTHING;
      END IF;
      v_counts := jsonb_set(v_counts, '{size_categories}', to_jsonb((v_counts->>'size_categories')::INTEGER + 1));
    END LOOP;
  END IF;

  -- Import assembly tiers
  IF p_data ? 'assembly_tiers' AND p_data->'assembly_tiers' IS NOT NULL THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_data->'assembly_tiers')
    LOOP
      IF p_overwrite THEN
        INSERT INTO public.assembly_tiers (tenant_id, tier_number, display_name, billing_mode, rate, default_minutes, requires_special_installer, requires_manual_quote)
        VALUES (
          p_tenant_id,
          (v_item->>'tier_number')::INTEGER,
          v_item->>'display_name',
          v_item->>'billing_mode',
          (v_item->>'rate')::NUMERIC,
          (v_item->>'default_minutes')::INTEGER,
          (v_item->>'requires_special_installer')::BOOLEAN,
          (v_item->>'requires_manual_quote')::BOOLEAN
        )
        ON CONFLICT (tenant_id, tier_number) DO UPDATE SET
          display_name = EXCLUDED.display_name,
          billing_mode = EXCLUDED.billing_mode,
          rate = EXCLUDED.rate,
          default_minutes = EXCLUDED.default_minutes,
          requires_special_installer = EXCLUDED.requires_special_installer,
          requires_manual_quote = EXCLUDED.requires_manual_quote;
      ELSE
        INSERT INTO public.assembly_tiers (tenant_id, tier_number, display_name, billing_mode, rate, default_minutes, requires_special_installer, requires_manual_quote)
        VALUES (
          p_tenant_id,
          (v_item->>'tier_number')::INTEGER,
          v_item->>'display_name',
          v_item->>'billing_mode',
          (v_item->>'rate')::NUMERIC,
          (v_item->>'default_minutes')::INTEGER,
          (v_item->>'requires_special_installer')::BOOLEAN,
          (v_item->>'requires_manual_quote')::BOOLEAN
        )
        ON CONFLICT (tenant_id, tier_number) DO NOTHING;
      END IF;
      v_counts := jsonb_set(v_counts, '{assembly_tiers}', to_jsonb((v_counts->>'assembly_tiers')::INTEGER + 1));
    END LOOP;
  END IF;

  -- Import flags
  IF p_data ? 'flags' AND p_data->'flags' IS NOT NULL THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_data->'flags')
    LOOP
      IF p_overwrite THEN
        INSERT INTO public.pricing_flags (tenant_id, flag_key, display_name, description, is_billable, flat_fee, adds_percent, adds_minutes, applies_to_services, triggers_task_type, triggers_alert, visible_to_client, client_can_set)
        VALUES (
          p_tenant_id,
          v_item->>'flag_key',
          v_item->>'display_name',
          v_item->>'description',
          COALESCE((v_item->>'is_billable')::BOOLEAN, false),
          (v_item->>'flat_fee')::NUMERIC,
          (v_item->>'adds_percent')::NUMERIC,
          (v_item->>'adds_minutes')::INTEGER,
          v_item->>'applies_to_services',
          v_item->>'triggers_task_type',
          COALESCE((v_item->>'triggers_alert')::BOOLEAN, false),
          COALESCE((v_item->>'visible_to_client')::BOOLEAN, true),
          COALESCE((v_item->>'client_can_set')::BOOLEAN, false)
        )
        ON CONFLICT (tenant_id, flag_key) DO UPDATE SET
          display_name = EXCLUDED.display_name,
          description = EXCLUDED.description,
          is_billable = EXCLUDED.is_billable,
          flat_fee = EXCLUDED.flat_fee,
          adds_percent = EXCLUDED.adds_percent,
          adds_minutes = EXCLUDED.adds_minutes,
          applies_to_services = EXCLUDED.applies_to_services,
          triggers_task_type = EXCLUDED.triggers_task_type,
          triggers_alert = EXCLUDED.triggers_alert,
          visible_to_client = EXCLUDED.visible_to_client,
          client_can_set = EXCLUDED.client_can_set;
      ELSE
        INSERT INTO public.pricing_flags (tenant_id, flag_key, display_name, description, is_billable, flat_fee, adds_percent, adds_minutes, applies_to_services, triggers_task_type, triggers_alert, visible_to_client, client_can_set)
        VALUES (
          p_tenant_id,
          v_item->>'flag_key',
          v_item->>'display_name',
          v_item->>'description',
          COALESCE((v_item->>'is_billable')::BOOLEAN, false),
          (v_item->>'flat_fee')::NUMERIC,
          (v_item->>'adds_percent')::NUMERIC,
          (v_item->>'adds_minutes')::INTEGER,
          v_item->>'applies_to_services',
          v_item->>'triggers_task_type',
          COALESCE((v_item->>'triggers_alert')::BOOLEAN, false),
          COALESCE((v_item->>'visible_to_client')::BOOLEAN, true),
          COALESCE((v_item->>'client_can_set')::BOOLEAN, false)
        )
        ON CONFLICT (tenant_id, flag_key) DO NOTHING;
      END IF;
      v_counts := jsonb_set(v_counts, '{flags}', to_jsonb((v_counts->>'flags')::INTEGER + 1));
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'imported_counts', v_counts
  );
END;
$$;

COMMENT ON FUNCTION public.import_pricing_data IS 'Import pricing configuration from JSON data';
