-- =============================================================================
-- NVPC Phase 2: Unified Inbound Planning Layer
-- ALTER: shipments (add inbound columns), shipment_items (add allocation cols)
-- CREATE: shipment_item_photos, shipment_external_refs,
--         shipment_item_allocations, inbound_links
-- RPCs: rpc_normalize_ref_value, rpc_allocate_manifest_items_to_expected,
--       rpc_deallocate_manifest_item, rpc_find_inbound_candidates,
--       rpc_link_dock_intake_to_shipment
-- =============================================================================

-- ============================================================
-- 1) ALTER shipments — add inbound planning columns
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='shipments' AND column_name='inbound_kind'
  ) THEN
    ALTER TABLE public.shipments ADD COLUMN inbound_kind TEXT NULL
      CHECK (inbound_kind IS NULL OR inbound_kind IN ('manifest','expected','dock_intake'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='shipments' AND column_name='inbound_status'
  ) THEN
    ALTER TABLE public.shipments ADD COLUMN inbound_status TEXT NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='shipments' AND column_name='vendor_name'
  ) THEN
    ALTER TABLE public.shipments ADD COLUMN vendor_name TEXT NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='shipments' AND column_name='eta_start'
  ) THEN
    ALTER TABLE public.shipments ADD COLUMN eta_start TIMESTAMPTZ NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='shipments' AND column_name='eta_end'
  ) THEN
    ALTER TABLE public.shipments ADD COLUMN eta_end TIMESTAMPTZ NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='shipments' AND column_name='expected_pieces'
  ) THEN
    ALTER TABLE public.shipments ADD COLUMN expected_pieces INTEGER NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='shipments' AND column_name='signed_pieces'
  ) THEN
    ALTER TABLE public.shipments ADD COLUMN signed_pieces INTEGER NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='shipments' AND column_name='received_pieces'
  ) THEN
    ALTER TABLE public.shipments ADD COLUMN received_pieces INTEGER NULL;
  END IF;
END $$;

-- Index for inbound queries
CREATE INDEX IF NOT EXISTS idx_shipments_inbound_kind_status
  ON public.shipments (tenant_id, inbound_kind, inbound_status)
  WHERE shipment_type = 'inbound';


-- ============================================================
-- 2) ALTER shipment_items — add allocation + room + photo
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='shipment_items' AND column_name='allocated_qty'
  ) THEN
    ALTER TABLE public.shipment_items ADD COLUMN allocated_qty INTEGER NOT NULL DEFAULT 0;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='shipment_items' AND column_name='room'
  ) THEN
    ALTER TABLE public.shipment_items ADD COLUMN room TEXT NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='shipment_items' AND column_name='primary_photo_id'
  ) THEN
    ALTER TABLE public.shipment_items ADD COLUMN primary_photo_id UUID NULL;
  END IF;
END $$;


-- ============================================================
-- 3) CREATE shipment_item_photos
-- ============================================================

CREATE TABLE IF NOT EXISTS public.shipment_item_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  shipment_item_id UUID NOT NULL REFERENCES public.shipment_items(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL,
  storage_url TEXT,
  file_name TEXT NOT NULL,
  file_size INTEGER,
  mime_type TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  uploaded_by UUID NULL REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shipment_item_photos_tenant_item
  ON public.shipment_item_photos (tenant_id, shipment_item_id);

ALTER TABLE public.shipment_item_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shipment_item_photos_tenant_isolation" ON public.shipment_item_photos;
CREATE POLICY "shipment_item_photos_tenant_isolation" ON public.shipment_item_photos
  FOR ALL USING (tenant_id = public.user_tenant_id());

GRANT ALL ON public.shipment_item_photos TO authenticated;


-- ============================================================
-- 4) CREATE shipment_external_refs
-- ============================================================

CREATE TABLE IF NOT EXISTS public.shipment_external_refs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  shipment_id UUID NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  ref_type TEXT NOT NULL CHECK (ref_type IN ('BOL','PRO','TRACKING','PO','REF')),
  value TEXT NOT NULL,
  normalized_value TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_shipment_external_refs_unique
  ON public.shipment_external_refs (shipment_id, ref_type, normalized_value);

CREATE INDEX IF NOT EXISTS idx_shipment_external_refs_tenant_normalized
  ON public.shipment_external_refs (tenant_id, normalized_value);

ALTER TABLE public.shipment_external_refs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shipment_external_refs_tenant_isolation" ON public.shipment_external_refs;
CREATE POLICY "shipment_external_refs_tenant_isolation" ON public.shipment_external_refs
  FOR ALL USING (tenant_id = public.user_tenant_id());

GRANT ALL ON public.shipment_external_refs TO authenticated;


-- ============================================================
-- 5) CREATE shipment_item_allocations
-- ============================================================

CREATE TABLE IF NOT EXISTS public.shipment_item_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  manifest_shipment_id UUID NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  manifest_shipment_item_id UUID NOT NULL REFERENCES public.shipment_items(id) ON DELETE CASCADE,
  expected_shipment_id UUID NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  expected_shipment_item_id UUID NOT NULL REFERENCES public.shipment_items(id) ON DELETE CASCADE,
  allocated_qty INTEGER NOT NULL CHECK (allocated_qty > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NULL REFERENCES public.users(id)
);

CREATE INDEX IF NOT EXISTS idx_shipment_item_alloc_manifest
  ON public.shipment_item_allocations (tenant_id, manifest_shipment_id);

CREATE INDEX IF NOT EXISTS idx_shipment_item_alloc_expected
  ON public.shipment_item_allocations (tenant_id, expected_shipment_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_shipment_item_alloc_pair
  ON public.shipment_item_allocations (manifest_shipment_item_id, expected_shipment_item_id);

ALTER TABLE public.shipment_item_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shipment_item_alloc_tenant_isolation" ON public.shipment_item_allocations;
CREATE POLICY "shipment_item_alloc_tenant_isolation" ON public.shipment_item_allocations
  FOR ALL USING (tenant_id = public.user_tenant_id());

GRANT ALL ON public.shipment_item_allocations TO authenticated;


-- ============================================================
-- 6) CREATE inbound_links
-- ============================================================

CREATE TABLE IF NOT EXISTS public.inbound_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  dock_intake_id UUID NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  linked_shipment_id UUID NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  link_type TEXT NOT NULL CHECK (link_type IN ('manifest','expected')),
  confidence_score NUMERIC,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  linked_by UUID NULL REFERENCES public.users(id)
);

CREATE INDEX IF NOT EXISTS idx_inbound_links_dock
  ON public.inbound_links (tenant_id, dock_intake_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inbound_links_pair
  ON public.inbound_links (dock_intake_id, linked_shipment_id);

ALTER TABLE public.inbound_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inbound_links_tenant_isolation" ON public.inbound_links;
CREATE POLICY "inbound_links_tenant_isolation" ON public.inbound_links
  FOR ALL USING (tenant_id = public.user_tenant_id());

GRANT ALL ON public.inbound_links TO authenticated;


-- ============================================================
-- 7) RPC: rpc_normalize_ref_value
-- ============================================================

CREATE OR REPLACE FUNCTION public.rpc_normalize_ref_value(p_value TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN UPPER(TRIM(REGEXP_REPLACE(p_value, '[^A-Za-z0-9]', '', 'g')));
END;
$$;


-- ============================================================
-- 8) RPC: rpc_allocate_manifest_items_to_expected
-- ============================================================

CREATE OR REPLACE FUNCTION public.rpc_allocate_manifest_items_to_expected(
  p_manifest_item_ids UUID[],
  p_expected_shipment_id UUID,
  p_quantities INTEGER[]
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_user_id UUID;
  v_len INT;
  v_i INT;
  v_manifest_item RECORD;
  v_expected_shipment RECORD;
  v_remaining INT;
  v_qty INT;
  v_existing_alloc RECORD;
  v_linked_count INT;
  v_new_expected_item_id UUID;
  v_allocs_created INT := 0;
  v_allocs_updated INT := 0;
  v_expected_items_created INT := 0;
  v_manifest_items_updated INT := 0;
BEGIN
  v_tenant_id := public.user_tenant_id();
  v_user_id := auth.uid();
  v_len := array_length(p_manifest_item_ids, 1);

  IF v_len IS NULL OR v_len = 0 THEN
    RAISE EXCEPTION 'EMPTY_INPUT: No manifest items provided';
  END IF;

  IF v_len <> array_length(p_quantities, 1) THEN
    RAISE EXCEPTION 'ARRAY_LENGTH_MISMATCH: manifest_item_ids and quantities must have same length';
  END IF;

  -- Assert tenant ownership of expected shipment
  SELECT id, inbound_kind, shipment_type
  INTO v_expected_shipment
  FROM public.shipments
  WHERE id = p_expected_shipment_id
    AND tenant_id = v_tenant_id
    AND shipment_type = 'inbound'
    AND inbound_kind = 'expected';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TENANT_MISMATCH: Expected shipment not found or not owned by tenant';
  END IF;

  FOR v_i IN 1..v_len LOOP
    v_qty := p_quantities[v_i];

    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'INVALID_QTY: Quantity must be positive for item index %', v_i;
    END IF;

    -- Lock and read manifest item
    SELECT si.*, s.inbound_kind AS parent_inbound_kind, s.tenant_id AS parent_tenant_id
    INTO v_manifest_item
    FROM public.shipment_items si
    JOIN public.shipments s ON s.id = si.shipment_id
    WHERE si.id = p_manifest_item_ids[v_i]
      AND s.tenant_id = v_tenant_id
      AND s.shipment_type = 'inbound'
      AND s.inbound_kind = 'manifest'
    FOR UPDATE OF si;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'TENANT_MISMATCH: Manifest item % not found or not owned by tenant', p_manifest_item_ids[v_i];
    END IF;

    -- Check remaining capacity
    v_remaining := v_manifest_item.expected_quantity - v_manifest_item.allocated_qty;
    IF v_remaining < v_qty THEN
      RAISE EXCEPTION 'INSUFFICIENT_REMAINING_QTY: Item % has only % remaining (requested %)',
        p_manifest_item_ids[v_i], v_remaining, v_qty;
    END IF;

    -- Check for existing allocation from this manifest_item to expected_shipment
    SELECT COUNT(*) INTO v_linked_count
    FROM public.shipment_item_allocations
    WHERE manifest_shipment_item_id = p_manifest_item_ids[v_i]
      AND expected_shipment_id = p_expected_shipment_id
      AND tenant_id = v_tenant_id;

    IF v_linked_count = 1 THEN
      -- Increment existing allocation
      SELECT * INTO v_existing_alloc
      FROM public.shipment_item_allocations
      WHERE manifest_shipment_item_id = p_manifest_item_ids[v_i]
        AND expected_shipment_id = p_expected_shipment_id
        AND tenant_id = v_tenant_id
      FOR UPDATE;

      UPDATE public.shipment_item_allocations
      SET allocated_qty = allocated_qty + v_qty
      WHERE id = v_existing_alloc.id;

      -- Increment the expected item quantity
      UPDATE public.shipment_items
      SET expected_quantity = expected_quantity + v_qty, updated_at = now()
      WHERE id = v_existing_alloc.expected_shipment_item_id;

      v_allocs_updated := v_allocs_updated + 1;

    ELSIF v_linked_count > 1 THEN
      RAISE EXCEPTION 'AMBIGUOUS_ALLOCATION_TARGET: Manifest item % has multiple allocations to expected shipment %',
        p_manifest_item_ids[v_i], p_expected_shipment_id;

    ELSE
      -- Create new expected shipment item
      INSERT INTO public.shipment_items (
        shipment_id, expected_quantity, expected_vendor, expected_description,
        expected_sidemark, expected_class_id, room, notes, status, allocated_qty
      ) VALUES (
        p_expected_shipment_id,
        v_qty,
        v_manifest_item.expected_vendor,
        v_manifest_item.expected_description,
        v_manifest_item.expected_sidemark,
        v_manifest_item.expected_class_id,
        v_manifest_item.room,
        v_manifest_item.notes,
        'pending',
        0
      )
      RETURNING id INTO v_new_expected_item_id;

      v_expected_items_created := v_expected_items_created + 1;

      -- Create allocation row
      INSERT INTO public.shipment_item_allocations (
        tenant_id, manifest_shipment_id, manifest_shipment_item_id,
        expected_shipment_id, expected_shipment_item_id,
        allocated_qty, created_by
      ) VALUES (
        v_tenant_id,
        v_manifest_item.shipment_id,
        p_manifest_item_ids[v_i],
        p_expected_shipment_id,
        v_new_expected_item_id,
        v_qty,
        v_user_id
      );

      v_allocs_created := v_allocs_created + 1;
    END IF;

    -- Always increment manifest item allocated_qty
    UPDATE public.shipment_items
    SET allocated_qty = allocated_qty + v_qty, updated_at = now()
    WHERE id = p_manifest_item_ids[v_i];

    v_manifest_items_updated := v_manifest_items_updated + 1;
  END LOOP;

  RETURN json_build_object(
    'success', true,
    'allocations_created', v_allocs_created,
    'allocations_updated', v_allocs_updated,
    'expected_items_created', v_expected_items_created,
    'manifest_items_updated', v_manifest_items_updated
  );
END;
$$;


-- ============================================================
-- 9) RPC: rpc_deallocate_manifest_item
-- ============================================================

CREATE OR REPLACE FUNCTION public.rpc_deallocate_manifest_item(p_allocation_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_alloc RECORD;
  v_other_allocs INT;
  v_expected_item RECORD;
  v_deleted_expected BOOLEAN := false;
BEGIN
  v_tenant_id := public.user_tenant_id();

  -- Lock and read allocation
  SELECT * INTO v_alloc
  FROM public.shipment_item_allocations
  WHERE id = p_allocation_id AND tenant_id = v_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TENANT_MISMATCH: Allocation not found or not owned by tenant';
  END IF;

  -- Decrement manifest item allocated_qty
  UPDATE public.shipment_items
  SET allocated_qty = GREATEST(allocated_qty - v_alloc.allocated_qty, 0),
      updated_at = now()
  WHERE id = v_alloc.manifest_shipment_item_id;

  -- Check if other allocations reference this expected item
  SELECT COUNT(*) INTO v_other_allocs
  FROM public.shipment_item_allocations
  WHERE expected_shipment_item_id = v_alloc.expected_shipment_item_id
    AND id <> p_allocation_id
    AND tenant_id = v_tenant_id;

  IF v_other_allocs = 0 THEN
    -- Check if expected item can be safely deleted
    SELECT * INTO v_expected_item
    FROM public.shipment_items
    WHERE id = v_alloc.expected_shipment_item_id
    FOR UPDATE;

    IF v_expected_item.status = 'pending'
       AND (v_expected_item.actual_quantity IS NULL OR v_expected_item.actual_quantity = 0) THEN
      DELETE FROM public.shipment_items WHERE id = v_alloc.expected_shipment_item_id;
      v_deleted_expected := true;
    ELSE
      -- Decrement expected_quantity
      UPDATE public.shipment_items
      SET expected_quantity = GREATEST(expected_quantity - v_alloc.allocated_qty, 0),
          updated_at = now()
      WHERE id = v_alloc.expected_shipment_item_id;
    END IF;
  ELSE
    -- Decrement expected item quantity
    UPDATE public.shipment_items
    SET expected_quantity = GREATEST(expected_quantity - v_alloc.allocated_qty, 0),
        updated_at = now()
    WHERE id = v_alloc.expected_shipment_item_id;
  END IF;

  -- Delete the allocation row
  DELETE FROM public.shipment_item_allocations WHERE id = p_allocation_id;

  RETURN json_build_object(
    'success', true,
    'deallocated_qty', v_alloc.allocated_qty,
    'expected_item_deleted', v_deleted_expected
  );
END;
$$;


-- ============================================================
-- 10) RPC: rpc_find_inbound_candidates
-- ============================================================

CREATE OR REPLACE FUNCTION public.rpc_find_inbound_candidates(
  p_account_id UUID DEFAULT NULL,
  p_vendor_name TEXT DEFAULT NULL,
  p_ref_value TEXT DEFAULT NULL,
  p_pieces INTEGER DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_normalized_ref TEXT;
  v_results JSON;
BEGIN
  v_tenant_id := public.user_tenant_id();

  IF p_ref_value IS NOT NULL AND TRIM(p_ref_value) <> '' THEN
    v_normalized_ref := UPPER(TRIM(REGEXP_REPLACE(p_ref_value, '[^A-Za-z0-9]', '', 'g')));
  END IF;

  SELECT COALESCE(json_agg(row_to_json(candidates) ORDER BY confidence_score DESC), '[]'::JSON)
  INTO v_results
  FROM (
    SELECT DISTINCT ON (s.id)
      s.id AS shipment_id,
      s.inbound_kind,
      s.account_id,
      a.account_name,
      s.vendor_name,
      s.expected_pieces,
      s.eta_start,
      s.eta_end,
      s.created_at,
      s.shipment_number,
      CASE
        -- Tier 1: exact ref match (95-100)
        WHEN v_normalized_ref IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.shipment_external_refs r
          WHERE r.shipment_id = s.id AND r.normalized_value = v_normalized_ref
        ) THEN
          CASE
            WHEN p_account_id IS NOT NULL AND s.account_id = p_account_id THEN 100
            ELSE 95
          END
        -- Tier 2: same account + vendor fuzzy (70-90)
        WHEN p_account_id IS NOT NULL AND s.account_id = p_account_id
             AND p_vendor_name IS NOT NULL AND s.vendor_name IS NOT NULL
             AND s.vendor_name ILIKE '%' || p_vendor_name || '%'
        THEN 80 + CASE
          WHEN p_pieces IS NOT NULL AND s.expected_pieces IS NOT NULL
               AND ABS(s.expected_pieces - p_pieces) <= 2 THEN 10
          ELSE 0
        END
        -- Tier 3: same account only (30-50)
        WHEN p_account_id IS NOT NULL AND s.account_id = p_account_id THEN
          30 + CASE
            WHEN p_pieces IS NOT NULL AND s.expected_pieces IS NOT NULL
                 AND ABS(s.expected_pieces - p_pieces) <= 2 THEN 20
            ELSE 0
          END
        -- Unknown account fallback: vendor match across all (20-40)
        WHEN p_account_id IS NULL AND p_vendor_name IS NOT NULL
             AND s.vendor_name IS NOT NULL
             AND s.vendor_name ILIKE '%' || p_vendor_name || '%'
        THEN 30
        ELSE 10
      END AS confidence_score,
      CASE
        WHEN v_normalized_ref IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.shipment_external_refs r
          WHERE r.shipment_id = s.id AND r.normalized_value = v_normalized_ref
        ) THEN 'Exact Ref Match'
        WHEN p_account_id IS NOT NULL AND s.account_id = p_account_id
             AND p_vendor_name IS NOT NULL AND s.vendor_name ILIKE '%' || p_vendor_name || '%'
        THEN 'Account + Vendor Match'
        WHEN p_account_id IS NOT NULL AND s.account_id = p_account_id
        THEN 'Account Match'
        ELSE 'Possible Match'
      END AS confidence_label
    FROM public.shipments s
    LEFT JOIN public.accounts a ON a.id = s.account_id
    WHERE s.tenant_id = v_tenant_id
      AND s.shipment_type = 'inbound'
      AND s.inbound_kind IN ('manifest', 'expected')
      AND (s.inbound_status IS NULL OR s.inbound_status NOT IN ('completed', 'cancelled'))
      AND s.created_at >= now() - interval '90 days'
      AND s.deleted_at IS NULL
    ORDER BY s.id, confidence_score DESC
    LIMIT 5
  ) candidates;

  RETURN v_results;
END;
$$;


-- ============================================================
-- 11) RPC: rpc_link_dock_intake_to_shipment
-- ============================================================

CREATE OR REPLACE FUNCTION public.rpc_link_dock_intake_to_shipment(
  p_dock_intake_id UUID,
  p_linked_shipment_id UUID,
  p_link_type TEXT,
  p_confidence_score NUMERIC DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_user_id UUID;
  v_dock RECORD;
  v_linked RECORD;
  v_link_id UUID;
BEGIN
  v_tenant_id := public.user_tenant_id();
  v_user_id := auth.uid();

  -- Assert dock intake ownership
  SELECT id, inbound_kind, shipment_type
  INTO v_dock
  FROM public.shipments
  WHERE id = p_dock_intake_id
    AND tenant_id = v_tenant_id
    AND shipment_type = 'inbound'
    AND inbound_kind = 'dock_intake';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TENANT_MISMATCH: Dock intake not found or not owned by tenant';
  END IF;

  -- Assert linked shipment ownership
  SELECT id, inbound_kind
  INTO v_linked
  FROM public.shipments
  WHERE id = p_linked_shipment_id
    AND tenant_id = v_tenant_id
    AND inbound_kind IN ('manifest', 'expected');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TENANT_MISMATCH: Linked shipment not found or not owned by tenant';
  END IF;

  -- Insert link (dedupe via UNIQUE index)
  INSERT INTO public.inbound_links (
    tenant_id, dock_intake_id, linked_shipment_id,
    link_type, confidence_score, linked_by
  ) VALUES (
    v_tenant_id, p_dock_intake_id, p_linked_shipment_id,
    p_link_type, p_confidence_score, v_user_id
  )
  ON CONFLICT (dock_intake_id, linked_shipment_id) DO UPDATE
  SET confidence_score = EXCLUDED.confidence_score,
      linked_by = EXCLUDED.linked_by,
      linked_at = now()
  RETURNING id INTO v_link_id;

  RETURN json_build_object(
    'success', true,
    'link_id', v_link_id
  );
END;
$$;


-- ============================================================
-- 12) Grants
-- ============================================================

GRANT EXECUTE ON FUNCTION public.rpc_normalize_ref_value(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_allocate_manifest_items_to_expected(UUID[], UUID, INTEGER[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_deallocate_manifest_item(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_find_inbound_candidates(UUID, TEXT, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_link_dock_intake_to_shipment(UUID, UUID, TEXT, NUMERIC) TO authenticated;
