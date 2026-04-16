-- Dashboard / Shipments repair migration:
-- - Keep locations.capacity_cuft and locations.capacity_cu_ft compatible
-- - Expand warehouse access role allowlist used by scanner suggestion RPCs
-- - Backfill location capacity cache for all tenants

-- Keep capacity fields compatible for both dimension-derived and manual-capacity locations.
CREATE OR REPLACE FUNCTION public.trg_locations_capacity_calc()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_computed_cuft numeric;
BEGIN
  IF NEW.length_in IS NOT NULL
     AND NEW.width_in IS NOT NULL
     AND NEW.usable_height_in IS NOT NULL THEN
    v_computed_cuft := (NEW.length_in * NEW.width_in * NEW.usable_height_in) / 1728.0;
    NEW.capacity_cuft := v_computed_cuft;
    NEW.capacity_cu_ft := v_computed_cuft;
  ELSIF NEW.capacity_cuft IS NOT NULL AND NEW.capacity_cu_ft IS NULL THEN
    NEW.capacity_cu_ft := NEW.capacity_cuft;
  ELSIF NEW.capacity_cu_ft IS NOT NULL AND NEW.capacity_cuft IS NULL THEN
    NEW.capacity_cuft := NEW.capacity_cu_ft;
  END IF;

  RETURN NEW;
END;
$$;

-- One-time sync for existing rows where only one capacity column is populated.
UPDATE public.locations
SET capacity_cuft = capacity_cu_ft
WHERE capacity_cuft IS NULL
  AND capacity_cu_ft IS NOT NULL;

UPDATE public.locations
SET capacity_cu_ft = capacity_cuft
WHERE capacity_cu_ft IS NULL
  AND capacity_cuft IS NOT NULL;

-- Allow manager/admin/admin_dev users through shared warehouse access checks.
CREATE OR REPLACE FUNCTION public.user_has_warehouse_access(
  p_user_id uuid,
  p_warehouse_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM warehouse_permissions wp
    WHERE wp.user_id = p_user_id
      AND wp.warehouse_id = p_warehouse_id
      AND wp.deleted_at IS NULL
  ) OR EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.user_id = p_user_id
      AND r.name IN ('admin', 'admin_dev', 'manager')
      AND r.deleted_at IS NULL
      AND ur.deleted_at IS NULL
  );
END;
$$;

-- Rebuild capacity cache now that capacity values are synced.
DO $$
DECLARE
  v_tenant_id uuid;
BEGIN
  FOR v_tenant_id IN
    SELECT t.id
    FROM public.tenants t
  LOOP
    PERFORM public.fn_backfill_location_capacity_cache(v_tenant_id, NULL);
  END LOOP;
END;
$$;
