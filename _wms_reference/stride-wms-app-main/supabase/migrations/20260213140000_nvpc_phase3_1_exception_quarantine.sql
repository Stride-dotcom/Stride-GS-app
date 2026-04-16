-- =============================================================================
-- NVPC Phase 3.1: Shipment Exception Type + Source Linkage + Quarantine Guard
-- Additive only. No renames, no drops, no table creation.
-- =============================================================================

-- ============================================================
-- 1) ADD shipments.shipment_exception_type
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='shipments' AND column_name='shipment_exception_type'
  ) THEN
    ALTER TABLE public.shipments ADD COLUMN shipment_exception_type TEXT NULL
      CHECK (shipment_exception_type IS NULL OR shipment_exception_type IN ('UNKNOWN_ACCOUNT','MIS_SHIP','RETURN_TO_SENDER'));
  END IF;
END $$;

-- ============================================================
-- 2) ADD shipments.source_shipment_id (return linkage)
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='shipments' AND column_name='source_shipment_id'
  ) THEN
    ALTER TABLE public.shipments ADD COLUMN source_shipment_id UUID NULL
      REFERENCES public.shipments(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_shipments_source_shipment
  ON public.shipments (source_shipment_id)
  WHERE source_shipment_id IS NOT NULL;

-- ============================================================
-- 3) UPDATE validate_shipment_outbound_completion — add quarantine guard
--    Two-layer check:
--    a) Items on outbound whose inbound shipment has MIS_SHIP/RETURN_TO_SENDER
--    b) inventory_units with QUARANTINE status linked via inbound shipment_items
-- ============================================================

CREATE OR REPLACE FUNCTION public.validate_shipment_outbound_completion(p_shipment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_blockers jsonb := '[]'::jsonb;
  v_shipment record;
  v_items_not_at_dock int;
  v_unresolved_tasks int;
  v_quarantined_count int;
BEGIN
  -- Fetch shipment
  SELECT * INTO v_shipment FROM shipments WHERE id = p_shipment_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'blockers', jsonb_build_array(
        jsonb_build_object('code', 'SHIPMENT_NOT_FOUND', 'message', 'Shipment not found.', 'severity', 'blocking')
      )
    );
  END IF;

  -- QUARANTINE GUARD: check if any items on this outbound came from
  -- exception-flagged inbound shipments OR have quarantined inventory_units
  SELECT COUNT(*) INTO v_quarantined_count
  FROM shipment_items outbound_si
  WHERE outbound_si.shipment_id = p_shipment_id
    AND outbound_si.item_id IS NOT NULL
    AND outbound_si.status != 'cancelled'
    AND (
      -- Layer 1: inbound shipment for this item is flagged
      EXISTS (
        SELECT 1 FROM shipment_items inbound_si
        JOIN shipments inbound_s ON inbound_s.id = inbound_si.shipment_id
        WHERE inbound_si.item_id = outbound_si.item_id
          AND inbound_s.id != p_shipment_id
          AND inbound_s.shipment_exception_type IN ('MIS_SHIP', 'RETURN_TO_SENDER')
      )
      OR
      -- Layer 2: inventory_units with QUARANTINE status for this item's inbound shipment_items
      EXISTS (
        SELECT 1 FROM shipment_items inbound_si
        JOIN inventory_units iu ON iu.shipment_item_id = inbound_si.id
        WHERE inbound_si.item_id = outbound_si.item_id
          AND iu.status = 'QUARANTINE'
      )
    );

  IF v_quarantined_count > 0 THEN
    v_blockers := v_blockers || jsonb_build_array(
      jsonb_build_object(
        'code', 'OUTBOUND_BLOCKED_QUARANTINE',
        'message', 'Outbound cannot be completed while quarantined units are included.',
        'severity', 'blocking'
      )
    );
  END IF;

  -- Check customer authorization
  IF COALESCE(v_shipment.customer_authorized, false) = false THEN
    v_blockers := v_blockers || jsonb_build_array(
      jsonb_build_object(
        'code', 'NO_AUTHORIZATION',
        'message', 'Customer authorization is required. The customer must submit the outbound request in the portal before you can complete the release.',
        'severity', 'blocking'
      )
    );
  END IF;

  -- Check release_type
  IF v_shipment.release_type IS NULL OR v_shipment.release_type = '' THEN
    v_blockers := v_blockers || jsonb_build_array(
      jsonb_build_object('code', 'NO_RELEASE_TYPE', 'message', 'Release type is required.', 'severity', 'blocking')
    );
  END IF;

  -- Check released_to / driver_name
  IF (v_shipment.released_to IS NULL OR v_shipment.released_to = '')
     AND (v_shipment.driver_name IS NULL OR v_shipment.driver_name = '') THEN
    v_blockers := v_blockers || jsonb_build_array(
      jsonb_build_object('code', 'NO_RELEASED_TO', 'message', 'Released To / Driver Name is required.', 'severity', 'blocking')
    );
  END IF;

  -- Check items not at dock/release location
  SELECT COUNT(*) INTO v_items_not_at_dock
  FROM shipment_items si
  JOIN items i ON i.id = si.item_id
  LEFT JOIN locations l ON l.id = i.current_location_id
  WHERE si.shipment_id = p_shipment_id
    AND si.item_id IS NOT NULL
    AND si.status != 'cancelled'
    AND (l.type IS NULL OR l.type NOT IN ('outbound_dock', 'release'));

  IF v_items_not_at_dock > 0 THEN
    v_blockers := v_blockers || jsonb_build_array(
      jsonb_build_object(
        'code', 'ITEMS_NOT_STAGED',
        'message', format('%s item(s) are not staged at the outbound dock or release location.', v_items_not_at_dock),
        'severity', 'blocking'
      )
    );
  END IF;

  -- Check for unresolved blocking tasks
  SELECT COUNT(*) INTO v_unresolved_tasks
  FROM tasks t
  JOIN shipment_items si ON si.item_id = t.item_id
  WHERE si.shipment_id = p_shipment_id
    AND t.status NOT IN ('completed', 'cancelled', 'unable_to_complete')
    AND t.task_type IN ('inspection', 'repair', 'assembly');

  IF v_unresolved_tasks > 0 THEN
    v_blockers := v_blockers || jsonb_build_array(
      jsonb_build_object(
        'code', 'UNRESOLVED_TASKS',
        'message', format('%s blocking task(s) (inspection/repair/assembly) must be completed first.', v_unresolved_tasks),
        'severity', 'blocking'
      )
    );
  END IF;

  -- Return result
  RETURN jsonb_build_object(
    'ok', jsonb_array_length(v_blockers) = 0,
    'blockers', v_blockers
  );
END;
$$;
