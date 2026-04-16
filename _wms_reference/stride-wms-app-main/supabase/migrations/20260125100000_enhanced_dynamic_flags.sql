-- Enhanced Dynamic Flags System Migration
-- Adds billing triggers, task automation, and additional flag configuration options

-- ============================================================================
-- 1. ENHANCE PRICING_FLAGS TABLE
-- Add more configuration options for billing and automation
-- ============================================================================

-- First ensure the pricing_flags table exists (create if missing from earlier migration)
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

ALTER TABLE public.pricing_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant isolation for pricing_flags" ON public.pricing_flags;
CREATE POLICY "Tenant isolation for pricing_flags"
ON public.pricing_flags FOR ALL
USING (tenant_id IN (
  SELECT tenant_id FROM public.users WHERE id = auth.uid()
));

-- Now add the enhanced columns
ALTER TABLE public.pricing_flags
ADD COLUMN IF NOT EXISTS description TEXT,
ADD COLUMN IF NOT EXISTS flat_fee NUMERIC(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS icon TEXT DEFAULT 'flag',
ADD COLUMN IF NOT EXISTS color TEXT DEFAULT 'default',
ADD COLUMN IF NOT EXISTS creates_billing_event BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS billing_charge_type TEXT,
ADD COLUMN IF NOT EXISTS is_billable BOOLEAN DEFAULT false;

COMMENT ON COLUMN public.pricing_flags.description IS 'Detailed description of what this flag represents and when to use it';
COMMENT ON COLUMN public.pricing_flags.flat_fee IS 'Flat fee to charge when this flag is set (in addition to percentage adjustments)';
COMMENT ON COLUMN public.pricing_flags.icon IS 'Icon name to display for this flag (lucide icon name)';
COMMENT ON COLUMN public.pricing_flags.color IS 'Color theme for the flag badge (default, destructive, warning, success)';
COMMENT ON COLUMN public.pricing_flags.creates_billing_event IS 'Auto-create a billing event when this flag is toggled on';
COMMENT ON COLUMN public.pricing_flags.billing_charge_type IS 'Charge type for auto-created billing events';
COMMENT ON COLUMN public.pricing_flags.is_billable IS 'Whether this flag represents a billable service/surcharge';

-- ============================================================================
-- 2. ADD METADATA TO ITEM_FLAGS
-- Track billing events created and history
-- ============================================================================

-- Ensure item_flags table exists (create if missing from earlier migration)
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

ALTER TABLE public.item_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant isolation for item_flags" ON public.item_flags;
CREATE POLICY "Tenant isolation for item_flags"
ON public.item_flags FOR ALL
USING (tenant_id IN (
  SELECT tenant_id FROM public.users WHERE id = auth.uid()
));

-- Now add the enhanced columns
ALTER TABLE public.item_flags
ADD COLUMN IF NOT EXISTS billing_event_id UUID REFERENCES public.billing_events(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS task_id UUID REFERENCES public.tasks(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS notes TEXT,
ADD COLUMN IF NOT EXISTS unset_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS unset_by UUID REFERENCES auth.users(id);

COMMENT ON COLUMN public.item_flags.billing_event_id IS 'Billing event auto-created when this flag was set';
COMMENT ON COLUMN public.item_flags.task_id IS 'Task auto-created when this flag was set';

-- ============================================================================
-- 2.5. ENSURE ASSEMBLY_TIERS TABLE EXISTS
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

ALTER TABLE public.assembly_tiers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant isolation for assembly_tiers" ON public.assembly_tiers;
CREATE POLICY "Tenant isolation for assembly_tiers"
ON public.assembly_tiers FOR ALL
USING (tenant_id IN (
  SELECT tenant_id FROM public.users WHERE id = auth.uid()
));

-- ============================================================================
-- 3. FUNCTION: SET ITEM FLAG WITH AUTO-BILLING AND AUTO-TASK
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
  v_tenant_id UUID;
  v_flag RECORD;
  v_item RECORD;
  v_item_flag_id UUID;
  v_billing_event_id UUID;
  v_task_id UUID;
  v_result JSONB;
BEGIN
  -- Get tenant_id from item
  SELECT i.tenant_id, i.id, i.item_code, i.account_id, i.sidemark_id, i.item_type_id, i.quantity
  INTO v_item
  FROM public.items i
  WHERE i.id = p_item_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Item not found');
  END IF;

  v_tenant_id := v_item.tenant_id;

  -- Get flag details
  SELECT * INTO v_flag
  FROM public.pricing_flags
  WHERE tenant_id = v_tenant_id AND flag_key = p_flag_key AND is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Flag not found or inactive');
  END IF;

  -- Check if flag already exists for this item
  SELECT id INTO v_item_flag_id
  FROM public.item_flags
  WHERE item_id = p_item_id AND flag_id = v_flag.id;

  IF FOUND THEN
    -- Flag already set, return existing
    RETURN jsonb_build_object('success', true, 'message', 'Flag already set', 'item_flag_id', v_item_flag_id);
  END IF;

  -- Insert the item flag
  INSERT INTO public.item_flags (tenant_id, item_id, flag_id, set_by, notes)
  VALUES (v_tenant_id, p_item_id, v_flag.id, COALESCE(p_user_id, auth.uid()), p_notes)
  RETURNING id INTO v_item_flag_id;

  -- Auto-create billing event if configured
  IF v_flag.creates_billing_event = true AND v_item.account_id IS NOT NULL THEN
    INSERT INTO public.billing_events (
      tenant_id,
      account_id,
      item_id,
      sidemark_id,
      class_id,
      event_type,
      charge_type,
      description,
      quantity,
      unit_rate,
      status,
      created_by
    )
    VALUES (
      v_tenant_id,
      v_item.account_id,
      p_item_id,
      v_item.sidemark_id,
      v_item.item_type_id,
      'flag_charge',
      COALESCE(v_flag.billing_charge_type, lower(v_flag.flag_key)),
      v_flag.display_name || ' - ' || v_item.item_code,
      COALESCE(v_item.quantity, 1),
      COALESCE(v_flag.flat_fee, 0),
      'unbilled',
      COALESCE(p_user_id, auth.uid())
    )
    RETURNING id INTO v_billing_event_id;

    -- Link billing event to item flag
    UPDATE public.item_flags SET billing_event_id = v_billing_event_id WHERE id = v_item_flag_id;
  END IF;

  -- Auto-create task if configured
  IF v_flag.triggers_task_type IS NOT NULL THEN
    INSERT INTO public.tasks (
      tenant_id,
      task_type,
      status,
      item_id,
      account_id,
      sidemark_id,
      title,
      notes,
      created_by
    )
    VALUES (
      v_tenant_id,
      v_flag.triggers_task_type,
      'pending',
      p_item_id,
      v_item.account_id,
      v_item.sidemark_id,
      v_flag.display_name || ' - ' || v_item.item_code,
      'Auto-created from flag: ' || v_flag.display_name,
      COALESCE(p_user_id, auth.uid())
    )
    RETURNING id INTO v_task_id;

    -- Link task to item flag
    UPDATE public.item_flags SET task_id = v_task_id WHERE id = v_item_flag_id;
  END IF;

  -- Return result
  RETURN jsonb_build_object(
    'success', true,
    'item_flag_id', v_item_flag_id,
    'billing_event_id', v_billing_event_id,
    'task_id', v_task_id
  );
END;
$$;

COMMENT ON FUNCTION public.set_item_flag IS 'Set a flag on an item with automatic billing event and task creation';

-- ============================================================================
-- 4. FUNCTION: UNSET ITEM FLAG
-- ============================================================================

CREATE OR REPLACE FUNCTION public.unset_item_flag(
  p_item_id UUID,
  p_flag_key TEXT,
  p_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id UUID;
  v_flag_id UUID;
  v_item_flag RECORD;
BEGIN
  -- Get tenant_id from item
  SELECT tenant_id INTO v_tenant_id FROM public.items WHERE id = p_item_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Item not found');
  END IF;

  -- Get flag id
  SELECT id INTO v_flag_id
  FROM public.pricing_flags
  WHERE tenant_id = v_tenant_id AND flag_key = p_flag_key;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Flag not found');
  END IF;

  -- Get item flag record
  SELECT * INTO v_item_flag
  FROM public.item_flags
  WHERE item_id = p_item_id AND flag_id = v_flag_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', true, 'message', 'Flag was not set');
  END IF;

  -- Delete the item flag (billing event remains for history)
  DELETE FROM public.item_flags WHERE id = v_item_flag.id;

  RETURN jsonb_build_object(
    'success', true,
    'removed_billing_event_id', v_item_flag.billing_event_id,
    'removed_task_id', v_item_flag.task_id
  );
END;
$$;

COMMENT ON FUNCTION public.unset_item_flag IS 'Remove a flag from an item';

-- ============================================================================
-- 5. FUNCTION: GET ITEM FLAGS WITH DETAILS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_item_flags(p_item_id UUID)
RETURNS TABLE (
  flag_id UUID,
  flag_key TEXT,
  display_name TEXT,
  description TEXT,
  icon TEXT,
  color TEXT,
  is_billable BOOLEAN,
  flat_fee NUMERIC,
  adds_percent NUMERIC,
  visible_to_client BOOLEAN,
  client_can_set BOOLEAN,
  set_at TIMESTAMPTZ,
  set_by UUID,
  billing_event_id UUID,
  task_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    pf.id as flag_id,
    pf.flag_key,
    pf.display_name,
    pf.description,
    pf.icon,
    pf.color,
    pf.is_billable,
    pf.flat_fee,
    pf.adds_percent,
    pf.visible_to_client,
    pf.client_can_set,
    if2.set_at,
    if2.set_by,
    if2.billing_event_id,
    if2.task_id
  FROM public.item_flags if2
  JOIN public.pricing_flags pf ON pf.id = if2.flag_id
  WHERE if2.item_id = p_item_id AND pf.is_active = true
  ORDER BY pf.sort_order;
END;
$$;

-- ============================================================================
-- 6. FUNCTION: GET ALL AVAILABLE FLAGS FOR TENANT
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_available_flags(p_tenant_id UUID, p_is_client BOOLEAN DEFAULT false)
RETURNS TABLE (
  id UUID,
  flag_key TEXT,
  display_name TEXT,
  description TEXT,
  icon TEXT,
  color TEXT,
  is_billable BOOLEAN,
  flat_fee NUMERIC,
  adds_percent NUMERIC,
  adds_minutes INTEGER,
  applies_to_services TEXT,
  visible_to_client BOOLEAN,
  client_can_set BOOLEAN,
  triggers_task_type TEXT,
  sort_order INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    pf.id,
    pf.flag_key,
    pf.display_name,
    pf.description,
    pf.icon,
    pf.color,
    pf.is_billable,
    pf.flat_fee,
    pf.adds_percent,
    pf.adds_minutes,
    pf.applies_to_services,
    pf.visible_to_client,
    pf.client_can_set,
    pf.triggers_task_type,
    pf.sort_order
  FROM public.pricing_flags pf
  WHERE pf.tenant_id = p_tenant_id
    AND pf.is_active = true
    AND (NOT p_is_client OR pf.visible_to_client = true)
  ORDER BY pf.sort_order, pf.display_name;
END;
$$;

-- ============================================================================
-- 7. UPDATE SEED FUNCTION WITH ENHANCED FLAG DATA
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

  -- Insert enhanced default flags
  INSERT INTO public.pricing_flags (
    tenant_id, flag_key, display_name, description, flag_type,
    visible_to_client, client_can_set,
    adds_percent, adds_minutes, flat_fee,
    applies_to_services, triggers_task_type, triggers_alert,
    creates_billing_event, billing_charge_type, is_billable,
    icon, color, sort_order
  )
  VALUES
    -- Handling Surcharges
    (p_tenant_id, 'OVERWEIGHT', 'Overweight', 'Item exceeds standard weight limits requiring additional handling equipment or personnel.', 'boolean',
     true, false,
     15, 10, 25.00,
     'ALL', NULL, false,
     true, 'overweight_handling', true,
     'weight', 'warning', 1),

    (p_tenant_id, 'OVERSIZE', 'Oversize', 'Item exceeds standard dimensions requiring special handling or equipment.', 'boolean',
     true, false,
     15, 10, 25.00,
     'ALL', NULL, false,
     true, 'oversize_handling', true,
     'maximize', 'warning', 2),

    (p_tenant_id, 'FRAGILE', 'Fragile', 'Item requires extra care during handling, storage, and transport. May need special packaging.', 'boolean',
     true, true,
     10, 5, 0,
     'ALL', NULL, false,
     false, NULL, false,
     'glass-water', 'destructive', 3),

    (p_tenant_id, 'CRATED', 'Crated', 'Item arrived in crate requiring disposal. Crate disposal fee applies.', 'boolean',
     true, false,
     0, 15, 35.00,
     'RECEIVING', NULL, false,
     true, 'crate_disposal', true,
     'box', 'default', 4),

    (p_tenant_id, 'UNSTACKABLE', 'Unstackable', 'Item cannot be stacked, requiring dedicated floor space. Storage premium applies.', 'boolean',
     true, false,
     25, 0, 0,
     'STORAGE', NULL, false,
     false, NULL, true,
     'layers', 'warning', 5),

    -- Service Requests
    (p_tenant_id, 'NEEDS_INSPECTION', 'Needs Inspection', 'Item requires quality inspection before storage or delivery.', 'boolean',
     true, true,
     0, 0, 0,
     'INSPECTION', 'inspection', false,
     false, NULL, false,
     'search', 'default', 10),

    (p_tenant_id, 'NEEDS_REPAIR', 'Needs Repair', 'Item has damage requiring repair service. A repair quote will be generated.', 'boolean',
     true, true,
     0, 0, 0,
     'REPAIR', 'repair', true,
     'wrench', 'destructive', 11),

    (p_tenant_id, 'NEEDS_ASSEMBLY', 'Needs Assembly', 'Item requires warehouse assembly before delivery.', 'boolean',
     true, true,
     0, 0, 0,
     'ASSEMBLY', 'assembly', false,
     'puzzle', 'default', 12),

    (p_tenant_id, 'NEEDS_TOUCHUP', 'Needs Touch-Up', 'Item requires minor cosmetic touch-up (scratches, scuffs).', 'boolean',
     true, false,
     0, 30, 45.00,
     'REPAIR', 'touchup', false,
     true, 'minor_touchup', true,
     'paintbrush', 'default', 13),

    -- Status Flags
    (p_tenant_id, 'HAS_DAMAGE', 'Has Damage', 'Item has documented damage. Photos should be attached.', 'boolean',
     true, false,
     0, 0, 0,
     'ALL', NULL, true,
     'alert-triangle', 'destructive', 20),

    (p_tenant_id, 'MISSING_PARTS', 'Missing Parts', 'Item is missing components. Parts list should be documented.', 'boolean',
     true, false,
     0, 0, 0,
     'ALL', NULL, true,
     'package-x', 'destructive', 21),

    (p_tenant_id, 'RECEIVED_WITHOUT_ID', 'Received Without ID', 'Item arrived without proper identification. ID assignment fee applies.', 'boolean',
     true, false,
     0, 5, 15.00,
     'RECEIVING', NULL, false,
     true, 'id_assignment', true,
     'file-question', 'warning', 22),

    -- Special Handling
    (p_tenant_id, 'HIGH_VALUE', 'High Value', 'Item has high declared value requiring enhanced security and handling procedures.', 'boolean',
     true, false,
     20, 0, 0,
     'ALL', NULL, false,
     false, NULL, true,
     'gem', 'default', 30),

    (p_tenant_id, 'CLIMATE_SENSITIVE', 'Climate Sensitive', 'Item requires climate-controlled storage environment.', 'boolean',
     true, true,
     50, 0, 0,
     'STORAGE', NULL, false,
     false, NULL, true,
     'thermometer', 'warning', 31),

    (p_tenant_id, 'HAZMAT', 'Hazardous Material', 'Item contains hazardous materials requiring special handling and documentation.', 'boolean',
     true, false,
     100, 30, 75.00,
     'ALL', NULL, true,
     'biohazard', 'destructive', 32),

    -- Workflow Triggers
    (p_tenant_id, 'HOLD_FOR_PICKUP', 'Hold for Pickup', 'Item is on hold waiting for customer pickup (will call).', 'boolean',
     true, false,
     0, 0, 0,
     'ALL', NULL, false,
     false, NULL, false,
     'hand', 'default', 40),

    (p_tenant_id, 'NOTIFY_ON_ARRIVAL', 'Notify on Arrival', 'Send notification when item arrives at destination.', 'boolean',
     true, true,
     0, 0, 0,
     'ALL', NULL, true,
     'bell', 'default', 41),

    (p_tenant_id, 'PRIORITY', 'Priority', 'Item requires priority handling and expedited processing.', 'boolean',
     true, false,
     25, 0, 0,
     'ALL', NULL, false,
     false, NULL, true,
     'zap', 'warning', 42)

  ON CONFLICT (tenant_id, flag_key) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    description = EXCLUDED.description,
    adds_percent = EXCLUDED.adds_percent,
    adds_minutes = EXCLUDED.adds_minutes,
    flat_fee = EXCLUDED.flat_fee,
    creates_billing_event = EXCLUDED.creates_billing_event,
    billing_charge_type = EXCLUDED.billing_charge_type,
    is_billable = EXCLUDED.is_billable,
    icon = EXCLUDED.icon,
    color = EXCLUDED.color;

  -- Update billable services with pricing modes and add new services
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

  -- Insert additional warehouse services
  INSERT INTO public.billable_services (tenant_id, code, name, description, base_rate, pricing_mode, charge_unit, is_active)
  VALUES
    (p_tenant_id, 'PALLETIZE', 'Palletizing', 'Palletize items for shipping or storage', 25.00, 'flat', 'per_pallet', true),
    (p_tenant_id, 'DEPALLETIZE', 'Depalletizing', 'Remove items from pallets', 20.00, 'flat', 'per_pallet', true),
    (p_tenant_id, 'SHRINKWRAP', 'Shrink Wrapping', 'Shrink wrap items for protection', 15.00, 'flat', 'per_item', true),
    (p_tenant_id, 'LABELING', 'Labeling/Relabeling', 'Apply or replace item labels', 5.00, 'flat', 'per_item', true),
    (p_tenant_id, 'PHOTO', 'Photography', 'Professional item photography for documentation', 10.00, 'flat', 'per_item', true),
    (p_tenant_id, 'CLIMATE', 'Climate-Controlled Storage', 'Premium climate-controlled storage', 2.00, 'flat', 'per_day', true),
    (p_tenant_id, 'KITTING', 'Kitting/Bundling', 'Combine multiple items into kits', 20.00, 'flat', 'per_kit', true),
    (p_tenant_id, 'RETURNS', 'Returns Processing', 'Process returned items', 25.00, 'flat', 'per_item', true),
    (p_tenant_id, 'QC', 'Quality Control Check', 'Detailed quality inspection', 35.00, 'per_size', 'per_item', true),
    (p_tenant_id, 'CUSTOM_PKG', 'Custom Packaging', 'Custom packaging service', 0, 'manual', 'per_item', true),
    (p_tenant_id, 'TOUCHUP', 'Minor Touch-Up', 'Minor cosmetic repairs and touch-ups', 45.00, 'flat', 'per_item', true),
    (p_tenant_id, 'CRATE_DISP', 'Crate Disposal', 'Dispose of shipping crates', 35.00, 'flat', 'per_crate', true)
  ON CONFLICT (tenant_id, code) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    base_rate = EXCLUDED.base_rate,
    pricing_mode = EXCLUDED.pricing_mode;

END;
$$;

COMMENT ON FUNCTION public.seed_default_pricing IS 'Populate comprehensive default pricing structure for a tenant including flags and services';
