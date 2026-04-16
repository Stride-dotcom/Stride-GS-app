-- Record manifest update function
CREATE OR REPLACE FUNCTION public.record_manifest_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_values JSONB := '{}'::JSONB;
  v_new_values JSONB := '{}'::JSONB;
BEGIN
  IF OLD.name IS DISTINCT FROM NEW.name THEN
    v_old_values := v_old_values || jsonb_build_object('name', OLD.name);
    v_new_values := v_new_values || jsonb_build_object('name', NEW.name);
  END IF;

  IF OLD.description IS DISTINCT FROM NEW.description THEN
    v_old_values := v_old_values || jsonb_build_object('description', OLD.description);
    v_new_values := v_new_values || jsonb_build_object('description', NEW.description);
  END IF;

  IF OLD.location_ids IS DISTINCT FROM NEW.location_ids THEN
    v_old_values := v_old_values || jsonb_build_object('location_ids', OLD.location_ids);
    v_new_values := v_new_values || jsonb_build_object('location_ids', NEW.location_ids);
  END IF;

  IF OLD.billable IS DISTINCT FROM NEW.billable THEN
    v_old_values := v_old_values || jsonb_build_object('billable', OLD.billable);
    v_new_values := v_new_values || jsonb_build_object('billable', NEW.billable);
  END IF;

  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.stocktake_manifest_history (
      manifest_id, action, changed_by, old_values, new_values, description
    ) VALUES (
      NEW.id,
      'status_changed',
      COALESCE(NEW.updated_by, auth.uid()),
      jsonb_build_object('status', OLD.status),
      jsonb_build_object('status', NEW.status),
      'Status changed from ' || OLD.status || ' to ' || NEW.status
    );
  END IF;

  IF v_old_values != '{}'::JSONB THEN
    INSERT INTO public.stocktake_manifest_history (
      manifest_id, action, changed_by, old_values, new_values, description
    ) VALUES (
      NEW.id,
      'updated',
      COALESCE(NEW.updated_by, auth.uid()),
      v_old_values,
      v_new_values,
      'Manifest updated'
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_record_manifest_update
AFTER UPDATE ON public.stocktake_manifests
FOR EACH ROW
EXECUTE FUNCTION public.record_manifest_update();

-- Manifest stats view
CREATE OR REPLACE VIEW public.v_manifest_stats AS
SELECT
  m.id as manifest_id,
  m.manifest_number,
  m.name,
  m.status,
  m.expected_item_count,
  m.scanned_item_count,
  m.expected_item_count - m.scanned_item_count as remaining_items,
  CASE
    WHEN m.expected_item_count > 0
    THEN ROUND((m.scanned_item_count::NUMERIC / m.expected_item_count::NUMERIC) * 100, 1)
    ELSE 0
  END as progress_percent,
  COALESCE(scan_stats.valid_scans, 0) as valid_scans,
  COALESCE(scan_stats.rejected_scans, 0) as rejected_scans,
  COALESCE(scan_stats.duplicate_scans, 0) as duplicate_scans,
  m.created_by,
  m.created_at,
  m.started_by,
  m.started_at,
  m.completed_by,
  m.completed_at
FROM public.stocktake_manifests m
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) FILTER (WHERE scan_result = 'valid') as valid_scans,
    COUNT(*) FILTER (WHERE scan_result = 'not_on_manifest') as rejected_scans,
    COUNT(*) FILTER (WHERE scan_result = 'duplicate') as duplicate_scans
  FROM public.stocktake_manifest_scans ms
  WHERE ms.manifest_id = m.id
) scan_stats ON true;