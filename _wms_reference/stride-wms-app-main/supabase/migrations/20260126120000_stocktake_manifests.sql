-- Stocktake Manifests Feature
-- Pre-defined lists of items for targeted stocktake with strict validation
-- Full audit history for all changes
-- ============================================================================

-- ============================================================================
-- 1. CREATE STOCKTAKE_MANIFESTS TABLE
-- Main manifest record with comprehensive audit fields
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.stocktake_manifests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  manifest_number TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  warehouse_id UUID NOT NULL REFERENCES public.warehouses(id),

  -- Location zone (collection of locations for this manifest)
  location_ids JSONB, -- Array of location UUIDs

  -- Status workflow: draft -> active -> in_progress -> completed | cancelled
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'in_progress', 'completed', 'cancelled')),

  -- Billing options (NOT billable by default)
  billable BOOLEAN DEFAULT false,
  include_accounts JSONB, -- Array of account IDs to bill

  -- Counts
  expected_item_count INTEGER DEFAULT 0,
  scanned_item_count INTEGER DEFAULT 0,

  -- Scheduled date
  scheduled_date DATE,
  notes TEXT,

  -- Comprehensive audit fields
  created_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_by UUID REFERENCES public.users(id),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- Scanning audit
  started_by UUID REFERENCES public.users(id),
  started_at TIMESTAMPTZ,

  -- Completion audit
  completed_by UUID REFERENCES public.users(id),
  completed_at TIMESTAMPTZ,

  -- Assigned scanner
  assigned_to UUID REFERENCES public.users(id),

  UNIQUE(tenant_id, manifest_number)
);

-- Generate manifest number
CREATE OR REPLACE FUNCTION public.generate_manifest_number()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_next_number INTEGER;
BEGIN
  -- Get next number for tenant
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

DROP TRIGGER IF EXISTS trg_generate_manifest_number ON public.stocktake_manifests;
CREATE OR REPLACE TRIGGER trg_generate_manifest_number
BEFORE INSERT ON public.stocktake_manifests
FOR EACH ROW
WHEN (NEW.manifest_number IS NULL OR NEW.manifest_number = '')
EXECUTE FUNCTION public.generate_manifest_number();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_manifests_tenant ON public.stocktake_manifests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_manifests_warehouse ON public.stocktake_manifests(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_manifests_status ON public.stocktake_manifests(status);
CREATE INDEX IF NOT EXISTS idx_manifests_created_at ON public.stocktake_manifests(created_at DESC);

-- Enable RLS
ALTER TABLE public.stocktake_manifests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant isolation for manifests" ON public.stocktake_manifests;
CREATE POLICY "Tenant isolation for manifests"
ON public.stocktake_manifests FOR ALL
USING (tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

COMMENT ON TABLE public.stocktake_manifests IS 'Pre-defined item lists for targeted stocktake with full audit trail';
COMMENT ON COLUMN public.stocktake_manifests.location_ids IS 'JSON array of location UUIDs (zone definition)';
COMMENT ON COLUMN public.stocktake_manifests.billable IS 'Whether to create billing events on completion (default: false)';

-- ============================================================================
-- 2. CREATE STOCKTAKE_MANIFEST_ITEMS TABLE
-- Items that belong on this manifest
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.stocktake_manifest_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manifest_id UUID NOT NULL REFERENCES public.stocktake_manifests(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  expected_location_id UUID REFERENCES public.locations(id),

  -- Denormalized for performance and audit trail
  item_code TEXT NOT NULL,
  item_description TEXT,
  account_id UUID REFERENCES public.accounts(id),

  -- Scan tracking
  scanned BOOLEAN DEFAULT false,
  scanned_by UUID REFERENCES public.users(id),
  scanned_at TIMESTAMPTZ,
  scanned_location_id UUID REFERENCES public.locations(id),

  -- Added by (for audit)
  added_by UUID REFERENCES public.users(id),
  added_at TIMESTAMPTZ DEFAULT now(),

  created_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(manifest_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_manifest_items_manifest ON public.stocktake_manifest_items(manifest_id);
CREATE INDEX IF NOT EXISTS idx_manifest_items_item ON public.stocktake_manifest_items(item_id);
CREATE INDEX IF NOT EXISTS idx_manifest_items_scanned ON public.stocktake_manifest_items(manifest_id, scanned);

-- Enable RLS
ALTER TABLE public.stocktake_manifest_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant isolation via manifest for items" ON public.stocktake_manifest_items;
CREATE POLICY "Tenant isolation via manifest for items"
ON public.stocktake_manifest_items FOR ALL
USING (EXISTS (
  SELECT 1 FROM public.stocktake_manifests m
  WHERE m.id = stocktake_manifest_items.manifest_id
  AND m.tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid())
));

COMMENT ON TABLE public.stocktake_manifest_items IS 'Items included in a manifest - only these items are valid for scanning';

-- ============================================================================
-- 3. CREATE STOCKTAKE_MANIFEST_HISTORY TABLE
-- Comprehensive edit history / audit trail
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.stocktake_manifest_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manifest_id UUID NOT NULL REFERENCES public.stocktake_manifests(id) ON DELETE CASCADE,

  -- Action types
  action TEXT NOT NULL CHECK (action IN (
    'created',
    'updated',
    'item_added',
    'item_removed',
    'items_bulk_added',
    'items_bulk_removed',
    'started',
    'completed',
    'cancelled',
    'status_changed'
  )),

  -- Who and when
  changed_by UUID NOT NULL REFERENCES public.users(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Change details (stores before/after values)
  old_values JSONB,
  new_values JSONB,

  -- Optional description
  description TEXT,

  -- For item changes, reference the affected items
  affected_item_ids JSONB -- Array of item UUIDs
);

CREATE INDEX IF NOT EXISTS idx_manifest_history_manifest ON public.stocktake_manifest_history(manifest_id);
CREATE INDEX IF NOT EXISTS idx_manifest_history_action ON public.stocktake_manifest_history(action);
CREATE INDEX IF NOT EXISTS idx_manifest_history_changed_at ON public.stocktake_manifest_history(changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_manifest_history_changed_by ON public.stocktake_manifest_history(changed_by);

-- Enable RLS
ALTER TABLE public.stocktake_manifest_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant isolation via manifest for history" ON public.stocktake_manifest_history;
CREATE POLICY "Tenant isolation via manifest for history"
ON public.stocktake_manifest_history FOR ALL
USING (EXISTS (
  SELECT 1 FROM public.stocktake_manifests m
  WHERE m.id = stocktake_manifest_history.manifest_id
  AND m.tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid())
));

COMMENT ON TABLE public.stocktake_manifest_history IS 'Complete audit trail of all manifest changes';
COMMENT ON COLUMN public.stocktake_manifest_history.old_values IS 'Previous values before the change';
COMMENT ON COLUMN public.stocktake_manifest_history.new_values IS 'New values after the change';

-- ============================================================================
-- 4. CREATE STOCKTAKE_MANIFEST_SCANS TABLE
-- Immutable record of all scan attempts (including rejected scans)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.stocktake_manifest_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manifest_id UUID NOT NULL REFERENCES public.stocktake_manifests(id) ON DELETE CASCADE,

  -- Scan details
  scanned_by UUID NOT NULL REFERENCES public.users(id),
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  scanned_location_id UUID NOT NULL REFERENCES public.locations(id),

  -- Item info (may be null for rejected scans of unknown items)
  item_id UUID REFERENCES public.items(id),
  item_code TEXT NOT NULL,

  -- Scan result
  scan_result TEXT NOT NULL CHECK (scan_result IN (
    'valid',              -- Item is on manifest, scan accepted
    'not_on_manifest',    -- Item NOT on manifest, scan rejected with error
    'duplicate',          -- Item already scanned
    'wrong_location',     -- Item on manifest but at different location
    'item_not_found'      -- Scanned code not found in system
  )),

  -- Error/feedback message
  message TEXT,

  -- Metadata for extensibility
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_manifest_scans_manifest ON public.stocktake_manifest_scans(manifest_id);
CREATE INDEX IF NOT EXISTS idx_manifest_scans_item ON public.stocktake_manifest_scans(item_id);
CREATE INDEX IF NOT EXISTS idx_manifest_scans_result ON public.stocktake_manifest_scans(scan_result);
CREATE INDEX IF NOT EXISTS idx_manifest_scans_scanned_at ON public.stocktake_manifest_scans(scanned_at DESC);

-- Enable RLS
ALTER TABLE public.stocktake_manifest_scans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant isolation via manifest for scans" ON public.stocktake_manifest_scans;
CREATE POLICY "Tenant isolation via manifest for scans"
ON public.stocktake_manifest_scans FOR ALL
USING (EXISTS (
  SELECT 1 FROM public.stocktake_manifests m
  WHERE m.id = stocktake_manifest_scans.manifest_id
  AND m.tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid())
));

COMMENT ON TABLE public.stocktake_manifest_scans IS 'Immutable audit trail of all scan attempts including rejected scans';
COMMENT ON COLUMN public.stocktake_manifest_scans.scan_result IS 'valid=on manifest, not_on_manifest=rejected (triggers error+haptic), duplicate=already scanned';

-- ============================================================================
-- 5. FUNCTION TO RECORD MANIFEST CREATION HISTORY
-- ============================================================================

CREATE OR REPLACE FUNCTION public.record_manifest_creation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
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

DROP TRIGGER IF EXISTS trg_record_manifest_creation ON public.stocktake_manifests;
CREATE OR REPLACE TRIGGER trg_record_manifest_creation
AFTER INSERT ON public.stocktake_manifests
FOR EACH ROW
EXECUTE FUNCTION public.record_manifest_creation();

-- ============================================================================
-- 6. FUNCTION TO RECORD MANIFEST UPDATES
-- ============================================================================

CREATE OR REPLACE FUNCTION public.record_manifest_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_changes JSONB := '{}'::JSONB;
  v_old_values JSONB := '{}'::JSONB;
  v_new_values JSONB := '{}'::JSONB;
BEGIN
  -- Only record if there are actual changes (not just updated_at)
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

  IF OLD.include_accounts IS DISTINCT FROM NEW.include_accounts THEN
    v_old_values := v_old_values || jsonb_build_object('include_accounts', OLD.include_accounts);
    v_new_values := v_new_values || jsonb_build_object('include_accounts', NEW.include_accounts);
  END IF;

  IF OLD.scheduled_date IS DISTINCT FROM NEW.scheduled_date THEN
    v_old_values := v_old_values || jsonb_build_object('scheduled_date', OLD.scheduled_date);
    v_new_values := v_new_values || jsonb_build_object('scheduled_date', NEW.scheduled_date);
  END IF;

  IF OLD.notes IS DISTINCT FROM NEW.notes THEN
    v_old_values := v_old_values || jsonb_build_object('notes', OLD.notes);
    v_new_values := v_new_values || jsonb_build_object('notes', NEW.notes);
  END IF;

  IF OLD.assigned_to IS DISTINCT FROM NEW.assigned_to THEN
    v_old_values := v_old_values || jsonb_build_object('assigned_to', OLD.assigned_to);
    v_new_values := v_new_values || jsonb_build_object('assigned_to', NEW.assigned_to);
  END IF;

  -- Record status changes separately
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

  -- Record other updates if there are changes
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

DROP TRIGGER IF EXISTS trg_record_manifest_update ON public.stocktake_manifests;
CREATE OR REPLACE TRIGGER trg_record_manifest_update
AFTER UPDATE ON public.stocktake_manifests
FOR EACH ROW
EXECUTE FUNCTION public.record_manifest_update();

-- ============================================================================
-- 7. FUNCTION TO RECORD MANIFEST ITEM CHANGES
-- ============================================================================

CREATE OR REPLACE FUNCTION public.record_manifest_item_added()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
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

  -- Update expected_item_count
  UPDATE public.stocktake_manifests
  SET expected_item_count = expected_item_count + 1,
      updated_at = now()
  WHERE id = NEW.manifest_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_record_manifest_item_added ON public.stocktake_manifest_items;
CREATE OR REPLACE TRIGGER trg_record_manifest_item_added
AFTER INSERT ON public.stocktake_manifest_items
FOR EACH ROW
EXECUTE FUNCTION public.record_manifest_item_added();

CREATE OR REPLACE FUNCTION public.record_manifest_item_removed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
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

  -- Update expected_item_count
  UPDATE public.stocktake_manifests
  SET expected_item_count = expected_item_count - 1,
      updated_at = now()
  WHERE id = OLD.manifest_id;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_record_manifest_item_removed ON public.stocktake_manifest_items;
CREATE OR REPLACE TRIGGER trg_record_manifest_item_removed
AFTER DELETE ON public.stocktake_manifest_items
FOR EACH ROW
EXECUTE FUNCTION public.record_manifest_item_removed();

-- ============================================================================
-- 8. FUNCTION TO RECORD A MANIFEST SCAN
-- Returns scan result with validation (error for non-manifest items)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.record_manifest_scan(
  p_manifest_id UUID,
  p_scanned_by UUID,
  p_scanned_location_id UUID,
  p_item_id UUID,
  p_item_code TEXT
)
RETURNS TABLE (
  scan_id UUID,
  result TEXT,
  is_valid BOOLEAN,
  message TEXT,
  trigger_error_feedback BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_manifest RECORD;
  v_manifest_item RECORD;
  v_item RECORD;
  v_scan_result TEXT;
  v_message TEXT;
  v_scan_id UUID;
  v_is_valid BOOLEAN := false;
  v_trigger_error BOOLEAN := false;
BEGIN
  -- Get manifest
  SELECT * INTO v_manifest FROM public.stocktake_manifests WHERE id = p_manifest_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Manifest not found';
  END IF;

  IF v_manifest.status NOT IN ('active', 'in_progress') THEN
    RAISE EXCEPTION 'Manifest is not active';
  END IF;

  -- Update to in_progress if first scan
  IF v_manifest.status = 'active' THEN
    UPDATE public.stocktake_manifests
    SET status = 'in_progress',
        started_by = p_scanned_by,
        started_at = now()
    WHERE id = p_manifest_id;
  END IF;

  -- Check if item exists in system
  SELECT * INTO v_item FROM public.items WHERE id = p_item_id;
  IF NOT FOUND THEN
    v_scan_result := 'item_not_found';
    v_message := 'Item code not found in system: ' || p_item_code;
    v_trigger_error := true;
  ELSE
    -- Check if item is on manifest
    SELECT * INTO v_manifest_item
    FROM public.stocktake_manifest_items
    WHERE manifest_id = p_manifest_id AND item_id = p_item_id;

    IF NOT FOUND THEN
      -- ITEM NOT ON MANIFEST - THIS IS AN ERROR!
      v_scan_result := 'not_on_manifest';
      v_message := 'ERROR: Item ' || p_item_code || ' is NOT on this manifest!';
      v_trigger_error := true;
      v_is_valid := false;
    ELSIF v_manifest_item.scanned THEN
      -- Already scanned
      v_scan_result := 'duplicate';
      v_message := 'Item ' || p_item_code || ' has already been scanned';
      v_trigger_error := true;
      v_is_valid := false;
    ELSE
      -- Valid scan - item is on manifest
      v_scan_result := 'valid';
      v_message := 'Item ' || p_item_code || ' verified successfully';
      v_is_valid := true;
      v_trigger_error := false;

      -- Check location match
      IF v_manifest_item.expected_location_id IS NOT NULL
         AND v_manifest_item.expected_location_id != p_scanned_location_id THEN
        v_scan_result := 'wrong_location';
        v_message := 'Item ' || p_item_code || ' found at different location than expected';
        -- Still valid but with warning
      END IF;

      -- Mark item as scanned
      UPDATE public.stocktake_manifest_items
      SET scanned = true,
          scanned_by = p_scanned_by,
          scanned_at = now(),
          scanned_location_id = p_scanned_location_id
      WHERE id = v_manifest_item.id;

      -- Update scanned_item_count
      UPDATE public.stocktake_manifests
      SET scanned_item_count = scanned_item_count + 1,
          updated_at = now()
      WHERE id = p_manifest_id;
    END IF;
  END IF;

  -- Insert scan record (always - for audit trail)
  INSERT INTO public.stocktake_manifest_scans (
    manifest_id, scanned_by, scanned_location_id, item_id, item_code,
    scan_result, message
  ) VALUES (
    p_manifest_id, p_scanned_by, p_scanned_location_id, p_item_id, p_item_code,
    v_scan_result, v_message
  ) RETURNING id INTO v_scan_id;

  RETURN QUERY SELECT v_scan_id, v_scan_result, v_is_valid, v_message, v_trigger_error;
END;
$$;

COMMENT ON FUNCTION public.record_manifest_scan IS 'Records a manifest scan with strict validation - returns error for non-manifest items';

-- ============================================================================
-- 9. FUNCTION TO START A MANIFEST (activate for scanning)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.start_manifest(
  p_manifest_id UUID,
  p_user_id UUID
)
RETURNS TABLE (
  success BOOLEAN,
  message TEXT,
  item_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_manifest RECORD;
  v_item_count INTEGER;
BEGIN
  -- Get manifest
  SELECT * INTO v_manifest FROM public.stocktake_manifests WHERE id = p_manifest_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Manifest not found'::TEXT, 0;
    RETURN;
  END IF;

  IF v_manifest.status != 'draft' THEN
    RETURN QUERY SELECT false, ('Manifest must be in draft status to start. Current status: ' || v_manifest.status)::TEXT, 0;
    RETURN;
  END IF;

  -- Count items
  SELECT COUNT(*) INTO v_item_count FROM public.stocktake_manifest_items WHERE manifest_id = p_manifest_id;

  IF v_item_count = 0 THEN
    RETURN QUERY SELECT false, 'Cannot start manifest with no items'::TEXT, 0;
    RETURN;
  END IF;

  -- Update status to active
  UPDATE public.stocktake_manifests
  SET status = 'active',
      expected_item_count = v_item_count,
      updated_by = p_user_id,
      updated_at = now()
  WHERE id = p_manifest_id;

  -- Record history
  INSERT INTO public.stocktake_manifest_history (
    manifest_id, action, changed_by, old_values, new_values, description
  ) VALUES (
    p_manifest_id,
    'started',
    p_user_id,
    jsonb_build_object('status', 'draft'),
    jsonb_build_object('status', 'active', 'item_count', v_item_count),
    'Manifest activated for scanning with ' || v_item_count || ' items'
  );

  RETURN QUERY SELECT true, ('Manifest activated with ' || v_item_count || ' items')::TEXT, v_item_count;
END;
$$;

COMMENT ON FUNCTION public.start_manifest IS 'Activates a manifest for scanning';

-- ============================================================================
-- 10. FUNCTION TO COMPLETE A MANIFEST
-- ============================================================================

CREATE OR REPLACE FUNCTION public.complete_manifest(
  p_manifest_id UUID,
  p_user_id UUID
)
RETURNS TABLE (
  success BOOLEAN,
  message TEXT,
  total_items INTEGER,
  scanned_items INTEGER,
  unscanned_items INTEGER,
  billing_events_created INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
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
  -- Get manifest
  SELECT * INTO v_manifest FROM public.stocktake_manifests WHERE id = p_manifest_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Manifest not found'::TEXT, 0, 0, 0, 0;
    RETURN;
  END IF;

  IF v_manifest.status NOT IN ('active', 'in_progress') THEN
    RETURN QUERY SELECT false, ('Manifest must be active or in progress. Current status: ' || v_manifest.status)::TEXT, 0, 0, 0, 0;
    RETURN;
  END IF;

  -- Count items
  SELECT COUNT(*) INTO v_total FROM public.stocktake_manifest_items WHERE manifest_id = p_manifest_id;
  SELECT COUNT(*) INTO v_scanned FROM public.stocktake_manifest_items WHERE manifest_id = p_manifest_id AND scanned = true;
  v_unscanned := v_total - v_scanned;

  -- Create billing events if billable
  IF v_manifest.billable THEN
    -- Get manifest/stocktake rate
    SELECT COALESCE(base_rate, 0.50) INTO v_billing_rate
    FROM public.billable_services
    WHERE tenant_id = v_manifest.tenant_id AND code = 'STOCKTAKE' AND is_active = true
    LIMIT 1;

    IF v_billing_rate IS NULL THEN
      v_billing_rate := 0.50;
    END IF;

    -- Group by account and create billing events
    FOR v_account_items IN
      SELECT
        mi.account_id,
        COUNT(*) FILTER (WHERE mi.scanned = true) as scanned_count
      FROM public.stocktake_manifest_items mi
      WHERE mi.manifest_id = p_manifest_id
        AND mi.scanned = true
        AND mi.account_id IS NOT NULL
        AND (v_manifest.include_accounts IS NULL
             OR mi.account_id::TEXT = ANY(SELECT jsonb_array_elements_text(v_manifest.include_accounts)))
      GROUP BY mi.account_id
      HAVING COUNT(*) FILTER (WHERE mi.scanned = true) > 0
    LOOP
      INSERT INTO public.billing_events (
        tenant_id, account_id, item_id, service_code, quantity, unit_price, total_amount,
        event_date, description, metadata, created_by
      ) VALUES (
        v_manifest.tenant_id,
        v_account_items.account_id,
        NULL,
        'STOCKTAKE',
        v_account_items.scanned_count,
        v_billing_rate,
        v_account_items.scanned_count * v_billing_rate,
        CURRENT_DATE,
        'Manifest: ' || v_manifest.manifest_number || ' (' || v_account_items.scanned_count || ' items)',
        jsonb_build_object('manifest_id', p_manifest_id, 'manifest_number', v_manifest.manifest_number),
        p_user_id
      );

      v_billing_count := v_billing_count + 1;
    END LOOP;
  END IF;

  -- Update manifest status
  UPDATE public.stocktake_manifests
  SET status = 'completed',
      completed_by = p_user_id,
      completed_at = now(),
      scanned_item_count = v_scanned,
      updated_by = p_user_id,
      updated_at = now()
  WHERE id = p_manifest_id;

  -- Record history
  INSERT INTO public.stocktake_manifest_history (
    manifest_id, action, changed_by, old_values, new_values, description
  ) VALUES (
    p_manifest_id,
    'completed',
    p_user_id,
    jsonb_build_object('status', v_manifest.status),
    jsonb_build_object(
      'status', 'completed',
      'total_items', v_total,
      'scanned_items', v_scanned,
      'unscanned_items', v_unscanned,
      'billing_events', v_billing_count
    ),
    'Manifest completed: ' || v_scanned || '/' || v_total || ' items scanned'
  );

  RETURN QUERY SELECT true, ('Manifest completed: ' || v_scanned || '/' || v_total || ' items scanned')::TEXT, v_total, v_scanned, v_unscanned, v_billing_count;
END;
$$;

COMMENT ON FUNCTION public.complete_manifest IS 'Completes a manifest and optionally creates billing events';

-- ============================================================================
-- 11. FUNCTION TO CANCEL A MANIFEST
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cancel_manifest(
  p_manifest_id UUID,
  p_user_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS TABLE (
  success BOOLEAN,
  message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_manifest RECORD;
BEGIN
  -- Get manifest
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

  -- Update status
  UPDATE public.stocktake_manifests
  SET status = 'cancelled',
      updated_by = p_user_id,
      updated_at = now(),
      notes = CASE
        WHEN p_reason IS NOT NULL THEN COALESCE(notes || E'\n', '') || 'Cancelled: ' || p_reason
        ELSE notes
      END
  WHERE id = p_manifest_id;

  -- Record history
  INSERT INTO public.stocktake_manifest_history (
    manifest_id, action, changed_by, old_values, new_values, description
  ) VALUES (
    p_manifest_id,
    'cancelled',
    p_user_id,
    jsonb_build_object('status', v_manifest.status),
    jsonb_build_object('status', 'cancelled', 'reason', p_reason),
    COALESCE('Manifest cancelled: ' || p_reason, 'Manifest cancelled')
  );

  RETURN QUERY SELECT true, 'Manifest cancelled successfully'::TEXT;
END;
$$;

COMMENT ON FUNCTION public.cancel_manifest IS 'Cancels a manifest with optional reason';

-- ============================================================================
-- 12. VIEW FOR MANIFEST STATISTICS
-- ============================================================================

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

COMMENT ON VIEW public.v_manifest_stats IS 'Real-time statistics for manifest progress including rejected scan counts';

-- ============================================================================
-- 13. ADD MANIFEST SERVICE TO BILLING (PALLET PREP)
-- ============================================================================

INSERT INTO public.billable_services (tenant_id, code, name, description, is_active, base_rate, pricing_mode)
SELECT
  t.id,
  'PALLET_PREP',
  'Pallet Prep',
  'Pallet preparation charge for manifest processing',
  true,
  5.00,
  'flat'
FROM public.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM public.billable_services bs
  WHERE bs.tenant_id = t.id AND bs.code = 'PALLET_PREP'
)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 14. FUNCTION TO ADD ITEMS TO MANIFEST IN BULK
-- ============================================================================

CREATE OR REPLACE FUNCTION public.add_manifest_items_bulk(
  p_manifest_id UUID,
  p_item_ids UUID[],
  p_added_by UUID
)
RETURNS TABLE (
  success BOOLEAN,
  message TEXT,
  items_added INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_manifest RECORD;
  v_count INTEGER := 0;
  v_item RECORD;
BEGIN
  -- Get manifest
  SELECT * INTO v_manifest FROM public.stocktake_manifests WHERE id = p_manifest_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Manifest not found'::TEXT, 0;
    RETURN;
  END IF;

  IF v_manifest.status != 'draft' THEN
    RETURN QUERY SELECT false, 'Can only add items to draft manifests'::TEXT, 0;
    RETURN;
  END IF;

  -- Insert items
  FOR v_item IN
    SELECT i.id, i.item_code, i.description, i.current_location_id, i.account_id
    FROM public.items i
    WHERE i.id = ANY(p_item_ids)
      AND i.tenant_id = v_manifest.tenant_id
      AND i.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.stocktake_manifest_items mi
        WHERE mi.manifest_id = p_manifest_id AND mi.item_id = i.id
      )
  LOOP
    INSERT INTO public.stocktake_manifest_items (
      manifest_id, item_id, expected_location_id, item_code, item_description,
      account_id, added_by
    ) VALUES (
      p_manifest_id, v_item.id, v_item.current_location_id, v_item.item_code,
      v_item.description, v_item.account_id, p_added_by
    );
    v_count := v_count + 1;
  END LOOP;

  -- Record bulk history entry
  IF v_count > 0 THEN
    INSERT INTO public.stocktake_manifest_history (
      manifest_id, action, changed_by, new_values, affected_item_ids, description
    ) VALUES (
      p_manifest_id,
      'items_bulk_added',
      p_added_by,
      jsonb_build_object('count', v_count),
      to_jsonb(p_item_ids),
      v_count || ' items added to manifest in bulk'
    );
  END IF;

  RETURN QUERY SELECT true, (v_count || ' items added to manifest')::TEXT, v_count;
END;
$$;

COMMENT ON FUNCTION public.add_manifest_items_bulk IS 'Add multiple items to a manifest at once';

-- ============================================================================
-- 15. FUNCTION TO REMOVE ITEMS FROM MANIFEST IN BULK
-- ============================================================================

CREATE OR REPLACE FUNCTION public.remove_manifest_items_bulk(
  p_manifest_id UUID,
  p_item_ids UUID[],
  p_removed_by UUID
)
RETURNS TABLE (
  success BOOLEAN,
  message TEXT,
  items_removed INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_manifest RECORD;
  v_count INTEGER := 0;
  v_removed_items JSONB;
BEGIN
  -- Get manifest
  SELECT * INTO v_manifest FROM public.stocktake_manifests WHERE id = p_manifest_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Manifest not found'::TEXT, 0;
    RETURN;
  END IF;

  IF v_manifest.status != 'draft' THEN
    RETURN QUERY SELECT false, 'Can only remove items from draft manifests'::TEXT, 0;
    RETURN;
  END IF;

  -- Get items being removed for history
  SELECT jsonb_agg(jsonb_build_object('item_id', item_id, 'item_code', item_code))
  INTO v_removed_items
  FROM public.stocktake_manifest_items
  WHERE manifest_id = p_manifest_id AND item_id = ANY(p_item_ids);

  -- Delete items
  DELETE FROM public.stocktake_manifest_items
  WHERE manifest_id = p_manifest_id AND item_id = ANY(p_item_ids);

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Record bulk history entry (the individual triggers won't fire because we use bulk delete)
  IF v_count > 0 THEN
    INSERT INTO public.stocktake_manifest_history (
      manifest_id, action, changed_by, old_values, affected_item_ids, description
    ) VALUES (
      p_manifest_id,
      'items_bulk_removed',
      p_removed_by,
      jsonb_build_object('count', v_count, 'items', v_removed_items),
      to_jsonb(p_item_ids),
      v_count || ' items removed from manifest in bulk'
    );

    -- Update count
    UPDATE public.stocktake_manifests
    SET expected_item_count = expected_item_count - v_count,
        updated_at = now()
    WHERE id = p_manifest_id;
  END IF;

  RETURN QUERY SELECT true, (v_count || ' items removed from manifest')::TEXT, v_count;
END;
$$;

COMMENT ON FUNCTION public.remove_manifest_items_bulk IS 'Remove multiple items from a manifest at once';
