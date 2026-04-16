-- ============================================
-- SOP Validator RPCs for Shipments, Movements, and Stocktakes
-- ============================================

-- 1) validate_shipment_receiving_completion
CREATE OR REPLACE FUNCTION public.validate_shipment_receiving_completion(p_shipment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_blockers jsonb := '[]'::jsonb;
  v_shipment record;
  v_item_count int;
  v_items_without_location int;
  v_items_missing_photos int;
  v_photo_count int;
BEGIN
  -- Fetch shipment
  SELECT * INTO v_shipment FROM shipments WHERE id = p_shipment_id AND deleted_at IS NULL;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'blockers', jsonb_build_array(
        jsonb_build_object('code', 'SHIPMENT_NOT_FOUND', 'message', 'Shipment not found.', 'severity', 'blocking')
      )
    );
  END IF;
  
  -- Check for zero items
  SELECT COUNT(*) INTO v_item_count
  FROM shipment_items
  WHERE shipment_id = p_shipment_id;
  
  IF v_item_count = 0 THEN
    v_blockers := v_blockers || jsonb_build_array(
      jsonb_build_object('code', 'NO_ITEMS', 'message', 'Shipment has no items. Add at least one item before completing.', 'severity', 'blocking')
    );
  END IF;
  
  -- Check for items without location (items that have been created but not placed)
  SELECT COUNT(*) INTO v_items_without_location
  FROM shipment_items si
  JOIN items i ON i.id = si.item_id
  WHERE si.shipment_id = p_shipment_id
    AND si.item_id IS NOT NULL
    AND i.current_location_id IS NULL;
  
  IF v_items_without_location > 0 THEN
    v_blockers := v_blockers || jsonb_build_array(
      jsonb_build_object(
        'code', 'ITEMS_WITHOUT_LOCATION', 
        'message', format('%s item(s) have not been put away to a location.', v_items_without_location), 
        'severity', 'blocking'
      )
    );
  END IF;
  
  -- Check for receiving photos (at least 1 required at shipment level)
  v_photo_count := COALESCE(jsonb_array_length(v_shipment.receiving_photos), 0);
  
  IF v_photo_count = 0 THEN
    v_blockers := v_blockers || jsonb_build_array(
      jsonb_build_object('code', 'NO_RECEIVING_PHOTOS', 'message', 'At least one receiving photo is required.', 'severity', 'blocking')
    );
  END IF;
  
  -- Return result
  RETURN jsonb_build_object(
    'ok', jsonb_array_length(v_blockers) = 0,
    'blockers', v_blockers
  );
END;
$$;

-- 2) validate_shipment_outbound_completion
CREATE OR REPLACE FUNCTION public.validate_shipment_outbound_completion(p_shipment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_blockers jsonb := '[]'::jsonb;
  v_shipment record;
  v_items_not_at_dock int;
  v_unresolved_tasks int;
BEGIN
  -- Fetch shipment
  SELECT * INTO v_shipment FROM shipments WHERE id = p_shipment_id AND deleted_at IS NULL;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'blockers', jsonb_build_array(
        jsonb_build_object('code', 'SHIPMENT_NOT_FOUND', 'message', 'Shipment not found.', 'severity', 'blocking')
      )
    );
  END IF;
  
  -- Check customer authorization
  IF COALESCE(v_shipment.customer_authorized, false) = false THEN
    v_blockers := v_blockers || jsonb_build_array(
      jsonb_build_object(
        'code', 'NO_AUTHORIZATION', 
        'message', 'Customer authorization is required. The customer must submit the outbound request in the portal before you can complete the release.', 
        'severity', 'blocking'
      )
    );
  END IF;
  
  -- Check release_type
  IF v_shipment.release_type IS NULL OR v_shipment.release_type = '' THEN
    v_blockers := v_blockers || jsonb_build_array(
      jsonb_build_object('code', 'NO_RELEASE_TYPE', 'message', 'Release type is required.', 'severity', 'blocking')
    );
  END IF;
  
  -- Check released_to / driver_name
  IF (v_shipment.released_to IS NULL OR v_shipment.released_to = '') 
     AND (v_shipment.driver_name IS NULL OR v_shipment.driver_name = '') THEN
    v_blockers := v_blockers || jsonb_build_array(
      jsonb_build_object('code', 'NO_RELEASED_TO', 'message', 'Released To / Driver Name is required.', 'severity', 'blocking')
    );
  END IF;
  
  -- Check items not at dock/release location
  SELECT COUNT(*) INTO v_items_not_at_dock
  FROM shipment_items si
  JOIN items i ON i.id = si.item_id
  LEFT JOIN locations l ON l.id = i.current_location_id
  WHERE si.shipment_id = p_shipment_id
    AND si.item_id IS NOT NULL
    AND si.status != 'cancelled'
    AND (l.type IS NULL OR l.type NOT IN ('outbound_dock', 'release'));
  
  IF v_items_not_at_dock > 0 THEN
    v_blockers := v_blockers || jsonb_build_array(
      jsonb_build_object(
        'code', 'ITEMS_NOT_STAGED', 
        'message', format('%s item(s) are not staged at the outbound dock or release location.', v_items_not_at_dock), 
        'severity', 'blocking'
      )
    );
  END IF;
  
  -- Check for unresolved blocking tasks
  SELECT COUNT(*) INTO v_unresolved_tasks
  FROM tasks t
  JOIN shipment_items si ON si.item_id = t.item_id
  WHERE si.shipment_id = p_shipment_id
    AND t.status NOT IN ('completed', 'cancelled', 'unable_to_complete')
    AND t.task_type IN ('inspection', 'repair', 'assembly');
  
  IF v_unresolved_tasks > 0 THEN
    v_blockers := v_blockers || jsonb_build_array(
      jsonb_build_object(
        'code', 'UNRESOLVED_TASKS', 
        'message', format('%s blocking task(s) (inspection/repair/assembly) must be completed first.', v_unresolved_tasks), 
        'severity', 'blocking'
      )
    );
  END IF;
  
  -- Return result
  RETURN jsonb_build_object(
    'ok', jsonb_array_length(v_blockers) = 0,
    'blockers', v_blockers
  );
END;
$$;

-- 3) validate_movement_event
CREATE OR REPLACE FUNCTION public.validate_movement_event(p_item_ids uuid[], p_destination_location_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_blockers jsonb := '[]'::jsonb;
  v_invalid_items int;
  v_location_exists boolean;
BEGIN
  -- Check for empty item array
  IF p_item_ids IS NULL OR array_length(p_item_ids, 1) IS NULL OR array_length(p_item_ids, 1) = 0 THEN
    v_blockers := v_blockers || jsonb_build_array(
      jsonb_build_object('code', 'NO_ITEMS', 'message', 'At least one item must be scanned before moving.', 'severity', 'blocking')
    );
  END IF;
  
  -- Check for destination location
  IF p_destination_location_id IS NULL THEN
    v_blockers := v_blockers || jsonb_build_array(
      jsonb_build_object('code', 'NO_DESTINATION', 'message', 'Destination location must be scanned.', 'severity', 'blocking')
    );
  ELSE
    -- Verify location exists
    SELECT EXISTS(SELECT 1 FROM locations WHERE id = p_destination_location_id) INTO v_location_exists;
    IF NOT v_location_exists THEN
      v_blockers := v_blockers || jsonb_build_array(
        jsonb_build_object('code', 'INVALID_LOCATION', 'message', 'Destination location is invalid or does not exist.', 'severity', 'blocking')
      );
    END IF;
  END IF;
  
  -- Check for invalid/missing items
  IF p_item_ids IS NOT NULL AND array_length(p_item_ids, 1) > 0 THEN
    SELECT COUNT(*) INTO v_invalid_items
    FROM unnest(p_item_ids) AS item_id
    WHERE NOT EXISTS (SELECT 1 FROM items WHERE id = item_id AND deleted_at IS NULL);
    
    IF v_invalid_items > 0 THEN
      v_blockers := v_blockers || jsonb_build_array(
        jsonb_build_object(
          'code', 'INVALID_ITEMS', 
          'message', format('%s item(s) are invalid or have been deleted.', v_invalid_items), 
          'severity', 'blocking'
        )
      );
    END IF;
  END IF;
  
  -- Return result
  RETURN jsonb_build_object(
    'ok', jsonb_array_length(v_blockers) = 0,
    'blockers', v_blockers
  );
END;
$$;

-- 4) validate_stocktake_completion
CREATE OR REPLACE FUNCTION public.validate_stocktake_completion(p_stocktake_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_blockers jsonb := '[]'::jsonb;
  v_stocktake record;
  v_expected_count int;
  v_scanned_count int;
  v_unresolved_variances int;
BEGIN
  -- Fetch stocktake
  SELECT * INTO v_stocktake FROM stocktakes WHERE id = p_stocktake_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'blockers', jsonb_build_array(
        jsonb_build_object('code', 'STOCKTAKE_NOT_FOUND', 'message', 'Stocktake not found.', 'severity', 'blocking')
      )
    );
  END IF;
  
  -- Check status
  IF v_stocktake.status != 'active' THEN
    v_blockers := v_blockers || jsonb_build_array(
      jsonb_build_object('code', 'INVALID_STATUS', 'message', 'Only active stocktakes can be closed.', 'severity', 'blocking')
    );
  END IF;
  
  -- Get expected vs scanned counts
  v_expected_count := COALESCE(v_stocktake.expected_item_count, 0);
  v_scanned_count := COALESCE(v_stocktake.counted_item_count, 0);
  
  -- Check if any items have been scanned
  IF v_scanned_count = 0 AND v_expected_count > 0 THEN
    v_blockers := v_blockers || jsonb_build_array(
      jsonb_build_object('code', 'NO_SCANS', 'message', 'No items have been scanned. At least one scan is required.', 'severity', 'blocking')
    );
  END IF;
  
  -- Check for unresolved variances (if variance_count exists and is > 0)
  v_unresolved_variances := COALESCE(v_stocktake.variance_count, 0);
  
  IF v_unresolved_variances > 0 THEN
    -- This is a warning, not a blocker - variances should be reviewed but don't block closure
    v_blockers := v_blockers || jsonb_build_array(
      jsonb_build_object(
        'code', 'UNRESOLVED_VARIANCES', 
        'message', format('%s variance(s) detected. Review discrepancies before closing.', v_unresolved_variances), 
        'severity', 'warning'
      )
    );
  END IF;
  
  -- Check for location scope (if location-based stocktake)
  IF v_stocktake.location_ids IS NOT NULL AND jsonb_array_length(v_stocktake.location_ids) > 0 THEN
    -- Location-scoped stocktake is valid
    NULL;
  END IF;
  
  -- Return result (only blocking severity items prevent completion)
  RETURN jsonb_build_object(
    'ok', NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_blockers) AS b
      WHERE b->>'severity' = 'blocking' OR b->>'severity' IS NULL
    ),
    'blockers', v_blockers
  );
END;
$$;

-- Add customer_authorized fields to shipments if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'shipments' AND column_name = 'customer_authorized') THEN
    ALTER TABLE public.shipments ADD COLUMN customer_authorized boolean DEFAULT false;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'shipments' AND column_name = 'customer_authorized_at') THEN
    ALTER TABLE public.shipments ADD COLUMN customer_authorized_at timestamptz;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'shipments' AND column_name = 'customer_authorized_by') THEN
    ALTER TABLE public.shipments ADD COLUMN customer_authorized_by uuid;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'shipments' AND column_name = 'released_to') THEN
    ALTER TABLE public.shipments ADD COLUMN released_to text;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'shipments' AND column_name = 'driver_name') THEN
    ALTER TABLE public.shipments ADD COLUMN driver_name text;
  END IF;
END $$;