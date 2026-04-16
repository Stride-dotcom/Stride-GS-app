-- Record manifest scan function
CREATE OR REPLACE FUNCTION public.record_manifest_scan(
  p_manifest_id UUID,
  p_scanned_by UUID,
  p_scanned_location_id UUID,
  p_item_id UUID,
  p_item_code TEXT
)
RETURNS TABLE (
  scan_id UUID,
  result TEXT,
  is_valid BOOLEAN,
  message TEXT,
  trigger_error_feedback BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_manifest RECORD;
  v_manifest_item RECORD;
  v_item RECORD;
  v_scan_result TEXT;
  v_message TEXT;
  v_scan_id UUID;
  v_is_valid BOOLEAN := false;
  v_trigger_error BOOLEAN := false;
BEGIN
  SELECT * INTO v_manifest FROM public.stocktake_manifests WHERE id = p_manifest_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Manifest not found';
  END IF;

  IF v_manifest.status NOT IN ('active', 'in_progress') THEN
    RAISE EXCEPTION 'Manifest is not active';
  END IF;

  IF v_manifest.status = 'active' THEN
    UPDATE public.stocktake_manifests
    SET status = 'in_progress', started_by = p_scanned_by, started_at = now()
    WHERE id = p_manifest_id;
  END IF;

  SELECT * INTO v_item FROM public.items WHERE id = p_item_id;
  IF NOT FOUND THEN
    v_scan_result := 'item_not_found';
    v_message := 'Item code not found in system: ' || p_item_code;
    v_trigger_error := true;
  ELSE
    SELECT * INTO v_manifest_item
    FROM public.stocktake_manifest_items
    WHERE manifest_id = p_manifest_id AND item_id = p_item_id;

    IF NOT FOUND THEN
      v_scan_result := 'not_on_manifest';
      v_message := 'ERROR: Item ' || p_item_code || ' is NOT on this manifest!';
      v_trigger_error := true;
      v_is_valid := false;
    ELSIF v_manifest_item.scanned THEN
      v_scan_result := 'duplicate';
      v_message := 'Item ' || p_item_code || ' has already been scanned';
      v_trigger_error := true;
      v_is_valid := false;
    ELSE
      v_scan_result := 'valid';
      v_message := 'Item ' || p_item_code || ' verified successfully';
      v_is_valid := true;
      v_trigger_error := false;

      IF v_manifest_item.expected_location_id IS NOT NULL
         AND v_manifest_item.expected_location_id != p_scanned_location_id THEN
        v_scan_result := 'wrong_location';
        v_message := 'Item ' || p_item_code || ' found at different location than expected';
      END IF;

      UPDATE public.stocktake_manifest_items
      SET scanned = true, scanned_by = p_scanned_by, scanned_at = now(), scanned_location_id = p_scanned_location_id
      WHERE id = v_manifest_item.id;

      UPDATE public.stocktake_manifests
      SET scanned_item_count = scanned_item_count + 1, updated_at = now()
      WHERE id = p_manifest_id;
    END IF;
  END IF;

  INSERT INTO public.stocktake_manifest_scans (
    manifest_id, scanned_by, scanned_location_id, item_id, item_code, scan_result, message
  ) VALUES (
    p_manifest_id, p_scanned_by, p_scanned_location_id, p_item_id, p_item_code, v_scan_result, v_message
  ) RETURNING id INTO v_scan_id;

  RETURN QUERY SELECT v_scan_id, v_scan_result, v_is_valid, v_message, v_trigger_error;
END;
$$;

-- Start manifest function
CREATE OR REPLACE FUNCTION public.start_manifest(
  p_manifest_id UUID,
  p_user_id UUID
)
RETURNS TABLE (success BOOLEAN, message TEXT, item_count INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_manifest RECORD;
  v_item_count INTEGER;
BEGIN
  SELECT * INTO v_manifest FROM public.stocktake_manifests WHERE id = p_manifest_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Manifest not found'::TEXT, 0;
    RETURN;
  END IF;

  IF v_manifest.status != 'draft' THEN
    RETURN QUERY SELECT false, ('Manifest must be in draft status. Current: ' || v_manifest.status)::TEXT, 0;
    RETURN;
  END IF;

  SELECT COUNT(*) INTO v_item_count FROM public.stocktake_manifest_items WHERE manifest_id = p_manifest_id;

  IF v_item_count = 0 THEN
    RETURN QUERY SELECT false, 'Cannot start manifest with no items'::TEXT, 0;
    RETURN;
  END IF;

  UPDATE public.stocktake_manifests
  SET status = 'active', expected_item_count = v_item_count, updated_by = p_user_id, updated_at = now()
  WHERE id = p_manifest_id;

  INSERT INTO public.stocktake_manifest_history (
    manifest_id, action, changed_by, old_values, new_values, description
  ) VALUES (
    p_manifest_id, 'started', p_user_id,
    jsonb_build_object('status', 'draft'),
    jsonb_build_object('status', 'active', 'item_count', v_item_count),
    'Manifest activated with ' || v_item_count || ' items'
  );

  RETURN QUERY SELECT true, ('Manifest activated with ' || v_item_count || ' items')::TEXT, v_item_count;
END;
$$;