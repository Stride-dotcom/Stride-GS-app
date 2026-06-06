-- ============================================================
-- COD Storage — Phase 4 (delivery-order add-on line storage) +
--                Phase 6 (collection + double-bill record)
--
-- Phase 4: dt_orders carries a "COD Storage" collection line. The
-- per-item math (class cubic feet × daily rate × eligible days, from
-- cod_storage_start_date to the cutoff date) is computed in React and
-- snapshotted into cod_storage_details; the scalar columns drive the
-- order UI + the DT description summary.
--
-- Phase 6: mark_cod_storage_collected() stamps the collection and
-- records each item's COD storage period into storage_billing_items
-- (status 'COD Collected') as a durable, never-re-billed record. The
-- designer is already excluded for these days by the Phase 3 cap, so
-- this is the customer-collection record + belt-and-suspenders against
-- any future recompute.
--
-- dt_orders is NOT a parity-mirror-set table → no parity_dryrun ALTER.
--
-- 2026-06-05 PST
-- ============================================================

-- ── dt_orders: COD Storage collection line ───────────────────
ALTER TABLE public.dt_orders
  ADD COLUMN IF NOT EXISTS cod_storage_enabled         boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cod_storage_cutoff_date     date,
  ADD COLUMN IF NOT EXISTS cod_storage_rate            numeric,
  ADD COLUMN IF NOT EXISTS cod_storage_total           numeric,
  ADD COLUMN IF NOT EXISTS cod_storage_item_count      integer,
  ADD COLUMN IF NOT EXISTS cod_storage_period_start    date,
  ADD COLUMN IF NOT EXISTS cod_storage_details         jsonb,
  ADD COLUMN IF NOT EXISTS cod_storage_collected_at    timestamptz,
  ADD COLUMN IF NOT EXISTS cod_storage_collected_by    text,
  ADD COLUMN IF NOT EXISTS cod_storage_collection_notes text;

COMMENT ON COLUMN public.dt_orders.cod_storage_enabled IS
  'True when this delivery order includes a COD Storage collection line (some items are cod_storage=true).';
COMMENT ON COLUMN public.dt_orders.cod_storage_cutoff_date IS
  'Last day of COD storage charged on this order (inclusive). Defaults to the local service date; operator-editable.';
COMMENT ON COLUMN public.dt_orders.cod_storage_rate IS
  'Per cubic-foot per-day rate for the COD storage line (default 0.05, operator-editable).';
COMMENT ON COLUMN public.dt_orders.cod_storage_details IS
  'Per-item snapshot: [{item_id, inventory_id, sidemark, description, item_class, cubic_feet, start_date, days, amount}]. Source of truth for the Phase 6 storage_billing_items record.';
COMMENT ON COLUMN public.dt_orders.cod_storage_collected_at IS
  'Set by mark_cod_storage_collected() when the team collects the COD storage payment (manual, no QBO).';

-- ── Phase 6: Mark as Collected ───────────────────────────────
-- Stamps the collection + writes a per-item storage_billing_items
-- record (status 'COD Collected') from cod_storage_details so the COD
-- period is durably recorded and never re-billed. Idempotent: re-running
-- replaces this order's COD records (keyed by the deterministic
-- summary_ledger_row_id 'COD-STORAGE-<orderId>').
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
      v_amt := COALESCE(NULLIF(d ->> 'amount', '')::numeric, 0);

      -- ON CONFLICT against the (tenant_id, item_id, period_start, period_end)
      -- WHERE status <> 'Void' partial unique index — a stray overlap from
      -- another source updates in place instead of aborting the RPC.
      INSERT INTO public.storage_billing_items (
        tenant_id, sidemark, item_id, description,
        period_start, period_end, billable_days, rate, amount,
        summary_ledger_row_id, status
      )
      VALUES (
        v_order.tenant_id,
        COALESCE(d ->> 'sidemark', ''),
        COALESCE(d ->> 'item_id', ''),
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

COMMENT ON FUNCTION public.mark_cod_storage_collected(uuid, text, text) IS
  'Phase 6: stamp COD storage as collected on a delivery order + record each item period into storage_billing_items (status COD Collected). Idempotent per order.';

GRANT EXECUTE ON FUNCTION public.mark_cod_storage_collected(uuid, text, text)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
