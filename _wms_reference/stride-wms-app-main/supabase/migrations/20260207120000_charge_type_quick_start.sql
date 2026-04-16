-- ============================================================================
-- Quick Start: Seed charge_types + pricing_rules for tenant onboarding
-- ============================================================================
-- Replaces the old service_events-based seeding with the new pricing model.
--
-- Core Defaults: Flat charge types (no classes, no prices)
-- Full Starter:  Core + classes + class-based charge types (still no prices)
-- ============================================================================

-- ============================================================================
-- 1. SEED CORE CHARGE TYPES (flat services, no classes, $0 rates)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.seed_core_charge_types(p_tenant_id UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_inserted INT := 0;
  v_ct_id UUID;
  v_rec RECORD;
BEGIN
  -- Define core flat charge types
  FOR v_rec IN
    SELECT * FROM (VALUES
      ('STRG_DAY',     'Storage Charge',      'storage',   'storage', 'qty',  false, false, false, 'per_day',  'Daily storage charge'),
      ('RCVG',         'Receiving',            'receiving', 'shipment','qty',  false, false, false, 'per_item', 'Receive and put away item'),
      ('INSP',         'Inspection',           'service',   'task',    'qty',  false, false, false, 'per_item', 'Inspect and document item condition'),
      ('ASSM',         'Assembly',             'task',      'task',    'both', false, false, false, 'per_item', 'Furniture assembly services'),
      ('REPAIR',       'Repair',               'task',      'task',    'both', false, false, false, 'per_item', 'Repair and restoration services'),
      ('KITTING',      'Kitting',              'service',   'manual',  'qty',  true,  true,  false, 'per_item', 'Consolidating multiple pieces'),
      ('RE_LABEL',     'Re-Label',             'service',   'manual',  'qty',  false, true,  false, 'per_item', 'Apply new labels on package'),
      ('WRAP',         'Shrink Wrapping',       'service',   'manual',  'qty',  false, true,  false, 'per_item', 'Shrink wrap item'),
      ('CLIMATE',      'Climate Control',       'service',   'manual',  'qty',  true,  false, false, 'per_item', 'Requires climate controlled storage'),
      ('CRATE_DISP',   'Crate Disposal',        'service',   'manual',  'qty',  true,  false, false, 'each',     'Crate disposal'),
      ('PALLET_DISP',  'Pallet Disposal',       'service',   'manual',  'qty',  true,  false, false, 'each',     'Pallet disposal'),
      ('TOUCH_UP',     'Minor Touch Up',        'service',   'manual',  'qty',  true,  true,  false, 'each',     'Minor cosmetic touch up'),
      ('WILL_CALL',    'Will Call',             'handling',  'manual',  'qty',  false, false, false, 'per_item', 'Prepare items for customer pickup'),
      ('DELIVERY',     'Delivery',             'shipping',  'manual',  'qty',  false, false, false, 'each',     'Outbound delivery'),
      ('RETURNS',      'Returns Processing',    'handling',  'shipment','qty',  false, false, false, 'per_item', 'Return shipment processing'),
      ('DISPOSAL',     'Disposal',             'service',   'task',    'qty',  false, false, false, 'per_item', 'Disposal or donation'),
      ('STOCKTAKE',    'Stocktake',            'service',   'manual',  'qty',  false, false, false, 'per_item', 'Per item scanned during stocktake'),
      ('QUARANTINE',   'Quarantine',           'service',   'manual',  'qty',  true,  false, true,  'each',     'Quarantine flagged items — indicator only, no charge')
    ) AS t(charge_code, charge_name, category, default_trigger, input_mode, add_flag, add_to_scan, flag_is_indicator, unit, notes)
  LOOP
    -- Skip if this charge_code already exists for the tenant
    IF EXISTS (
      SELECT 1 FROM public.charge_types
      WHERE tenant_id = p_tenant_id AND charge_code = v_rec.charge_code
    ) THEN
      CONTINUE;
    END IF;

    -- Insert the charge type
    INSERT INTO public.charge_types (
      tenant_id, charge_code, charge_name, category, default_trigger,
      input_mode, is_active, is_taxable, add_flag, add_to_scan,
      flag_is_indicator, notes
    ) VALUES (
      p_tenant_id, v_rec.charge_code, v_rec.charge_name, v_rec.category, v_rec.default_trigger,
      v_rec.input_mode, true, true, v_rec.add_flag, v_rec.add_to_scan,
      v_rec.flag_is_indicator, v_rec.notes
    )
    RETURNING id INTO v_ct_id;

    -- Create a single flat pricing rule ($0 rate — user sets their own prices)
    INSERT INTO public.pricing_rules (
      tenant_id, charge_type_id, pricing_method, class_code, unit, rate,
      is_default
    ) VALUES (
      p_tenant_id, v_ct_id, 'flat', NULL, v_rec.unit, 0,
      true
    );

    v_inserted := v_inserted + 1;
  END LOOP;

  RAISE NOTICE 'Seeded % core charge types for tenant %', v_inserted, p_tenant_id;
  RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION public.seed_core_charge_types IS 'Seed flat charge types with $0 rates. Users set their own prices. Idempotent.';
GRANT EXECUTE ON FUNCTION public.seed_core_charge_types(UUID) TO authenticated;


-- ============================================================================
-- 2. SEED STARTER CLASSES (3 service tiers)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.seed_starter_classes(p_tenant_id UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_inserted INT := 0;
BEGIN
  INSERT INTO public.classes (tenant_id, code, name, sort_order, is_active)
  SELECT * FROM (VALUES
    (p_tenant_id, 'STD', 'Standard', 1, true),
    (p_tenant_id, 'PRM', 'Premium',  2, true),
    (p_tenant_id, 'DLX', 'Deluxe',   3, true)
  ) AS v(tenant_id, code, name, sort_order, is_active)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.classes c
    WHERE c.tenant_id = v.tenant_id AND c.code = v.code
  );

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RAISE NOTICE 'Seeded % starter classes for tenant %', v_inserted, p_tenant_id;
  RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION public.seed_starter_classes IS 'Seed 3 service tier classes (Standard, Premium, Deluxe). Idempotent.';
GRANT EXECUTE ON FUNCTION public.seed_starter_classes(UUID) TO authenticated;


-- ============================================================================
-- 3. SEED STARTER CHARGE TYPES (adds class-based pricing rules)
-- ============================================================================
-- Adds class-based pricing rules (Standard/Premium/Deluxe, $0 rates) for
-- services that benefit from tier-based pricing.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.seed_starter_charge_types(p_tenant_id UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rules_added INT := 0;
  v_ct_id UUID;
  v_code TEXT;
  v_unit TEXT;
  v_class TEXT;
  v_class_services TEXT[][] := ARRAY[
    ARRAY['STRG_DAY',  'per_day'],
    ARRAY['RCVG',      'per_item'],
    ARRAY['INSP',      'per_item'],
    ARRAY['ASSM',      'per_item'],
    ARRAY['REPAIR',    'per_item'],
    ARRAY['WILL_CALL', 'per_item']
  ];
  v_classes TEXT[] := ARRAY['STD', 'PRM', 'DLX'];
BEGIN
  -- For each class-based service, add Standard/Premium/Deluxe pricing rules
  FOR i IN 1..array_length(v_class_services, 1)
  LOOP
    v_code := v_class_services[i][1];
    v_unit := v_class_services[i][2];

    -- Find the charge type
    SELECT id INTO v_ct_id
    FROM public.charge_types
    WHERE tenant_id = p_tenant_id AND charge_code = v_code
    LIMIT 1;

    IF v_ct_id IS NULL THEN
      CONTINUE;
    END IF;

    -- Add class-based rules for each tier
    FOREACH v_class IN ARRAY v_classes
    LOOP
      -- Skip if rule already exists
      IF EXISTS (
        SELECT 1 FROM public.pricing_rules
        WHERE charge_type_id = v_ct_id AND class_code = v_class
      ) THEN
        CONTINUE;
      END IF;

      INSERT INTO public.pricing_rules (
        tenant_id, charge_type_id, pricing_method, class_code, unit, rate,
        is_default
      ) VALUES (
        p_tenant_id, v_ct_id, 'class_based', v_class, v_unit, 0,
        false
      );

      v_rules_added := v_rules_added + 1;
    END LOOP;

    -- Update the charge type's flat rule to mark pricing method as class_based
    UPDATE public.pricing_rules
    SET pricing_method = 'class_based'
    WHERE charge_type_id = v_ct_id AND class_code IS NULL;
  END LOOP;

  RAISE NOTICE 'Added % class-based pricing rules for tenant %', v_rules_added, p_tenant_id;
  RETURN v_rules_added;
END;
$$;

COMMENT ON FUNCTION public.seed_starter_charge_types IS 'Add class-based pricing rules (Standard/Premium/Deluxe, $0) to core charge types. Idempotent.';
GRANT EXECUTE ON FUNCTION public.seed_starter_charge_types(UUID) TO authenticated;


-- ============================================================================
-- 3. UPDATE apply_core_defaults — add charge types, remove classes
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
  v_charge_types_before INT;
  v_charge_types_added INT;
  v_result jsonb;
BEGIN
  -- Count before
  SELECT COUNT(*) INTO v_categories_before FROM public.service_categories WHERE tenant_id = p_tenant_id;
  SELECT COUNT(*) INTO v_task_types_before FROM public.task_types WHERE tenant_id = p_tenant_id;
  SELECT COUNT(*) INTO v_charge_types_before FROM public.charge_types WHERE tenant_id = p_tenant_id;

  -- 1. Seed service categories
  PERFORM public.seed_service_categories(p_tenant_id, p_user_id);

  -- 2. Seed task types
  PERFORM public.seed_task_types(p_tenant_id, p_user_id);

  -- 3. Seed core charge types (flat, no classes)
  v_charge_types_added := public.seed_core_charge_types(p_tenant_id);

  -- Count after
  SELECT COUNT(*) INTO v_categories_after FROM public.service_categories WHERE tenant_id = p_tenant_id;
  SELECT COUNT(*) INTO v_task_types_after FROM public.task_types WHERE tenant_id = p_tenant_id;

  v_result := jsonb_build_object(
    'success', true,
    'tenant_id', p_tenant_id,
    'categories_added', v_categories_after - v_categories_before,
    'task_types_added', v_task_types_after - v_task_types_before,
    'classes_added', 0,
    'total_categories', v_categories_after,
    'total_task_types', v_task_types_after,
    'total_classes', 0,
    'services_added', v_charge_types_added,
    'total_services', v_charge_types_before + v_charge_types_added
  );

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.apply_core_defaults IS 'Apply core defaults (categories, task types, flat charge types) to a tenant. No classes or prices. Idempotent.';
GRANT EXECUTE ON FUNCTION public.apply_core_defaults(UUID, UUID) TO authenticated;


-- ============================================================================
-- 5. UPDATE apply_full_starter — adds classes + class-based charge types
-- ============================================================================

CREATE OR REPLACE FUNCTION public.apply_full_starter(p_tenant_id UUID, p_user_id UUID DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_core_result jsonb;
  v_classes_before INT;
  v_classes_after INT;
  v_rules_added INT;
  v_result jsonb;
BEGIN
  -- Count classes before
  SELECT COUNT(*) INTO v_classes_before FROM public.classes WHERE tenant_id = p_tenant_id;

  -- 1. Apply core defaults (categories, task types, flat charge types)
  v_core_result := public.apply_core_defaults(p_tenant_id, p_user_id);

  -- 2. Seed starter classes (Standard, Premium, Deluxe)
  PERFORM public.seed_starter_classes(p_tenant_id);

  -- 3. Add class-based pricing rules to relevant charge types
  v_rules_added := public.seed_starter_charge_types(p_tenant_id);

  -- Count classes after
  SELECT COUNT(*) INTO v_classes_after FROM public.classes WHERE tenant_id = p_tenant_id;

  -- Merge results
  v_result := v_core_result || jsonb_build_object(
    'classes_added', v_classes_after - v_classes_before,
    'total_classes', v_classes_after,
    'pricing_rules_added', v_rules_added
  );

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.apply_full_starter IS 'Apply full starter (core + 3 service tiers + class-based pricing rules) to a tenant. All rates are $0. Idempotent.';
GRANT EXECUTE ON FUNCTION public.apply_full_starter(UUID, UUID) TO authenticated;
