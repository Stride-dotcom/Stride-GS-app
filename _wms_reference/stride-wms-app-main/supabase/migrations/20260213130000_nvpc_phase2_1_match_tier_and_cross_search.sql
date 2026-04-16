-- =============================================================================
-- NVPC Phase 2.1: match_tier in RPC payload + unknown-account cross-search
-- Updates rpc_find_inbound_candidates only. No schema changes.
-- =============================================================================

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
        -- Unknown account: vendor match across all (20-40)
        WHEN p_account_id IS NULL AND p_vendor_name IS NOT NULL
             AND s.vendor_name IS NOT NULL
             AND s.vendor_name ILIKE '%' || p_vendor_name || '%'
        THEN 30 + CASE
          WHEN p_pieces IS NOT NULL AND s.expected_pieces IS NOT NULL
               AND ABS(s.expected_pieces - p_pieces) <= 2 THEN 10
          ELSE 0
        END
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
        WHEN p_account_id IS NULL AND p_vendor_name IS NOT NULL
             AND s.vendor_name IS NOT NULL
             AND s.vendor_name ILIKE '%' || p_vendor_name || '%'
        THEN 'Vendor Match (Cross-Account)'
        ELSE 'Possible Match'
      END AS confidence_label,
      -- match_tier: structured tier classification for UI debugging
      CASE
        WHEN v_normalized_ref IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.shipment_external_refs r
          WHERE r.shipment_id = s.id AND r.normalized_value = v_normalized_ref
        ) THEN 'tier_1'
        WHEN p_account_id IS NOT NULL AND s.account_id = p_account_id
             AND p_vendor_name IS NOT NULL AND s.vendor_name IS NOT NULL
             AND s.vendor_name ILIKE '%' || p_vendor_name || '%'
        THEN 'tier_2'
        WHEN p_account_id IS NOT NULL AND s.account_id = p_account_id
        THEN 'tier_3'
        WHEN p_account_id IS NULL
        THEN 'unknown_account'
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
