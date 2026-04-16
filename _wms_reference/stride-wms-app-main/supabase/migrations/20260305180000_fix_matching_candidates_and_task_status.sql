-- =============================================================================
-- BUG-BETA-01: Rewrite rpc_find_inbound_candidates with proper scoring
-- BUG-BETA-05: Add unable_to_complete to tasks status CHECK constraint
-- =============================================================================

-- ============================================================
-- 1) FIX: rpc_find_inbound_candidates — field-level scoring,
--    tracking/carrier matching, account filtering, match details
-- ============================================================

-- Drop old 4-param version first to avoid overload ambiguity
DROP FUNCTION IF EXISTS public.rpc_find_inbound_candidates(UUID, TEXT, TEXT, INTEGER);

-- Create new version with tracking_number and carrier params
CREATE OR REPLACE FUNCTION public.rpc_find_inbound_candidates(
  p_account_id UUID DEFAULT NULL,
  p_vendor_name TEXT DEFAULT NULL,
  p_ref_value TEXT DEFAULT NULL,
  p_pieces INTEGER DEFAULT NULL,
  p_tracking_number TEXT DEFAULT NULL,
  p_carrier TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_normalized_ref TEXT;
  v_norm_tracking TEXT;
  v_norm_carrier TEXT;
  v_norm_vendor TEXT;
  v_results JSON;
BEGIN
  v_tenant_id := public.user_tenant_id();

  -- Normalize inputs for comparison
  IF p_ref_value IS NOT NULL AND TRIM(p_ref_value) <> '' THEN
    v_normalized_ref := UPPER(TRIM(REGEXP_REPLACE(p_ref_value, '[^A-Za-z0-9]', '', 'g')));
  END IF;

  IF p_tracking_number IS NOT NULL AND TRIM(p_tracking_number) <> '' THEN
    v_norm_tracking := LOWER(TRIM(p_tracking_number));
  END IF;

  IF p_carrier IS NOT NULL AND TRIM(p_carrier) <> '' THEN
    v_norm_carrier := LOWER(TRIM(p_carrier));
  END IF;

  IF p_vendor_name IS NOT NULL AND TRIM(p_vendor_name) <> '' THEN
    v_norm_vendor := LOWER(TRIM(p_vendor_name));
  END IF;

  SELECT COALESCE(json_agg(row_to_json(scored) ORDER BY total_score DESC, created_at DESC), '[]'::JSON)
  INTO v_results
  FROM (
    SELECT
      sub.shipment_id,
      sub.inbound_kind,
      sub.account_id,
      sub.account_name,
      sub.vendor_name,
      sub.expected_pieces,
      sub.eta_start,
      sub.eta_end,
      sub.created_at,
      sub.shipment_number,
      sub.tracking_number,
      sub.carrier,
      sub.total_score AS confidence_score,
      CASE
        WHEN sub.total_score >= 80 THEN 'Strong Match'
        WHEN sub.total_score >= 50 THEN 'Good Match'
        WHEN sub.total_score >= 30 THEN 'Possible Match'
        ELSE 'Weak Match'
      END AS confidence_label,
      CASE
        WHEN sub.total_score >= 80 THEN 'tier_1'
        WHEN sub.total_score >= 50 THEN 'tier_2'
        WHEN sub.total_score >= 30 THEN 'tier_3'
        WHEN p_account_id IS NULL THEN 'unknown_account'
        ELSE 'no_match'
      END AS match_tier,
      sub.match_details
    FROM (
      SELECT
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
        s.tracking_number,
        s.carrier,
        -- Field-level scoring: tracking=30, reference=25, carrier=15, vendor=15, pieces=10, account=5
        (
          CASE WHEN v_norm_tracking IS NOT NULL AND (
            LOWER(TRIM(COALESCE(s.tracking_number, ''))) = v_norm_tracking
            OR EXISTS (
              SELECT 1 FROM public.shipment_external_refs r
              WHERE r.shipment_id = s.id
                AND r.ref_type = 'TRACKING'
                AND LOWER(TRIM(r.value)) = v_norm_tracking
            )
          ) THEN 30 ELSE 0 END
          +
          CASE WHEN v_normalized_ref IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.shipment_external_refs r
            WHERE r.shipment_id = s.id AND r.normalized_value = v_normalized_ref
          ) THEN 25 ELSE 0 END
          +
          CASE WHEN v_norm_carrier IS NOT NULL AND s.carrier IS NOT NULL
            AND LOWER(s.carrier) ILIKE '%' || v_norm_carrier || '%'
          THEN 15 ELSE 0 END
          +
          CASE WHEN v_norm_vendor IS NOT NULL AND s.vendor_name IS NOT NULL
            AND LOWER(s.vendor_name) ILIKE '%' || v_norm_vendor || '%'
          THEN 15 ELSE 0 END
          +
          CASE WHEN p_pieces IS NOT NULL AND s.expected_pieces IS NOT NULL
            AND ABS(s.expected_pieces - p_pieces) <= 2
          THEN 10 ELSE 0 END
          +
          CASE WHEN p_account_id IS NOT NULL AND s.account_id = p_account_id
          THEN 5 ELSE 0 END
        ) AS total_score,
        -- Match details JSON array for UI display
        (
          SELECT COALESCE(json_agg(detail ORDER BY detail.points DESC), '[]'::JSON)
          FROM (
            SELECT 'tracking' AS field, 30 AS points, COALESCE(s.tracking_number, '') AS matched_value
            WHERE v_norm_tracking IS NOT NULL AND (
              LOWER(TRIM(COALESCE(s.tracking_number, ''))) = v_norm_tracking
              OR EXISTS (
                SELECT 1 FROM public.shipment_external_refs r
                WHERE r.shipment_id = s.id
                  AND r.ref_type = 'TRACKING'
                  AND LOWER(TRIM(r.value)) = v_norm_tracking
              )
            )
            UNION ALL
            SELECT 'reference' AS field, 25 AS points, COALESCE(
              (SELECT r.value FROM public.shipment_external_refs r
               WHERE r.shipment_id = s.id AND r.normalized_value = v_normalized_ref
               LIMIT 1), ''
            ) AS matched_value
            WHERE v_normalized_ref IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.shipment_external_refs r
              WHERE r.shipment_id = s.id AND r.normalized_value = v_normalized_ref
            )
            UNION ALL
            SELECT 'carrier' AS field, 15 AS points, COALESCE(s.carrier, '') AS matched_value
            WHERE v_norm_carrier IS NOT NULL AND s.carrier IS NOT NULL
              AND LOWER(s.carrier) ILIKE '%' || v_norm_carrier || '%'
            UNION ALL
            SELECT 'vendor' AS field, 15 AS points, COALESCE(s.vendor_name, '') AS matched_value
            WHERE v_norm_vendor IS NOT NULL AND s.vendor_name IS NOT NULL
              AND LOWER(s.vendor_name) ILIKE '%' || v_norm_vendor || '%'
            UNION ALL
            SELECT 'pieces' AS field, 10 AS points, COALESCE(s.expected_pieces::TEXT, '') AS matched_value
            WHERE p_pieces IS NOT NULL AND s.expected_pieces IS NOT NULL
              AND ABS(s.expected_pieces - p_pieces) <= 2
            UNION ALL
            SELECT 'account' AS field, 5 AS points, COALESCE(a.account_name, '') AS matched_value
            WHERE p_account_id IS NOT NULL AND s.account_id = p_account_id
          ) detail
        ) AS match_details
      FROM public.shipments s
      LEFT JOIN public.accounts a ON a.id = s.account_id
      WHERE s.tenant_id = v_tenant_id
        AND s.shipment_type = 'inbound'
        AND s.inbound_kind IN ('manifest', 'expected')
        AND (s.inbound_status IS NULL OR s.inbound_status NOT IN ('closed', 'cancelled'))
        AND s.created_at >= now() - interval '90 days'
        AND s.deleted_at IS NULL
        -- Account + signal filter: same account always included,
        -- cross-account only with strong signal match (tracking/reference)
        AND (
          (p_account_id IS NOT NULL AND s.account_id = p_account_id)
          OR
          (v_norm_tracking IS NOT NULL AND (
            LOWER(TRIM(COALESCE(s.tracking_number, ''))) = v_norm_tracking
            OR EXISTS (
              SELECT 1 FROM public.shipment_external_refs r
              WHERE r.shipment_id = s.id
                AND r.ref_type = 'TRACKING'
                AND LOWER(TRIM(r.value)) = v_norm_tracking
            )
          ))
          OR
          (v_normalized_ref IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.shipment_external_refs r
            WHERE r.shipment_id = s.id AND r.normalized_value = v_normalized_ref
          ))
          OR
          (p_account_id IS NULL AND v_norm_vendor IS NOT NULL AND s.vendor_name IS NOT NULL
           AND LOWER(s.vendor_name) ILIKE '%' || v_norm_vendor || '%')
        )
    ) sub
    WHERE sub.total_score > 0
    ORDER BY sub.total_score DESC, sub.created_at DESC
    LIMIT 20
  ) scored;

  RETURN v_results;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_find_inbound_candidates(UUID, TEXT, TEXT, INTEGER, TEXT, TEXT) TO authenticated;


-- ============================================================
-- 2) FIX: tasks_status_check — add unable_to_complete
-- ============================================================

ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_status_check
  CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled', 'unable_to_complete', 'paused'));
