CREATE OR REPLACE FUNCTION public.validate_task_completion(p_task_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_task record;
  v_item_ids uuid[];
  v_missing_location int := 0;
  v_missing_photos int := 0;
  v_missing_repair_approval boolean := false;
  v_blockers jsonb := '[]'::jsonb;
  v_task_has_photos boolean := false;
BEGIN
  SELECT id, tenant_id, task_type, status, related_item_id, metadata
  INTO v_task
  FROM public.tasks
  WHERE id = p_task_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'blockers', jsonb_build_array(jsonb_build_object(
        'code','task_not_found',
        'message','Task not found.',
        'severity','blocking'
      ))
    );
  END IF;

  v_task_has_photos := jsonb_array_length(COALESCE(v_task.metadata->'photos', '[]'::jsonb)) > 0;

  SELECT COALESCE(array_agg(ti.item_id), ARRAY[]::uuid[])
  INTO v_item_ids
  FROM public.task_items ti
  WHERE ti.task_id = p_task_id;

  IF (v_item_ids IS NULL OR array_length(v_item_ids, 1) IS NULL) AND v_task.related_item_id IS NOT NULL THEN
    v_item_ids := ARRAY[v_task.related_item_id];
  END IF;

  IF v_item_ids IS NULL OR array_length(v_item_ids, 1) IS NULL THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code','no_items_linked',
      'message','No items are linked to this task. Link at least one item before completing.',
      'severity','blocking'
    ));
    RETURN jsonb_build_object('ok', false, 'blockers', v_blockers);
  END IF;

  SELECT COUNT(*)
  INTO v_missing_location
  FROM public.items i
  WHERE i.id = ANY(v_item_ids)
    AND (i.current_location_id IS NULL);

  IF v_missing_location > 0 THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code','missing_location',
      'message', format('%s item(s) are missing a location. Scan/move them to a location before completing.', v_missing_location),
      'severity','blocking'
    ));
  END IF;

  IF v_task.task_type = 'Inspection' THEN
    IF NOT v_task_has_photos THEN
      SELECT COUNT(*)
      INTO v_missing_photos
      FROM public.items i
      WHERE i.id = ANY(v_item_ids)
        AND (
          COALESCE(jsonb_array_length(i.inspection_photos), 0) = 0
          AND NOT EXISTS (
            SELECT 1 FROM public.item_photos p
            WHERE p.item_id = i.id
          )
        );

      IF v_missing_photos > 0 THEN
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
          'code','inspection_photos_required',
          'message', format('%s item(s) are missing required inspection photos.', v_missing_photos),
          'severity','blocking'
        ));
      END IF;
    END IF;

  ELSIF v_task.task_type = 'Assembly' THEN
    IF NOT v_task_has_photos THEN
      SELECT COUNT(*)
      INTO v_missing_photos
      FROM public.items i
      WHERE i.id = ANY(v_item_ids)
        AND (
          COALESCE(jsonb_array_length(i.photo_urls), 0) = 0
          AND NOT EXISTS (
            SELECT 1 FROM public.item_photos p
            WHERE p.item_id = i.id
          )
        );

      IF v_missing_photos > 0 THEN
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
          'code','assembly_photos_required',
          'message', format('%s item(s) are missing required assembly completion photos.', v_missing_photos),
          'severity','blocking'
        ));
      END IF;
    END IF;

  ELSIF v_task.task_type = 'Repair' THEN
    SELECT NOT EXISTS (
      SELECT 1
      FROM public.repair_quotes rq
      WHERE (rq.source_task_id = p_task_id OR rq.item_id = ANY(v_item_ids))
        AND rq.status = 'accepted'
    )
    INTO v_missing_repair_approval;

    IF v_missing_repair_approval THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code','repair_approval_required',
        'message','Repair quote approval is required (status = accepted) before completing this repair task.',
        'severity','blocking'
      ));
    END IF;

    IF NOT v_task_has_photos THEN
      SELECT COUNT(*)
      INTO v_missing_photos
      FROM public.items i
      WHERE i.id = ANY(v_item_ids)
        AND (
          COALESCE(jsonb_array_length(i.repair_photos), 0) = 0
          AND NOT EXISTS (
            SELECT 1 FROM public.item_photos p
            WHERE p.item_id = i.id
          )
        );

      IF v_missing_photos > 0 THEN
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
          'code','repair_photos_required',
          'message', format('%s item(s) are missing required before/after repair photos.', v_missing_photos),
          'severity','blocking'
        ));
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', (jsonb_array_length(v_blockers) = 0),
    'blockers', v_blockers,
    'task_type', v_task.task_type
  );
END;
$$;