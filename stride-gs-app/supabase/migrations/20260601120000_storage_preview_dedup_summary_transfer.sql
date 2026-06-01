-- Storage preview dedup: see through the STOR-SUMMARY collapse + harden transfers
-- ==============================================================================
-- PROBLEM (verified 2026-06-01)
--   `_compute_storage_charges` (the engine behind the Storage-tab preview via
--   `calculate_storage_charges`, and behind `generate_storage_charges`) subtracts
--   already-billed periods by matching `billing.item_id` and parsing the
--   `STOR-{item}-{start}-{end}` range out of `billing.task_id`. Since the v38.256
--   storage-summary migration, committing/invoicing collapses the per-item STOR
--   rows into ONE `STOR-SUMMARY-{tenant}-{sidemark}-{start}-{end}` row that has a
--   BLANK item_id and a non-per-item task_id — invisible to that dedup. The real
--   per-item invoiced periods now live in `storage_billing_items`, which the dedup
--   never queried. Net effect: the preview re-showed storage that was already
--   invoiced (e.g. all 6 FAHRINGER items on INV-020133 reappeared in the May
--   preview), silently breaking the invariant the React code relies on
--   (Billing.tsx:3709 "the RPC excludes already-invoiced periods"). The commit
--   path is independently gated (handleCommitStorageRows_ lockedSidemarks +
--   storage_billing_items sbiAlreadyBilled), so no actual double-bill occurred —
--   but the misleading preview is exactly the kind of latent gap that becomes a
--   real double-bill the day that gate is refactored.
--
-- FIX — extend the per-item `v_billed` subtraction set with three more sources:
--   (a) FINALIZED `storage_billing_items` ranges (Invoiced/Billed). This is the
--       per-item record of what the STOR-SUMMARY collapse actually billed — the
--       precise, primary fix.
--   (b) FINALIZED `STOR-SUMMARY` periods from billing, sidemark-matched. Fallback
--       for when storage_billing_items wasn't written (a Supabase blip during a
--       commit). Mirrors handleCommitStorageRows_'s finalized-summary gate: a
--       blank-sidemark summary locks the whole tenant; a sidemark-specific summary
--       locks that sidemark's items. So "what the preview shows" == "what the
--       commit will actually accept".
--   (c) HARDEN: Unbilled `STOR-TRANSFER-*` backfill periods. The transfer backfill
--       bills receive_date -> transfer_date-1 on the destination; the cutover
--       (v_eff_recv := transfer_date) normally keeps the monthly projection off
--       that window, but if transfer_date is ever blank the cutover can't fire.
--       Subtracting the backfill range directly is the belt-and-suspenders net.
--       (Audit on 2026-06-01 found 0 unbilled backfills with a missing
--       transfer_date, so this changes nothing today — it closes the edge case.)
--
-- VALIDATION (test-copy diffed against live across all tenants before promoting)
--   May 2026: excludes EXACTLY the invoiced storage and nothing else —
--     Allison Lind $2,419.40 (= sum of INV-020125..134), KIPP $2.40 (INV-020124),
--     ISLAND PARK $36.00 (INV-020135). All cross-checked to Invoiced records.
--   June 2026: identical totals live vs new ($57,551.48), zero exclusions —
--     all billable storage preserved.
--   Subtract-only: ZERO rows are introduced or inflated by the new sources in any
--     month (the new function output is a strict subset of the old).
--
-- Subtracting the storage_billing_items / STOR-SUMMARY *report-window* range
-- (which can be wider than the days actually charged, e.g. it includes free/pre-
-- receive days) is safe: those extra days were non-billable in that window, and
-- any day outside an invoiced window stays billable (subtraction only removes
-- days that fall inside an already-invoiced report window).

CREATE OR REPLACE FUNCTION public._compute_storage_charges(
  p_tenant_id text DEFAULT NULL::text,
  p_sidemark text DEFAULT NULL::text,
  p_period_start date DEFAULT NULL::date,
  p_period_end date DEFAULT NULL::date)
 RETURNS TABLE(out_tenant_id text, out_client_name text, out_item_id text, out_description text, out_vendor text, out_sidemark text, out_item_class text, out_storage_size numeric, out_receive_date date, out_release_date date, out_free_days integer, out_billable_start date, out_billable_end date, out_billable_days integer, out_daily_rate numeric, out_total_charge numeric, out_task_id text, out_notes text, out_shipment_no text, out_location text)
 LANGUAGE plpgsql
 STABLE
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
      -- TRANSFER FIX: skip source rows where item was transferred to another tenant
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
      CONTINUE; -- source rows now filtered in WHERE, but belt-and-suspenders
    ELSIF v_status = 'released' THEN
      IF v_rel IS NULL THEN CONTINUE; END IF;
    ELSIF v_status NOT IN ('active', 'on hold', '') THEN
      CONTINUE;
    END IF;

    -- For destination items that have a transfer_date, start from transfer_date (not receive)
    IF v_xfer IS NOT NULL AND v_status IN ('active', 'on hold', 'released') THEN
      v_eff_recv := v_xfer;
      IF v_rel IS NOT NULL AND v_rel <= p_period_end THEN v_eff_end := v_rel - 1; ELSE v_eff_end := p_period_end; END IF;
    ELSE
      v_eff_recv := v_recv;
      IF v_rel IS NOT NULL AND v_rel <= p_period_end THEN v_eff_end := v_rel - 1; ELSE v_eff_end := p_period_end; END IF;
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

    -- Already-billed per-item STOR rows (finalized). Catches legacy per-item
    -- invoiced rows + the transfer backfill once it is finalized.
    v_billed := ARRAY(
      SELECT daterange(rng.range_start, rng.range_end, '[]')
      FROM public.billing b
      CROSS JOIN LATERAL public._parse_stor_task_range(b.task_id) rng
      WHERE b.tenant_id = r.tenant_id AND b.item_id = r.item_id AND b.svc_code = 'STOR'
        AND LOWER(COALESCE(b.status, '')) IN ('invoiced','billed','void')
        AND rng.range_start IS NOT NULL AND rng.range_end IS NOT NULL
    );

    -- Manual storage credits (free periods).
    v_billed := v_billed || ARRAY(
      SELECT daterange(cr.free_from, cr.free_to, '[]')
      FROM public.storage_credits cr
      WHERE cr.tenant_id = r.tenant_id AND cr.item_id = r.item_id
        AND cr.deleted_at IS NULL
        AND cr.free_from IS NOT NULL AND cr.free_to IS NOT NULL
        AND cr.free_to >= cr.free_from
    );

    -- (a) FINALIZED per-item storage from storage_billing_items. After the
    --     STOR-SUMMARY collapse (v38.256) the per-item invoiced periods live
    --     here, not as per-item STOR rows in billing — so the task-id dedup
    --     above can't see them. Primary fix for the re-shown invoiced storage.
    v_billed := v_billed || ARRAY(
      SELECT daterange(sbi.period_start, sbi.period_end, '[]')
      FROM public.storage_billing_items sbi
      WHERE sbi.tenant_id = r.tenant_id AND sbi.item_id = r.item_id
        AND LOWER(COALESCE(sbi.status, '')) IN ('invoiced','billed')
        AND sbi.period_start IS NOT NULL AND sbi.period_end IS NOT NULL
    );

    -- (b) FINALIZED STOR-SUMMARY periods, sidemark-matched. Fallback for when
    --     storage_billing_items wasn't populated (Supabase blip during commit).
    --     Blank-sidemark summary => whole-tenant lock; sidemark-specific summary
    --     => that sidemark's items. Mirrors handleCommitStorageRows_'s gate.
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
    );

    -- (c) HARDEN: Unbilled STOR-TRANSFER backfill periods. Safety net for when a
    --     destination item's transfer_date is missing so the cutover above can't
    --     fire — subtract the already-accrued backfill window directly.
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
