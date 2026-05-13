-- Fixes two regressions in the submit_public_request RPC added in
-- migration 20260513130526:
--
-- 1. `original_quantity` always landed at 1. The expression
--      COALESCE((NULLIF(v_item->>'original_quantity', v_item->>'quantity'))::integer, 1)
--    used `NULLIF(a, b)` which returns NULL when a = b — but that's
--    not the intent. When the React caller omits `original_quantity`
--    (which the new RPC-aware code does), `v_item->>'original_quantity'`
--    is SQL NULL, so `NULLIF(NULL, '<qty>')` is NULL, and COALESCE
--    falls through to 1. Every public submission's
--    `dt_order_items.original_quantity` would have been 1 regardless of
--    `quantity`. The correct expression chains COALESCE: prefer caller-
--    supplied original_quantity, fall back to quantity, fall back to 1.
--
-- 2. `quantity` and `original_quantity` were cast to `::integer`, but the
--    schema columns are `numeric`. Today the React form always sends
--    integers so this would not error in practice, but a future caller
--    sending `2.5` would hit a cast error rather than the silent
--    storage `numeric` would give. Switched both to `::numeric`.
--
-- This is a CREATE OR REPLACE so the function is fully redefined; the
-- previous (buggy) definition is gone after this migration.

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

  INSERT INTO public.dt_orders (
    source, review_status, tenant_id, created_by_user, created_by_role, pricing_override, customer_tax_exempt,
    dt_identifier, timezone, local_service_date, window_start_local, window_end_local, order_type, is_pickup,
    contact_name, contact_company, contact_address, contact_city, contact_state, contact_zip, contact_phone, contact_phone2, contact_email,
    bill_to_name, bill_to_company, bill_to_email, bill_to_phone, bill_to_address, bill_to_city, bill_to_state, bill_to_zip,
    details, driver_notes,
    base_delivery_fee, extra_items_count, extra_items_fee, accessorials_json, accessorials_total,
    coverage_option_id, declared_value, coverage_charge,
    tax_amount, tax_rate_pct, order_total, pricing_notes
  ) VALUES (
    'public_form', 'pending_review', NULL, NULL, 'public', true, NULL,
    v_dt_identifier,
    COALESCE(NULLIF(p_order->>'timezone',''), 'America/Los_Angeles'),
    NULLIF(p_order->>'local_service_date','')::date,
    NULLIF(p_order->>'window_start_local','')::time,
    NULLIF(p_order->>'window_end_local','')::time,
    COALESCE(NULLIF(p_order->>'order_type',''), 'delivery'),
    COALESCE((NULLIF(p_order->>'is_pickup',''))::boolean, false),
    NULLIF(p_order->>'contact_name',''), NULLIF(p_order->>'contact_company',''),
    NULLIF(p_order->>'contact_address',''), NULLIF(p_order->>'contact_city',''),
    NULLIF(p_order->>'contact_state',''), NULLIF(p_order->>'contact_zip',''),
    NULLIF(p_order->>'contact_phone',''), NULLIF(p_order->>'contact_phone2',''),
    NULLIF(p_order->>'contact_email',''),
    NULLIF(p_order->>'bill_to_name',''), NULLIF(p_order->>'bill_to_company',''),
    NULLIF(p_order->>'bill_to_email',''), NULLIF(p_order->>'bill_to_phone',''),
    NULLIF(p_order->>'bill_to_address',''), NULLIF(p_order->>'bill_to_city',''),
    NULLIF(p_order->>'bill_to_state',''), NULLIF(p_order->>'bill_to_zip',''),
    NULLIF(p_order->>'details',''), NULLIF(p_order->>'driver_notes',''),
    NULLIF(p_order->>'base_delivery_fee','')::numeric,
    COALESCE((NULLIF(p_order->>'extra_items_count',''))::integer, 0),
    COALESCE((NULLIF(p_order->>'extra_items_fee',''))::numeric, 0),
    CASE WHEN p_order ? 'accessorials_json' AND jsonb_typeof(p_order->'accessorials_json') <> 'null'
         THEN p_order->'accessorials_json' ELSE NULL END,
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

  IF jsonb_typeof(p_items) = 'array' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
      INSERT INTO public.dt_order_items (
        dt_order_id, dt_item_code, description, quantity, original_quantity, cubic_feet, extras
      ) VALUES (
        v_order_id, NULL,
        COALESCE(v_item->>'description', ''),
        COALESCE(NULLIF(v_item->>'quantity','')::numeric, 1),
        COALESCE(
          NULLIF(v_item->>'original_quantity','')::numeric,
          NULLIF(v_item->>'quantity','')::numeric,
          1
        ),
        NULLIF(v_item->>'cubic_feet','')::numeric,
        COALESCE(v_item->'extras', '{}'::jsonb)
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object('id', v_order_id, 'dt_identifier', v_dt_identifier);
END;
$$;
