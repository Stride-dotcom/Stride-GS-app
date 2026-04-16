-- Complete manifest function
CREATE OR REPLACE FUNCTION public.complete_manifest(
  p_manifest_id UUID,
  p_user_id UUID
)
RETURNS TABLE (success BOOLEAN, message TEXT, total_items INTEGER, scanned_items INTEGER, unscanned_items INTEGER, billing_events_created INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_manifest RECORD;
  v_total INTEGER;
  v_scanned INTEGER;
  v_unscanned INTEGER;
  v_billing_count INTEGER := 0;
  v_account_items RECORD;
  v_billing_rate NUMERIC;
BEGIN
  SELECT * INTO v_manifest FROM public.stocktake_manifests WHERE id = p_manifest_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Manifest not found'::TEXT, 0, 0, 0, 0;
    RETURN;
  END IF;

  IF v_manifest.status NOT IN ('active', 'in_progress') THEN
    RETURN QUERY SELECT false, ('Manifest must be active or in progress. Current: ' || v_manifest.status)::TEXT, 0, 0, 0, 0;
    RETURN;
  END IF;

  SELECT COUNT(*) INTO v_total FROM public.stocktake_manifest_items WHERE manifest_id = p_manifest_id;
  SELECT COUNT(*) INTO v_scanned FROM public.stocktake_manifest_items WHERE manifest_id = p_manifest_id AND scanned = true;
  v_unscanned := v_total - v_scanned;

  IF v_manifest.billable THEN
    SELECT COALESCE(base_rate, 0.50) INTO v_billing_rate
    FROM public.billable_services
    WHERE tenant_id = v_manifest.tenant_id AND code = 'STOCKTAKE' AND is_active = true
    LIMIT 1;

    IF v_billing_rate IS NULL THEN v_billing_rate := 0.50; END IF;

    FOR v_account_items IN
      SELECT mi.account_id, COUNT(*) FILTER (WHERE mi.scanned = true) as scanned_count
      FROM public.stocktake_manifest_items mi
      WHERE mi.manifest_id = p_manifest_id AND mi.scanned = true AND mi.account_id IS NOT NULL
        AND (v_manifest.include_accounts IS NULL
             OR mi.account_id::TEXT = ANY(SELECT jsonb_array_elements_text(v_manifest.include_accounts)))
      GROUP BY mi.account_id
      HAVING COUNT(*) FILTER (WHERE mi.scanned = true) > 0
    LOOP
      INSERT INTO public.billing_events (
        tenant_id, account_id, event_type, charge_type, quantity, unit_rate, total_amount,
        occurred_at, description, metadata, created_by
      ) VALUES (
        v_manifest.tenant_id, v_account_items.account_id, 'stocktake', 'stocktake',
        v_account_items.scanned_count, v_billing_rate, v_account_items.scanned_count * v_billing_rate,
        now(), 'Manifest: ' || v_manifest.manifest_number || ' (' || v_account_items.scanned_count || ' items)',
        jsonb_build_object('manifest_id', p_manifest_id, 'manifest_number', v_manifest.manifest_number), p_user_id
      );
      v_billing_count := v_billing_count + 1;
    END LOOP;
  END IF;

  UPDATE public.stocktake_manifests
  SET status = 'completed', completed_by = p_user_id, completed_at = now(),
      scanned_item_count = v_scanned, updated_by = p_user_id, updated_at = now()
  WHERE id = p_manifest_id;

  INSERT INTO public.stocktake_manifest_history (
    manifest_id, action, changed_by, old_values, new_values, description
  ) VALUES (
    p_manifest_id, 'completed', p_user_id,
    jsonb_build_object('status', v_manifest.status),
    jsonb_build_object('status', 'completed', 'total_items', v_total, 'scanned_items', v_scanned, 'unscanned_items', v_unscanned, 'billing_events', v_billing_count),
    'Manifest completed: ' || v_scanned || '/' || v_total || ' items scanned'
  );

  RETURN QUERY SELECT true, ('Manifest completed: ' || v_scanned || '/' || v_total || ' items scanned')::TEXT, v_total, v_scanned, v_unscanned, v_billing_count;
END;
$$;

-- Cancel manifest function
CREATE OR REPLACE FUNCTION public.cancel_manifest(
  p_manifest_id UUID,
  p_user_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS TABLE (success BOOLEAN, message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_manifest RECORD;
BEGIN
  SELECT * INTO v_manifest FROM public.stocktake_manifests WHERE id = p_manifest_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Manifest not found'::TEXT;
    RETURN;
  END IF;

  IF v_manifest.status = 'completed' THEN
    RETURN QUERY SELECT false, 'Cannot cancel a completed manifest'::TEXT;
    RETURN;
  END IF;

  IF v_manifest.status = 'cancelled' THEN
    RETURN QUERY SELECT false, 'Manifest is already cancelled'::TEXT;
    RETURN;
  END IF;

  UPDATE public.stocktake_manifests
  SET status = 'cancelled', updated_by = p_user_id, updated_at = now(),
      notes = CASE WHEN p_reason IS NOT NULL THEN COALESCE(notes || E'\n', '') || 'Cancelled: ' || p_reason ELSE notes END
  WHERE id = p_manifest_id;

  INSERT INTO public.stocktake_manifest_history (
    manifest_id, action, changed_by, old_values, new_values, description
  ) VALUES (
    p_manifest_id, 'cancelled', p_user_id,
    jsonb_build_object('status', v_manifest.status),
    jsonb_build_object('status', 'cancelled', 'reason', p_reason),
    COALESCE('Manifest cancelled: ' || p_reason, 'Manifest cancelled')
  );

  RETURN QUERY SELECT true, 'Manifest cancelled successfully'::TEXT;
END;
$$;

-- Add items bulk function
CREATE OR REPLACE FUNCTION public.add_manifest_items_bulk(
  p_manifest_id UUID,
  p_item_ids UUID[],
  p_added_by UUID
)
RETURNS TABLE (success BOOLEAN, message TEXT, items_added INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_manifest RECORD;
  v_count INTEGER := 0;
  v_item RECORD;
BEGIN
  SELECT * INTO v_manifest FROM public.stocktake_manifests WHERE id = p_manifest_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Manifest not found'::TEXT, 0;
    RETURN;
  END IF;

  IF v_manifest.status != 'draft' THEN
    RETURN QUERY SELECT false, 'Can only add items to draft manifests'::TEXT, 0;
    RETURN;
  END IF;

  FOR v_item IN
    SELECT i.id, i.item_code, i.description, i.current_location_id, i.account_id
    FROM public.items i
    WHERE i.id = ANY(p_item_ids) AND i.tenant_id = v_manifest.tenant_id AND i.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.stocktake_manifest_items mi WHERE mi.manifest_id = p_manifest_id AND mi.item_id = i.id)
  LOOP
    INSERT INTO public.stocktake_manifest_items (
      manifest_id, item_id, expected_location_id, item_code, item_description, account_id, added_by
    ) VALUES (
      p_manifest_id, v_item.id, v_item.current_location_id, v_item.item_code, v_item.description, v_item.account_id, p_added_by
    );
    v_count := v_count + 1;
  END LOOP;

  IF v_count > 0 THEN
    INSERT INTO public.stocktake_manifest_history (
      manifest_id, action, changed_by, new_values, affected_item_ids, description
    ) VALUES (
      p_manifest_id, 'items_bulk_added', p_added_by,
      jsonb_build_object('count', v_count), to_jsonb(p_item_ids),
      v_count || ' items added to manifest in bulk'
    );
  END IF;

  RETURN QUERY SELECT true, (v_count || ' items added to manifest')::TEXT, v_count;
END;
$$;

-- Remove items bulk function
CREATE OR REPLACE FUNCTION public.remove_manifest_items_bulk(
  p_manifest_id UUID,
  p_item_ids UUID[],
  p_removed_by UUID
)
RETURNS TABLE (success BOOLEAN, message TEXT, items_removed INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_manifest RECORD;
  v_count INTEGER := 0;
  v_removed_items JSONB;
BEGIN
  SELECT * INTO v_manifest FROM public.stocktake_manifests WHERE id = p_manifest_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Manifest not found'::TEXT, 0;
    RETURN;
  END IF;

  IF v_manifest.status != 'draft' THEN
    RETURN QUERY SELECT false, 'Can only remove items from draft manifests'::TEXT, 0;
    RETURN;
  END IF;

  SELECT jsonb_agg(jsonb_build_object('item_id', item_id, 'item_code', item_code))
  INTO v_removed_items
  FROM public.stocktake_manifest_items
  WHERE manifest_id = p_manifest_id AND item_id = ANY(p_item_ids);

  DELETE FROM public.stocktake_manifest_items
  WHERE manifest_id = p_manifest_id AND item_id = ANY(p_item_ids);

  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count > 0 THEN
    INSERT INTO public.stocktake_manifest_history (
      manifest_id, action, changed_by, old_values, affected_item_ids, description
    ) VALUES (
      p_manifest_id, 'items_bulk_removed', p_removed_by,
      jsonb_build_object('count', v_count, 'items', v_removed_items), to_jsonb(p_item_ids),
      v_count || ' items removed from manifest in bulk'
    );

    UPDATE public.stocktake_manifests
    SET expected_item_count = expected_item_count - v_count, updated_at = now()
    WHERE id = p_manifest_id;
  END IF;

  RETURN QUERY SELECT true, (v_count || ' items removed from manifest')::TEXT, v_count;
END;
$$;

-- Add PALLET_PREP billable service
INSERT INTO public.billable_services (tenant_id, code, name, description, is_active, base_rate, pricing_mode)
SELECT t.id, 'PALLET_PREP', 'Pallet Prep', 'Pallet preparation charge for manifest processing', true, 5.00, 'flat'
FROM public.tenants t
WHERE NOT EXISTS (SELECT 1 FROM public.billable_services bs WHERE bs.tenant_id = t.id AND bs.code = 'PALLET_PREP')
ON CONFLICT DO NOTHING;