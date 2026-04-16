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
  v_quarantined_count int;
BEGIN
  SELECT * INTO v_shipment FROM shipments WHERE id = p_shipment_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'blockers', jsonb_build_array(
        jsonb_build_object('code', 'SHIPMENT_NOT_FOUND', 'message', 'Shipment not found.', 'severity', 'blocking')
      )
    );
  END IF;

  SELECT COUNT(*) INTO v_quarantined_count
  FROM shipment_items outbound_si
  WHERE outbound_si.shipment_id = p_shipment_id
    AND outbound_si.item_id IS NOT NULL
    AND outbound_si.status != 'cancelled'
    AND (
      EXISTS (
        SELECT 1 FROM shipment_items inbound_si
        JOIN shipments inbound_s ON inbound_s.id = inbound_si.shipment_id
        WHERE inbound_si.item_id = outbound_si.item_id
          AND inbound_s.id != p_shipment_id
          AND inbound_s.shipment_exception_type IN ('MIS_SHIP', 'RETURN_TO_SENDER')
      )
      OR
      EXISTS (
        SELECT 1 FROM shipment_items inbound_si
        JOIN inventory_units iu ON iu.shipment_item_id = inbound_si.id
        WHERE inbound_si.item_id = outbound_si.item_id
          AND iu.status = 'QUARANTINE'
      )
    );

  IF v_quarantined_count > 0 THEN
    v_blockers := v_blockers || jsonb_build_array(
      jsonb_build_object(
        'code', 'OUTBOUND_BLOCKED_QUARANTINE',
        'message', 'Outbound cannot be completed while quarantined units are included.',
        'severity', 'blocking'
      )
    );
  END IF;

  IF COALESCE(v_shipment.customer_authorized, false) = false THEN
    v_blockers := v_blockers || jsonb_build_array(
      jsonb_build_object('code', 'NO_AUTHORIZATION', 'message', 'Customer authorization is required.', 'severity', 'blocking')
    );
  END IF;

  IF v_shipment.release_type IS NULL OR v_shipment.release_type = '' THEN
    v_blockers := v_blockers || jsonb_build_array(
      jsonb_build_object('code', 'NO_RELEASE_TYPE', 'message', 'Release type is required.', 'severity', 'blocking')
    );
  END IF;

  IF (v_shipment.released_to IS NULL OR v_shipment.released_to = '')
     AND (v_shipment.driver_name IS NULL OR v_shipment.driver_name = '') THEN
    v_blockers := v_blockers || jsonb_build_array(
      jsonb_build_object('code', 'NO_RELEASED_TO', 'message', 'Released To / Driver Name is required.', 'severity', 'blocking')
    );
  END IF;

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

  -- Use related_item_id (not item_id) on the tasks table
  SELECT COUNT(*) INTO v_unresolved_tasks
  FROM tasks t
  JOIN shipment_items si ON si.item_id = t.related_item_id
  WHERE si.shipment_id = p_shipment_id
    AND t.status NOT IN ('completed', 'cancelled', 'unable_to_complete')
    AND t.task_type IN ('inspection', 'repair', 'assembly');

  IF v_unresolved_tasks > 0 THEN
    v_blockers := v_blockers || jsonb_build_array(
      jsonb_build_object(
        'code', 'UNRESOLVED_TASKS',
        'message', format('%s blocking task(s) must be completed first.', v_unresolved_tasks),
        'severity', 'blocking'
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', jsonb_array_length(v_blockers) = 0,
    'blockers', v_blockers
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_shipment_outbound_completion(uuid) TO authenticated;