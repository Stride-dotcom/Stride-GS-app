-- Migration: Configurable default receiving location per warehouse
-- Adds warehouses.default_receiving_location_id column and a safe RPC for
-- atomic location assignment + movement creation during receiving.

-- 1) Add default_receiving_location_id to warehouses
ALTER TABLE public.warehouses
  ADD COLUMN IF NOT EXISTS default_receiving_location_id uuid
  REFERENCES public.locations(id) ON DELETE SET NULL;

-- 2) Backfill: set existing RECV-DOCK locations as warehouse defaults where applicable
UPDATE public.warehouses w
SET default_receiving_location_id = l.id
FROM public.locations l
WHERE l.warehouse_id = w.id
  AND (
    lower(coalesce(l.type, '')) = 'receiving'
    OR lower(coalesce(l.location_type, '')) = 'receiving'
  )
  AND l.deleted_at IS NULL
  AND w.default_receiving_location_id IS NULL
  AND w.deleted_at IS NULL;

-- 3) Create the atomic RPC for assigning receiving locations to shipment items
CREATE OR REPLACE FUNCTION public.rpc_assign_receiving_location_for_shipment(
  p_shipment_id uuid,
  p_location_id uuid DEFAULT NULL,
  p_note text DEFAULT 'Auto-assigned during receiving'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_warehouse_id uuid;
  v_effective_location_id uuid;
  v_effective_location_code text;
  v_updated_count int;
  v_actor_id uuid;
BEGIN
  v_actor_id := auth.uid();

  -- Get shipment info and verify tenant
  SELECT s.tenant_id, s.warehouse_id
  INTO v_tenant_id, v_warehouse_id
  FROM shipments s
  WHERE s.id = p_shipment_id
    AND s.deleted_at IS NULL;

  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error_code', 'SHIPMENT_NOT_FOUND',
      'message', 'Shipment not found or deleted.',
      'updated_count', 0
    );
  END IF;

  -- Determine effective location
  IF p_location_id IS NOT NULL THEN
    -- Validate provided location belongs to same tenant and warehouse
    SELECT l.id, l.code
    INTO v_effective_location_id, v_effective_location_code
    FROM locations l
    JOIN warehouses w ON w.id = l.warehouse_id AND w.deleted_at IS NULL
    WHERE l.id = p_location_id
      AND l.warehouse_id = v_warehouse_id
      AND l.deleted_at IS NULL
      AND w.tenant_id = v_tenant_id;

    IF v_effective_location_id IS NULL THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error_code', 'LOCATION_WAREHOUSE_MISMATCH',
        'message', 'Location does not belong to the same tenant/warehouse as the shipment.',
        'updated_count', 0
      );
    END IF;
  ELSE
    -- Precedence 1: warehouse default
    SELECT l.id, l.code
    INTO v_effective_location_id, v_effective_location_code
    FROM warehouses w
    JOIN locations l ON l.id = w.default_receiving_location_id AND l.deleted_at IS NULL
    WHERE w.id = v_warehouse_id
      AND w.deleted_at IS NULL;

    -- Precedence 2: account/tenant fallback (accounts.default_receiving_location_id)
    IF v_effective_location_id IS NULL THEN
      SELECT l.id, l.code
      INTO v_effective_location_id, v_effective_location_code
      FROM shipments s
      JOIN accounts a ON a.id = s.account_id
      JOIN locations l ON l.id = a.default_receiving_location_id AND l.deleted_at IS NULL
      WHERE s.id = p_shipment_id;
    END IF;

    -- Precedence 3: find any existing receiving-type location for this warehouse
    IF v_effective_location_id IS NULL THEN
      SELECT l.id, l.code
      INTO v_effective_location_id, v_effective_location_code
      FROM locations l
      WHERE l.warehouse_id = v_warehouse_id
        AND l.deleted_at IS NULL
        AND (
          lower(coalesce(l.type, '')) = 'receiving'
          OR lower(coalesce(l.location_type, '')) = 'receiving'
        )
      ORDER BY l.code
      LIMIT 1;
    END IF;

    -- No default found
    IF v_effective_location_id IS NULL THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error_code', 'NO_DEFAULT_LOCATION',
        'message', 'No default receiving location configured for this warehouse.',
        'updated_count', 0
      );
    END IF;
  END IF;

  -- Atomic: Update items that belong to this shipment and have no location
  -- Uses set-based SQL (no loops)
  WITH items_to_update AS (
    SELECT i.id
    FROM shipment_items si
    JOIN items i ON i.id = si.item_id
    WHERE si.shipment_id = p_shipment_id
      AND i.current_location_id IS NULL
      AND i.tenant_id = v_tenant_id
  ),
  updated AS (
    UPDATE items
    SET current_location_id = v_effective_location_id
    FROM items_to_update
    WHERE items.id = items_to_update.id
    RETURNING items.id, items.tenant_id
  ),
  movements_inserted AS (
    INSERT INTO movements (tenant_id, item_id, from_location_id, to_location_id, actor_id, actor_type, action_type, note)
    SELECT u.tenant_id, u.id, NULL, v_effective_location_id, v_actor_id, 'user', 'receiving', p_note
    FROM updated u
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_updated_count FROM updated;

  RETURN jsonb_build_object(
    'ok', true,
    'updated_count', v_updated_count,
    'effective_location_id', v_effective_location_id,
    'effective_location_code', v_effective_location_code
  );
END;
$$;

-- 4) Create a lightweight RPC to resolve the default receiving location for a warehouse
-- (used for UI prefill without actually assigning)
CREATE OR REPLACE FUNCTION public.rpc_resolve_receiving_location(
  p_warehouse_id uuid,
  p_account_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_location_id uuid;
  v_location_code text;
BEGIN
  -- Precedence 1: warehouse default
  SELECT l.id, l.code
  INTO v_location_id, v_location_code
  FROM warehouses w
  JOIN locations l ON l.id = w.default_receiving_location_id AND l.deleted_at IS NULL
  WHERE w.id = p_warehouse_id
    AND w.deleted_at IS NULL;

  -- Precedence 2: account default
  IF v_location_id IS NULL AND p_account_id IS NOT NULL THEN
    SELECT l.id, l.code
    INTO v_location_id, v_location_code
    FROM accounts a
    JOIN locations l ON l.id = a.default_receiving_location_id AND l.deleted_at IS NULL
    WHERE a.id = p_account_id;
  END IF;

  -- Precedence 3: any receiving-type location
  IF v_location_id IS NULL THEN
    SELECT l.id, l.code
    INTO v_location_id, v_location_code
    FROM locations l
    WHERE l.warehouse_id = p_warehouse_id
      AND l.deleted_at IS NULL
      AND (
        lower(coalesce(l.type, '')) = 'receiving'
        OR lower(coalesce(l.location_type, '')) = 'receiving'
      )
    ORDER BY l.code
    LIMIT 1;
  END IF;

  IF v_location_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'NO_DEFAULT_LOCATION');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'location_id', v_location_id,
    'location_code', v_location_code
  );
END;
$$;
