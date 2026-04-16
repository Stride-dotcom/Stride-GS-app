-- ============================================================================
-- Tenant Templates: Safe, Idempotent Functions for Tenant Onboarding
-- ============================================================================
-- This migration provides admin-only functions to apply default configurations
-- to tenants. All functions are idempotent (safe to run multiple times).
--
-- Two template packs:
-- 1. apply_core_defaults - Categories + Task Types + Classes (no price list)
-- 2. apply_full_starter - Core defaults + Starter Price List
--
-- SAFETY: These functions NEVER overwrite existing customizations.
-- ============================================================================

-- ============================================================================
-- 1. SEED TASK TYPES FUNCTION (Idempotent)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.seed_task_types(p_tenant_id UUID, p_created_by UUID DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_inspection_cat_id UUID;
  v_receiving_cat_id UUID;
  v_assembly_cat_id UUID;
  v_repair_cat_id UUID;
  v_delivery_cat_id UUID;
  v_disposal_cat_id UUID;
BEGIN
  -- Get category IDs for this tenant (may be NULL if categories not seeded)
  SELECT id INTO v_inspection_cat_id FROM public.service_categories
    WHERE tenant_id = p_tenant_id AND name = 'Inspection' LIMIT 1;
  SELECT id INTO v_receiving_cat_id FROM public.service_categories
    WHERE tenant_id = p_tenant_id AND name = 'Receiving' LIMIT 1;
  SELECT id INTO v_assembly_cat_id FROM public.service_categories
    WHERE tenant_id = p_tenant_id AND name = 'Assembly' LIMIT 1;
  SELECT id INTO v_repair_cat_id FROM public.service_categories
    WHERE tenant_id = p_tenant_id AND name = 'Repair' LIMIT 1;
  SELECT id INTO v_delivery_cat_id FROM public.service_categories
    WHERE tenant_id = p_tenant_id AND name = 'Delivery' LIMIT 1;
  SELECT id INTO v_disposal_cat_id FROM public.service_categories
    WHERE tenant_id = p_tenant_id AND name = 'Disposal / Haul-away' LIMIT 1;

  -- Insert system task types (is_system = true)
  -- Uses ON CONFLICT DO NOTHING to be idempotent
  INSERT INTO public.task_types (
    tenant_id, name, description, is_system, is_active, color, icon, sort_order,
    category_id, default_service_code, requires_items, allow_rate_override
  ) VALUES
    (p_tenant_id, 'Inspection', 'Inspect and document item condition', true, true, '#3b82f6', 'Search', 1,
     v_inspection_cat_id, 'INSP', true, true),
    (p_tenant_id, 'Receiving', 'Process incoming shipments', true, true, '#22c55e', 'Package', 2,
     v_receiving_cat_id, 'RCVG', true, false),
    (p_tenant_id, 'Will Call', 'Prepare items for customer pickup', true, true, '#f59e0b', 'Truck', 3,
     v_delivery_cat_id, 'Will_Call', true, true),
    (p_tenant_id, 'Disposal', 'Item disposal and removal', true, true, '#ef4444', 'Trash2', 4,
     v_disposal_cat_id, 'Disposal', true, true),
    (p_tenant_id, 'Assembly', 'Furniture assembly services', true, true, '#8b5cf6', 'Wrench', 5,
     v_assembly_cat_id, NULL, true, true),
    (p_tenant_id, 'Repair', 'Repair and restoration services', true, true, '#ec4899', 'Tool', 6,
     v_repair_cat_id, NULL, true, true)
  ON CONFLICT (tenant_id, name) DO NOTHING;

  RAISE NOTICE 'Seeded task types for tenant %', p_tenant_id;
END;
$$;

COMMENT ON FUNCTION public.seed_task_types IS 'Seed standard task types for a tenant. Safe to run multiple times - never overwrites existing types.';
GRANT EXECUTE ON FUNCTION public.seed_task_types(UUID, UUID) TO authenticated;

-- ============================================================================
-- 2. APPLY CORE DEFAULTS FUNCTION
-- ============================================================================
-- Applies:
-- - 8 system service_categories (if missing)
-- - 6 system task_types (if missing)
-- - 6 default classes (XS, S, M, L, XL, XXL)
-- Does NOT include price list (service_events)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.apply_core_defaults(p_tenant_id UUID, p_user_id UUID DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_categories_before INT;
  v_categories_after INT;
  v_task_types_before INT;
  v_task_types_after INT;
  v_classes_before INT;
  v_classes_after INT;
  v_result jsonb;
BEGIN
  -- Count existing records before
  SELECT COUNT(*) INTO v_categories_before FROM public.service_categories WHERE tenant_id = p_tenant_id;
  SELECT COUNT(*) INTO v_task_types_before FROM public.task_types WHERE tenant_id = p_tenant_id;
  SELECT COUNT(*) INTO v_classes_before FROM public.classes WHERE tenant_id = p_tenant_id;

  -- 1. Seed service categories (8 system categories)
  PERFORM public.seed_service_categories(p_tenant_id, p_user_id);

  -- 2. Seed task types (6 system types)
  PERFORM public.seed_task_types(p_tenant_id, p_user_id);

  -- 3. Seed default classes (6 size classes)
  PERFORM public.seed_default_classes(p_tenant_id);

  -- Count after
  SELECT COUNT(*) INTO v_categories_after FROM public.service_categories WHERE tenant_id = p_tenant_id;
  SELECT COUNT(*) INTO v_task_types_after FROM public.task_types WHERE tenant_id = p_tenant_id;
  SELECT COUNT(*) INTO v_classes_after FROM public.classes WHERE tenant_id = p_tenant_id;

  -- Build result summary
  v_result := jsonb_build_object(
    'success', true,
    'tenant_id', p_tenant_id,
    'categories_added', v_categories_after - v_categories_before,
    'task_types_added', v_task_types_after - v_task_types_before,
    'classes_added', v_classes_after - v_classes_before,
    'total_categories', v_categories_after,
    'total_task_types', v_task_types_after,
    'total_classes', v_classes_after
  );

  RAISE NOTICE 'Applied core defaults for tenant %: % categories, % task types, % classes added',
    p_tenant_id,
    v_categories_after - v_categories_before,
    v_task_types_after - v_task_types_before,
    v_classes_after - v_classes_before;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.apply_core_defaults IS 'Apply core defaults (categories, task types, classes) to a tenant. Safe to run multiple times - never overwrites existing data.';
GRANT EXECUTE ON FUNCTION public.apply_core_defaults(UUID, UUID) TO authenticated;

-- ============================================================================
-- 3. SEED STARTER SERVICE EVENTS (Idempotent version)
-- ============================================================================
-- Unlike seed_service_events which DELETEs first, this function only INSERTs
-- records that don't already exist (based on service_code + class_code).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.seed_starter_service_events(p_tenant_id UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_inserted INT := 0;
BEGIN
  -- Insert starter service events, skipping any that already exist
  -- Uses a temp table approach to count inserts

  WITH inserted AS (
    INSERT INTO public.service_events (
      tenant_id, class_code, service_code, service_name, billing_unit,
      service_time_minutes, rate, taxable, uses_class_pricing, is_active,
      notes, add_flag, add_to_service_event_scan, alert_rule, billing_trigger
    )
    SELECT * FROM (VALUES
      -- Short Term Storage (by class) - AUTOCALCULATE
      (p_tenant_id, 'XS', 'Short_Storage', 'Short Term Storage', 'Day', NULL::INT, 0.5, true, false, true, 'Short Term Storage', false, false, 'none', 'AUTOCALCULATE'),
      (p_tenant_id, 'S', 'Short_Storage', 'Short Term Storage', 'Day', NULL, 1.5, true, false, true, 'Short Term Storage', false, false, 'none', 'AUTOCALCULATE'),
      (p_tenant_id, 'M', 'Short_Storage', 'Short Term Storage', 'Day', NULL, 4.5, true, false, true, 'Short Term Storage', false, false, 'none', 'AUTOCALCULATE'),
      (p_tenant_id, 'L', 'Short_Storage', 'Short Term Storage', 'Day', NULL, 7.5, true, false, true, 'Short Term Storage', false, false, 'none', 'AUTOCALCULATE'),
      (p_tenant_id, 'XL', 'Short_Storage', 'Short Term Storage', 'Day', NULL, 10, true, false, true, 'Short Term Storage', false, false, 'none', 'AUTOCALCULATE'),
      (p_tenant_id, 'XXL', 'Short_Storage', 'Short Term Storage', 'Day', NULL, 15, true, false, true, 'Short Term Storage', false, false, 'none', 'AUTOCALCULATE'),

      -- Climate Control - Flag
      (p_tenant_id, NULL, 'Climate_Control', 'Climate Control', 'Item', NULL, 25, true, false, true, 'Requires Climate Control', true, false, 'email_office', 'Flag'),

      -- Crate Disposal - Flag
      (p_tenant_id, NULL, 'Crate_Disposal', 'Crate Disposal', 'Item', NULL, 100, true, false, true, 'Crate Disposal', true, false, 'none', 'Flag'),

      -- Kitting - Flag
      (p_tenant_id, NULL, 'KITTING', 'Kitting', 'Item', NULL, 15, true, false, true, 'Consolidating Multiple Pieces to One', true, true, 'none', 'Flag'),

      -- Minor Touch Up - Flag
      (p_tenant_id, NULL, 'Minor_Touch_Up', 'Minor Touch Up', 'Item', NULL, 25, true, false, true, 'Minor Touch Up', true, true, 'none', 'Flag'),

      -- Multi Part Inspection - Flag
      (p_tenant_id, NULL, 'Multi_Insp', 'Multi Part Inspection', 'Item', NULL, 20, true, true, true, 'Multiple Parts Added to Base Inspection', true, true, 'none', 'Flag'),

      -- Pallet Disposal - Flag
      (p_tenant_id, NULL, 'Pallet_Disposal', 'Pallet Disposal', 'Item', NULL, 10, true, false, true, 'Pallet Disposal', true, false, 'none', 'Flag'),

      -- Storage Charge (by class) - Per Item Auto Calculated
      (p_tenant_id, 'XS', 'STRG_DAY', 'Storage Charge', 'Day', NULL, 0.2, true, false, true, 'Storage charges', false, false, 'none', 'Per Item Auto Calculated'),
      (p_tenant_id, 'S', 'STRG_DAY', 'Storage Charge', 'Day', NULL, 0.6, true, false, true, 'Storage charges', false, false, 'none', 'Per Item Auto Calculated'),
      (p_tenant_id, 'M', 'STRG_DAY', 'Storage Charge', 'Day', NULL, 1.8, true, false, true, 'Storage charges', false, false, 'none', 'Per Item Auto Calculated'),
      (p_tenant_id, 'L', 'STRG_DAY', 'Storage Charge', 'Day', NULL, 3, true, false, true, 'Storage charges', false, false, 'none', 'Per Item Auto Calculated'),
      (p_tenant_id, 'XL', 'STRG_DAY', 'Storage Charge', 'Day', NULL, 4, true, false, true, 'Storage charges', false, false, 'none', 'Per Item Auto Calculated'),
      (p_tenant_id, 'XXL', 'STRG_DAY', 'Storage Charge', 'Day', NULL, 6, true, false, true, 'Storage charges', false, false, 'none', 'Per Item Auto Calculated'),

      -- Palletize - SCAN EVENT
      (p_tenant_id, NULL, 'Palletize_Lrg', 'Palletize Large', 'Item', NULL, 80, true, false, true, 'Provide pallet and attach goods', false, true, 'none', 'SCAN EVENT'),
      (p_tenant_id, NULL, 'Palletize_Std', 'Palletize Standard', 'Item', NULL, 40, true, false, true, 'Provide pallet and attach goods', false, true, 'none', 'SCAN EVENT'),

      -- Pull Prep (by class) - SCAN EVENT
      (p_tenant_id, 'XS', 'Pull_Prep', 'Pull Prep Load', 'Item', 5, 2, true, false, true, 'Pull Item, Prepare and Load', false, true, 'none', 'SCAN EVENT'),
      (p_tenant_id, 'S', 'Pull_Prep', 'Pull Prep Load', 'Item', 5, 3, true, false, true, 'Pull Item, Prepare and Load', false, true, 'none', 'SCAN EVENT'),
      (p_tenant_id, 'M', 'Pull_Prep', 'Pull Prep Load', 'Item', 5, 5, true, false, true, 'Pull Item, Prepare and Load', false, true, 'none', 'SCAN EVENT'),
      (p_tenant_id, 'L', 'Pull_Prep', 'Pull Prep Load', 'Item', 5, 7, true, false, true, 'Pull Item, Prepare and Load', false, true, 'none', 'SCAN EVENT'),
      (p_tenant_id, 'XL', 'Pull_Prep', 'Pull Prep Load', 'Item', 7, 9, true, false, true, 'Pull Item, Prepare and Load', false, true, 'none', 'SCAN EVENT'),
      (p_tenant_id, 'XXL', 'Pull_Prep', 'Pull Prep Load', 'Item', 9, 12, true, false, true, 'Pull Item, Prepare and Load', false, true, 'none', 'SCAN EVENT'),

      -- Re-Label - SCAN EVENT
      (p_tenant_id, NULL, 'Re_Label', 'Re-Label', 'Item', NULL, 6, true, false, true, 'Apply new labels on package', false, true, 'none', 'SCAN EVENT'),

      -- Restock - SCAN EVENT
      (p_tenant_id, NULL, 'Restock_Std', 'Restock', 'Item', NULL, 35, true, true, true, 'Restock Item', false, true, 'none', 'SCAN EVENT'),
      (p_tenant_id, NULL, 'Restock_Lrg', 'Restock', 'Item', NULL, 50, true, true, true, 'Restock Item', false, true, 'none', 'SCAN EVENT'),

      -- Wrap - SCAN EVENT
      (p_tenant_id, NULL, 'Wrap', 'Shrink Wrapping', 'Item', NULL, 15, true, true, true, 'Shrink wrap added', false, true, 'none', 'SCAN EVENT'),

      -- Sit Test (by class) - SCAN EVENT
      (p_tenant_id, 'XS', 'Sit_test', 'Sit Test', 'Item', 5, 2, true, false, true, 'Sit Test or Viewing', false, true, 'none', 'SCAN EVENT'),
      (p_tenant_id, 'S', 'Sit_test', 'Sit Test', 'Item', 5, 3, true, false, true, 'Sit Test or Viewing', false, true, 'none', 'SCAN EVENT'),
      (p_tenant_id, 'M', 'Sit_test', 'Sit Test', 'Item', 5, 5, true, false, true, 'Sit Test or Viewing', false, true, 'none', 'SCAN EVENT'),
      (p_tenant_id, 'L', 'Sit_test', 'Sit Test', 'Item', 5, 7, true, false, true, 'Sit Test or Viewing', false, true, 'none', 'SCAN EVENT'),
      (p_tenant_id, 'XL', 'Sit_test', 'Sit Test', 'Item', 7, 9, true, false, true, 'Sit Test or Viewing', false, true, 'none', 'SCAN EVENT'),
      (p_tenant_id, 'XXL', 'Sit_test', 'Sit Test', 'Item', 9, 12, true, false, true, 'Sit Test or Viewing', true, true, 'none', 'SCAN EVENT'),

      -- Receiving (by class) - Shipment
      (p_tenant_id, 'XS', 'RCVG', 'Receiving', 'Item', 5, 10, true, false, true, 'Receive and put away Item', false, false, 'none', 'Shipment'),
      (p_tenant_id, 'S', 'RCVG', 'Receiving', 'Item', 5, 10, true, false, true, 'Receive and put away Item', false, false, 'none', 'Shipment'),
      (p_tenant_id, 'M', 'RCVG', 'Receiving', 'Item', 5, 15, true, false, true, 'Receive and put away Item', false, false, 'none', 'Shipment'),
      (p_tenant_id, 'L', 'RCVG', 'Receiving', 'Item', 5, 15, true, false, true, 'Receive and put away Item', false, false, 'none', 'Shipment'),
      (p_tenant_id, 'XL', 'RCVG', 'Receiving', 'Item', 7, 20, true, false, true, 'Receive and put away Item', false, false, 'none', 'Shipment'),
      (p_tenant_id, 'XXL', 'RCVG', 'Receiving', 'Item', 9, 25, true, false, true, 'Receive and put away Item', false, false, 'none', 'Shipment'),

      -- Returns Processing (by class) - Shipment
      (p_tenant_id, 'XS', 'Returns', 'Returns Processing', 'Item', 5, 10, true, false, true, 'Return Shipment Processing', false, false, 'none', 'Shipment'),
      (p_tenant_id, 'S', 'Returns', 'Returns Processing', 'Item', 5, 10, true, false, true, 'Return Shipment Processing', false, false, 'none', 'Shipment'),
      (p_tenant_id, 'M', 'Returns', 'Returns Processing', 'Item', 5, 13, true, false, true, 'Return Shipment Processing', false, false, 'none', 'Shipment'),
      (p_tenant_id, 'L', 'Returns', 'Returns Processing', 'Item', 5, 15, true, false, true, 'Return Shipment Processing', false, false, 'none', 'Shipment'),
      (p_tenant_id, 'XL', 'Returns', 'Returns Processing', 'Item', 7, 20, true, false, true, 'Return Shipment Processing', false, false, 'none', 'Shipment'),
      (p_tenant_id, 'XXL', 'Returns', 'Returns Processing', 'Item', 9, 25, true, false, true, 'Return Shipment Processing', false, false, 'none', 'Shipment'),

      -- Stocktake - Stocktake
      (p_tenant_id, NULL, 'STOCKTAKE', 'Stocktake', 'Item', NULL, 2, true, false, true, 'Flat per item scanned.', false, false, 'none', 'Stocktake'),

      -- Disposal (by class) - TASK
      (p_tenant_id, 'XS', 'Disposal', 'Disposal', 'Item', 7, 10, true, false, true, 'Disposal Or Donation', false, false, 'none', 'TASK'),
      (p_tenant_id, 'S', 'Disposal', 'Disposal', 'Item', 7, 25, true, false, true, 'Disposal Or Donation', false, false, 'none', 'TASK'),
      (p_tenant_id, 'M', 'Disposal', 'Disposal', 'Item', 9, 50, true, false, true, 'Disposal Or Donation', false, false, 'none', 'TASK'),
      (p_tenant_id, 'L', 'Disposal', 'Disposal', 'Item', 10, 100, true, false, true, 'Disposal Or Donation', false, false, 'none', 'TASK'),
      (p_tenant_id, 'XL', 'Disposal', 'Disposal', 'Item', 14, 185, true, false, true, 'Disposal Or Donation', false, false, 'none', 'TASK'),
      (p_tenant_id, 'XXL', 'Disposal', 'Disposal', 'Item', 20, 250, true, false, true, 'Disposal Or Donation', false, false, 'none', 'TASK'),

      -- Assembly Services - Task - Assign Rate
      (p_tenant_id, NULL, '5MA', '<15 Minute Assembly', 'Task', NULL, 25, true, false, true, 'Assembly', false, false, 'none', 'Task - Assign Rate'),
      (p_tenant_id, NULL, '1HRO', '1 Hr Repair', 'Task', NULL, 105, true, false, true, 'Repair', false, false, 'none', 'Task - Assign Rate'),
      (p_tenant_id, NULL, '1.5HRO', '1.5 Hr Repair', 'Task', NULL, 212.5, true, false, true, 'Repair', false, false, 'none', 'Task - Assign Rate'),
      (p_tenant_id, NULL, '120MA', '120 Minute Assembly', 'Task', NULL, 245, true, false, true, 'Assembly', false, false, 'none', 'Task - Assign Rate'),
      (p_tenant_id, NULL, '15MA', '15 Minute Assembly', 'Task', NULL, 35, true, false, true, 'Assembly', false, false, 'none', 'Task - Assign Rate'),
      (p_tenant_id, NULL, '2HRO', '2 Hr Repair', 'Task', NULL, 110, true, false, true, 'Repair', false, false, 'none', 'Task - Assign Rate'),
      (p_tenant_id, NULL, '2.5HRO', '2.5 Hr Repair', 'Task', NULL, 387.5, true, false, true, 'Repair', false, false, 'none', 'Task - Assign Rate'),
      (p_tenant_id, NULL, '3HRO', '3 Hr Repair', 'Task', NULL, 465, true, false, true, 'Repair', false, false, 'none', 'Task - Assign Rate'),
      (p_tenant_id, NULL, '30MA', '30 Minute Assembly', 'Task', NULL, 75, true, false, true, 'Assembly', false, false, 'none', 'Task - Assign Rate'),
      (p_tenant_id, NULL, '45MA', '45 Minute Assembly', 'Task', NULL, 105, true, false, true, 'Assembly', false, false, 'none', 'Task - Assign Rate'),
      (p_tenant_id, NULL, '60MA', '60 Minute Assembly', 'Task', NULL, 140, true, false, true, 'Assembly', false, false, 'none', 'Task - Assign Rate'),
      (p_tenant_id, NULL, '75MA', '75 Minute Assembly', 'Task', NULL, 175, true, false, true, 'Assembly', false, false, 'none', 'Task - Assign Rate'),
      (p_tenant_id, NULL, '90MA', '90 Minute Assembly', 'Task', NULL, 210, true, false, true, 'Assembly', false, false, 'none', 'Task - Assign Rate'),

      -- Quote Required Services - Task - Assign Rate
      (p_tenant_id, NULL, 'QR_REPAIR', 'Mgr Quote Req Repair', 'Task', NULL, 0, true, false, true, 'Manager Quote Required Repair', false, false, 'none', 'Task - Assign Rate'),
      (p_tenant_id, NULL, 'QR_ASSM', 'Mgr Quote Req Assembly', 'Task', NULL, 0, true, false, true, 'Manager Quote Required Assembly', false, false, 'email_office', 'Task - Assign Rate'),

      -- Inspection (by class) - Through Task
      (p_tenant_id, 'XS', 'INSP', 'Inspection', 'Task', 7, 15, true, false, true, 'Inspection and pack for storage', false, false, 'email_office', 'Through Task'),
      (p_tenant_id, 'S', 'INSP', 'Inspection', 'Task', 7, 25, true, false, true, 'Inspection and pack for storage', false, false, 'none', 'Through Task'),
      (p_tenant_id, 'M', 'INSP', 'Inspection', 'Task', 9, 35, true, false, true, 'Inspection and pack for storage', false, false, 'none', 'Through Task'),
      (p_tenant_id, 'L', 'INSP', 'Inspection', 'Task', 10, 55, true, false, true, 'Inspection and pack for storage', false, false, 'none', 'Through Task'),
      (p_tenant_id, 'XL', 'INSP', 'Inspection', 'Task', 14, 65, true, false, true, 'Inspection and pack for storage', false, false, 'none', 'Through Task'),
      (p_tenant_id, 'XXL', 'INSP', 'Inspection', 'Task', 20, 75, true, false, true, 'Inspection and pack for storage', false, false, 'none', 'Through Task'),

      -- Will Call (by class) - Through Task
      (p_tenant_id, 'XS', 'Will_Call', 'Will Call', 'Task', 5, 10, true, false, true, 'Will Call / Outbound Shipment', false, false, 'none', 'Through Task'),
      (p_tenant_id, 'S', 'Will_Call', 'Will Call', 'Task', 5, 10, true, false, true, 'Will Call / Outbound Shipment', false, false, 'none', 'Through Task'),
      (p_tenant_id, 'M', 'Will_Call', 'Will Call', 'Task', 5, 15, true, false, true, 'Will Call / Outbound Shipment', false, false, 'none', 'Through Task'),
      (p_tenant_id, 'L', 'Will_Call', 'Will Call', 'Task', 5, 15, true, false, true, 'Will Call / Outbound Shipment', false, false, 'none', 'Through Task'),
      (p_tenant_id, 'XL', 'Will_Call', 'Will Call', 'Task', 7, 20, true, false, true, 'Will Call / Outbound Shipment', false, false, 'none', 'Through Task'),
      (p_tenant_id, 'XXL', 'Will_Call', 'Will Call', 'Task', 9, 25, true, false, true, 'Will Call / Outbound Shipment', false, false, 'none', 'Through Task')
    ) AS v(tenant_id, class_code, service_code, service_name, billing_unit, service_time_minutes, rate, taxable, uses_class_pricing, is_active, notes, add_flag, add_to_service_event_scan, alert_rule, billing_trigger)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.service_events se
      WHERE se.tenant_id = v.tenant_id
      AND se.service_code = v.service_code
      AND (se.class_code = v.class_code OR (se.class_code IS NULL AND v.class_code IS NULL))
    )
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_inserted FROM inserted;

  -- Backfill categories for the new service_events
  PERFORM public.backfill_service_events_categories(p_tenant_id);

  RAISE NOTICE 'Inserted % starter service events for tenant %', v_inserted, p_tenant_id;
  RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION public.seed_starter_service_events IS 'Seed starter price list for a tenant. Safe to run multiple times - only inserts missing records.';
GRANT EXECUTE ON FUNCTION public.seed_starter_service_events(UUID) TO authenticated;

-- ============================================================================
-- 4. APPLY FULL STARTER FUNCTION
-- ============================================================================
-- Applies:
-- - All core defaults (categories, task types, classes)
-- - Full starter price list (service_events)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.apply_full_starter(p_tenant_id UUID, p_user_id UUID DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_core_result jsonb;
  v_services_before INT;
  v_services_added INT;
  v_result jsonb;
BEGIN
  -- Count existing service_events before
  SELECT COUNT(*) INTO v_services_before FROM public.service_events WHERE tenant_id = p_tenant_id;

  -- 1. Apply core defaults first
  v_core_result := public.apply_core_defaults(p_tenant_id, p_user_id);

  -- 2. Seed starter service events (price list)
  v_services_added := public.seed_starter_service_events(p_tenant_id);

  -- Build combined result
  v_result := v_core_result || jsonb_build_object(
    'services_added', v_services_added,
    'total_services', v_services_before + v_services_added
  );

  RAISE NOTICE 'Applied full starter for tenant %: % services added',
    p_tenant_id, v_services_added;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.apply_full_starter IS 'Apply full starter template (categories, task types, classes, price list) to a tenant. Safe to run multiple times - never overwrites existing data.';
GRANT EXECUTE ON FUNCTION public.apply_full_starter(UUID, UUID) TO authenticated;

-- ============================================================================
-- 5. SUMMARY
-- ============================================================================
-- This migration provides:
--
-- seed_task_types(tenant_id, user_id) - Seed 6 system task types
-- apply_core_defaults(tenant_id, user_id) - Categories + Task Types + Classes
-- seed_starter_service_events(tenant_id) - Idempotent price list seeding
-- apply_full_starter(tenant_id, user_id) - Core defaults + Price list
--
-- All functions are:
-- - Idempotent (safe to run multiple times)
-- - Non-destructive (never overwrites existing customizations)
-- - Multi-tenant safe (scoped by tenant_id)
-- - Return useful summary information
-- ============================================================================
