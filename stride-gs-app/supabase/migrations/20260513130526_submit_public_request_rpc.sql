-- Public service-request form: replace anon direct-INSERT path with a
-- SECURITY DEFINER RPC `submit_public_request(p_order, p_items)`.
--
-- This is the proper fix for the bug shipped in PR #384 (the missing-anon-
-- SELECT-policy that broke `INSERT ... RETURNING`). Direct anon writes have
-- two problems regardless of whether the RETURNING quirk bites you:
--   1. Order + items insert across two HTTP round-trips → a half-success
--      leaves an order with no items.
--   2. Anon needs INSERT (and now SELECT) RLS surface on dt_orders +
--      dt_order_items, which is more attack surface than necessary.
--
-- The RPC fixes both: single transaction, no anon RLS surface needed.
-- This migration only ADDS the RPC; the React form switches to it in the
-- same PR. A FOLLOW-UP migration (BUILD_STATUS backlog item) drops the
-- three legacy anon policies (dt_orders_insert_public_form_anon,
-- dt_orders_select_just_inserted_public_anon, dt_order_items_insert_public_form_anon)
-- once the React change has been live long enough that no in-flight
-- submissions could still be using the old code path.
--
-- Security model:
--   • SECURITY DEFINER → runs as function owner (postgres, has bypassrls)
--   • The function FORCES the policy-critical fields to safe values
--     regardless of what the caller sent: source='public_form',
--     review_status='pending_review', tenant_id=NULL, created_by_user=NULL,
--     created_by_role='public', pricing_override=true, customer_tax_exempt=NULL.
--     A malicious anon caller cannot grant themselves elevated access.
--   • search_path is locked to public to prevent function-hijack attacks.
--   • EXECUTE granted to anon + authenticated only (PUBLIC explicitly REVOKEd).
--   • Returns just {id, dt_identifier} — no row data leak.
--
-- Idempotency / atomicity:
--   • PL/pgSQL function = single implicit transaction. If items insert
--     fails, the order insert rolls back.
--   • dt_identifier is caller-supplied (typically generated client-side
--     as `REQ-${ts36}-${rnd4}`). The unique constraint on
--     (tenant_id, dt_identifier) is effectively non-enforcing for public
--     submissions because tenant_id is NULL and PG treats NULLs as distinct
--     in unique constraints — duplicate identifiers are technically allowed
--     but never collide in practice.

CREATE OR REPLACE FUNCTION public.submit_public_request(
  p_order jsonb,
  p_items jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id      uuid;
  v_dt_identifier text;
  v_item          jsonb;
BEGIN
  -- ── Validate identity / scoping fields ─────────────────────────────
  -- These are the four conditions the now-defunct
  -- dt_orders_insert_public_form_anon policy enforced. We re-enforce
  -- them here because the caller's JSON is untrusted.

  IF (p_order ? 'tenant_id') AND (p_order->>'tenant_id') IS NOT NULL THEN
    RAISE EXCEPTION 'tenant_id must be null on public submissions'
      USING ERRCODE = '22023';
  END IF;

  IF (p_order ? 'created_by_user') AND (p_order->>'created_by_user') IS NOT NULL THEN
    RAISE EXCEPTION 'created_by_user must be null on public submissions'
      USING ERRCODE = '22023';
  END IF;

  v_dt_identifier := COALESCE(p_order->>'dt_identifier', '');
  IF length(v_dt_identifier) = 0 THEN
    RAISE EXCEPTION 'dt_identifier is required'
      USING ERRCODE = '22023';
  END IF;

  -- ── Insert the order row ──────────────────────────────────────────
  -- Policy-critical fields (source, review_status, tenant_id,
  -- created_by_user, created_by_role, pricing_override, customer_tax_exempt)
  -- are FORCED to safe values regardless of the input — this is the
  -- security boundary.
  INSERT INTO public.dt_orders (
    -- Forced
    source,
    review_status,
    tenant_id,
    created_by_user,
    created_by_role,
    pricing_override,
    customer_tax_exempt,
    -- Caller-supplied
    dt_identifier,
    timezone,
    local_service_date,
    window_start_local,
    window_end_local,
    order_type,
    is_pickup,
    contact_name,
    contact_company,
    contact_address,
    contact_city,
    contact_state,
    contact_zip,
    contact_phone,
    contact_phone2,
    contact_email,
    bill_to_name,
    bill_to_company,
    bill_to_email,
    bill_to_phone,
    bill_to_address,
    bill_to_city,
    bill_to_state,
    bill_to_zip,
    details,
    driver_notes,
    base_delivery_fee,
    extra_items_count,
    extra_items_fee,
    accessorials_json,
    accessorials_total,
    coverage_option_id,
    declared_value,
    coverage_charge,
    tax_amount,
    tax_rate_pct,
    order_total,
    pricing_notes
  ) VALUES (
    -- Forced
    'public_form',
    'pending_review',
    NULL,
    NULL,
    'public',
    true,
    NULL,
    -- Caller-supplied
    v_dt_identifier,
    COALESCE(NULLIF(p_order->>'timezone',''), 'America/Los_Angeles'),
    NULLIF(p_order->>'local_service_date','')::date,
    NULLIF(p_order->>'window_start_local','')::time,
    NULLIF(p_order->>'window_end_local','')::time,
    COALESCE(NULLIF(p_order->>'order_type',''), 'delivery'),
    COALESCE((NULLIF(p_order->>'is_pickup',''))::boolean, false),
    NULLIF(p_order->>'contact_name',''),
    NULLIF(p_order->>'contact_company',''),
    NULLIF(p_order->>'contact_address',''),
    NULLIF(p_order->>'contact_city',''),
    NULLIF(p_order->>'contact_state',''),
    NULLIF(p_order->>'contact_zip',''),
    NULLIF(p_order->>'contact_phone',''),
    NULLIF(p_order->>'contact_phone2',''),
    NULLIF(p_order->>'contact_email',''),
    NULLIF(p_order->>'bill_to_name',''),
    NULLIF(p_order->>'bill_to_company',''),
    NULLIF(p_order->>'bill_to_email',''),
    NULLIF(p_order->>'bill_to_phone',''),
    NULLIF(p_order->>'bill_to_address',''),
    NULLIF(p_order->>'bill_to_city',''),
    NULLIF(p_order->>'bill_to_state',''),
    NULLIF(p_order->>'bill_to_zip',''),
    NULLIF(p_order->>'details',''),
    NULLIF(p_order->>'driver_notes',''),
    NULLIF(p_order->>'base_delivery_fee','')::numeric,
    COALESCE((NULLIF(p_order->>'extra_items_count',''))::integer, 0),
    COALESCE((NULLIF(p_order->>'extra_items_fee',''))::numeric, 0),
    CASE WHEN p_order ? 'accessorials_json' AND jsonb_typeof(p_order->'accessorials_json') <> 'null'
         THEN p_order->'accessorials_json'
         ELSE NULL END,
    COALESCE((NULLIF(p_order->>'accessorials_total',''))::numeric, 0),
    NULLIF(p_order->>'coverage_option_id',''),
    NULLIF(p_order->>'declared_value','')::numeric,
    COALESCE((NULLIF(p_order->>'coverage_charge',''))::numeric, 0),
    COALESCE((NULLIF(p_order->>'tax_amount',''))::numeric, 0),
    NULLIF(p_order->>'tax_rate_pct','')::numeric,
    NULLIF(p_order->>'order_total','')::numeric,
    NULLIF(p_order->>'pricing_notes','')
  )
  RETURNING id INTO v_order_id;

  -- ── Insert items (if any) ─────────────────────────────────────────
  -- Items are public-form ad-hoc lines only. dt_order_id is filled in
  -- from the just-inserted order, NOT trusted from caller input.
  IF jsonb_typeof(p_items) = 'array' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
      INSERT INTO public.dt_order_items (
        dt_order_id,
        dt_item_code,
        description,
        quantity,
        original_quantity,
        cubic_feet,
        extras
      ) VALUES (
        v_order_id,
        NULL,
        COALESCE(v_item->>'description', ''),
        COALESCE((NULLIF(v_item->>'quantity',''))::integer, 1),
        COALESCE((NULLIF(v_item->>'original_quantity', v_item->>'quantity'))::integer, 1),
        NULLIF(v_item->>'cubic_feet','')::numeric,
        COALESCE(v_item->'extras', '{}'::jsonb)
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object('id', v_order_id, 'dt_identifier', v_dt_identifier);
END;
$$;

COMMENT ON FUNCTION public.submit_public_request(jsonb, jsonb) IS
  'Public service-request form submission. SECURITY DEFINER so anon can write to dt_orders + dt_order_items in a single transaction without needing direct INSERT/SELECT RLS surface on those tables. Forces source=public_form, review_status=pending_review, tenant_id=NULL, created_by_user=NULL, created_by_role=public, pricing_override=true, customer_tax_exempt=NULL regardless of caller input — these are the security-critical fields. Returns {id, dt_identifier}.';

REVOKE EXECUTE ON FUNCTION public.submit_public_request(jsonb, jsonb) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.submit_public_request(jsonb, jsonb) TO anon, authenticated;
