-- Fix validate_shipment_outbound_completion: use correct column name (related_item_id, not item_id)
CREATE OR REPLACE FUNCTION public.validate_shipment_outbound_completion(p_shipment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shipment RECORD;
  v_blockers jsonb := '[]'::jsonb;
  v_item_count int;
  v_unstaged_count int;
  v_unresolved_task_count int;
BEGIN
  -- Get shipment
  SELECT * INTO v_shipment FROM shipments WHERE id = p_shipment_id;
  
  IF v_shipment IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'blockers', jsonb_build_array(
        jsonb_build_object('code', 'NOT_FOUND', 'message', 'Shipment not found.', 'severity', 'blocking')
      )
    );
  END IF;
  
  -- Check customer authorization
  IF v_shipment.customer_authorized IS NOT TRUE THEN
    v_blockers := v_blockers || jsonb_build_array(
      jsonb_build_object('code', 'NOT_AUTHORIZED', 'message', 'Customer authorization is required before releasing items.', 'severity', 'blocking')
    );
  END IF;
  
  -- Check release_type
  IF v_shipment.release_type IS NULL OR v_shipment.release_type = '' THEN
    v_blockers := v_blockers || jsonb_build_array(
      jsonb_build_object('code', 'NO_RELEASE_TYPE', 'message', 'Release type must be specified (e.g., Customer Pickup, Delivery).', 'severity', 'blocking')
    );
  END IF;
  
  -- Check released_to
  IF v_shipment.released_to IS NULL OR v_shipment.released_to = '' THEN
    v_blockers := v_blockers || jsonb_build_array(
      jsonb_build_object('code', 'NO_RELEASED_TO', 'message', 'Released To field is required.', 'severity', 'blocking')
    );
  END IF;
  
  -- Count items
  SELECT COUNT(*) INTO v_item_count
  FROM shipment_items WHERE shipment_id = p_shipment_id;
  
  IF v_item_count = 0 THEN
    v_blockers := v_blockers || jsonb_build_array(
      jsonb_build_object('code', 'NO_ITEMS', 'message', 'Shipment has no items to release.', 'severity', 'blocking')
    );
  END IF;
  
  -- Check for unstaged items (items without is_staged = true)
  SELECT COUNT(*) INTO v_unstaged_count
  FROM shipment_items 
  WHERE shipment_id = p_shipment_id 
    AND (is_staged IS NULL OR is_staged = false);
  
  IF v_unstaged_count > 0 THEN
    v_blockers := v_blockers || jsonb_build_array(
      jsonb_build_object('code', 'UNSTAGED_ITEMS', 'message', format('%s item(s) have not been staged/scanned for release.', v_unstaged_count), 'severity', 'blocking')
    );
  END IF;
  
  -- Check for unresolved tasks on items in shipment (using related_item_id)
  SELECT COUNT(*) INTO v_unresolved_task_count
  FROM tasks t
  JOIN shipment_items si ON si.item_id = t.related_item_id
  WHERE si.shipment_id = p_shipment_id
    AND t.status NOT IN ('completed', 'cancelled')
    AND t.task_type IN ('repair', 'assembly', 'inspection');
  
  IF v_unresolved_task_count > 0 THEN
    v_blockers := v_blockers || jsonb_build_array(
      jsonb_build_object('code', 'UNRESOLVED_TASKS', 'message', format('%s unresolved task(s) must be completed before release.', v_unresolved_task_count), 'severity', 'blocking')
    );
  END IF;
  
  RETURN jsonb_build_object(
    'ok', jsonb_array_length(v_blockers) = 0,
    'blockers', v_blockers
  );
END;
$$;

-- Add is_staged column to shipment_items if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'shipment_items' AND column_name = 'is_staged'
  ) THEN
    ALTER TABLE shipment_items ADD COLUMN is_staged boolean DEFAULT false;
  END IF;
END $$;

-- Fix qa_test_runs FK to reference public.users instead of auth.users for PostgREST compatibility
-- First drop the existing constraint if it exists
ALTER TABLE qa_test_runs DROP CONSTRAINT IF EXISTS qa_test_runs_executed_by_fkey;

-- Add new FK referencing public.users
ALTER TABLE qa_test_runs 
  ADD CONSTRAINT qa_test_runs_executed_by_fkey 
  FOREIGN KEY (executed_by) REFERENCES public.users(id) ON DELETE SET NULL;

-- Update remaining validator functions with proper search_path
CREATE OR REPLACE FUNCTION public.validate_shipment_receiving_completion(p_shipment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shipment RECORD;
  v_blockers jsonb := '[]'::jsonb;
  v_item_count int;
  v_items_without_location int;
  v_photo_count int;
BEGIN
  -- Get shipment
  SELECT * INTO v_shipment FROM shipments WHERE id = p_shipment_id;
  
  IF v_shipment IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'blockers', jsonb_build_array(
        jsonb_build_object('code', 'NOT_FOUND', 'message', 'Shipment not found.', 'severity', 'blocking')
      )
    );
  END IF;
  
  -- Count items
  SELECT COUNT(*) INTO v_item_count FROM items WHERE shipment_id = p_shipment_id;
  
  IF v_item_count = 0 THEN
    v_blockers := v_blockers || jsonb_build_array(
      jsonb_build_object('code', 'NO_ITEMS', 'message', 'Shipment has no items. Add at least one item before completing.', 'severity', 'blocking')
    );
  END IF;
  
  -- Check items without locations
  SELECT COUNT(*) INTO v_items_without_location 
  FROM items 
  WHERE shipment_id = p_shipment_id 
    AND current_location_id IS NULL;
  
  IF v_items_without_location > 0 THEN
    v_blockers := v_blockers || jsonb_build_array(
      jsonb_build_object('code', 'MISSING_LOCATIONS', 'message', format('%s item(s) have not been assigned a put-away location.', v_items_without_location), 'severity', 'blocking')
    );
  END IF;
  
  -- Check for receiving photos
  SELECT COUNT(*) INTO v_photo_count 
  FROM shipment_media 
  WHERE shipment_id = p_shipment_id AND media_type = 'receiving';
  
  IF v_photo_count = 0 THEN
    v_blockers := v_blockers || jsonb_build_array(
      jsonb_build_object('code', 'NO_PHOTOS', 'message', 'At least one receiving photo is required.', 'severity', 'blocking')
    );
  END IF;
  
  RETURN jsonb_build_object(
    'ok', jsonb_array_length(v_blockers) = 0,
    'blockers', v_blockers
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_movement_event(p_item_ids uuid[], p_destination_location_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_blockers jsonb := '[]'::jsonb;
  v_item_count int;
  v_location_exists boolean;
BEGIN
  -- Check if items provided
  IF p_item_ids IS NULL OR array_length(p_item_ids, 1) IS NULL OR array_length(p_item_ids, 1) = 0 THEN
    v_blockers := v_blockers || jsonb_build_array(
      jsonb_build_object('code', 'NO_ITEMS', 'message', 'At least one item must be scanned before moving.', 'severity', 'blocking')
    );
  ELSE
    -- Validate all items exist
    SELECT COUNT(*) INTO v_item_count FROM items WHERE id = ANY(p_item_ids);
    IF v_item_count != array_length(p_item_ids, 1) THEN
      v_blockers := v_blockers || jsonb_build_array(
        jsonb_build_object('code', 'INVALID_ITEMS', 'message', 'One or more scanned items are invalid or not found.', 'severity', 'blocking')
      );
    END IF;
  END IF;
  
  -- Check destination location
  IF p_destination_location_id IS NULL THEN
    v_blockers := v_blockers || jsonb_build_array(
      jsonb_build_object('code', 'NO_DESTINATION', 'message', 'Destination location must be scanned before moving items.', 'severity', 'blocking')
    );
  ELSE
    SELECT EXISTS(SELECT 1 FROM locations WHERE id = p_destination_location_id) INTO v_location_exists;
    IF NOT v_location_exists THEN
      v_blockers := v_blockers || jsonb_build_array(
        jsonb_build_object('code', 'INVALID_DESTINATION', 'message', 'Destination location not found.', 'severity', 'blocking')
      );
    END IF;
  END IF;
  
  RETURN jsonb_build_object(
    'ok', jsonb_array_length(v_blockers) = 0,
    'blockers', v_blockers
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_stocktake_completion(p_stocktake_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stocktake RECORD;
  v_blockers jsonb := '[]'::jsonb;
  v_scan_count int;
BEGIN
  -- Get stocktake
  SELECT * INTO v_stocktake FROM stocktakes WHERE id = p_stocktake_id;
  
  IF v_stocktake IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'blockers', jsonb_build_array(
        jsonb_build_object('code', 'NOT_FOUND', 'message', 'Stocktake not found.', 'severity', 'blocking')
      )
    );
  END IF;
  
  -- Check if already closed
  IF v_stocktake.status = 'closed' THEN
    v_blockers := v_blockers || jsonb_build_array(
      jsonb_build_object('code', 'ALREADY_CLOSED', 'message', 'This stocktake is already closed.', 'severity', 'blocking')
    );
    RETURN jsonb_build_object('ok', false, 'blockers', v_blockers);
  END IF;
  
  -- Count scanned items
  SELECT COUNT(*) INTO v_scan_count FROM stocktake_scans WHERE stocktake_id = p_stocktake_id;
  
  IF v_scan_count = 0 THEN
    v_blockers := v_blockers || jsonb_build_array(
      jsonb_build_object('code', 'NO_SCANS', 'message', 'No items have been scanned. Complete scanning before closing.', 'severity', 'blocking')
    );
  END IF;
  
  RETURN jsonb_build_object(
    'ok', jsonb_array_length(v_blockers) = 0,
    'blockers', v_blockers
  );
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.validate_shipment_receiving_completion(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_shipment_outbound_completion(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_movement_event(uuid[], uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_stocktake_completion(uuid) TO authenticated;