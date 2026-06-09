-- ============================================================
-- COD Storage "Mark Paid" — write a per-item activity row.
--
-- The delivery-order COD line is now collected as a mark-paid (collect-on-
-- delivery) event, NOT an invoice. mark_cod_storage_collected() already
-- records the storage_billing_items dedup ledger + stamps the order's
-- cod_storage_collected_*; this adds a per-item entity_audit_log row (action
-- 'cod_storage_collected') so the collection shows in the item Activity tab
-- alongside the existing 'cod_storage_set'/'cod_storage_removed' rows.
--
-- CREATE OR REPLACE only — body is identical to 20260605170200 except for the
-- audit INSERT added inside the per-item loop. No signature change.
--
-- 2026-06-09 PST
-- ============================================================

CREATE OR REPLACE FUNCTION public.mark_cod_storage_collected(
  p_order_id     uuid,
  p_notes        text DEFAULT NULL,
  p_collected_by text DEFAULT NULL
)
RETURNS TABLE (
  collected_at timestamptz,
  items_recorded integer,
  total_recorded numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role      text;
  v_order     record;
  v_now       timestamptz := now();
  v_summary   text;
  v_count     integer := 0;
  v_total     numeric  := 0;
  d           jsonb;
  v_ps        date;
  v_pe        date;
  v_amt       numeric;
  v_item      text;
  v_days      text;
  v_rate      text;
BEGIN
  -- Admin/staff gate (defense in depth; the Orders UI is staff-gated).
  IF auth.role() = 'service_role' THEN
    NULL;
  ELSE
    v_role := LOWER(COALESCE(auth.jwt() -> 'user_metadata' ->> 'role', ''));
    IF v_role NOT IN ('admin', 'staff') THEN
      RAISE EXCEPTION 'mark_cod_storage_collected requires admin/staff role (got %)', v_role
        USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT id, tenant_id, cod_storage_enabled, cod_storage_details,
         cod_storage_cutoff_date, cod_storage_rate
    INTO v_order
    FROM public.dt_orders
   WHERE id = p_order_id;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'dt_order % not found', p_order_id USING ERRCODE = 'P0002';
  END IF;
  IF v_order.cod_storage_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'dt_order % has no COD storage line', p_order_id USING ERRCODE = '22023';
  END IF;

  v_summary := 'COD-STORAGE-' || p_order_id::text;

  -- Replace any prior COD-Collected record for this order (idempotent).
  DELETE FROM public.storage_billing_items
   WHERE summary_ledger_row_id = v_summary;

  -- Write one record per COD item from the React-computed snapshot.
  IF v_order.cod_storage_details IS NOT NULL THEN
    FOR d IN SELECT * FROM jsonb_array_elements(v_order.cod_storage_details)
    LOOP
      v_ps := NULLIF(d ->> 'start_date', '')::date;
      v_pe := COALESCE(NULLIF(d ->> 'end_date', '')::date, v_order.cod_storage_cutoff_date);
      -- period_start / period_end are NOT NULL columns — skip a malformed
      -- detail row rather than aborting the whole collection.
      IF v_ps IS NULL OR v_pe IS NULL THEN
        CONTINUE;
      END IF;
      v_amt  := COALESCE(NULLIF(d ->> 'amount', '')::numeric, 0);
      v_item := COALESCE(d ->> 'item_id', '');
      v_days := COALESCE(NULLIF(d ->> 'days', ''), '0');
      v_rate := COALESCE(NULLIF(d ->> 'rate', ''), '');

      INSERT INTO public.storage_billing_items (
        tenant_id, sidemark, item_id, description,
        period_start, period_end, billable_days, rate, amount,
        summary_ledger_row_id, status
      )
      VALUES (
        v_order.tenant_id,
        COALESCE(d ->> 'sidemark', ''),
        v_item,
        d ->> 'description',
        v_ps,
        v_pe,
        NULLIF(d ->> 'days', '')::integer,
        NULLIF(d ->> 'rate', '')::numeric,
        v_amt,
        v_summary,
        'COD Collected'
      )
      ON CONFLICT (tenant_id, item_id, period_start, period_end) WHERE status <> 'Void'
      DO UPDATE SET
        billable_days         = EXCLUDED.billable_days,
        rate                  = EXCLUDED.rate,
        amount                = EXCLUDED.amount,
        summary_ledger_row_id = EXCLUDED.summary_ledger_row_id,
        status                = EXCLUDED.status,
        description           = EXCLUDED.description,
        updated_at            = now();

      -- NEW: per-item activity row so the collection shows in the Item
      -- Activity tab (entity_audit_log, action 'cod_storage_collected').
      -- Browser INSERTs to entity_audit_log are RLS-blocked, so this
      -- SECURITY DEFINER RPC is the write path (same pattern as set_cod_storage).
      IF v_item <> '' THEN
        INSERT INTO public.entity_audit_log (
          entity_type, entity_id, tenant_id, action, changes, performed_by, source
        )
        VALUES (
          'inventory', v_item, v_order.tenant_id, 'cod_storage_collected',
          jsonb_build_object(
            'summary',
              'COD storage paid: $' || to_char(v_amt, 'FM999990.00') ||
              ' · ' || to_char(v_ps, 'YYYY-MM-DD') || ' → ' || to_char(v_pe, 'YYYY-MM-DD') ||
              ' (' || v_days || 'd' ||
              CASE WHEN v_rate <> '' THEN ' @ $' || v_rate || '/cu ft/day' ELSE '' END || ')' ||
              CASE WHEN COALESCE(p_notes, '') <> '' THEN ' · ' || p_notes ELSE '' END,
            'amount', v_amt,
            'days',   v_days,
            'rate',   v_rate
          ),
          COALESCE(p_collected_by, 'system'),
          'supabase'
        );
      END IF;

      v_count := v_count + 1;
      v_total := v_total + v_amt;
    END LOOP;
  END IF;

  UPDATE public.dt_orders
     SET cod_storage_collected_at     = v_now,
         cod_storage_collected_by     = p_collected_by,
         cod_storage_collection_notes = p_notes,
         updated_at                   = v_now
   WHERE id = p_order_id;

  collected_at   := v_now;
  items_recorded := v_count;
  total_recorded := v_total;
  RETURN NEXT;
END;
$$;
