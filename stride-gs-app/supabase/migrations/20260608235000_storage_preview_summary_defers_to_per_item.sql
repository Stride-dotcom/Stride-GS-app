-- ============================================================================
-- Storage preview dedup — a finalized STOR-SUMMARY locks the whole
-- sidemark/tenant period only as a FALLBACK; defer to per-item detail.
--
-- BUG (revenue loss): on Billing → Storage Charges, an operator previews
-- storage, UNCHECKS some rows, and invoices the rest. For a
-- separate_by_sidemark=FALSE client the commit writes ONE blank-sidemark
-- STOR-SUMMARY row; once invoiced, preview dedup source (b) below subtracts
-- that summary's WHOLE-TENANT period — so the UNCHECKED items vanish from the
-- next preview and can never be billed.
--
-- FIX: source (b) is only a fallback for when the per-item storage_billing_items
-- write was lost (Supabase blip during commit). When the summary HAS finalized
-- per-item rows (the normal case), source (a) — finalized storage_billing_items
-- keyed on item_id — already dedups precisely, so skip the coarse summary lock.
-- The unchecked items reappear; the invoiced items stay excluded via (a) → NO
-- double-bill (the per-item layer + uq_sbi_active_item_period are untouched).
--
-- This CREATE OR REPLACE is the live body (from 20260608180000 + the
-- 20260608231300 search_path pin) with ONLY source (b) changed (the added
-- NOT EXISTS). SECURITY DEFINER + SET search_path preserved.
-- ============================================================================

CREATE OR REPLACE FUNCTION public._compute_storage_charges(
  p_tenant_id text DEFAULT NULL::text,
  p_sidemark text DEFAULT NULL::text,
  p_period_start date DEFAULT NULL::date,
  p_period_end date DEFAULT NULL::date
)
 RETURNS TABLE(out_tenant_id text, out_client_name text, out_item_id text, out_description text, out_vendor text, out_sidemark text, out_item_class text, out_storage_size numeric, out_receive_date date, out_release_date date, out_free_days integer, out_billable_start date, out_billable_end date, out_billable_days integer, out_daily_rate numeric, out_total_charge numeric, out_task_id text, out_notes text, out_shipment_no text, out_location text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r            record;
  v_storage    numeric;
  v_recv       date;
  v_rel        date;
  v_xfer       date;
  v_eff_recv   date;
  v_eff_end    date;
  v_charge_st  date;
  v_charge_en  date;
  v_free_days  integer;
  v_disc_pct   numeric;
  v_daily_rate numeric;
  v_base       numeric;
  v_periods    daterange[];
  v_billed     daterange[];
  v_billed_one daterange;
  v_new        daterange[];
  v_p          daterange;
  v_pst        date;
  v_pen        date;
  v_bst        date;
  v_ben        date;
  v_days       integer;
  v_status     text;
  v_class_up   text;
BEGIN
  IF p_period_start IS NULL THEN
    p_period_start := date_trunc('month', current_date)::date;
  END IF;
  IF p_period_end IS NULL THEN
    p_period_end := current_date;
  END IF;

  FOR r IN
    SELECT
      i.tenant_id, i.item_id,
      COALESCE(i.description, '') AS description,
      COALESCE(i.vendor, '') AS vendor,
      COALESCE(i.sidemark, '') AS sidemark,
      COALESCE(i.item_class, '') AS item_class,
      NULLIF(NULLIF(TRIM(i.receive_date), ''), 'null')::date AS receive_date,
      NULLIF(NULLIF(TRIM(i.release_date), ''), 'null')::date AS release_date,
      NULLIF(NULLIF(TRIM(i.transfer_date), ''), 'null')::date AS transfer_date,
      LOWER(COALESCE(i.status, '')) AS status,
      COALESCE(i.shipment_number, '') AS shipment_number,
      COALESCE(i.location, '') AS location,
      COALESCE(i.cod_storage, false) AS cod_storage,
      i.cod_storage_start_date AS cod_storage_start_date,
      c.name AS client_name,
      COALESCE(c.free_storage_days, 0) AS free_storage_days,
      COALESCE(c.discount_storage_pct, 0) AS discount_storage_pct,
      ic.storage_size AS storage_size,
      sc.rates AS stor_rates
    FROM public.inventory i
    JOIN public.clients c ON c.tenant_id = i.tenant_id
    LEFT JOIN public.item_classes ic ON UPPER(ic.id) = UPPER(COALESCE(i.item_class, ''))
    LEFT JOIN public.service_catalog sc ON sc.code = 'STOR' AND sc.active = true
    WHERE c.active = true
      AND (p_tenant_id IS NULL OR i.tenant_id = p_tenant_id)
      AND (p_sidemark IS NULL OR LOWER(i.sidemark) = LOWER(p_sidemark))
      AND NULLIF(TRIM(i.receive_date), '') IS NOT NULL
      AND NULLIF(TRIM(i.receive_date), '')::date <= p_period_end
      AND (NULLIF(TRIM(i.release_date), '') IS NULL OR NULLIF(TRIM(i.release_date), '')::date > p_period_start)
      AND NOT (
        LOWER(COALESCE(i.status, '')) IN ('released', 'transferred')
        AND EXISTS (
          SELECT 1 FROM public.inventory i2
          WHERE i2.item_id = i.item_id
            AND i2.tenant_id != i.tenant_id
            AND i2.receive_date = i.receive_date
        )
      )
  LOOP
    v_status := r.status; v_recv := r.receive_date; v_rel := r.release_date;
    v_xfer := r.transfer_date; v_class_up := UPPER(r.item_class);

    IF v_status = 'transferred' THEN
      CONTINUE;
    ELSIF v_status = 'released' THEN
      IF v_rel IS NULL THEN CONTINUE; END IF;
    ELSIF v_status NOT IN ('active', 'on hold', '') THEN
      CONTINUE;
    END IF;

    IF v_xfer IS NOT NULL AND v_status IN ('active', 'on hold', 'released') THEN
      v_eff_recv := v_xfer;
      IF v_rel IS NOT NULL AND v_rel <= p_period_end THEN v_eff_end := v_rel - 1; ELSE v_eff_end := p_period_end; END IF;
    ELSE
      v_eff_recv := v_recv;
      IF v_rel IS NOT NULL AND v_rel <= p_period_end THEN v_eff_end := v_rel - 1; ELSE v_eff_end := p_period_end; END IF;
    END IF;

    -- COD storage cap (restored from 20260605170100)
    IF r.cod_storage IS TRUE AND r.cod_storage_start_date IS NOT NULL THEN
      v_eff_end := LEAST(v_eff_end, r.cod_storage_start_date - 1);
    END IF;

    v_free_days := r.free_storage_days; v_disc_pct := r.discount_storage_pct;
    v_charge_st := GREATEST(v_eff_recv + v_free_days, p_period_start);
    v_charge_en := v_eff_end;
    IF v_charge_st > v_charge_en THEN CONTINUE; END IF;

    v_storage := r.storage_size;
    IF v_storage IS NULL OR v_storage <= 0 THEN CONTINUE; END IF;
    IF r.stor_rates IS NULL THEN v_base := 0;
    ELSE v_base := COALESCE((r.stor_rates ->> v_class_up)::numeric, 0); END IF;
    IF v_base <= 0 THEN CONTINUE; END IF;
    v_daily_rate := ROUND(v_base * v_storage * (1 + v_disc_pct / 100.0), 2);

    v_periods := ARRAY[daterange(v_charge_st, v_charge_en, '[]')];

    v_billed := ARRAY(
      SELECT daterange(rng.range_start, rng.range_end, '[]')
      FROM public.billing b
      CROSS JOIN LATERAL public._parse_stor_task_range(b.task_id) rng
      WHERE b.tenant_id = r.tenant_id AND b.item_id = r.item_id AND b.svc_code = 'STOR'
        AND LOWER(COALESCE(b.status, '')) IN ('invoiced','billed','void')
        AND rng.range_start IS NOT NULL AND rng.range_end IS NOT NULL
    );

    v_billed := v_billed || ARRAY(
      SELECT daterange(cr.free_from, cr.free_to, '[]')
      FROM public.storage_credits cr
      WHERE cr.tenant_id = r.tenant_id AND cr.item_id = r.item_id
        AND cr.deleted_at IS NULL
        AND cr.free_from IS NOT NULL AND cr.free_to IS NOT NULL
        AND cr.free_to >= cr.free_from
    );

    -- (a) FINALIZED per-item storage from storage_billing_items (PER ITEM).
    v_billed := v_billed || ARRAY(
      SELECT daterange(sbi.period_start, sbi.period_end, '[]')
      FROM public.storage_billing_items sbi
      WHERE sbi.tenant_id = r.tenant_id AND sbi.item_id = r.item_id
        AND LOWER(COALESCE(sbi.status, '')) IN ('invoiced','billed')
        AND sbi.period_start IS NOT NULL AND sbi.period_end IS NOT NULL
    );

    -- (b) FINALIZED STOR-SUMMARY periods, sidemark-matched (blank = whole
    --     tenant) — FALLBACK ONLY. Skip when the summary already has finalized
    --     per-item storage_billing_items rows: source (a) above dedups those
    --     precisely per item, so applying the summary's whole-sidemark/period
    --     range here would WRONGLY strand items NOT in a partial commit (the
    --     operator unchecks rows, invoices the rest, and the unchecked items
    --     vanish). Deferring to (a) keeps the unchecked items billable. (b)
    --     still fires when the per-item rows were lost (Supabase blip during
    --     commit) — the coarse lock then prevents double-billing.
    v_billed := v_billed || ARRAY(
      SELECT daterange(p.period_start, p.period_end, '[]')
      FROM public.billing b
      CROSS JOIN LATERAL public._parse_stor_summary_period(b.ledger_row_id) p
      WHERE b.tenant_id = r.tenant_id AND b.svc_code = 'STOR'
        AND b.ledger_row_id LIKE 'STOR-SUMMARY-%'
        AND LOWER(COALESCE(b.status, '')) IN ('invoiced','billed','void')
        AND p.period_start IS NOT NULL AND p.period_end IS NOT NULL
        AND (
          NULLIF(TRIM(UPPER(COALESCE(b.sidemark, ''))), '') IS NULL
          OR UPPER(TRIM(COALESCE(b.sidemark, ''))) = UPPER(TRIM(COALESCE(r.sidemark, '')))
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.storage_billing_items sbi
          WHERE sbi.tenant_id = b.tenant_id
            AND sbi.summary_ledger_row_id = b.ledger_row_id
            AND LOWER(COALESCE(sbi.status, '')) IN ('invoiced','billed')
        )
    );

    -- (c) HARDEN: Unbilled STOR-TRANSFER backfill periods.
    v_billed := v_billed || ARRAY(
      SELECT daterange(rng.range_start, rng.range_end, '[]')
      FROM public.billing b
      CROSS JOIN LATERAL public._parse_stor_task_range(b.task_id) rng
      WHERE b.tenant_id = r.tenant_id AND b.item_id = r.item_id AND b.svc_code = 'STOR'
        AND b.ledger_row_id LIKE 'STOR-TRANSFER-%'
        AND LOWER(COALESCE(b.status, '')) = 'unbilled'
        AND rng.range_start IS NOT NULL AND rng.range_end IS NOT NULL
    );

    IF array_length(v_billed, 1) IS NOT NULL THEN
      FOREACH v_billed_one IN ARRAY v_billed LOOP
        v_new := ARRAY[]::daterange[];
        FOREACH v_p IN ARRAY v_periods LOOP
          v_pst := lower(v_p); v_pen := upper(v_p) - 1;
          v_bst := lower(v_billed_one); v_ben := upper(v_billed_one) - 1;
          IF v_ben < v_pst OR v_bst > v_pen THEN v_new := v_new || v_p;
          ELSE
            IF v_pst < v_bst THEN v_new := v_new || daterange(v_pst, v_bst - 1, '[]'); END IF;
            IF v_pen > v_ben THEN v_new := v_new || daterange(v_ben + 1, v_pen, '[]'); END IF;
          END IF;
        END LOOP;
        v_periods := v_new;
      END LOOP;
    END IF;

    FOREACH v_p IN ARRAY v_periods LOOP
      v_pst := lower(v_p); v_pen := upper(v_p) - 1;
      v_days := (v_pen - v_pst) + 1;
      IF v_days <= 0 THEN CONTINUE; END IF;
      out_tenant_id := r.tenant_id; out_client_name := r.client_name;
      out_item_id := r.item_id; out_description := r.description;
      out_vendor := r.vendor; out_sidemark := r.sidemark;
      out_item_class := v_class_up; out_storage_size := v_storage;
      out_receive_date := v_recv; out_release_date := v_rel;
      out_free_days := v_free_days; out_billable_start := v_pst;
      out_billable_end := v_pen; out_billable_days := v_days;
      out_daily_rate := v_daily_rate;
      out_total_charge := ROUND(v_daily_rate * v_days, 2);
      out_task_id := 'STOR-' || r.item_id || '-' || to_char(v_pst, 'YYYYMMDD') || '-' || to_char(v_pen, 'YYYYMMDD');
      out_notes := 'Storage ' || to_char(v_pst, 'MM/DD/YY') || ' to ' || to_char(v_pen, 'MM/DD/YY') || ' (' || v_days || ' day(s))';
      out_shipment_no := r.shipment_number; out_location := r.location;
      RETURN NEXT;
    END LOOP;
  END LOOP;
  RETURN;
END;
$function$;

NOTIFY pgrst, 'reload schema';
