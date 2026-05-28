-- ============================================================
-- Storage charges — exclude transferred-out source rows
--
-- Bug: _compute_storage_charges (20260502200000) bills the SOURCE
-- client up to transfer_date - 1 for items that were transferred
-- to another tenant. This produces a duplicate charge for the
-- holding period, because handleTransferItems_ already creates an
-- Unbilled STOR row on the DESTINATION covering receive_date →
-- transfer_date - 1 (the storage backfill at StrideAPI.gs ~23582).
--
-- Repro from production: item 62218 received under Brume on
-- 04/06/26, transferred to Allison Lind on 04/08/26. The April
-- storage run charged Brume $6 for 04/06–04/07. Should have been
-- $0 — destination owns storage end-to-end.
--
-- Fix: in the source row scan, exclude rows where status =
-- 'transferred' AND a sibling inventory row exists for the same
-- item_id at a different tenant_id with the same receive_date.
--
-- Scoping it to status='transferred' ensures we still bill the
-- DESTINATION (status='active') even though it shares item_id +
-- receive_date with the source. Receive_date equality is the
-- transfer signal — handleTransferItems_ copies the source row
-- wholesale and only overwrites Status + Transfer Date, leaving
-- Receive Date identical on both sides.
--
-- Net effect after this migration:
--   • Source (status='transferred', sibling exists):  skipped
--   • Source (status='transferred', no sibling yet):  still billed
--     up to transfer_date - 1 — transient until the destination
--     row mirrors to public.inventory; corrected on the next run.
--   • Destination (status='active', transfer_date set):  unchanged
--     — bills from transfer_date forward via the existing cutover
--     logic. Holding period covered by the at-transfer backfill.
--
-- Only _compute_storage_charges changes. calculate_storage_charges
-- and generate_storage_charges both wrap it, so no further edits.
--
-- 2026-05-28 PST
-- ============================================================

CREATE OR REPLACE FUNCTION public._compute_storage_charges(
  p_tenant_id      text DEFAULT NULL,
  p_sidemark       text DEFAULT NULL,
  p_period_start   date DEFAULT NULL,
  p_period_end     date DEFAULT NULL
)
RETURNS TABLE (
  out_tenant_id      text,
  out_client_name    text,
  out_item_id        text,
  out_description    text,
  out_vendor         text,
  out_sidemark       text,
  out_item_class     text,
  out_storage_size   numeric,
  out_receive_date   date,
  out_release_date   date,
  out_free_days      integer,
  out_billable_start date,
  out_billable_end   date,
  out_billable_days  integer,
  out_daily_rate     numeric,
  out_total_charge   numeric,
  out_task_id        text,
  out_notes          text,
  out_shipment_no    text,
  out_location       text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
      i.tenant_id,
      i.item_id,
      COALESCE(i.description, '')                              AS description,
      COALESCE(i.vendor, '')                                   AS vendor,
      COALESCE(i.sidemark, '')                                 AS sidemark,
      COALESCE(i.item_class, '')                               AS item_class,
      NULLIF(NULLIF(TRIM(i.receive_date), ''),  'null')::date  AS receive_date,
      NULLIF(NULLIF(TRIM(i.release_date), ''),  'null')::date  AS release_date,
      NULLIF(NULLIF(TRIM(i.transfer_date), ''), 'null')::date  AS transfer_date,
      LOWER(COALESCE(i.status, ''))                            AS status,
      COALESCE(i.shipment_number, '')                          AS shipment_number,
      COALESCE(i.location, '')                                 AS location,
      c.name                                                   AS client_name,
      COALESCE(c.free_storage_days, 0)                         AS free_storage_days,
      COALESCE(c.discount_storage_pct, 0)                      AS discount_storage_pct,
      ic.storage_size                                          AS storage_size,
      sc.rates                                                 AS stor_rates
    FROM public.inventory i
    JOIN public.clients   c  ON c.tenant_id = i.tenant_id
    LEFT JOIN public.item_classes ic
                              ON UPPER(ic.id) = UPPER(COALESCE(i.item_class, ''))
    LEFT JOIN public.service_catalog sc
                              ON sc.code = 'STOR'
                             AND sc.active = true
    WHERE c.active = true
      AND (p_tenant_id IS NULL OR i.tenant_id = p_tenant_id)
      AND (p_sidemark  IS NULL OR LOWER(i.sidemark) = LOWER(p_sidemark))
      AND NULLIF(TRIM(i.receive_date), '') IS NOT NULL
      AND NULLIF(TRIM(i.receive_date), '')::date <= p_period_end
      AND (
        NULLIF(TRIM(i.release_date), '') IS NULL
        OR NULLIF(TRIM(i.release_date), '')::date > p_period_start
      )
      -- v38.245.1 (2026-05-28): skip transferred-out source rows.
      -- See migration header. Receive_date equality identifies the
      -- sibling as the post-transfer destination row (handleTransferItems_
      -- copies the source row wholesale, only overwriting Status + Transfer Date).
      AND NOT (
        LOWER(COALESCE(i.status, '')) = 'transferred'
        AND EXISTS (
          SELECT 1 FROM public.inventory i2
           WHERE i2.item_id = i.item_id
             AND i2.tenant_id <> i.tenant_id
             AND NULLIF(NULLIF(TRIM(i2.receive_date), ''), 'null')::date
               = NULLIF(NULLIF(TRIM(i.receive_date), ''), 'null')::date
        )
      )
  LOOP
    v_status   := r.status;
    v_recv     := r.receive_date;
    v_rel      := r.release_date;
    v_xfer     := r.transfer_date;
    v_class_up := UPPER(r.item_class);

    IF v_status = 'transferred' THEN
      IF v_xfer IS NULL THEN CONTINUE; END IF;
    ELSIF v_status = 'released' THEN
      IF v_rel IS NULL THEN CONTINUE; END IF;
    ELSIF v_status NOT IN ('active', 'on hold', '') THEN
      CONTINUE;
    END IF;

    IF v_status = 'transferred' THEN
      v_eff_recv := v_recv;
      v_eff_end  := v_xfer - 1;
      IF v_rel IS NOT NULL AND v_rel <= v_xfer - 1 THEN
        v_eff_end := v_rel - 1;
      END IF;
      IF v_eff_end > p_period_end THEN
        v_eff_end := p_period_end;
      END IF;
    ELSIF v_xfer IS NOT NULL AND v_status IN ('active', 'on hold', 'released') THEN
      v_eff_recv := v_xfer;
      IF v_rel IS NOT NULL AND v_rel <= p_period_end THEN
        v_eff_end := v_rel - 1;
      ELSE
        v_eff_end := p_period_end;
      END IF;
    ELSE
      v_eff_recv := v_recv;
      IF v_rel IS NOT NULL AND v_rel <= p_period_end THEN
        v_eff_end := v_rel - 1;
      ELSE
        v_eff_end := p_period_end;
      END IF;
    END IF;

    v_free_days  := r.free_storage_days;
    v_disc_pct   := r.discount_storage_pct;
    v_charge_st  := GREATEST(v_eff_recv + v_free_days, p_period_start);
    v_charge_en  := v_eff_end;

    IF v_charge_st > v_charge_en THEN CONTINUE; END IF;

    v_storage := r.storage_size;
    IF v_storage IS NULL OR v_storage <= 0 THEN CONTINUE; END IF;

    IF r.stor_rates IS NULL THEN
      v_base := 0;
    ELSE
      v_base := COALESCE((r.stor_rates ->> v_class_up)::numeric, 0);
    END IF;
    IF v_base <= 0 THEN CONTINUE; END IF;
    v_daily_rate := ROUND(v_base * v_storage * (1 + v_disc_pct / 100.0), 2);

    v_periods := ARRAY[daterange(v_charge_st, v_charge_en, '[]')];
    v_billed  := ARRAY(
      SELECT daterange(rng.range_start, rng.range_end, '[]')
        FROM public.billing b
        CROSS JOIN LATERAL public._parse_stor_task_range(b.task_id) rng
       WHERE b.tenant_id = r.tenant_id
         AND b.item_id   = r.item_id
         AND b.svc_code  = 'STOR'
         AND LOWER(COALESCE(b.status, '')) IN ('invoiced','billed','void')
         AND rng.range_start IS NOT NULL
         AND rng.range_end   IS NOT NULL
    );

    IF array_length(v_billed, 1) IS NOT NULL THEN
      FOREACH v_billed_one IN ARRAY v_billed
      LOOP
        v_new := ARRAY[]::daterange[];
        FOREACH v_p IN ARRAY v_periods
        LOOP
          v_pst := lower(v_p);
          v_pen := upper(v_p) - 1;
          v_bst := lower(v_billed_one);
          v_ben := upper(v_billed_one) - 1;
          IF v_ben < v_pst OR v_bst > v_pen THEN
            v_new := v_new || v_p;
          ELSE
            IF v_pst < v_bst THEN
              v_new := v_new || daterange(v_pst, v_bst - 1, '[]');
            END IF;
            IF v_pen > v_ben THEN
              v_new := v_new || daterange(v_ben + 1, v_pen, '[]');
            END IF;
          END IF;
        END LOOP;
        v_periods := v_new;
      END LOOP;
    END IF;

    FOREACH v_p IN ARRAY v_periods
    LOOP
      v_pst  := lower(v_p);
      v_pen  := upper(v_p) - 1;
      v_days := (v_pen - v_pst) + 1;
      IF v_days <= 0 THEN CONTINUE; END IF;

      out_tenant_id      := r.tenant_id;
      out_client_name    := r.client_name;
      out_item_id        := r.item_id;
      out_description    := r.description;
      out_vendor         := r.vendor;
      out_sidemark       := r.sidemark;
      out_item_class     := v_class_up;
      out_storage_size   := v_storage;
      out_receive_date   := v_recv;
      out_release_date   := v_rel;
      out_free_days      := v_free_days;
      out_billable_start := v_pst;
      out_billable_end   := v_pen;
      out_billable_days  := v_days;
      out_daily_rate     := v_daily_rate;
      out_total_charge   := ROUND(v_daily_rate * v_days, 2);
      out_task_id        := 'STOR-' || r.item_id || '-'
                            || to_char(v_pst, 'YYYYMMDD') || '-'
                            || to_char(v_pen, 'YYYYMMDD');
      out_notes          := 'Storage ' || to_char(v_pst, 'MM/DD/YY')
                            || ' to ' || to_char(v_pen, 'MM/DD/YY')
                            || ' (' || v_days || ' day(s))';
      out_shipment_no    := r.shipment_number;
      out_location       := r.location;
      RETURN NEXT;
    END LOOP;
  END LOOP;

  RETURN;
END;
$$;

COMMENT ON FUNCTION public._compute_storage_charges(text, text, date, date) IS
  'Internal: shared compute path for calculate_storage_charges + generate_storage_charges. Mirrors GAS handleGenerateStorageCharges_/handlePreviewStorageCharges_ exactly so totals match cell-for-cell. v38.245.1 (2026-05-28): excludes transferred-out source rows (status=transferred with a sibling row at another tenant sharing item_id + receive_date) — destination owns storage end-to-end via the at-transfer backfill in handleTransferItems_.';

NOTIFY pgrst, 'reload schema';
