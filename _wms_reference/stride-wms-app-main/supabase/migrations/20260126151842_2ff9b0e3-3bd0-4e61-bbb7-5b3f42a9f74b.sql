-- Generate manifest number function
CREATE OR REPLACE FUNCTION public.generate_manifest_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_next_number INTEGER;
BEGIN
  SELECT COALESCE(MAX(
    CASE
      WHEN manifest_number ~ '^MAN-[0-9]+$'
      THEN CAST(SUBSTRING(manifest_number FROM 5) AS INTEGER)
      ELSE 0
    END
  ), 0) + 1
  INTO v_next_number
  FROM public.stocktake_manifests
  WHERE tenant_id = NEW.tenant_id;

  NEW.manifest_number := 'MAN-' || LPAD(v_next_number::TEXT, 6, '0');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_generate_manifest_number
BEFORE INSERT ON public.stocktake_manifests
FOR EACH ROW
WHEN (NEW.manifest_number IS NULL OR NEW.manifest_number = '')
EXECUTE FUNCTION public.generate_manifest_number();

-- Record manifest creation function
CREATE OR REPLACE FUNCTION public.record_manifest_creation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.stocktake_manifest_history (
    manifest_id, action, changed_by, new_values, description
  ) VALUES (
    NEW.id,
    'created',
    COALESCE(NEW.created_by, auth.uid()),
    jsonb_build_object(
      'name', NEW.name,
      'description', NEW.description,
      'warehouse_id', NEW.warehouse_id,
      'location_ids', NEW.location_ids,
      'billable', NEW.billable,
      'scheduled_date', NEW.scheduled_date
    ),
    'Manifest created'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_record_manifest_creation
AFTER INSERT ON public.stocktake_manifests
FOR EACH ROW
EXECUTE FUNCTION public.record_manifest_creation();

-- Record manifest item added function
CREATE OR REPLACE FUNCTION public.record_manifest_item_added()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.stocktake_manifest_history (
    manifest_id, action, changed_by, new_values, affected_item_ids, description
  ) VALUES (
    NEW.manifest_id,
    'item_added',
    COALESCE(NEW.added_by, auth.uid()),
    jsonb_build_object(
      'item_code', NEW.item_code,
      'item_description', NEW.item_description,
      'expected_location_id', NEW.expected_location_id
    ),
    jsonb_build_array(NEW.item_id),
    'Item ' || NEW.item_code || ' added to manifest'
  );

  UPDATE public.stocktake_manifests
  SET expected_item_count = expected_item_count + 1,
      updated_at = now()
  WHERE id = NEW.manifest_id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_record_manifest_item_added
AFTER INSERT ON public.stocktake_manifest_items
FOR EACH ROW
EXECUTE FUNCTION public.record_manifest_item_added();

-- Record manifest item removed function
CREATE OR REPLACE FUNCTION public.record_manifest_item_removed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.stocktake_manifest_history (
    manifest_id, action, changed_by, old_values, affected_item_ids, description
  ) VALUES (
    OLD.manifest_id,
    'item_removed',
    auth.uid(),
    jsonb_build_object(
      'item_code', OLD.item_code,
      'item_description', OLD.item_description
    ),
    jsonb_build_array(OLD.item_id),
    'Item ' || OLD.item_code || ' removed from manifest'
  );

  UPDATE public.stocktake_manifests
  SET expected_item_count = expected_item_count - 1,
      updated_at = now()
  WHERE id = OLD.manifest_id;

  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_record_manifest_item_removed
AFTER DELETE ON public.stocktake_manifest_items
FOR EACH ROW
EXECUTE FUNCTION public.record_manifest_item_removed();