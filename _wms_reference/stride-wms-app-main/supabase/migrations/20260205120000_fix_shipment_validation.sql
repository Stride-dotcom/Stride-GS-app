-- Fix shipment validation RPCs to use shipments.id (no shipment_id column)

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
