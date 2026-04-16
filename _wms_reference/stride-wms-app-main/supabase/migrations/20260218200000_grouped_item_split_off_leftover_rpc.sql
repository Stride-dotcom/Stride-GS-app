-- ============================================================================
-- RPC: Grouped item split (split-off-leftover model)
-- ============================================================================
-- Implements the "split-off-leftover" workflow:
--  - A grouped parent item (quantity > 1) stays on the job.
--  - The job's requested quantity becomes the NEW parent quantity (keep_qty).
--  - The leftover quantity is split into new child item labels (qty=1 each).
--  - Child item_codes are generated as: PARENT-1, PARENT-2, ... (monotonic; never reused).
--  - Child items default to the warehouse's default receiving location, unless overridden.
--
-- Two functions:
--  - rpc_preview_grouped_item_split_off_leftover: returns the exact next codes for preview
--  - rpc_apply_grouped_item_split_off_leftover: performs the atomic split + returns created ids/codes
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Preview RPC (read-only)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_preview_grouped_item_split_off_leftover(
  p_parent_item_id UUID,
  p_leftover_qty   INTEGER
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_parent RECORD;
  v_grouped_qty INTEGER;
  v_max_suffix INTEGER;
  v_start_suffix INTEGER;
  v_codes TEXT[] := ARRAY[]::TEXT[];
  v_escaped_parent TEXT;
  i INTEGER;
BEGIN
  v_tenant_id := public.user_tenant_id();

  SELECT id, tenant_id, item_code, quantity
  INTO v_parent
  FROM public.items
  WHERE id = p_parent_item_id
    AND tenant_id = v_tenant_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TENANT_MISMATCH: Item not found or not owned by tenant';
  END IF;

  v_grouped_qty := COALESCE(v_parent.quantity, 1);
  IF v_grouped_qty <= 1 THEN
    RAISE EXCEPTION 'INVALID_STATE: Item is not grouped (quantity <= 1)';
  END IF;

  IF p_leftover_qty IS NULL OR p_leftover_qty < 1 OR p_leftover_qty > (v_grouped_qty - 1) THEN
    RAISE EXCEPTION 'INVALID_QTY: leftover_qty must be between 1 and quantity-1';
  END IF;

  -- Escape regex metacharacters in parent item_code (best-effort)
  v_escaped_parent := regexp_replace(v_parent.item_code, '([\\.^$|?*+()\\[\\]{}])', '\\\\\1', 'g');

  SELECT COALESCE(MAX((regexp_match(item_code, '^' || v_escaped_parent || '-(\\d+)$'))[1]::int), 0)
  INTO v_max_suffix
  FROM public.items
  WHERE tenant_id = v_tenant_id
    AND item_code ~ ('^' || v_escaped_parent || '-[0-9]+$');

  v_start_suffix := v_max_suffix + 1;

  FOR i IN 0..(p_leftover_qty - 1) LOOP
    v_codes := array_append(v_codes, v_parent.item_code || '-' || (v_start_suffix + i)::text);
  END LOOP;

  RETURN json_build_object(
    'parent_item_id', v_parent.id,
    'parent_item_code', v_parent.item_code,
    'grouped_qty', v_grouped_qty,
    'leftover_qty', p_leftover_qty,
    'keep_qty', (v_grouped_qty - p_leftover_qty),
    'start_suffix', v_start_suffix,
    'child_item_codes', v_codes
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 2) Apply RPC (atomic write)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_apply_grouped_item_split_off_leftover(
  p_parent_item_id        UUID,
  p_leftover_qty          INTEGER,
  p_target_location_id    UUID DEFAULT NULL,
  p_expected_start_suffix INTEGER DEFAULT NULL,
  p_split_task_id         UUID DEFAULT NULL
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
  i INTEGER;
  v_new_id UUID;
BEGIN
  v_tenant_id := public.user_tenant_id();
  v_user_id := auth.uid();

  -- Lock parent row for the duration of the split
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

  v_grouped_qty := COALESCE(v_parent.quantity, 1);
  IF v_grouped_qty <= 1 THEN
    RAISE EXCEPTION 'INVALID_STATE: Item is not grouped (quantity <= 1)';
  END IF;

  IF p_leftover_qty IS NULL OR p_leftover_qty < 1 OR p_leftover_qty > (v_grouped_qty - 1) THEN
    RAISE EXCEPTION 'INVALID_QTY: leftover_qty must be between 1 and quantity-1';
  END IF;

  v_keep_qty := v_grouped_qty - p_leftover_qty;

  -- Resolve target location:
  -- - If provided, validate it
  -- - Else use warehouse default_receiving_location_id
  IF p_target_location_id IS NOT NULL THEN
    SELECT id INTO v_target_location
    FROM public.locations
    WHERE id = p_target_location_id
      AND tenant_id = v_tenant_id
      AND deleted_at IS NULL;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'INVALID_LOCATION: Target location not found or not owned by tenant';
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
      AND tenant_id = v_tenant_id
      AND deleted_at IS NULL;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'INVALID_LOCATION: Default receiving location not found or not owned by tenant';
    END IF;
  END IF;

  -- Determine next suffix range (monotonic; never reused)
  v_escaped_parent := regexp_replace(v_parent.item_code, '([\\.^$|?*+()\\[\\]{}])', '\\\\\1', 'g');

  SELECT COALESCE(MAX((regexp_match(item_code, '^' || v_escaped_parent || '-(\\d+)$'))[1]::int), 0)
  INTO v_max_suffix
  FROM public.items
  WHERE tenant_id = v_tenant_id
    AND item_code ~ ('^' || v_escaped_parent || '-[0-9]+$');

  v_start_suffix := v_max_suffix + 1;

  IF p_expected_start_suffix IS NOT NULL AND p_expected_start_suffix <> v_start_suffix THEN
    RAISE EXCEPTION 'PREVIEW_MISMATCH: Child codes changed since preview. Please preview again.';
  END IF;

  -- Create child items (qty=1)
  FOR i IN 0..(p_leftover_qty - 1) LOOP
    v_new_id := gen_random_uuid();
    v_codes := array_append(v_codes, v_parent.item_code || '-' || (v_start_suffix + i)::text);
    v_child_ids := array_append(v_child_ids, v_new_id);

    INSERT INTO public.items (
      id,
      tenant_id,
      warehouse_id,
      account_id,
      client_account,
      item_code,
      quantity,
      status,
      description,
      vendor,
      sku,
      size,
      size_unit,
      sidemark,
      sidemark_id,
      room,
      class_id,
      condition,
      declared_value,
      coverage_type,
      coverage_rate,
      coverage_deductible,
      receiving_shipment_id,
      received_at,
      received_date,
      current_location_id,
      location_id,
      metadata,
      created_at,
      updated_at
    ) VALUES (
      v_new_id,
      v_tenant_id,
      v_parent.warehouse_id,
      v_parent.account_id,
      v_parent.client_account,
      v_parent.item_code || '-' || (v_start_suffix + i)::text,
      1,
      'stored',
      v_parent.description,
      v_parent.vendor,
      v_parent.sku,
      v_parent.size,
      v_parent.size_unit,
      v_parent.sidemark,
      v_parent.sidemark_id,
      v_parent.room,
      v_parent.class_id,
      v_parent.condition,
      v_parent.declared_value,
      v_parent.coverage_type,
      v_parent.coverage_rate,
      v_parent.coverage_deductible,
      v_parent.receiving_shipment_id,
      v_parent.received_at,
      v_parent.received_date,
      v_target_location,
      v_target_location,
      COALESCE(v_parent.metadata, '{}'::jsonb) || jsonb_build_object(
        'split_parent_item_id', v_parent.id,
        'split_parent_item_code', v_parent.item_code,
        'split_task_id', p_split_task_id,
        'split_created_by', v_user_id,
        'split_created_at', now()
      ),
      now(),
      now()
    );
  END LOOP;

  -- Update parent quantity (keep_qty)
  UPDATE public.items
  SET quantity = v_keep_qty,
      updated_at = now()
  WHERE id = v_parent.id
    AND tenant_id = v_tenant_id;

  RETURN json_build_object(
    'parent_item_id', v_parent.id,
    'parent_item_code', v_parent.item_code,
    'previous_grouped_qty', v_grouped_qty,
    'keep_qty', v_keep_qty,
    'leftover_qty', p_leftover_qty,
    'target_location_id', v_target_location,
    'start_suffix', v_start_suffix,
    'child_item_ids', v_child_ids,
    'child_item_codes', v_codes
  );
END;
$$;

-- Permissions: allow authenticated users to execute (relies on user_tenant_id() tenant check)
GRANT EXECUTE ON FUNCTION public.rpc_preview_grouped_item_split_off_leftover(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_apply_grouped_item_split_off_leftover(UUID, INTEGER, UUID, INTEGER, UUID) TO authenticated;

