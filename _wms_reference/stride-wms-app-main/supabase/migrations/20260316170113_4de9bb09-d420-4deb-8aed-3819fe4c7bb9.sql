CREATE OR REPLACE FUNCTION public.rpc_apply_grouped_item_split_off_leftover(
  p_parent_item_id UUID,
  p_leftover_qty INTEGER,
  p_target_location_id UUID DEFAULT NULL,
  p_expected_start_suffix INTEGER DEFAULT NULL,
  p_split_task_id UUID DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_user_id UUID;
  v_parent RECORD;
  v_grouped_qty INTEGER;
  v_keep_qty INTEGER;
  v_target_location UUID;
  v_default_receiving_location_id UUID;
  v_max_suffix INTEGER;
  v_start_suffix INTEGER;
  v_codes TEXT[] := ARRAY[]::TEXT[];
  v_child_ids UUID[] := ARRAY[]::UUID[];
  v_escaped_parent TEXT;
  v_existing_child_count INTEGER := 0;
  v_existing_wrong_parent_count INTEGER := 0;
  v_split_task RECORD;
  i INTEGER;
  v_new_id UUID;
BEGIN
  v_tenant_id := public.user_tenant_id();
  v_user_id := auth.uid();

  SELECT *
  INTO v_parent
  FROM public.items
  WHERE id = p_parent_item_id
    AND tenant_id = v_tenant_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TENANT_MISMATCH: Item not found or not owned by tenant';
  END IF;

  IF p_split_task_id IS NOT NULL THEN
    SELECT id, tenant_id, task_type, status
    INTO v_split_task
    FROM public.tasks
    WHERE id = p_split_task_id
      AND tenant_id = v_tenant_id
      AND deleted_at IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'INVALID_SPLIT_TASK: Split task not found for tenant';
    END IF;

    IF v_split_task.task_type <> 'Split' THEN
      RAISE EXCEPTION 'INVALID_SPLIT_TASK: Task is not type Split';
    END IF;

    SELECT
      COUNT(*)::int,
      COUNT(*) FILTER (
        WHERE COALESCE(i.metadata->>'split_parent_item_id', '') <> p_parent_item_id::text
      )::int,
      COALESCE(array_agg(i.id ORDER BY i.item_code), ARRAY[]::UUID[]),
      COALESCE(array_agg(i.item_code ORDER BY i.item_code), ARRAY[]::TEXT[])
    INTO
      v_existing_child_count,
      v_existing_wrong_parent_count,
      v_child_ids,
      v_codes
    FROM public.items i
    WHERE i.tenant_id = v_tenant_id
      AND i.deleted_at IS NULL
      AND i.metadata @> jsonb_build_object('split_task_id', p_split_task_id);

    IF v_existing_wrong_parent_count > 0 THEN
      RAISE EXCEPTION 'VERIFY_FAIL: Existing split children for split_task_id belong to a different parent item';
    END IF;

    IF v_existing_child_count > 0 THEN
      RETURN json_build_object(
        'ok', true,
        'already_applied', true,
        'parent_item_id', p_parent_item_id,
        'parent_item_code', v_parent.item_code,
        'parent_new_qty', COALESCE(v_parent.quantity, 1),
        'keep_qty', COALESCE(v_parent.quantity, 1),
        'leftover_qty', v_existing_child_count,
        'child_item_ids', v_child_ids,
        'child_item_codes', v_codes,
        'child_ids', v_child_ids,
        'child_codes', v_codes,
        'target_location_id', v_parent.current_location_id,
        'start_suffix', NULL
      );
    END IF;
  END IF;

  v_grouped_qty := COALESCE(v_parent.quantity, 1);
  IF v_grouped_qty <= 1 THEN
    RAISE EXCEPTION 'INVALID_STATE: Item is not grouped (quantity <= 1)';
  END IF;

  IF p_leftover_qty IS NULL OR p_leftover_qty < 1 OR p_leftover_qty > (v_grouped_qty - 1) THEN
    RAISE EXCEPTION 'INVALID_QTY: leftover_qty must be between 1 and quantity-1';
  END IF;

  v_keep_qty := v_grouped_qty - p_leftover_qty;

  IF p_target_location_id IS NOT NULL THEN
    SELECT id INTO v_target_location
    FROM public.locations
    WHERE id = p_target_location_id
      AND warehouse_id = v_parent.warehouse_id
      AND deleted_at IS NULL;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'INVALID_LOCATION: Target location not found or not in the same warehouse';
    END IF;
  ELSE
    SELECT default_receiving_location_id
    INTO v_default_receiving_location_id
    FROM public.warehouses
    WHERE id = v_parent.warehouse_id
      AND tenant_id = v_tenant_id
      AND deleted_at IS NULL;

    IF v_default_receiving_location_id IS NULL THEN
      RAISE EXCEPTION 'MISSING_DEFAULT_RECEIVING_LOCATION: Warehouse has no default receiving location configured';
    END IF;

    SELECT id INTO v_target_location
    FROM public.locations
    WHERE id = v_default_receiving_location_id
      AND warehouse_id = v_parent.warehouse_id
      AND deleted_at IS NULL;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'INVALID_LOCATION: Default receiving location not found';
    END IF;
  END IF;

  v_escaped_parent := regexp_replace(v_parent.item_code, '([\.^$|?*+()\[\]{}])', '\\\1', 'g');

  SELECT COALESCE(MAX((regexp_match(item_code, '^' || v_escaped_parent || '-(\d+)$'))[1]::int), 0)
  INTO v_max_suffix
  FROM public.items
  WHERE tenant_id = v_tenant_id
    AND item_code ~ ('^' || v_escaped_parent || '-[0-9]+$');

  v_start_suffix := v_max_suffix + 1;

  IF p_expected_start_suffix IS NOT NULL AND p_expected_start_suffix <> v_start_suffix THEN
    RAISE EXCEPTION 'PREVIEW_MISMATCH: Child codes changed since preview. Please preview again.';
  END IF;

  FOR i IN 0..(p_leftover_qty - 1) LOOP
    v_new_id := gen_random_uuid();
    v_codes := array_append(v_codes, v_parent.item_code || '-' || (v_start_suffix + i)::text);
    v_child_ids := array_append(v_child_ids, v_new_id);

    INSERT INTO public.items (
      id, tenant_id, account_id, item_code, description,
      item_type_id, warehouse_id, current_location_id,
      status, condition, quantity,
      width, height, depth, weight, cubic_feet,
      sidemark_id, room, class_id,
      created_at, updated_at,
      parent_item_id, split_source_item_id,
      receiving_shipment_id, receiving_shipment_item_id,
      metadata
    )
    VALUES (
      v_new_id, v_tenant_id, v_parent.account_id,
      v_parent.item_code || '-' || (v_start_suffix + i)::text,
      v_parent.description,
      v_parent.item_type_id, v_parent.warehouse_id, v_target_location,
      v_parent.status, v_parent.condition, 1,
      v_parent.width, v_parent.height, v_parent.depth, v_parent.weight, v_parent.cubic_feet,
      v_parent.sidemark_id, v_parent.room, v_parent.class_id,
      now(), now(),
      p_parent_item_id, p_parent_item_id,
      v_parent.receiving_shipment_id, v_parent.receiving_shipment_item_id,
      COALESCE(v_parent.metadata, '{}'::jsonb) || jsonb_build_object(
        'split_parent_item_id', p_parent_item_id,
        'split_parent_item_code', v_parent.item_code,
        'split_task_id', p_split_task_id,
        'split_created_by', v_user_id,
        'split_created_at', now()
      )
    );

    INSERT INTO public.movements (
      id, tenant_id, item_id, movement_type,
      from_location_id, to_location_id,
      performed_by, notes, created_at
    )
    VALUES (
      gen_random_uuid(), v_tenant_id, v_new_id, 'split_off',
      v_parent.current_location_id, v_target_location,
      v_user_id,
      'Split off from parent ' || v_parent.item_code || ' (qty ' || v_grouped_qty || ' → kept ' || v_keep_qty || ')',
      now()
    );
  END LOOP;

  UPDATE public.items
  SET quantity = v_keep_qty,
      updated_at = now()
  WHERE id = p_parent_item_id
    AND tenant_id = v_tenant_id;

  INSERT INTO public.movements (
    id, tenant_id, item_id, movement_type,
    from_location_id, to_location_id,
    performed_by, notes, created_at
  )
  VALUES (
    gen_random_uuid(), v_tenant_id, p_parent_item_id, 'split_reduce',
    v_parent.current_location_id, v_parent.current_location_id,
    v_user_id,
    'Parent quantity reduced from ' || v_grouped_qty || ' to ' || v_keep_qty || '; split off ' || p_leftover_qty || ' children',
    now()
  );

  RETURN json_build_object(
    'ok', true,
    'already_applied', false,
    'parent_item_id', p_parent_item_id,
    'parent_item_code', v_parent.item_code,
    'parent_new_qty', v_keep_qty,
    'keep_qty', v_keep_qty,
    'leftover_qty', p_leftover_qty,
    'child_item_ids', v_child_ids,
    'child_item_codes', v_codes,
    'child_ids', v_child_ids,
    'child_codes', v_codes,
    'target_location_id', v_target_location,
    'start_suffix', v_start_suffix
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_apply_grouped_item_split_off_leftover(UUID, INTEGER, UUID, INTEGER, UUID) TO authenticated;