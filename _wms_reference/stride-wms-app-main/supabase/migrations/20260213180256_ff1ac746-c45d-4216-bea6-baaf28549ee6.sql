
-- MIGRATION 2 of 5: Location grouping + flag links + updated RPC

-- SECTION A: ADD group_code TO locations
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'locations' AND column_name = 'group_code'
  ) THEN
    ALTER TABLE public.locations ADD COLUMN group_code TEXT NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_locations_wh_group
  ON public.locations(warehouse_id, group_code);

-- SECTION B: LOCATION CAPABILITY FLAGS
CREATE TABLE IF NOT EXISTS public.location_flag_links (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL,
  location_id  UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  service_code TEXT NOT NULL,
  charge_type_id UUID REFERENCES public.charge_types(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   UUID NULL,
  CONSTRAINT location_flag_links_unique UNIQUE (location_id, service_code)
);

CREATE INDEX IF NOT EXISTS idx_location_flag_links_tenant_location
  ON public.location_flag_links(tenant_id, location_id);

CREATE INDEX IF NOT EXISTS idx_location_flag_links_tenant_service
  ON public.location_flag_links(tenant_id, service_code);

ALTER TABLE public.location_flag_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "location_flag_links_tenant_select" ON public.location_flag_links;
CREATE POLICY "location_flag_links_tenant_select"
  ON public.location_flag_links FOR SELECT
  USING (tenant_id = public.user_tenant_id());

DROP POLICY IF EXISTS "location_flag_links_tenant_insert" ON public.location_flag_links;
CREATE POLICY "location_flag_links_tenant_insert"
  ON public.location_flag_links FOR INSERT
  WITH CHECK (tenant_id = public.user_tenant_id());

DROP POLICY IF EXISTS "location_flag_links_tenant_delete" ON public.location_flag_links;
CREATE POLICY "location_flag_links_tenant_delete"
  ON public.location_flag_links FOR DELETE
  USING (tenant_id = public.user_tenant_id());

DROP POLICY IF EXISTS "location_flag_links_tenant_update" ON public.location_flag_links;
CREATE POLICY "location_flag_links_tenant_update"
  ON public.location_flag_links FOR UPDATE
  USING (tenant_id = public.user_tenant_id())
  WITH CHECK (tenant_id = public.user_tenant_id());

GRANT ALL ON public.location_flag_links TO authenticated;

ALTER TABLE public.location_capacity_cache ENABLE ROW LEVEL SECURITY;

-- SECTION D: UPDATE rpc_get_location_suggestions with group_code + flag support
CREATE OR REPLACE FUNCTION public.rpc_get_location_suggestions(
  p_tenant_id    UUID,
  p_warehouse_id UUID,
  p_mode         TEXT,
  p_item_id      UUID DEFAULT NULL,
  p_item_ids     UUID[] DEFAULT NULL
)
RETURNS TABLE (
  location_id       UUID,
  location_code     TEXT,
  capacity_cuft     NUMERIC,
  used_cuft         NUMERIC,
  available_cuft    NUMERIC,
  utilization_pct   NUMERIC,
  flag_compliant    BOOLEAN,
  account_cluster   BOOLEAN,
  sku_or_vendor_match BOOLEAN,
  group_match       BOOLEAN,
  leftover_cuft     NUMERIC,
  overflow          BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_required_volume  NUMERIC;
  v_item_account_id  UUID;
  v_item_code        TEXT;
  v_item_vendor      TEXT;
  v_ref_item_id      UUID;
  v_item_location_id UUID;
  v_item_group_code  TEXT;
  v_item_flag_count  INT := 0;
  v_eligible_count   INT;
BEGIN
  IF public.user_tenant_id() IS DISTINCT FROM p_tenant_id THEN
    RAISE EXCEPTION 'TENANT_MISMATCH: Caller tenant does not match p_tenant_id';
  END IF;

  IF NOT public.user_has_warehouse_access(auth.uid(), p_warehouse_id) THEN
    RAISE EXCEPTION 'ACCESS_DENIED: User does not have access to warehouse %', p_warehouse_id;
  END IF;

  IF p_mode NOT IN ('single', 'batch') THEN
    RAISE EXCEPTION 'INVALID_MODE: mode must be single or batch, got %', p_mode;
  END IF;

  IF p_mode = 'single' THEN
    IF p_item_id IS NULL THEN
      RAISE EXCEPTION 'INVALID_INPUT: item_id required for single mode';
    END IF;
    v_ref_item_id := p_item_id;
    SELECT COALESCE(i.size, 0), i.account_id, i.item_code, i.vendor, i.location_id
    INTO v_required_volume, v_item_account_id, v_item_code, v_item_vendor, v_item_location_id
    FROM public.items i
    WHERE i.id = p_item_id AND i.tenant_id = p_tenant_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ITEM_NOT_FOUND: item_id % not found for tenant', p_item_id;
    END IF;
  ELSIF p_mode = 'batch' THEN
    IF p_item_ids IS NULL OR array_length(p_item_ids, 1) IS NULL THEN
      RAISE EXCEPTION 'INVALID_INPUT: item_ids required for batch mode';
    END IF;
    v_ref_item_id := p_item_ids[1];
    SELECT COALESCE(SUM(COALESCE(i.size, 0)), 0) INTO v_required_volume
    FROM public.items i WHERE i.id = ANY(p_item_ids) AND i.tenant_id = p_tenant_id;
    SELECT i.account_id, i.item_code, i.vendor, i.location_id
    INTO v_item_account_id, v_item_code, v_item_vendor, v_item_location_id
    FROM public.items i WHERE i.id = p_item_ids[1] AND i.tenant_id = p_tenant_id;
  END IF;

  IF v_item_location_id IS NOT NULL THEN
    SELECT l.group_code INTO v_item_group_code
    FROM public.locations l WHERE l.id = v_item_location_id;
  END IF;

  SELECT count(DISTINCT ifr.service_code) INTO v_item_flag_count
  FROM public.item_flags ifr
  WHERE ifr.item_id = v_ref_item_id AND ifr.tenant_id = p_tenant_id;

  SELECT count(*) INTO v_eligible_count
  FROM public.locations l
  JOIN public.location_capacity_cache c ON c.location_id = l.id
  WHERE l.warehouse_id = p_warehouse_id
    AND l.capacity_cuft IS NOT NULL
    AND l.deleted_at IS NULL
    AND c.utilization_pct < 0.90;

  IF v_eligible_count > 0 THEN
    RETURN QUERY
    WITH
    item_req_flags AS (
      SELECT DISTINCT ifr.service_code
      FROM public.item_flags ifr
      WHERE ifr.item_id = v_ref_item_id AND ifr.tenant_id = p_tenant_id
    ),
    loc_flag_match AS (
      SELECT lfl.location_id AS loc_id, count(DISTINCT lfl.service_code) AS matched_count
      FROM public.location_flag_links lfl
      WHERE lfl.tenant_id = p_tenant_id
        AND lfl.service_code IN (SELECT service_code FROM item_req_flags)
      GROUP BY lfl.location_id
    ),
    account_volume AS (
      SELECT i.location_id AS loc_id, COALESCE(SUM(COALESCE(i.size, 0)), 0) AS acct_vol
      FROM public.items i
      WHERE i.tenant_id = p_tenant_id AND i.account_id = v_item_account_id
        AND i.location_id IS NOT NULL AND i.deleted_at IS NULL
      GROUP BY i.location_id
    ),
    sku_vendor_match AS (
      SELECT DISTINCT i.location_id AS loc_id
      FROM public.items i
      WHERE i.tenant_id = p_tenant_id AND i.location_id IS NOT NULL AND i.deleted_at IS NULL
        AND ((v_item_code IS NOT NULL AND i.item_code = v_item_code) OR (v_item_vendor IS NOT NULL AND i.vendor = v_item_vendor))
    )
    SELECT
      l.id AS location_id, l.code AS location_code, l.capacity_cuft, c.used_cuft, c.available_cuft, c.utilization_pct,
      CASE WHEN v_item_flag_count = 0 THEN TRUE
           WHEN COALESCE(lfm.matched_count, 0) >= v_item_flag_count THEN TRUE
           ELSE FALSE END AS flag_compliant,
      COALESCE(av.acct_vol >= 35, FALSE) AS account_cluster,
      (svm.loc_id IS NOT NULL) AS sku_or_vendor_match,
      (v_item_group_code IS NOT NULL AND l.group_code IS NOT NULL AND l.group_code = v_item_group_code) AS group_match,
      (c.available_cuft - v_required_volume) AS leftover_cuft,
      FALSE AS overflow
    FROM public.locations l
    JOIN public.location_capacity_cache c ON c.location_id = l.id
    LEFT JOIN loc_flag_match lfm ON lfm.loc_id = l.id
    LEFT JOIN account_volume av ON av.loc_id = l.id
    LEFT JOIN sku_vendor_match svm ON svm.loc_id = l.id
    WHERE l.warehouse_id = p_warehouse_id AND l.capacity_cuft IS NOT NULL AND l.deleted_at IS NULL AND c.utilization_pct < 0.90
    ORDER BY
      CASE WHEN v_item_flag_count = 0 THEN TRUE WHEN COALESCE(lfm.matched_count, 0) >= v_item_flag_count THEN TRUE ELSE FALSE END DESC,
      COALESCE(av.acct_vol >= 35, FALSE) DESC,
      (svm.loc_id IS NOT NULL) DESC,
      (v_item_group_code IS NOT NULL AND l.group_code IS NOT NULL AND l.group_code = v_item_group_code) DESC,
      (c.available_cuft - v_required_volume) ASC,
      c.available_cuft DESC,
      l.id ASC
    LIMIT 3;
  ELSE
    RETURN QUERY
    WITH
    item_req_flags_overflow AS (
      SELECT DISTINCT ifr.service_code FROM public.item_flags ifr
      WHERE ifr.item_id = v_ref_item_id AND ifr.tenant_id = p_tenant_id
    ),
    loc_flag_match_overflow AS (
      SELECT lfl.location_id AS loc_id, count(DISTINCT lfl.service_code) AS matched_count
      FROM public.location_flag_links lfl
      WHERE lfl.tenant_id = p_tenant_id AND lfl.service_code IN (SELECT service_code FROM item_req_flags_overflow)
      GROUP BY lfl.location_id
    )
    SELECT
      l.id AS location_id, l.code AS location_code, l.capacity_cuft, c.used_cuft, c.available_cuft, c.utilization_pct,
      CASE WHEN v_item_flag_count = 0 THEN TRUE WHEN COALESCE(lfmo.matched_count, 0) >= v_item_flag_count THEN TRUE ELSE FALSE END AS flag_compliant,
      FALSE AS account_cluster, FALSE AS sku_or_vendor_match,
      (v_item_group_code IS NOT NULL AND l.group_code IS NOT NULL AND l.group_code = v_item_group_code) AS group_match,
      (c.available_cuft - v_required_volume) AS leftover_cuft,
      TRUE AS overflow
    FROM public.locations l
    JOIN public.location_capacity_cache c ON c.location_id = l.id
    LEFT JOIN loc_flag_match_overflow lfmo ON lfmo.loc_id = l.id
    WHERE l.warehouse_id = p_warehouse_id AND l.capacity_cuft IS NOT NULL AND l.deleted_at IS NULL
    ORDER BY c.available_cuft DESC, l.id ASC
    LIMIT 3;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_get_location_suggestions(UUID, UUID, TEXT, UUID, UUID[]) TO authenticated;

-- MIGRATION 3 of 5: Harden get_effective_rate tenant check
CREATE OR REPLACE FUNCTION public.get_effective_rate(
  p_tenant_id UUID,
  p_charge_code TEXT,
  p_account_id UUID DEFAULT NULL,
  p_class_code TEXT DEFAULT NULL
)
RETURNS TABLE (
  charge_type_id UUID,
  charge_code TEXT,
  charge_name TEXT,
  category TEXT,
  is_taxable BOOLEAN,
  default_trigger TEXT,
  input_mode TEXT,
  service_time_minutes INTEGER,
  add_to_scan BOOLEAN,
  add_flag BOOLEAN,
  unit TEXT,
  base_rate NUMERIC,
  effective_rate NUMERIC,
  adjustment_type TEXT,
  adjustment_applied BOOLEAN,
  error_message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_charge_type RECORD;
  v_pricing_rule RECORD;
  v_adjustment RECORD;
  v_base_rate NUMERIC;
  v_effective_rate NUMERIC;
  v_adjustment_type TEXT := NULL;
  v_adjustment_applied BOOLEAN := false;
  v_error_message TEXT := NULL;
  v_caller_tenant_id UUID;
BEGIN
  SELECT u.tenant_id INTO v_caller_tenant_id
  FROM public.users u WHERE u.id = auth.uid();

  IF v_caller_tenant_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  IF v_caller_tenant_id IS DISTINCT FROM p_tenant_id THEN
    RAISE EXCEPTION 'TENANT_MISMATCH';
  END IF;

  SELECT * INTO v_charge_type
  FROM public.charge_types ct
  WHERE ct.tenant_id = p_tenant_id AND ct.charge_code = p_charge_code
    AND ct.is_active = true AND ct.deleted_at IS NULL;

  IF v_charge_type.id IS NULL THEN
    v_error_message := 'Charge type not found: ' || p_charge_code;
    RETURN QUERY SELECT
      NULL::UUID, p_charge_code, NULL::TEXT, NULL::TEXT, false, 'manual', 'qty',
      0, false, false, 'each', 0::NUMERIC, 0::NUMERIC, NULL::TEXT, false, v_error_message;
    RETURN;
  END IF;

  IF p_class_code IS NOT NULL THEN
    SELECT * INTO v_pricing_rule
    FROM public.pricing_rules pr
    WHERE pr.charge_type_id = v_charge_type.id AND pr.class_code = p_class_code AND pr.deleted_at IS NULL;
  END IF;

  IF v_pricing_rule.id IS NULL THEN
    SELECT * INTO v_pricing_rule
    FROM public.pricing_rules pr
    WHERE pr.charge_type_id = v_charge_type.id AND pr.is_default = true AND pr.deleted_at IS NULL;
  END IF;

  IF v_pricing_rule.id IS NULL THEN
    SELECT * INTO v_pricing_rule
    FROM public.pricing_rules pr
    WHERE pr.charge_type_id = v_charge_type.id AND pr.deleted_at IS NULL
    ORDER BY pr.class_code NULLS FIRST LIMIT 1;
  END IF;

  IF v_pricing_rule.id IS NULL THEN
    v_error_message := 'No pricing rule found for: ' || p_charge_code;
    v_base_rate := 0;
  ELSE
    v_base_rate := COALESCE(v_pricing_rule.rate, 0);
  END IF;

  v_effective_rate := v_base_rate;

  IF p_account_id IS NOT NULL AND v_pricing_rule.id IS NOT NULL THEN
    SELECT * INTO v_adjustment
    FROM public.account_service_settings ass
    WHERE ass.account_id = p_account_id AND ass.service_code = p_charge_code;

    IF v_adjustment.id IS NOT NULL THEN
      IF v_adjustment.is_enabled = false THEN
        v_error_message := 'Billing for this service is disabled for this account. Please update account pricing settings to continue.';
        RETURN QUERY SELECT
          v_charge_type.id, v_charge_type.charge_code, v_charge_type.charge_name,
          v_charge_type.category, v_charge_type.is_taxable, v_charge_type.default_trigger,
          v_charge_type.input_mode, COALESCE(v_pricing_rule.service_time_minutes, 0),
          v_charge_type.add_to_scan, v_charge_type.add_flag,
          COALESCE(v_pricing_rule.unit, 'each'), v_base_rate, 0::NUMERIC,
          NULL::TEXT, false, v_error_message;
        RETURN;
      END IF;

      IF v_adjustment.custom_rate IS NOT NULL THEN
        v_adjustment_applied := true;
        v_adjustment_type := 'override';
        v_effective_rate := v_adjustment.custom_rate;
      ELSIF v_adjustment.custom_percent_adjust IS NOT NULL THEN
        v_adjustment_applied := true;
        v_adjustment_type := 'percentage';
        v_effective_rate := v_base_rate * (1 + v_adjustment.custom_percent_adjust / 100);
      END IF;
    END IF;
  END IF;

  RETURN QUERY SELECT
    v_charge_type.id, v_charge_type.charge_code, v_charge_type.charge_name,
    v_charge_type.category, v_charge_type.is_taxable, v_charge_type.default_trigger,
    v_charge_type.input_mode, COALESCE(v_pricing_rule.service_time_minutes, 0),
    v_charge_type.add_to_scan, v_charge_type.add_flag,
    COALESCE(v_pricing_rule.unit, 'each'), v_base_rate, v_effective_rate,
    v_adjustment_type, v_adjustment_applied, v_error_message;
END;
$function$;

-- MIGRATION 4 of 5: match_tier in rpc_find_inbound_candidates
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
        WHEN v_normalized_ref IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.shipment_external_refs r
          WHERE r.shipment_id = s.id AND r.normalized_value = v_normalized_ref
        ) THEN
          CASE WHEN p_account_id IS NOT NULL AND s.account_id = p_account_id THEN 100 ELSE 95 END
        WHEN p_account_id IS NOT NULL AND s.account_id = p_account_id
             AND p_vendor_name IS NOT NULL AND s.vendor_name IS NOT NULL
             AND s.vendor_name ILIKE '%' || p_vendor_name || '%'
        THEN 80 + CASE WHEN p_pieces IS NOT NULL AND s.expected_pieces IS NOT NULL AND ABS(s.expected_pieces - p_pieces) <= 2 THEN 10 ELSE 0 END
        WHEN p_account_id IS NOT NULL AND s.account_id = p_account_id THEN
          30 + CASE WHEN p_pieces IS NOT NULL AND s.expected_pieces IS NOT NULL AND ABS(s.expected_pieces - p_pieces) <= 2 THEN 20 ELSE 0 END
        WHEN p_account_id IS NULL AND p_vendor_name IS NOT NULL AND s.vendor_name IS NOT NULL
             AND s.vendor_name ILIKE '%' || p_vendor_name || '%'
        THEN 30 + CASE WHEN p_pieces IS NOT NULL AND s.expected_pieces IS NOT NULL AND ABS(s.expected_pieces - p_pieces) <= 2 THEN 10 ELSE 0 END
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
        WHEN p_account_id IS NOT NULL AND s.account_id = p_account_id THEN 'Account Match'
        WHEN p_account_id IS NULL AND p_vendor_name IS NOT NULL AND s.vendor_name IS NOT NULL
             AND s.vendor_name ILIKE '%' || p_vendor_name || '%'
        THEN 'Vendor Match (Cross-Account)'
        ELSE 'Possible Match'
      END AS confidence_label,
      CASE
        WHEN v_normalized_ref IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.shipment_external_refs r
          WHERE r.shipment_id = s.id AND r.normalized_value = v_normalized_ref
        ) THEN 'tier_1'
        WHEN p_account_id IS NOT NULL AND s.account_id = p_account_id
             AND p_vendor_name IS NOT NULL AND s.vendor_name IS NOT NULL
             AND s.vendor_name ILIKE '%' || p_vendor_name || '%'
        THEN 'tier_2'
        WHEN p_account_id IS NOT NULL AND s.account_id = p_account_id THEN 'tier_3'
        WHEN p_account_id IS NULL THEN 'unknown_account'
        ELSE 'no_match'
      END AS match_tier
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

-- MIGRATION 5 of 5: Shipment Exception Type + Source Linkage + Quarantine Guard
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='shipments' AND column_name='shipment_exception_type'
  ) THEN
    ALTER TABLE public.shipments ADD COLUMN shipment_exception_type TEXT NULL
      CHECK (shipment_exception_type IS NULL OR shipment_exception_type IN ('UNKNOWN_ACCOUNT','MIS_SHIP','RETURN_TO_SENDER'));
  END IF;
END $$;

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
  SELECT * INTO v_shipment FROM shipments WHERE id = p_shipment_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'blockers', jsonb_build_array(
        jsonb_build_object('code', 'SHIPMENT_NOT_FOUND', 'message', 'Shipment not found.', 'severity', 'blocking')
      )
    );
  END IF;

  SELECT COUNT(*) INTO v_quarantined_count
  FROM shipment_items outbound_si
  WHERE outbound_si.shipment_id = p_shipment_id
    AND outbound_si.item_id IS NOT NULL
    AND outbound_si.status != 'cancelled'
    AND (
      EXISTS (
        SELECT 1 FROM shipment_items inbound_si
        JOIN shipments inbound_s ON inbound_s.id = inbound_si.shipment_id
        WHERE inbound_si.item_id = outbound_si.item_id
          AND inbound_s.id != p_shipment_id
          AND inbound_s.shipment_exception_type IN ('MIS_SHIP', 'RETURN_TO_SENDER')
      )
      OR
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

  IF COALESCE(v_shipment.customer_authorized, false) = false THEN
    v_blockers := v_blockers || jsonb_build_array(
      jsonb_build_object('code', 'NO_AUTHORIZATION', 'message', 'Customer authorization is required.', 'severity', 'blocking')
    );
  END IF;

  IF v_shipment.release_type IS NULL OR v_shipment.release_type = '' THEN
    v_blockers := v_blockers || jsonb_build_array(
      jsonb_build_object('code', 'NO_RELEASE_TYPE', 'message', 'Release type is required.', 'severity', 'blocking')
    );
  END IF;

  IF (v_shipment.released_to IS NULL OR v_shipment.released_to = '')
     AND (v_shipment.driver_name IS NULL OR v_shipment.driver_name = '') THEN
    v_blockers := v_blockers || jsonb_build_array(
      jsonb_build_object('code', 'NO_RELEASED_TO', 'message', 'Released To / Driver Name is required.', 'severity', 'blocking')
    );
  END IF;

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
        'message', format('%s blocking task(s) must be completed first.', v_unresolved_tasks),
        'severity', 'blocking'
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', jsonb_array_length(v_blockers) = 0,
    'blockers', v_blockers
  );
END;
$$;
