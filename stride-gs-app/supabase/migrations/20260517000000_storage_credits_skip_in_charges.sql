-- ============================================================
-- Storage Credits — free-storage windows that suppress billing
--
-- An admin grants a (free_from, free_to) window on an inventory
-- item via the React StorageCreditModal. Those days must never
-- land on a storage invoice. This migration:
--
--   1. Ensures public.storage_credits exists (table was created
--      ad-hoc in prod; this is the git-source-of-truth definition
--      + indexes + RLS so the repo is authoritative). IF NOT
--      EXISTS / idempotent policy drops make it safe to re-apply.
--   2. Redefines public._compute_storage_charges() so active
--      credit ranges (deleted_at IS NULL) are subtracted from the
--      billable period exactly like already-billed STOR ranges.
--      Only the inner compute function changes; the public
--      calculate_storage_charges / generate_storage_charges
--      wrappers call it unchanged, so BOTH preview and commit
--      honor credits.
--
-- 2026-05-17 PST
-- ============================================================

-- ── 1. storage_credits table ────────────────────────────────

CREATE TABLE IF NOT EXISTS public.storage_credits (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    text NOT NULL,
  item_id      text NOT NULL,
  inventory_id uuid,
  free_from    date NOT NULL,
  free_to      date NOT NULL,
  reason       text,
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);

-- Lookup path used by _compute_storage_charges and the item panel:
-- (tenant_id, item_id) filtered to active rows.
CREATE INDEX IF NOT EXISTS storage_credits_tenant_item_active_idx
  ON public.storage_credits (tenant_id, item_id)
  WHERE deleted_at IS NULL;

ALTER TABLE public.storage_credits ENABLE ROW LEVEL SECURITY;

-- Read: admin + staff (item detail panel surfaces credits to both);
-- service_role for the SECURITY DEFINER compute path / scripted runs.
DROP POLICY IF EXISTS storage_credits_read ON public.storage_credits;
CREATE POLICY storage_credits_read ON public.storage_credits
  FOR SELECT
  USING (
    (auth.jwt() -> 'user_metadata' ->> 'role') IN ('admin', 'staff')
    OR auth.role() = 'service_role'
  );

-- Write (insert credit + soft-delete): admin only, plus service_role.
DROP POLICY IF EXISTS storage_credits_write_admin ON public.storage_credits;
CREATE POLICY storage_credits_write_admin ON public.storage_credits
  FOR ALL
  USING (
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
    OR auth.role() = 'service_role'
  )
  WITH CHECK (
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
    OR auth.role() = 'service_role'
  );

COMMENT ON TABLE public.storage_credits IS
  'Admin-granted free-storage windows. Active rows (deleted_at IS NULL) are subtracted from the billable period by _compute_storage_charges(). Soft-delete (set deleted_at) un-applies the credit.';


-- ── 2. _compute_storage_charges: subtract active credit ranges ──
-- Verbatim copy of the 20260502200000 definition with one added
-- block: after building v_billed from finalized STOR billing rows,
-- union in active storage_credits ranges so the existing interval-
-- subtraction loop drops credited days too.

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
  -- Period subtraction state
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
  -- Period bounds default to current calendar month if missing.
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
      -- inventory.{receive,release,transfer}_date are TEXT in the
      -- mirror schema — empty string when absent. Cast safely.
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
  LOOP
    v_status   := r.status;
    v_recv     := r.receive_date;
    v_rel      := r.release_date;
    v_xfer     := r.transfer_date;
    v_class_up := UPPER(r.item_class);

    -- Status filter (mirror of GAS):
    --   active / on hold              → bill
    --   released w/ release_date      → bill (need release_date)
    --   transferred w/ transfer_date  → bill source side up to xfer-1
    --   anything else                 → skip
    IF v_status = 'transferred' THEN
      IF v_xfer IS NULL THEN CONTINUE; END IF;
    ELSIF v_status = 'released' THEN
      IF v_rel IS NULL THEN CONTINUE; END IF;
    ELSIF v_status NOT IN ('active', 'on hold', '') THEN
      CONTINUE;
    END IF;

    -- Effective recv / end with transfer-cutover logic:
    --   transferred + transfer_date  → bill up to transfer_date - 1
    --   destination side (transfer_date set, status not transferred)
    --                               → effective_recv = transfer_date,
    --                                 fresh free-days credit
    --   otherwise                   → standard
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

    -- Storage size + STOR rate → daily rate (with client discount).
    v_storage := r.storage_size;
    IF v_storage IS NULL OR v_storage <= 0 THEN CONTINUE; END IF;

    -- Rate keyed by class on the jsonb (matches log_billing_parity()).
    IF r.stor_rates IS NULL THEN
      v_base := 0;
    ELSE
      v_base := COALESCE((r.stor_rates ->> v_class_up)::numeric, 0);
    END IF;
    IF v_base <= 0 THEN CONTINUE; END IF;
    v_daily_rate := ROUND(v_base * v_storage * (1 + v_disc_pct / 100.0), 2);

    -- Dedup: subtract any already-billed STOR ranges (Invoiced /
    -- Billed / Void) from the candidate charge period. Yields 0..N
    -- non-overlapping sub-periods.
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

    -- Storage credits: active (deleted_at IS NULL) free-storage
    -- windows for this item are treated exactly like already-billed
    -- ranges — subtracted from the candidate period so credited days
    -- never appear on an invoice. Guard free_from <= free_to so a
    -- malformed row can't raise a daterange bound error.
    v_billed := v_billed || ARRAY(
      SELECT daterange(cr.free_from, cr.free_to, '[]')
        FROM public.storage_credits cr
       WHERE cr.tenant_id  = r.tenant_id
         AND cr.item_id    = r.item_id
         AND cr.deleted_at IS NULL
         AND cr.free_from  IS NOT NULL
         AND cr.free_to    IS NOT NULL
         AND cr.free_to   >= cr.free_from
    );

    IF array_length(v_billed, 1) IS NOT NULL THEN
      FOREACH v_billed_one IN ARRAY v_billed
      LOOP
        v_new := ARRAY[]::daterange[];
        FOREACH v_p IN ARRAY v_periods
        LOOP
          v_pst := lower(v_p);                        -- daterange '[]' lower bound
          v_pen := upper(v_p) - 1;                    -- daterange canon to '[)' so upper is exclusive
          v_bst := lower(v_billed_one);
          v_ben := upper(v_billed_one) - 1;
          IF v_ben < v_pst OR v_bst > v_pen THEN
            -- No overlap, keep period.
            v_new := v_new || v_p;
          ELSE
            IF v_pst < v_bst THEN
              v_new := v_new || daterange(v_pst, v_bst - 1, '[]');
            END IF;
            IF v_pen > v_ben THEN
              v_new := v_new || daterange(v_ben + 1, v_pen, '[]');
            END IF;
            -- Overlapping portion is dropped (already billed / credited).
          END IF;
        END LOOP;
        v_periods := v_new;
      END LOOP;
    END IF;

    -- Emit one output row per remaining period.
    FOREACH v_p IN ARRAY v_periods
    LOOP
      v_pst  := lower(v_p);
      v_pen  := upper(v_p) - 1;  -- daterange auto-canonicalizes [] → [)
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
  'Internal: shared compute path for calculate_storage_charges + generate_storage_charges. Mirrors GAS handleGenerateStorageCharges_/handlePreviewStorageCharges_ and additionally subtracts active public.storage_credits windows (2026-05-17).';

-- Refresh PostgREST schema cache so storage_credits is immediately
-- REST-readable from the browser and the redefined RPC is picked up.
NOTIFY pgrst, 'reload schema';
