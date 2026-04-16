-- ============================================================================
-- Containers: Create with auto-generated CNT-##### codes
-- ============================================================================
-- Adds an RPC that creates a container with:
--  - optional user-provided container_code (override)
--  - otherwise auto-generated, monotonic-ish CNT-00001 style codes per tenant
--  - retries on unique violations to handle concurrent creates safely
--
-- NOTE: containers have UNIQUE(tenant_id, container_code)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.rpc_create_container(
  p_container_type   TEXT,
  p_warehouse_id     UUID,
  p_location_id      UUID DEFAULT NULL,
  p_container_code   TEXT DEFAULT NULL,
  p_footprint_cu_ft  NUMERIC DEFAULT NULL
)
RETURNS public.containers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_user_id UUID;
  v_code TEXT;
  v_max_num INT;
  v_try INT := 0;
  v_row public.containers%ROWTYPE;
BEGIN
  v_tenant_id := public.user_tenant_id();
  v_user_id := auth.uid();

  -- Validate warehouse belongs to tenant
  IF NOT EXISTS (
    SELECT 1 FROM public.warehouses
    WHERE id = p_warehouse_id
      AND tenant_id = v_tenant_id
      AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'INVALID_WAREHOUSE: Warehouse not found or not owned by tenant';
  END IF;

  -- Validate location belongs to the provided warehouse (and thus tenant) if provided.
  -- NOTE: locations does NOT have tenant_id; tenant scoping is via warehouses.tenant_id.
  IF p_location_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.locations l
      WHERE l.id = p_location_id
        AND l.warehouse_id = p_warehouse_id
        AND l.deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'INVALID_LOCATION: Location not found for this warehouse';
    END IF;
  END IF;

  -- Normalize provided code (optional)
  IF p_container_code IS NOT NULL AND length(trim(p_container_code)) > 0 THEN
    v_code := upper(trim(p_container_code));

    INSERT INTO public.containers (
      tenant_id,
      container_code,
      container_type,
      warehouse_id,
      location_id,
      footprint_cu_ft,
      status,
      is_active,
      created_by
    ) VALUES (
      v_tenant_id,
      v_code,
      p_container_type,
      p_warehouse_id,
      p_location_id,
      p_footprint_cu_ft,
      'active',
      true,
      v_user_id
    )
    RETURNING * INTO v_row;

    RETURN v_row;
  END IF;

  -- Auto-generate code:
  -- Use MAX over existing CNT-\d+ codes (including deleted) so we never reuse.
  SELECT COALESCE(MAX((regexp_match(container_code, '^CNT-(\\d+)$'))[1]::int), 0)
  INTO v_max_num
  FROM public.containers
  WHERE tenant_id = v_tenant_id
    AND container_code ~ '^CNT-[0-9]+$';

  v_max_num := v_max_num + 1;

  LOOP
    v_code := 'CNT-' || lpad(v_max_num::text, 5, '0');

    BEGIN
      INSERT INTO public.containers (
        tenant_id,
        container_code,
        container_type,
        warehouse_id,
        location_id,
        footprint_cu_ft,
        status,
        is_active,
        created_by
      ) VALUES (
        v_tenant_id,
        v_code,
        p_container_type,
        p_warehouse_id,
        p_location_id,
        p_footprint_cu_ft,
        'active',
        true,
        v_user_id
      )
      RETURNING * INTO v_row;

      RETURN v_row;
    EXCEPTION WHEN unique_violation THEN
      v_try := v_try + 1;
      IF v_try > 50 THEN
        RAISE EXCEPTION 'AUTO_CODE_EXHAUSTED: Could not generate unique container code';
      END IF;
      v_max_num := v_max_num + 1;
    END;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_create_container(TEXT, UUID, UUID, TEXT, NUMERIC) TO authenticated;

