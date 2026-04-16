-- New Pricing Structure Migration
-- Implements: Size Categories, Global Service Rates, Assembly Tiers, Flags, Account Pricing Overrides

-- ============================================================================
-- 1. EXTEND CLASSES TABLE (Size_Categories)
-- Add storage and inspection pricing per size category
-- ============================================================================

ALTER TABLE public.classes
ADD COLUMN IF NOT EXISTS storage_rate_per_day NUMERIC(10,4) DEFAULT 0,
ADD COLUMN IF NOT EXISTS inspection_fee_per_item NUMERIC(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS default_inspection_minutes INTEGER DEFAULT 10,
ADD COLUMN IF NOT EXISTS notes TEXT;

COMMENT ON COLUMN public.classes.storage_rate_per_day IS 'Daily storage rate for this size category';
COMMENT ON COLUMN public.classes.inspection_fee_per_item IS 'Inspection fee for items in this size category';
COMMENT ON COLUMN public.classes.default_inspection_minutes IS 'Default time estimate for inspection tasks';

-- ============================================================================
-- 2. EXTEND BILLABLE_SERVICES TABLE (Global_Service_Rates)
-- Add base_rate and pricing_mode to indicate how pricing is determined
-- ============================================================================

ALTER TABLE public.billable_services
ADD COLUMN IF NOT EXISTS base_rate NUMERIC(10,2),
ADD COLUMN IF NOT EXISTS pricing_mode TEXT DEFAULT 'flat' CHECK (pricing_mode IN ('flat', 'per_size', 'assembly_tier', 'manual')),
ADD COLUMN IF NOT EXISTS notes TEXT;

COMMENT ON COLUMN public.billable_services.base_rate IS 'Base rate for flat-rate services (like Receiving)';
COMMENT ON COLUMN public.billable_services.pricing_mode IS 'flat=use base_rate, per_size=use size category rates, assembly_tier=use assembly tiers, manual=requires quote';

-- ============================================================================
-- 3. CREATE ASSEMBLY_TIERS TABLE
-- Assembly pricing is variable based on complexity tier
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.assembly_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  tier_number INTEGER NOT NULL,
  display_name TEXT NOT NULL,
  billing_mode TEXT NOT NULL DEFAULT 'flat_per_item' CHECK (billing_mode IN ('flat_per_item', 'per_minute', 'manual_quote')),
  rate NUMERIC(10,2),
  default_minutes INTEGER,
  requires_special_installer BOOLEAN DEFAULT false,
  requires_manual_quote BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, tier_number)
);

CREATE INDEX IF NOT EXISTS idx_assembly_tiers_tenant ON public.assembly_tiers(tenant_id);

COMMENT ON TABLE public.assembly_tiers IS 'Assembly complexity tiers with variable pricing (Tier 1=Easy to Tier 4=Custom)';

-- Enable RLS
ALTER TABLE public.assembly_tiers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant isolation for assembly_tiers" ON public.assembly_tiers;
CREATE POLICY "Tenant isolation for assembly_tiers"
ON public.assembly_tiers FOR ALL
USING (tenant_id IN (
  SELECT tenant_id FROM public.users WHERE id = auth.uid()
));

-- ============================================================================
-- 4. CREATE FLAGS TABLE
-- Tenant-customizable flags that can affect pricing and trigger tasks
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.pricing_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  flag_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  flag_type TEXT NOT NULL DEFAULT 'boolean' CHECK (flag_type IN ('boolean', 'enum', 'number')),
  is_active BOOLEAN DEFAULT true,
  visible_to_client BOOLEAN DEFAULT true,
  client_can_set BOOLEAN DEFAULT false,
  adds_percent NUMERIC(5,2) DEFAULT 0,
  adds_minutes INTEGER DEFAULT 0,
  applies_to_services TEXT DEFAULT 'ALL',
  triggers_task_type TEXT,
  triggers_alert BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, flag_key)
);

CREATE INDEX IF NOT EXISTS idx_pricing_flags_tenant ON public.pricing_flags(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pricing_flags_key ON public.pricing_flags(tenant_id, flag_key);

COMMENT ON TABLE public.pricing_flags IS 'Item flags that can modify pricing or trigger workflows';
COMMENT ON COLUMN public.pricing_flags.adds_percent IS 'Percentage to add to applicable service rates (e.g., 10 = +10%)';
COMMENT ON COLUMN public.pricing_flags.adds_minutes IS 'Extra minutes to add to time estimates';
COMMENT ON COLUMN public.pricing_flags.applies_to_services IS 'Which services this flag affects: ALL, STORAGE, INSPECTION, ASSEMBLY, REPAIR, etc.';
COMMENT ON COLUMN public.pricing_flags.triggers_task_type IS 'Auto-create a task of this type when flag is set';

-- Enable RLS
ALTER TABLE public.pricing_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant isolation for pricing_flags" ON public.pricing_flags;
CREATE POLICY "Tenant isolation for pricing_flags"
ON public.pricing_flags FOR ALL
USING (tenant_id IN (
  SELECT tenant_id FROM public.users WHERE id = auth.uid()
));

-- ============================================================================
-- 5. ITEM FLAGS JUNCTION TABLE
-- Track which flags are set on each item
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.item_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  flag_id UUID NOT NULL REFERENCES public.pricing_flags(id) ON DELETE CASCADE,
  value TEXT DEFAULT 'true',
  set_by UUID REFERENCES auth.users(id),
  set_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(item_id, flag_id)
);

CREATE INDEX IF NOT EXISTS idx_item_flags_item ON public.item_flags(item_id);
CREATE INDEX IF NOT EXISTS idx_item_flags_tenant ON public.item_flags(tenant_id);

COMMENT ON TABLE public.item_flags IS 'Junction table tracking which pricing flags are set on each item';

-- Enable RLS
ALTER TABLE public.item_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant isolation for item_flags" ON public.item_flags;
CREATE POLICY "Tenant isolation for item_flags"
ON public.item_flags FOR ALL
USING (tenant_id IN (
  SELECT tenant_id FROM public.users WHERE id = auth.uid()
));

-- ============================================================================
-- 6. ADD ASSEMBLY_TIER_ID TO ITEMS TABLE
-- Track which assembly tier an item requires
-- ============================================================================

ALTER TABLE public.items
ADD COLUMN IF NOT EXISTS assembly_tier_id UUID REFERENCES public.assembly_tiers(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.items.assembly_tier_id IS 'Assembly complexity tier (1-4) for this item';

-- ============================================================================
-- 7. SEED DEFAULT DATA FUNCTION
-- Call this to populate default pricing data for a tenant
-- ============================================================================

CREATE OR REPLACE FUNCTION public.seed_default_pricing(p_tenant_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Insert default size categories if not exist
  INSERT INTO public.classes (tenant_id, code, name, min_cubic_feet, max_cubic_feet, storage_rate_per_day, inspection_fee_per_item, default_inspection_minutes, sort_order)
  VALUES
    (p_tenant_id, 'XS', 'Extra Small', 0, 5, 0.40, 30, 6, 1),
    (p_tenant_id, 'S', 'Small', 5, 15, 0.55, 35, 8, 2),
    (p_tenant_id, 'M', 'Medium', 15, 40, 0.75, 35, 10, 3),
    (p_tenant_id, 'L', 'Large', 40, 100, 1.00, 45, 14, 4),
    (p_tenant_id, 'XL', 'Extra Large', 100, NULL, 1.30, 55, 18, 5)
  ON CONFLICT (tenant_id, code) DO UPDATE SET
    storage_rate_per_day = EXCLUDED.storage_rate_per_day,
    inspection_fee_per_item = EXCLUDED.inspection_fee_per_item,
    default_inspection_minutes = EXCLUDED.default_inspection_minutes;

  -- Insert default assembly tiers if not exist
  INSERT INTO public.assembly_tiers (tenant_id, tier_number, display_name, billing_mode, rate, default_minutes, requires_special_installer, requires_manual_quote, sort_order)
  VALUES
    (p_tenant_id, 1, 'Tier 1 — Very Easy', 'flat_per_item', 45, 15, false, false, 1),
    (p_tenant_id, 2, 'Tier 2 — Default', 'flat_per_item', 95, 45, false, false, 2),
    (p_tenant_id, 3, 'Tier 3 — Skilled', 'flat_per_item', 175, 90, false, false, 3),
    (p_tenant_id, 4, 'Tier 4 — Special Installer / Custom Quote', 'manual_quote', NULL, NULL, true, true, 4)
  ON CONFLICT (tenant_id, tier_number) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    billing_mode = EXCLUDED.billing_mode,
    rate = EXCLUDED.rate,
    default_minutes = EXCLUDED.default_minutes;

  -- Insert default flags if not exist
  INSERT INTO public.pricing_flags (tenant_id, flag_key, display_name, flag_type, visible_to_client, client_can_set, adds_percent, adds_minutes, applies_to_services, triggers_task_type, triggers_alert, sort_order)
  VALUES
    (p_tenant_id, 'OVERWEIGHT', 'Overweight', 'boolean', true, true, 0, 5, 'ALL', NULL, false, 1),
    (p_tenant_id, 'OVERSIZE', 'Oversize', 'boolean', true, true, 0, 5, 'ALL', NULL, false, 2),
    (p_tenant_id, 'CRATED', 'Crated', 'boolean', true, false, 0, 3, 'ALL', NULL, false, 3),
    (p_tenant_id, 'UNSTACKABLE', 'Unstackable', 'boolean', true, false, 10, 0, 'STORAGE', NULL, false, 4),
    (p_tenant_id, 'NEEDS_REPAIR', 'Needs Repair', 'boolean', true, true, 0, 0, 'REPAIR', 'repair', true, 5),
    (p_tenant_id, 'NEEDS_ASSEMBLY', 'Needs Assembly', 'boolean', true, true, 0, 0, 'ASSEMBLY', 'assembly', false, 6)
  ON CONFLICT (tenant_id, flag_key) DO NOTHING;

  -- Update billable services with pricing modes
  UPDATE public.billable_services SET
    base_rate = 15,
    pricing_mode = 'flat'
  WHERE tenant_id = p_tenant_id AND code = 'RECEIVING';

  UPDATE public.billable_services SET
    pricing_mode = 'per_size'
  WHERE tenant_id = p_tenant_id AND code IN ('STORAGE', 'INSPECTION');

  UPDATE public.billable_services SET
    pricing_mode = 'assembly_tier'
  WHERE tenant_id = p_tenant_id AND code = 'ASSEMBLY';

  UPDATE public.billable_services SET
    pricing_mode = 'manual'
  WHERE tenant_id = p_tenant_id AND code IN ('WILL_CALL', 'DISPOSAL');

END;
$$;

COMMENT ON FUNCTION public.seed_default_pricing IS 'Populate default pricing structure for a tenant';

-- ============================================================================
-- 8. PRICING CALCULATION FUNCTION
-- Calculate the price for a service given item details
-- ============================================================================

CREATE OR REPLACE FUNCTION public.calculate_service_price(
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
  flags_applied TEXT[]
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
  v_flag_minutes_adjustment INTEGER := 0;
  v_flags_applied TEXT[] := ARRAY[]::TEXT[];
  v_flag RECORD;
BEGIN
  -- Get service details
  SELECT * INTO v_service FROM public.billable_services
  WHERE tenant_id = p_tenant_id AND code = p_service_code AND is_active = true;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 0::NUMERIC, 0::INTEGER, 'service_not_found'::TEXT, ARRAY[]::TEXT[];
    RETURN;
  END IF;

  -- Calculate base rate based on pricing mode
  CASE v_service.pricing_mode
    WHEN 'flat' THEN
      v_base_rate := COALESCE(v_service.base_rate, 0);
      v_total_minutes := 5; -- Default flat service time

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
        END IF;
      END IF;

    WHEN 'assembly_tier' THEN
      IF p_assembly_tier_id IS NOT NULL THEN
        SELECT * INTO v_assembly FROM public.assembly_tiers WHERE id = p_assembly_tier_id;
        IF FOUND THEN
          v_base_rate := COALESCE(v_assembly.rate, 0);
          v_total_minutes := COALESCE(v_assembly.default_minutes, 0);
        END IF;
      END IF;

    WHEN 'manual' THEN
      v_base_rate := 0;
      v_total_minutes := 0;
  END CASE;

  -- Apply flag adjustments if item_id provided
  IF p_item_id IS NOT NULL THEN
    FOR v_flag IN
      SELECT pf.* FROM public.pricing_flags pf
      JOIN public.item_flags if2 ON if2.flag_id = pf.id
      WHERE if2.item_id = p_item_id
        AND pf.is_active = true
        AND (pf.applies_to_services = 'ALL' OR pf.applies_to_services LIKE '%' || p_service_code || '%')
    LOOP
      v_flag_percent_adjustment := v_flag_percent_adjustment + COALESCE(v_flag.adds_percent, 0);
      v_flag_minutes_adjustment := v_flag_minutes_adjustment + COALESCE(v_flag.adds_minutes, 0);
      v_flags_applied := array_append(v_flags_applied, v_flag.flag_key);
    END LOOP;
  END IF;

  -- Apply flag percentage adjustment
  IF v_flag_percent_adjustment > 0 THEN
    v_base_rate := v_base_rate * (1 + v_flag_percent_adjustment / 100);
  END IF;

  -- Apply flag minutes adjustment
  v_total_minutes := v_total_minutes + v_flag_minutes_adjustment;

  -- Get account adjustment
  SELECT COALESCE(percent_adjust, 0) INTO v_account_adjustment
  FROM public.account_rate_adjustments
  WHERE tenant_id = p_tenant_id AND account_id = p_account_id;

  -- Apply account adjustment
  IF v_account_adjustment != 0 THEN
    v_base_rate := v_base_rate * (1 + v_account_adjustment);
  END IF;

  RETURN QUERY SELECT
    ROUND(v_base_rate, 2)::NUMERIC,
    v_total_minutes,
    v_service.pricing_mode,
    v_flags_applied;
END;
$$;

COMMENT ON FUNCTION public.calculate_service_price IS 'Calculate price for a service with size, tier, flags, and account adjustments';

-- ============================================================================
-- 9. UPDATED_AT TRIGGERS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_assembly_tiers_updated_at ON public.assembly_tiers;
CREATE TRIGGER set_assembly_tiers_updated_at
  BEFORE UPDATE ON public.assembly_tiers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_pricing_flags_updated_at ON public.pricing_flags;
CREATE TRIGGER set_pricing_flags_updated_at
  BEFORE UPDATE ON public.pricing_flags
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
