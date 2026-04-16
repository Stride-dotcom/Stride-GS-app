-- Improved QA test data cleanup function
-- Deletes test data based on relationships rather than relying on metadata columns
-- =============================================================================

CREATE OR REPLACE FUNCTION cleanup_qa_test_data(p_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted_counts jsonb := '{}';
  v_count integer;
  v_item_ids uuid[];
  v_shipment_ids uuid[];
  v_task_ids uuid[];
  v_account_ids uuid[];
  v_location_ids uuid[];
BEGIN
  -- First, collect all entity IDs that were created by this QA run
  
  -- Get all item IDs created by this run
  SELECT ARRAY_AGG(id) INTO v_item_ids
  FROM items
  WHERE metadata->>'qa_test' = 'true'
    AND metadata->>'qa_run_id' = p_run_id::text;
  
  -- Get all shipment IDs created by this run
  SELECT ARRAY_AGG(id) INTO v_shipment_ids
  FROM shipments
  WHERE metadata->>'qa_test' = 'true'
    AND metadata->>'qa_run_id' = p_run_id::text;
  
  -- Get all task IDs created by this run
  SELECT ARRAY_AGG(id) INTO v_task_ids
  FROM tasks
  WHERE metadata->>'qa_test' = 'true'
    AND metadata->>'qa_run_id' = p_run_id::text;
  
  -- Get all account IDs created by this run
  SELECT ARRAY_AGG(id) INTO v_account_ids
  FROM accounts
  WHERE metadata->>'qa_test' = 'true'
    AND metadata->>'qa_run_id' = p_run_id::text;
    
  -- Get all location IDs created by this run
  SELECT ARRAY_AGG(id) INTO v_location_ids
  FROM locations
  WHERE metadata->>'qa_test' = 'true'
    AND metadata->>'qa_run_id' = p_run_id::text;

  -- Delete in order of dependencies (children first, then parents)
  
  -- 1. Delete item-related records first
  IF v_item_ids IS NOT NULL AND array_length(v_item_ids, 1) > 0 THEN
    -- Delete item_photos for QA items
    DELETE FROM item_photos WHERE item_id = ANY(v_item_ids);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_deleted_counts := v_deleted_counts || jsonb_build_object('item_photos', v_count);
    
    -- Delete item_notes for QA items
    DELETE FROM item_notes WHERE item_id = ANY(v_item_ids);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_deleted_counts := v_deleted_counts || jsonb_build_object('item_notes', v_count);
    
    -- Delete item_flags for QA items
    DELETE FROM item_flags WHERE item_id = ANY(v_item_ids);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_deleted_counts := v_deleted_counts || jsonb_build_object('item_flags', v_count);
    
    -- Delete billing_events for QA items
    DELETE FROM billing_events WHERE item_id = ANY(v_item_ids);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_deleted_counts := v_deleted_counts || jsonb_build_object('billing_events', v_count);
    
    -- Delete movements for QA items
    DELETE FROM movements WHERE item_id = ANY(v_item_ids);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_deleted_counts := v_deleted_counts || jsonb_build_object('movements', v_count);
    
    -- Delete claim_items for QA items
    DELETE FROM claim_items WHERE item_id = ANY(v_item_ids);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_deleted_counts := v_deleted_counts || jsonb_build_object('claim_items', v_count);
    
    -- Delete repair_quotes for QA items
    DELETE FROM repair_quotes WHERE item_id = ANY(v_item_ids);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_deleted_counts := v_deleted_counts || jsonb_build_object('repair_quotes', v_count);
    
    -- Delete stocktake_manifest_items for QA items
    DELETE FROM stocktake_manifest_items WHERE item_id = ANY(v_item_ids);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_deleted_counts := v_deleted_counts || jsonb_build_object('stocktake_manifest_items', v_count);
  END IF;
  
  -- 2. Delete shipment-related records
  IF v_shipment_ids IS NOT NULL AND array_length(v_shipment_ids, 1) > 0 THEN
    -- Delete shipment_items for QA shipments (no metadata column, so we use shipment_id)
    DELETE FROM shipment_items WHERE shipment_id = ANY(v_shipment_ids);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_deleted_counts := v_deleted_counts || jsonb_build_object('shipment_items', v_count);
    
    -- Delete receiving_sessions for QA shipments
    DELETE FROM receiving_sessions WHERE shipment_id = ANY(v_shipment_ids);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_deleted_counts := v_deleted_counts || jsonb_build_object('receiving_sessions', v_count);
  END IF;
  
  -- 3. Delete task-related records
  IF v_task_ids IS NOT NULL AND array_length(v_task_ids, 1) > 0 THEN
    -- Delete task_items for QA tasks
    DELETE FROM task_items WHERE task_id = ANY(v_task_ids);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_deleted_counts := v_deleted_counts || jsonb_build_object('task_items', v_count);
    
    -- Delete task_custom_charges for QA tasks
    DELETE FROM task_custom_charges WHERE task_id = ANY(v_task_ids);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_deleted_counts := v_deleted_counts || jsonb_build_object('task_custom_charges', v_count);
  END IF;
  
  -- 4. Delete stocktakes tagged with this run
  DELETE FROM stocktakes
  WHERE metadata->>'qa_test' = 'true'
    AND metadata->>'qa_run_id' = p_run_id::text;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted_counts := v_deleted_counts || jsonb_build_object('stocktakes', v_count);
  
  -- 5. Delete claims tagged with this run
  DELETE FROM claims
  WHERE metadata->>'qa_test' = 'true'
    AND metadata->>'qa_run_id' = p_run_id::text;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted_counts := v_deleted_counts || jsonb_build_object('claims', v_count);
  
  -- 6. Delete tasks tagged with this run
  DELETE FROM tasks
  WHERE metadata->>'qa_test' = 'true'
    AND metadata->>'qa_run_id' = p_run_id::text;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted_counts := v_deleted_counts || jsonb_build_object('tasks', v_count);
  
  -- 7. Now delete the items (after all child records are gone)
  DELETE FROM items
  WHERE metadata->>'qa_test' = 'true'
    AND metadata->>'qa_run_id' = p_run_id::text;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted_counts := v_deleted_counts || jsonb_build_object('items', v_count);
  
  -- 8. Delete shipments (after shipment_items are gone)
  DELETE FROM shipments
  WHERE metadata->>'qa_test' = 'true'
    AND metadata->>'qa_run_id' = p_run_id::text;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted_counts := v_deleted_counts || jsonb_build_object('shipments', v_count);
  
  -- 9. Delete locations created by QA tests
  DELETE FROM locations
  WHERE metadata->>'qa_test' = 'true'
    AND metadata->>'qa_run_id' = p_run_id::text;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted_counts := v_deleted_counts || jsonb_build_object('locations', v_count);
  
  -- 10. Delete accounts created by QA tests (only if they were created by QA)
  DELETE FROM accounts
  WHERE metadata->>'qa_test' = 'true'
    AND metadata->>'qa_run_id' = p_run_id::text;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted_counts := v_deleted_counts || jsonb_build_object('accounts', v_count);

  RETURN jsonb_build_object(
    'success', true,
    'deleted_counts', v_deleted_counts,
    'run_id', p_run_id
  );
END;
$$;