-- Service Categories Phase 1: Schema + RLS + Seed + Backfill
-- This migration adds service categories for organizing the price list
-- Categories are UI/reporting metadata ONLY - they do NOT affect billing calculations
-- ============================================================================

-- ============================================================================
-- 1. CREATE SERVICE_CATEGORIES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.service_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER DEFAULT 0,
  is_system BOOLEAN DEFAULT false,  -- System defaults seeded per tenant
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES public.users(id),
  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by UUID REFERENCES public.users(id),

  -- Unique constraint for tenant + name (case insensitive)
  CONSTRAINT service_categories_tenant_name_unique UNIQUE (tenant_id, name)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_service_categories_tenant ON public.service_categories(tenant_id);
CREATE INDEX IF NOT EXISTS idx_service_categories_active ON public.service_categories(tenant_id, is_active)
  WHERE is_active = true;

-- Comments
COMMENT ON TABLE public.service_categories IS 'Tenant-scoped categories for organizing services in Price List. Categories are UI metadata only and do NOT affect billing calculations.';
COMMENT ON COLUMN public.service_categories.is_system IS 'System categories seeded per tenant. Cannot be deleted if in use.';

-- ============================================================================
-- 2. ADD CATEGORY_ID TO SERVICE_EVENTS (PRICE LIST)
-- ============================================================================

ALTER TABLE public.service_events
ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES public.service_categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_service_events_category ON public.service_events(tenant_id, category_id);

COMMENT ON COLUMN public.service_events.category_id IS 'Optional category for organizing services. Does NOT affect billing calculations.';

-- ============================================================================
-- 3. EXTEND TASK_TYPES TABLE FOR TASK TYPE DEFINITIONS
-- ============================================================================

-- Add category_id to task_types if not exists
ALTER TABLE public.task_types
ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES public.service_categories(id) ON DELETE SET NULL;

-- Add default_service_code for billing
ALTER TABLE public.task_types
ADD COLUMN IF NOT EXISTS default_service_code TEXT;

-- Add requires_items flag
ALTER TABLE public.task_types
ADD COLUMN IF NOT EXISTS requires_items BOOLEAN DEFAULT true;

-- Add allow_rate_override flag (admin only)
ALTER TABLE public.task_types
ADD COLUMN IF NOT EXISTS allow_rate_override BOOLEAN DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_task_types_category ON public.task_types(tenant_id, category_id);

COMMENT ON COLUMN public.task_types.category_id IS 'Service category for this task type';
COMMENT ON COLUMN public.task_types.default_service_code IS 'Default service_code from service_events for billing';
COMMENT ON COLUMN public.task_types.requires_items IS 'If true, task must have items attached before billing. If false, account-level task.';
COMMENT ON COLUMN public.task_types.allow_rate_override IS 'If true, admins can override the rate for this task type';

-- ============================================================================
-- 4. RLS POLICIES FOR SERVICE_CATEGORIES
-- ============================================================================

ALTER TABLE public.service_categories ENABLE ROW LEVEL SECURITY;

-- SELECT: Users can view categories in their tenant
DROP POLICY IF EXISTS "service_categories_tenant_select" ON public.service_categories;
CREATE POLICY "service_categories_tenant_select" ON public.service_categories
  FOR SELECT USING (tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

-- INSERT: Only tenant_admin or manager can insert
DROP POLICY IF EXISTS "service_categories_tenant_insert" ON public.service_categories;
CREATE POLICY "service_categories_tenant_insert" ON public.service_categories
  FOR INSERT WITH CHECK (
    tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('tenant_admin', 'manager', 'admin')
      AND ur.deleted_at IS NULL
    )
  );

-- UPDATE: Only tenant_admin or manager can update
DROP POLICY IF EXISTS "service_categories_tenant_update" ON public.service_categories;
CREATE POLICY "service_categories_tenant_update" ON public.service_categories
  FOR UPDATE USING (
    tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('tenant_admin', 'manager', 'admin')
      AND ur.deleted_at IS NULL
    )
  );

-- DELETE: Only tenant_admin can delete (with restrictions on system categories)
DROP POLICY IF EXISTS "service_categories_tenant_delete" ON public.service_categories;
CREATE POLICY "service_categories_tenant_delete" ON public.service_categories
  FOR DELETE USING (
    tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('tenant_admin', 'admin')
      AND ur.deleted_at IS NULL
    )
  );

-- Grant permissions
GRANT ALL ON public.service_categories TO authenticated;

-- ============================================================================
-- 5. UPDATED_AT TRIGGER FOR SERVICE_CATEGORIES
-- ============================================================================

DROP TRIGGER IF EXISTS set_service_categories_updated_at ON public.service_categories;
CREATE TRIGGER set_service_categories_updated_at
  BEFORE UPDATE ON public.service_categories
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 6. FUNCTION TO SEED SERVICE CATEGORIES FOR A TENANT
-- ============================================================================

CREATE OR REPLACE FUNCTION public.seed_service_categories(p_tenant_id UUID, p_created_by UUID DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Insert system categories (is_system = true)
  -- These are the standard categories for organizing services
  INSERT INTO public.service_categories (tenant_id, name, description, sort_order, is_system, is_active, created_by)
  VALUES
    (p_tenant_id, 'Receiving', 'Services related to receiving and processing incoming shipments', 1, true, true, p_created_by),
    (p_tenant_id, 'Inspection', 'Inspection, condition assessment, and documentation services', 2, true, true, p_created_by),
    (p_tenant_id, 'Assembly', 'Assembly, installation, and setup services', 3, true, true, p_created_by),
    (p_tenant_id, 'Repair', 'Repair, restoration, and touch-up services', 4, true, true, p_created_by),
    (p_tenant_id, 'Delivery', 'Delivery, outbound, and will-call services', 5, true, true, p_created_by),
    (p_tenant_id, 'Storage', 'Storage and warehousing services', 6, true, true, p_created_by),
    (p_tenant_id, 'Disposal / Haul-away', 'Disposal, donation, and haul-away services', 7, true, true, p_created_by),
    (p_tenant_id, 'Admin / Misc', 'Administrative, handling, and miscellaneous services', 8, true, true, p_created_by)
  ON CONFLICT (tenant_id, name) DO NOTHING;
END;
$$;

COMMENT ON FUNCTION public.seed_service_categories IS 'Seed standard service categories for a tenant. Safe to run multiple times.';
GRANT EXECUTE ON FUNCTION public.seed_service_categories(UUID, UUID) TO authenticated;

-- ============================================================================
-- 7. FUNCTION TO BACKFILL CATEGORY_ID ON SERVICE_EVENTS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.backfill_service_events_categories(p_tenant_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_receiving_id UUID;
  v_inspection_id UUID;
  v_assembly_id UUID;
  v_repair_id UUID;
  v_delivery_id UUID;
  v_storage_id UUID;
  v_disposal_id UUID;
  v_admin_id UUID;
BEGIN
  -- Get category IDs for this tenant
  SELECT id INTO v_receiving_id FROM public.service_categories WHERE tenant_id = p_tenant_id AND name = 'Receiving';
  SELECT id INTO v_inspection_id FROM public.service_categories WHERE tenant_id = p_tenant_id AND name = 'Inspection';
  SELECT id INTO v_assembly_id FROM public.service_categories WHERE tenant_id = p_tenant_id AND name = 'Assembly';
  SELECT id INTO v_repair_id FROM public.service_categories WHERE tenant_id = p_tenant_id AND name = 'Repair';
  SELECT id INTO v_delivery_id FROM public.service_categories WHERE tenant_id = p_tenant_id AND name = 'Delivery';
  SELECT id INTO v_storage_id FROM public.service_categories WHERE tenant_id = p_tenant_id AND name = 'Storage';
  SELECT id INTO v_disposal_id FROM public.service_categories WHERE tenant_id = p_tenant_id AND name = 'Disposal / Haul-away';
  SELECT id INTO v_admin_id FROM public.service_categories WHERE tenant_id = p_tenant_id AND name = 'Admin / Misc';

  -- Exit if categories not seeded
  IF v_admin_id IS NULL THEN
    RAISE NOTICE 'Categories not seeded for tenant %. Run seed_service_categories first.', p_tenant_id;
    RETURN;
  END IF;

  -- Backfill category_id based on service_code heuristics
  -- Note: These heuristics are conservative and default to Admin / Misc if uncertain

  -- Receiving services
  UPDATE public.service_events
  SET category_id = v_receiving_id
  WHERE tenant_id = p_tenant_id
    AND category_id IS NULL
    AND (
      service_code IN ('RCVG', 'Returns')
      OR UPPER(service_code) LIKE '%RCVG%'
      OR UPPER(service_code) LIKE '%RECV%'
      OR UPPER(service_name) LIKE '%RECEIVING%'
      OR UPPER(service_name) LIKE '%RETURN%'
    );

  -- Inspection services
  UPDATE public.service_events
  SET category_id = v_inspection_id
  WHERE tenant_id = p_tenant_id
    AND category_id IS NULL
    AND (
      service_code IN ('INSP', 'Multi_Insp', 'STOCKTAKE')
      OR UPPER(service_code) LIKE '%INSP%'
      OR UPPER(service_name) LIKE '%INSPECTION%'
      OR UPPER(service_name) LIKE '%STOCKTAKE%'
      OR UPPER(service_code) LIKE '%SIT_TEST%'
      OR UPPER(service_name) LIKE '%SIT TEST%'
    );

  -- Assembly services
  UPDATE public.service_events
  SET category_id = v_assembly_id
  WHERE tenant_id = p_tenant_id
    AND category_id IS NULL
    AND (
      UPPER(service_code) LIKE '%MA'  -- 5MA, 15MA, 30MA, etc.
      OR UPPER(service_code) LIKE '%ASSM%'
      OR UPPER(service_code) LIKE '%ASSEMB%'
      OR UPPER(service_name) LIKE '%ASSEMBLY%'
      OR service_code = 'QR_ASSM'
      OR UPPER(service_code) LIKE 'KITTING%'
      OR UPPER(service_name) LIKE '%KITTING%'
    );

  -- Repair services
  UPDATE public.service_events
  SET category_id = v_repair_id
  WHERE tenant_id = p_tenant_id
    AND category_id IS NULL
    AND (
      UPPER(service_code) LIKE '%HRO'  -- 1HRO, 2HRO, etc.
      OR UPPER(service_code) LIKE '%RPR%'
      OR UPPER(service_code) LIKE '%REPAIR%'
      OR UPPER(service_name) LIKE '%REPAIR%'
      OR service_code = 'QR_REPAIR'
      OR UPPER(service_code) LIKE '%TOUCH%UP%'
      OR UPPER(service_name) LIKE '%TOUCH UP%'
      OR service_code = 'Minor_Touch_Up'
    );

  -- Delivery / Outbound services
  UPDATE public.service_events
  SET category_id = v_delivery_id
  WHERE tenant_id = p_tenant_id
    AND category_id IS NULL
    AND (
      UPPER(service_code) LIKE '%DEL%'
      OR UPPER(service_code) LIKE '%WILL_CALL%'
      OR UPPER(service_code) LIKE '%POD%'
      OR UPPER(service_name) LIKE '%DELIVERY%'
      OR UPPER(service_name) LIKE '%WILL CALL%'
      OR UPPER(service_name) LIKE '%OUTBOUND%'
      OR UPPER(service_code) LIKE '%PULL_PREP%'
      OR UPPER(service_name) LIKE '%PULL PREP%'
    );

  -- Storage services
  UPDATE public.service_events
  SET category_id = v_storage_id
  WHERE tenant_id = p_tenant_id
    AND category_id IS NULL
    AND (
      billing_unit = 'Day'
      OR UPPER(service_code) LIKE '%STORAGE%'
      OR UPPER(service_code) LIKE '%STRG%'
      OR UPPER(service_name) LIKE '%STORAGE%'
      OR UPPER(service_code) LIKE '%CLIMATE%'
      OR UPPER(service_name) LIKE '%CLIMATE%'
    );

  -- Disposal / Haul-away services
  UPDATE public.service_events
  SET category_id = v_disposal_id
  WHERE tenant_id = p_tenant_id
    AND category_id IS NULL
    AND (
      UPPER(service_code) LIKE '%DISP%'
      OR UPPER(service_code) LIKE '%HAUL%'
      OR UPPER(service_name) LIKE '%DISPOSAL%'
      OR UPPER(service_name) LIKE '%DONATION%'
      OR UPPER(service_name) LIKE '%HAUL%'
      OR service_code = 'Disposal'
      OR service_code = 'Crate_Disposal'
      OR service_code = 'Pallet_Disposal'
    );

  -- Everything else goes to Admin / Misc
  UPDATE public.service_events
  SET category_id = v_admin_id
  WHERE tenant_id = p_tenant_id
    AND category_id IS NULL;

  RAISE NOTICE 'Backfilled categories for tenant %', p_tenant_id;
END;
$$;

COMMENT ON FUNCTION public.backfill_service_events_categories IS 'Backfill category_id on service_events based on service_code heuristics. Safe to run multiple times.';
GRANT EXECUTE ON FUNCTION public.backfill_service_events_categories(UUID) TO authenticated;

-- ============================================================================
-- 8. SEED CATEGORIES FOR ALL EXISTING TENANTS AND BACKFILL SERVICE_EVENTS
-- ============================================================================

DO $$
DECLARE
  tenant_record RECORD;
BEGIN
  -- Loop through all tenants that have service_events
  FOR tenant_record IN
    SELECT DISTINCT tenant_id
    FROM public.service_events
    WHERE tenant_id IS NOT NULL
  LOOP
    -- Seed categories for this tenant
    PERFORM public.seed_service_categories(tenant_record.tenant_id, NULL);

    -- Backfill service_events category_id
    PERFORM public.backfill_service_events_categories(tenant_record.tenant_id);
  END LOOP;

  -- Also seed categories for any tenants that exist but don't have service_events yet
  FOR tenant_record IN
    SELECT id as tenant_id
    FROM public.tenants
    WHERE id NOT IN (SELECT DISTINCT tenant_id FROM public.service_categories WHERE tenant_id IS NOT NULL)
  LOOP
    PERFORM public.seed_service_categories(tenant_record.tenant_id, NULL);
  END LOOP;

  RAISE NOTICE 'Completed seeding categories and backfilling service_events for all tenants';
END;
$$;

-- ============================================================================
-- 9. UPDATE SEED_SERVICE_EVENTS FUNCTION TO INCLUDE CATEGORIES
-- ============================================================================

-- We need to update the existing seed_service_events function to assign category_id
-- This ensures new tenants get categorized services from the start

CREATE OR REPLACE FUNCTION public.seed_service_events_with_categories(p_tenant_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- First ensure categories exist
  PERFORM public.seed_service_categories(p_tenant_id, NULL);

  -- Then seed service events (existing function)
  PERFORM public.seed_service_events(p_tenant_id);

  -- Finally backfill categories
  PERFORM public.backfill_service_events_categories(p_tenant_id);
END;
$$;

COMMENT ON FUNCTION public.seed_service_events_with_categories IS 'Seed service events with categories for a new tenant. Calls seed_service_categories, seed_service_events, and backfill_service_events_categories.';
GRANT EXECUTE ON FUNCTION public.seed_service_events_with_categories(UUID) TO authenticated;

-- ============================================================================
-- DONE - Phase 1 Complete
-- ============================================================================

-- Summary of changes:
-- 1. Created service_categories table with tenant isolation
-- 2. Added category_id to service_events (nullable, does NOT affect billing)
-- 3. Extended task_types with category_id, default_service_code, requires_items, allow_rate_override
-- 4. Added RLS policies for service_categories (tenant isolation + admin write access)
-- 5. Created seed_service_categories function to seed standard categories
-- 6. Created backfill_service_events_categories function to assign categories based on heuristics
-- 7. Seeded categories and backfilled for all existing tenants
-- 8. Created seed_service_events_with_categories for new tenant setup

-- IMPORTANT: Categories are UI/reporting metadata ONLY
-- They do NOT change billing calculations, rate lookups, or any billing behavior
-- All existing billing logic remains unchanged
