-- Enhanced Stocktakes (Cycle Counts) Module
-- Adds: Multi-location selection, freeze moves, auto-fix, billing integration, scan audit trail

-- ============================================================================
-- 1. ENHANCE STOCKTAKES TABLE
-- Add columns for freeze moves, auto-fix, billing, multi-location support
-- ============================================================================

-- Add name column for friendly identification
ALTER TABLE public.stocktakes ADD COLUMN IF NOT EXISTS name TEXT;

-- Change from single location_id to JSONB array of location IDs
ALTER TABLE public.stocktakes ADD COLUMN IF NOT EXISTS location_ids JSONB;

-- Freeze moves prevents any item movements while stocktake is active
ALTER TABLE public.stocktakes ADD COLUMN IF NOT EXISTS freeze_moves BOOLEAN DEFAULT false;

-- Auto-fix location allows updating item location when scanned at wrong location
ALTER TABLE public.stocktakes ADD COLUMN IF NOT EXISTS allow_location_auto_fix BOOLEAN DEFAULT false;

-- Billing support
ALTER TABLE public.stocktakes ADD COLUMN IF NOT EXISTS billable BOOLEAN DEFAULT false;
ALTER TABLE public.stocktakes ADD COLUMN IF NOT EXISTS include_accounts JSONB; -- Array of account IDs to bill

-- Closed timestamp (separate from completed for distinction)
ALTER TABLE public.stocktakes ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
ALTER TABLE public.stocktakes ADD COLUMN IF NOT EXISTS closed_by UUID REFERENCES public.users(id);

-- Add status values: draft, active, closed (to align with spec)
-- Update existing status values if needed
UPDATE public.stocktakes SET status = 'draft' WHERE status = 'planned';
UPDATE public.stocktakes SET status = 'active' WHERE status = 'in_progress';
UPDATE public.stocktakes SET status = 'closed' WHERE status = 'completed';

-- Comments
COMMENT ON COLUMN public.stocktakes.name IS 'Friendly name for the stocktake';
COMMENT ON COLUMN public.stocktakes.location_ids IS 'JSON array of location UUIDs to be counted';
COMMENT ON COLUMN public.stocktakes.freeze_moves IS 'Block all item movements while stocktake is active';
COMMENT ON COLUMN public.stocktakes.allow_location_auto_fix IS 'Auto-update item location when scanned at different location';
COMMENT ON COLUMN public.stocktakes.billable IS 'Whether to create billing events on close';
COMMENT ON COLUMN public.stocktakes.include_accounts IS 'Account IDs to bill (null = all accounts with items in locations)';

-- ============================================================================
-- 2. CREATE STOCKTAKE_EXPECTED_ITEMS TABLE
-- Snapshot of items expected at stocktake creation time
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.stocktake_expected_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stocktake_id UUID NOT NULL REFERENCES public.stocktakes(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  expected_location_id UUID REFERENCES public.locations(id),
  item_code TEXT NOT NULL,
  item_description TEXT,
  account_id UUID REFERENCES public.accounts(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(stocktake_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_stocktake_expected_items_stocktake ON public.stocktake_expected_items(stocktake_id);
CREATE INDEX IF NOT EXISTS idx_stocktake_expected_items_item ON public.stocktake_expected_items(item_id);
CREATE INDEX IF NOT EXISTS idx_stocktake_expected_items_location ON public.stocktake_expected_items(expected_location_id);

COMMENT ON TABLE public.stocktake_expected_items IS 'Snapshot of items expected in stocktake locations at creation time';

-- Enable RLS
ALTER TABLE public.stocktake_expected_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation via stocktake for expected_items"
ON public.stocktake_expected_items FOR ALL
USING (EXISTS (
  SELECT 1 FROM public.stocktakes s
  WHERE s.id = stocktake_expected_items.stocktake_id
  AND s.tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid())
));

-- ============================================================================
-- 3. CREATE STOCKTAKE_SCANS TABLE
-- Immutable audit trail of all scans during stocktake
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.stocktake_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stocktake_id UUID NOT NULL REFERENCES public.stocktakes(id) ON DELETE CASCADE,
  scanned_by UUID NOT NULL REFERENCES public.users(id),
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  scanned_location_id UUID NOT NULL REFERENCES public.locations(id),
  item_id UUID REFERENCES public.items(id),
  item_code TEXT, -- Stored separately in case item is deleted
  scan_result TEXT NOT NULL CHECK (scan_result IN ('expected', 'unexpected', 'wrong_location', 'released_conflict', 'duplicate', 'not_found')),
  fault_reason TEXT,
  auto_fix_applied BOOLEAN DEFAULT false,
  old_location_id UUID REFERENCES public.locations(id),
  new_location_id UUID REFERENCES public.locations(id),
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_stocktake_scans_stocktake ON public.stocktake_scans(stocktake_id);
CREATE INDEX IF NOT EXISTS idx_stocktake_scans_item ON public.stocktake_scans(item_id);
CREATE INDEX IF NOT EXISTS idx_stocktake_scans_location ON public.stocktake_scans(scanned_location_id);
CREATE INDEX IF NOT EXISTS idx_stocktake_scans_result ON public.stocktake_scans(scan_result);

COMMENT ON TABLE public.stocktake_scans IS 'Immutable audit trail of all scans during stocktake';
COMMENT ON COLUMN public.stocktake_scans.scan_result IS 'expected=found where expected, unexpected=not in expected list, wrong_location=found at different location, released_conflict=item marked released but found, duplicate=already scanned';
COMMENT ON COLUMN public.stocktake_scans.auto_fix_applied IS 'Whether item location was auto-updated';

-- Enable RLS
ALTER TABLE public.stocktake_scans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation via stocktake for scans"
ON public.stocktake_scans FOR ALL
USING (EXISTS (
  SELECT 1 FROM public.stocktakes s
  WHERE s.id = stocktake_scans.stocktake_id
  AND s.tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid())
));

-- ============================================================================
-- 4. CREATE STOCKTAKE_RESULTS TABLE
-- Summary of discrepancies and resolutions
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.stocktake_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stocktake_id UUID NOT NULL REFERENCES public.stocktakes(id) ON DELETE CASCADE,
  item_id UUID REFERENCES public.items(id),
  item_code TEXT NOT NULL,
  expected_location_id UUID REFERENCES public.locations(id),
  scanned_location_id UUID REFERENCES public.locations(id),
  result TEXT NOT NULL CHECK (result IN ('missing', 'found_expected', 'found_wrong_location', 'found_unexpected', 'released_found')),
  resolved BOOLEAN DEFAULT false,
  resolution_notes TEXT,
  resolved_by UUID REFERENCES public.users(id),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(stocktake_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_stocktake_results_stocktake ON public.stocktake_results(stocktake_id);
CREATE INDEX IF NOT EXISTS idx_stocktake_results_result ON public.stocktake_results(result);
CREATE INDEX IF NOT EXISTS idx_stocktake_results_resolved ON public.stocktake_results(resolved);

COMMENT ON TABLE public.stocktake_results IS 'Final discrepancy results computed after stocktake close';
COMMENT ON COLUMN public.stocktake_results.result IS 'missing=not found during scan, found_expected=found at expected location, found_wrong_location=found at different location, found_unexpected=found but not in expected list';

-- Enable RLS
ALTER TABLE public.stocktake_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation via stocktake for results"
ON public.stocktake_results FOR ALL
USING (EXISTS (
  SELECT 1 FROM public.stocktakes s
  WHERE s.id = stocktake_results.stocktake_id
  AND s.tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid())
));

-- ============================================================================
-- 5. ADD STOCKTAKE SERVICE TO BILLING
-- ============================================================================

-- Add STOCKTAKE to billable services (per-item rate for stocktake)
INSERT INTO public.billable_services (tenant_id, code, name, description, is_active, base_rate, pricing_mode)
SELECT
  t.id,
  'STOCKTAKE',
  'Stocktake / Cycle Count',
  'Per-item charge for cycle count scanning',
  true,
  0.50,
  'flat'
FROM public.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM public.billable_services bs
  WHERE bs.tenant_id = t.id AND bs.code = 'STOCKTAKE'
)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 6. FUNCTION TO INITIALIZE STOCKTAKE EXPECTED ITEMS
-- Called when stocktake is started (status changes to 'active')
-- ============================================================================

CREATE OR REPLACE FUNCTION public.initialize_stocktake_expected_items(p_stocktake_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_stocktake RECORD;
  v_location_ids UUID[];
  v_count INTEGER := 0;
BEGIN
  -- Get stocktake details
  SELECT * INTO v_stocktake FROM public.stocktakes WHERE id = p_stocktake_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stocktake not found';
  END IF;

  -- Parse location_ids from JSONB to UUID array
  IF v_stocktake.location_ids IS NOT NULL THEN
    SELECT array_agg(elem::UUID)
    INTO v_location_ids
    FROM jsonb_array_elements_text(v_stocktake.location_ids) elem;
  ELSE
    -- If no specific locations, use all active locations in warehouse
    SELECT array_agg(id)
    INTO v_location_ids
    FROM public.locations
    WHERE warehouse_id = v_stocktake.warehouse_id
      AND deleted_at IS NULL
      AND (is_active IS NULL OR is_active = true);
  END IF;

  -- Insert expected items snapshot
  INSERT INTO public.stocktake_expected_items (
    stocktake_id,
    item_id,
    expected_location_id,
    item_code,
    item_description,
    account_id
  )
  SELECT
    p_stocktake_id,
    i.id,
    i.current_location_id,
    i.item_code,
    i.description,
    i.account_id
  FROM public.items i
  WHERE i.tenant_id = v_stocktake.tenant_id
    AND i.current_location_id = ANY(v_location_ids)
    AND i.status NOT IN ('released', 'disposed')
    AND i.deleted_at IS NULL
  ON CONFLICT (stocktake_id, item_id) DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Update expected_item_count on stocktake
  UPDATE public.stocktakes
  SET expected_item_count = v_count
  WHERE id = p_stocktake_id;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.initialize_stocktake_expected_items IS 'Creates snapshot of expected items when stocktake starts';

-- ============================================================================
-- 7. FUNCTION TO RECORD A SCAN
-- Returns scan result type
-- ============================================================================

CREATE OR REPLACE FUNCTION public.record_stocktake_scan(
  p_stocktake_id UUID,
  p_scanned_by UUID,
  p_scanned_location_id UUID,
  p_item_id UUID,
  p_item_code TEXT
)
RETURNS TABLE (
  scan_id UUID,
  result TEXT,
  was_expected BOOLEAN,
  expected_location_id UUID,
  auto_fixed BOOLEAN,
  message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_stocktake RECORD;
  v_expected RECORD;
  v_item RECORD;
  v_scan_result TEXT;
  v_auto_fixed BOOLEAN := false;
  v_old_location_id UUID;
  v_message TEXT;
  v_scan_id UUID;
  v_existing_scan RECORD;
BEGIN
  -- Get stocktake
  SELECT * INTO v_stocktake FROM public.stocktakes WHERE id = p_stocktake_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stocktake not found';
  END IF;

  IF v_stocktake.status != 'active' THEN
    RAISE EXCEPTION 'Stocktake is not active';
  END IF;

  -- Get item details
  SELECT * INTO v_item FROM public.items WHERE id = p_item_id;

  -- Check for duplicate scan
  SELECT * INTO v_existing_scan
  FROM public.stocktake_scans
  WHERE stocktake_id = p_stocktake_id AND item_id = p_item_id
  LIMIT 1;

  IF FOUND THEN
    -- Insert duplicate record but don't count it
    INSERT INTO public.stocktake_scans (
      stocktake_id, scanned_by, scanned_location_id, item_id, item_code, scan_result, fault_reason
    ) VALUES (
      p_stocktake_id, p_scanned_by, p_scanned_location_id, p_item_id, p_item_code, 'duplicate', 'Already scanned in this stocktake'
    ) RETURNING id INTO v_scan_id;

    RETURN QUERY SELECT v_scan_id, 'duplicate'::TEXT, false, NULL::UUID, false, 'Item already scanned in this stocktake'::TEXT;
    RETURN;
  END IF;

  -- Check if item was expected
  SELECT * INTO v_expected
  FROM public.stocktake_expected_items
  WHERE stocktake_id = p_stocktake_id AND item_id = p_item_id;

  IF NOT FOUND THEN
    -- Item not in expected list
    IF v_item.status = 'released' THEN
      v_scan_result := 'released_conflict';
      v_message := 'Item is marked as released but found in warehouse';
    ELSE
      v_scan_result := 'unexpected';
      v_message := 'Item not expected in this stocktake area';
    END IF;
  ELSE
    -- Item was expected
    IF v_expected.expected_location_id = p_scanned_location_id THEN
      -- Found at expected location
      v_scan_result := 'expected';
      v_message := 'Item found at expected location';
    ELSE
      -- Found at different location
      v_scan_result := 'wrong_location';
      v_old_location_id := v_item.current_location_id;
      v_message := 'Item found at different location';

      -- Auto-fix if enabled
      IF v_stocktake.allow_location_auto_fix THEN
        UPDATE public.items
        SET current_location_id = p_scanned_location_id,
            updated_at = now()
        WHERE id = p_item_id;

        -- Record movement
        INSERT INTO public.movements (
          item_id, from_location_id, to_location_id, action_type, actor_id, actor_type, metadata
        ) VALUES (
          p_item_id, v_old_location_id, p_scanned_location_id, 'stocktake_autofix', p_scanned_by, 'user',
          jsonb_build_object('stocktake_id', p_stocktake_id)
        );

        v_auto_fixed := true;
        v_message := 'Item location auto-corrected';
      END IF;
    END IF;
  END IF;

  -- Insert scan record
  INSERT INTO public.stocktake_scans (
    stocktake_id, scanned_by, scanned_location_id, item_id, item_code, scan_result,
    auto_fix_applied, old_location_id, new_location_id
  ) VALUES (
    p_stocktake_id, p_scanned_by, p_scanned_location_id, p_item_id, p_item_code, v_scan_result,
    v_auto_fixed, v_old_location_id, CASE WHEN v_auto_fixed THEN p_scanned_location_id ELSE NULL END
  ) RETURNING id INTO v_scan_id;

  -- Update counted_item_count
  UPDATE public.stocktakes
  SET counted_item_count = (
    SELECT COUNT(DISTINCT item_id)
    FROM public.stocktake_scans
    WHERE stocktake_id = p_stocktake_id
      AND scan_result != 'duplicate'
  )
  WHERE id = p_stocktake_id;

  RETURN QUERY SELECT
    v_scan_id,
    v_scan_result,
    FOUND,
    v_expected.expected_location_id,
    v_auto_fixed,
    v_message;
END;
$$;

COMMENT ON FUNCTION public.record_stocktake_scan IS 'Records a scan during stocktake and determines result';

-- ============================================================================
-- 8. FUNCTION TO CLOSE STOCKTAKE
-- Generates results and optionally creates billing events
-- ============================================================================

CREATE OR REPLACE FUNCTION public.close_stocktake(
  p_stocktake_id UUID,
  p_closed_by UUID
)
RETURNS TABLE (
  total_expected INTEGER,
  total_scanned INTEGER,
  found_expected INTEGER,
  found_wrong_location INTEGER,
  missing INTEGER,
  unexpected INTEGER,
  billing_events_created INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_stocktake RECORD;
  v_expected_item RECORD;
  v_scan RECORD;
  v_result_type TEXT;
  v_total_expected INTEGER := 0;
  v_total_scanned INTEGER := 0;
  v_found_expected INTEGER := 0;
  v_found_wrong INTEGER := 0;
  v_missing INTEGER := 0;
  v_unexpected INTEGER := 0;
  v_billing_count INTEGER := 0;
  v_account_scans RECORD;
  v_billing_rate NUMERIC;
BEGIN
  -- Get stocktake
  SELECT * INTO v_stocktake FROM public.stocktakes WHERE id = p_stocktake_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stocktake not found';
  END IF;

  IF v_stocktake.status != 'active' THEN
    RAISE EXCEPTION 'Stocktake must be active to close';
  END IF;

  -- Count expected items
  SELECT COUNT(*) INTO v_total_expected FROM public.stocktake_expected_items WHERE stocktake_id = p_stocktake_id;

  -- Count unique scanned items (excluding duplicates)
  SELECT COUNT(DISTINCT item_id) INTO v_total_scanned
  FROM public.stocktake_scans
  WHERE stocktake_id = p_stocktake_id AND scan_result != 'duplicate';

  -- Generate results for expected items
  FOR v_expected_item IN
    SELECT * FROM public.stocktake_expected_items WHERE stocktake_id = p_stocktake_id
  LOOP
    -- Check if item was scanned
    SELECT * INTO v_scan
    FROM public.stocktake_scans
    WHERE stocktake_id = p_stocktake_id
      AND item_id = v_expected_item.item_id
      AND scan_result != 'duplicate'
    LIMIT 1;

    IF NOT FOUND THEN
      v_result_type := 'missing';
      v_missing := v_missing + 1;
    ELSIF v_scan.scan_result = 'expected' THEN
      v_result_type := 'found_expected';
      v_found_expected := v_found_expected + 1;
    ELSIF v_scan.scan_result = 'wrong_location' THEN
      v_result_type := 'found_wrong_location';
      v_found_wrong := v_found_wrong + 1;
    ELSE
      v_result_type := 'found_expected';
      v_found_expected := v_found_expected + 1;
    END IF;

    -- Insert result
    INSERT INTO public.stocktake_results (
      stocktake_id, item_id, item_code, expected_location_id, scanned_location_id, result
    ) VALUES (
      p_stocktake_id, v_expected_item.item_id, v_expected_item.item_code,
      v_expected_item.expected_location_id, v_scan.scanned_location_id, v_result_type
    )
    ON CONFLICT (stocktake_id, item_id) DO UPDATE SET
      scanned_location_id = EXCLUDED.scanned_location_id,
      result = EXCLUDED.result;
  END LOOP;

  -- Generate results for unexpected scans
  FOR v_scan IN
    SELECT ss.*, i.item_code as current_item_code
    FROM public.stocktake_scans ss
    LEFT JOIN public.items i ON ss.item_id = i.id
    WHERE ss.stocktake_id = p_stocktake_id
      AND ss.scan_result IN ('unexpected', 'released_conflict')
      AND ss.item_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.stocktake_expected_items sei
        WHERE sei.stocktake_id = p_stocktake_id AND sei.item_id = ss.item_id
      )
  LOOP
    v_unexpected := v_unexpected + 1;

    INSERT INTO public.stocktake_results (
      stocktake_id, item_id, item_code, expected_location_id, scanned_location_id,
      result
    ) VALUES (
      p_stocktake_id, v_scan.item_id, COALESCE(v_scan.item_code, v_scan.current_item_code),
      NULL, v_scan.scanned_location_id,
      CASE WHEN v_scan.scan_result = 'released_conflict' THEN 'released_found' ELSE 'found_unexpected' END
    )
    ON CONFLICT (stocktake_id, item_id) DO NOTHING;
  END LOOP;

  -- Create billing events if billable
  IF v_stocktake.billable THEN
    -- Get stocktake rate
    SELECT COALESCE(base_rate, 0.50) INTO v_billing_rate
    FROM public.billable_services
    WHERE tenant_id = v_stocktake.tenant_id AND code = 'STOCKTAKE' AND is_active = true
    LIMIT 1;

    IF v_billing_rate IS NULL THEN
      v_billing_rate := 0.50;
    END IF;

    -- Group scans by account and create billing events
    FOR v_account_scans IN
      SELECT
        sei.account_id,
        COUNT(DISTINCT ss.item_id) as scan_count
      FROM public.stocktake_scans ss
      JOIN public.stocktake_expected_items sei ON sei.stocktake_id = ss.stocktake_id AND sei.item_id = ss.item_id
      WHERE ss.stocktake_id = p_stocktake_id
        AND ss.scan_result != 'duplicate'
        AND sei.account_id IS NOT NULL
        AND (v_stocktake.include_accounts IS NULL
             OR sei.account_id::TEXT = ANY(SELECT jsonb_array_elements_text(v_stocktake.include_accounts)))
      GROUP BY sei.account_id
    LOOP
      INSERT INTO public.billing_events (
        tenant_id, account_id, item_id, service_code, quantity, unit_price, total_amount,
        event_date, description, metadata, created_by
      ) VALUES (
        v_stocktake.tenant_id,
        v_account_scans.account_id,
        NULL,
        'STOCKTAKE',
        v_account_scans.scan_count,
        v_billing_rate,
        v_account_scans.scan_count * v_billing_rate,
        CURRENT_DATE,
        'Stocktake: ' || v_stocktake.stocktake_number || ' (' || v_account_scans.scan_count || ' items)',
        jsonb_build_object('stocktake_id', p_stocktake_id, 'stocktake_number', v_stocktake.stocktake_number),
        p_closed_by
      );

      v_billing_count := v_billing_count + 1;
    END LOOP;
  END IF;

  -- Update stocktake status
  UPDATE public.stocktakes
  SET status = 'closed',
      closed_at = now(),
      closed_by = p_closed_by,
      variance_count = v_missing + v_found_wrong + v_unexpected,
      counted_item_count = v_total_scanned,
      completed_at = now()
  WHERE id = p_stocktake_id;

  RETURN QUERY SELECT
    v_total_expected,
    v_total_scanned,
    v_found_expected,
    v_found_wrong,
    v_missing,
    v_unexpected,
    v_billing_count;
END;
$$;

COMMENT ON FUNCTION public.close_stocktake IS 'Closes stocktake, generates results, and creates billing events if billable';

-- ============================================================================
-- 9. FUNCTION TO CHECK IF ITEM CAN BE MOVED (freeze moves enforcement)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.check_stocktake_freeze(
  p_item_id UUID,
  p_tenant_id UUID
)
RETURNS TABLE (
  is_frozen BOOLEAN,
  stocktake_id UUID,
  stocktake_number TEXT,
  message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_item RECORD;
  v_stocktake RECORD;
  v_location_ids UUID[];
BEGIN
  -- Get item location
  SELECT current_location_id INTO v_item FROM public.items WHERE id = p_item_id;

  -- Check for active stocktakes with freeze_moves that include this location
  FOR v_stocktake IN
    SELECT s.*
    FROM public.stocktakes s
    WHERE s.tenant_id = p_tenant_id
      AND s.status = 'active'
      AND s.freeze_moves = true
  LOOP
    -- Parse location_ids
    IF v_stocktake.location_ids IS NOT NULL THEN
      SELECT array_agg(elem::UUID)
      INTO v_location_ids
      FROM jsonb_array_elements_text(v_stocktake.location_ids) elem;

      IF v_item.current_location_id = ANY(v_location_ids) THEN
        RETURN QUERY SELECT
          true,
          v_stocktake.id,
          v_stocktake.stocktake_number,
          ('Item cannot be moved: active stocktake ' || v_stocktake.stocktake_number || ' has frozen movements')::TEXT;
        RETURN;
      END IF;
    ELSE
      -- No specific locations means entire warehouse
      -- Check if item is in same warehouse
      IF EXISTS (
        SELECT 1 FROM public.locations l
        JOIN public.items i ON i.current_location_id = l.id
        WHERE i.id = p_item_id AND l.warehouse_id = v_stocktake.warehouse_id
      ) THEN
        RETURN QUERY SELECT
          true,
          v_stocktake.id,
          v_stocktake.stocktake_number,
          ('Item cannot be moved: active stocktake ' || v_stocktake.stocktake_number || ' has frozen movements')::TEXT;
        RETURN;
      END IF;
    END IF;
  END LOOP;

  -- Not frozen
  RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, NULL::TEXT;
END;
$$;

COMMENT ON FUNCTION public.check_stocktake_freeze IS 'Checks if an item is frozen due to active stocktake';

-- ============================================================================
-- 10. VIEW FOR STOCKTAKE SCAN STATISTICS
-- ============================================================================

CREATE OR REPLACE VIEW public.v_stocktake_scan_stats AS
SELECT
  s.id as stocktake_id,
  s.stocktake_number,
  s.name,
  s.status,
  s.expected_item_count,
  COALESCE(scan_stats.total_scans, 0) as total_scans,
  COALESCE(scan_stats.unique_items_scanned, 0) as unique_items_scanned,
  COALESCE(scan_stats.expected_count, 0) as found_expected,
  COALESCE(scan_stats.wrong_location_count, 0) as found_wrong_location,
  COALESCE(scan_stats.unexpected_count, 0) as found_unexpected,
  COALESCE(scan_stats.duplicate_count, 0) as duplicates,
  COALESCE(scan_stats.released_conflict_count, 0) as released_conflicts,
  (s.expected_item_count - COALESCE(scan_stats.unique_items_scanned, 0)) as not_yet_scanned
FROM public.stocktakes s
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) as total_scans,
    COUNT(DISTINCT item_id) FILTER (WHERE scan_result != 'duplicate') as unique_items_scanned,
    COUNT(*) FILTER (WHERE scan_result = 'expected') as expected_count,
    COUNT(*) FILTER (WHERE scan_result = 'wrong_location') as wrong_location_count,
    COUNT(*) FILTER (WHERE scan_result = 'unexpected') as unexpected_count,
    COUNT(*) FILTER (WHERE scan_result = 'duplicate') as duplicate_count,
    COUNT(*) FILTER (WHERE scan_result = 'released_conflict') as released_conflict_count
  FROM public.stocktake_scans ss
  WHERE ss.stocktake_id = s.id
) scan_stats ON true;

COMMENT ON VIEW public.v_stocktake_scan_stats IS 'Real-time statistics for stocktake progress';

-- ============================================================================
-- 11. UPDATE STATUS ENUM VALUES IN EXISTING CODE
-- Create helper function to migrate status values
-- ============================================================================

CREATE OR REPLACE FUNCTION public.migrate_stocktake_status()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Map old status values to new ones
  UPDATE public.stocktakes SET status = 'draft' WHERE status = 'planned';
  UPDATE public.stocktakes SET status = 'active' WHERE status = 'in_progress';
  UPDATE public.stocktakes SET status = 'closed' WHERE status = 'completed';
END;
$$;

-- Run migration
SELECT public.migrate_stocktake_status();

-- Drop migration function
DROP FUNCTION public.migrate_stocktake_status();

-- ============================================================================
-- 12. CREATE INDEX FOR FREEZE CHECK PERFORMANCE
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_stocktakes_active_freeze ON public.stocktakes(tenant_id, status, freeze_moves)
WHERE status = 'active' AND freeze_moves = true;
