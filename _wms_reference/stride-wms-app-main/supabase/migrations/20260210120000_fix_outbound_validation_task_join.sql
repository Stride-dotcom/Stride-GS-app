-- Fix validate_shipment_outbound_completion: tasks table uses related_item_id
-- and task_items junction table, not item_id column.

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

  -- Check for unresolved blocking tasks linked to items on this shipment
  -- Tasks link to items via task_items junction table OR tasks.related_item_id
  SELECT COUNT(DISTINCT t.id) INTO v_unresolved_tasks
  FROM tasks t
  WHERE t.status NOT IN ('completed', 'cancelled', 'unable_to_complete')
    AND t.task_type IN ('inspection', 'repair', 'assembly')
    AND t.deleted_at IS NULL
    AND (
      -- Check task_items junction table
      EXISTS (
        SELECT 1 FROM task_items ti
        JOIN shipment_items si ON si.item_id = ti.item_id
        WHERE ti.task_id = t.id
          AND si.shipment_id = p_shipment_id
          AND si.status != 'cancelled'
      )
      OR
      -- Check related_item_id direct reference
      EXISTS (
        SELECT 1 FROM shipment_items si
        WHERE si.item_id = t.related_item_id
          AND si.shipment_id = p_shipment_id
          AND si.status != 'cancelled'
      )
    );

  IF v_unresolved_tasks > 0 THEN
    v_blockers := v_blockers || jsonb_build_array(
      jsonb_build_object(
        'code', 'UNRESOLVED_TASKS',
        'message', format('%s open task(s) (inspection/repair/assembly) are linked to items on this shipment. You can override and proceed with the release.', v_unresolved_tasks),
        'severity', 'warning'
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
