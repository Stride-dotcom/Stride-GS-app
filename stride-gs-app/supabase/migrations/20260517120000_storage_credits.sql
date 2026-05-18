-- ============================================================
-- Storage Credits
--
-- Admin-granted free-storage windows. A credit waives the
-- per-day STOR charge for the days it covers, scoped either to
-- a whole client (item_id NULL) or one specific item.
--
-- The day is still surfaced in the storage-charge report as a
-- zero-dollar "Credited" row so the waiver is auditable and the
-- client can see what was comped (Billing → Storage Charges
-- renders a "Credited" badge off the new `credited` column).
--
-- Wiring into the existing Postgres storage-charge engine
-- (migration 20260502200000):
--   • _compute_storage_charges  — after the finalized-billing
--       dedup, subtract active credit ranges from each candidate
--       charge period. Uncovered days emit as normal charge
--       rows (credited = false). Covered days emit as
--       zero-dollar rows (credited = true, credit_reason set,
--       task id prefix STORCR- so they never collide with or
--       dedup against real STOR rows).
--   • calculate_storage_charges — gains `credited` +
--       `credit_reason` output columns (signature change →
--       DROP + CREATE, re-GRANT).
--   • generate_storage_charges  — inserts credited rows with
--       status 'Credited' (NOT 'Unbilled', so invoice
--       generation never picks them up) and rate/total 0.
--       The pre-insert cleanup also clears prior 'Credited'
--       STOR rows in the window so re-running reflects credit
--       add/delete.
--
-- Note on created_by: the spec sketched uuid REFERENCES
-- auth.users(id), but every other audit/actor column in this
-- schema (entity_audit_log.performed_by, billing actor fields)
-- stores the user's email as text, and the React layer passes
-- user.email. Kept as text for consistency with that pattern.
--
-- 2026-05-17 PST
-- ============================================================

-- ── Table ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.storage_credits (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    text NOT NULL REFERENCES public.clients(spreadsheet_id),
  item_id      text,                                  -- NULL = whole client, non-null = one item
  inventory_id uuid REFERENCES public.inventory(id),
  free_from    date NOT NULL,
  free_to      date NOT NULL,
  reason       text NOT NULL DEFAULT '',
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (free_to >= free_from)
);

CREATE INDEX IF NOT EXISTS idx_storage_credits_tenant_item
  ON public.storage_credits (tenant_id, item_id);
CREATE INDEX IF NOT EXISTS idx_storage_credits_inventory
  ON public.storage_credits (inventory_id);

COMMENT ON TABLE public.storage_credits IS
  'Admin-granted free-storage windows. Waives the STOR per-day charge for covered days (whole client when item_id IS NULL, else one item). Honored by _compute_storage_charges; covered days still logged as zero-dollar Credited rows.';

-- ── RLS: admin/staff full access ─────────────────────────────

ALTER TABLE public.storage_credits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "storage_credits admin/staff select"
  ON public.storage_credits FOR SELECT
  USING ((auth.jwt() -> 'user_metadata' ->> 'role') IN ('admin', 'staff'));

CREATE POLICY "storage_credits admin/staff insert"
  ON public.storage_credits FOR INSERT
  WITH CHECK ((auth.jwt() -> 'user_metadata' ->> 'role') IN ('admin', 'staff'));

CREATE POLICY "storage_credits admin/staff delete"
  ON public.storage_credits FOR DELETE
  USING ((auth.jwt() -> 'user_metadata' ->> 'role') IN ('admin', 'staff'));

-- ── Recreate the storage-charge engine with credit awareness ──
-- Signature of _compute_storage_charges + calculate_storage_charges
-- changes (two new output columns) so they must be dropped first.
-- Order matters: calculate_ (LANGUAGE sql) hard-depends on
-- _compute_; drop the dependent first.

DROP FUNCTION IF EXISTS public.calculate_storage_charges(text, text, date, date);
DROP FUNCTION IF EXISTS public.generate_storage_charges(text, text, date, date);
DROP FUNCTION IF EXISTS public._compute_storage_charges(text, text, date, date);

CREATE FUNCTION public._compute_storage_charges(
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
  out_location       text,
  out_credited       boolean,
  out_credit_reason  text
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
  -- Credit state
  v_cr         record;
  v_uncredited daterange[];
  v_cr_rng     daterange;
  v_int_st     date;
  v_int_en     date;
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

    -- Dedup: subtract finalized (Invoiced/Billed/Void) STOR ranges.
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

    -- ── Storage credits ──────────────────────────────────────
    -- Subtract every active credit range from v_periods to get
    -- the still-billable (uncredited) sub-periods. Emit those as
    -- normal charge rows. Then, per credit, emit a zero-dollar
    -- "Credited" row for the intersection of the credit with the
    -- original (post-billing-dedup) periods so the waiver is
    -- visible/auditable in the storage report.
    v_uncredited := v_periods;
    FOR v_cr IN
      SELECT free_from, free_to, COALESCE(reason, '') AS reason
        FROM public.storage_credits
       WHERE tenant_id = r.tenant_id
         AND (item_id IS NULL OR item_id = r.item_id)
         AND free_to   >= v_charge_st
         AND free_from <= v_charge_en
       ORDER BY free_from
    LOOP
      v_cr_rng := daterange(v_cr.free_from, v_cr.free_to, '[]');

      -- (a) Carve the credit out of the still-billable set.
      v_new := ARRAY[]::daterange[];
      IF array_length(v_uncredited, 1) IS NOT NULL THEN
        FOREACH v_p IN ARRAY v_uncredited
        LOOP
          v_pst := lower(v_p);
          v_pen := upper(v_p) - 1;
          v_bst := lower(v_cr_rng);
          v_ben := upper(v_cr_rng) - 1;
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
      END IF;
      v_uncredited := v_new;

      -- (b) Emit a zero-dollar credited row per (period ∩ credit).
      FOREACH v_p IN ARRAY v_periods
      LOOP
        v_pst := lower(v_p);
        v_pen := upper(v_p) - 1;
        v_int_st := GREATEST(v_pst, v_cr.free_from);
        v_int_en := LEAST(v_pen, v_cr.free_to);
        IF v_int_st > v_int_en THEN CONTINUE; END IF;
        v_days := (v_int_en - v_int_st) + 1;

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
        out_billable_start := v_int_st;
        out_billable_end   := v_int_en;
        out_billable_days  := v_days;
        out_daily_rate     := 0;
        out_total_charge   := 0;
        out_task_id        := 'STORCR-' || r.item_id || '-'
                              || to_char(v_int_st, 'YYYYMMDD') || '-'
                              || to_char(v_int_en, 'YYYYMMDD');
        out_notes          := 'Storage credited ' || to_char(v_int_st, 'MM/DD/YY')
                              || ' to ' || to_char(v_int_en, 'MM/DD/YY')
                              || ' (' || v_days || ' day(s))'
                              || CASE WHEN v_cr.reason <> ''
                                      THEN ' — ' || v_cr.reason ELSE '' END;
        out_shipment_no    := r.shipment_number;
        out_location       := r.location;
        out_credited       := true;
        out_credit_reason  := v_cr.reason;
        RETURN NEXT;
      END LOOP;
    END LOOP;

    -- Emit one normal charge row per remaining uncredited period.
    FOREACH v_p IN ARRAY v_uncredited
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
      out_credited       := false;
      out_credit_reason  := NULL;
      RETURN NEXT;
    END LOOP;
  END LOOP;

  RETURN;
END;
$$;

COMMENT ON FUNCTION public._compute_storage_charges(text, text, date, date) IS
  'Internal: shared compute path for calculate_/generate_storage_charges. Mirrors GAS handleGenerate/handlePreview, plus storage_credits: covered days emit zero-dollar credited rows (STORCR- task id), uncovered days emit normal STOR charge rows.';


-- ── Public: read-only preview (now exposes credit columns) ───

CREATE FUNCTION public.calculate_storage_charges(
  p_tenant_id    text DEFAULT NULL,
  p_sidemark     text DEFAULT NULL,
  p_period_start date DEFAULT NULL,
  p_period_end   date DEFAULT NULL
)
RETURNS TABLE (
  tenant_id      text,
  client_name    text,
  item_id        text,
  description    text,
  vendor         text,
  sidemark       text,
  item_class     text,
  storage_size   numeric,
  receive_date   date,
  release_date   date,
  free_days      integer,
  billable_start date,
  billable_end   date,
  billable_days  integer,
  daily_rate     numeric,
  total_charge   numeric,
  task_id        text,
  notes          text,
  shipment_no    text,
  location       text,
  credited       boolean,
  credit_reason  text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    out_tenant_id, out_client_name, out_item_id, out_description, out_vendor,
    out_sidemark,  out_item_class,  out_storage_size, out_receive_date,
    out_release_date, out_free_days, out_billable_start, out_billable_end,
    out_billable_days, out_daily_rate, out_total_charge, out_task_id,
    out_notes, out_shipment_no, out_location, out_credited, out_credit_reason
  FROM public._compute_storage_charges(p_tenant_id, p_sidemark, p_period_start, p_period_end)
  ORDER BY out_client_name, out_item_id, out_billable_start
$$;

COMMENT ON FUNCTION public.calculate_storage_charges(text, text, date, date) IS
  'Storage charges preview (read-only). One row per item × charge period after billing dedup + credit split. credited=true rows are zero-dollar waiver log rows (Billing → Storage renders a Credited badge).';

GRANT EXECUTE ON FUNCTION public.calculate_storage_charges(text, text, date, date)
  TO anon, authenticated, service_role;


-- ── Public: generate (writes Unbilled + Credited rows) ───────

CREATE FUNCTION public.generate_storage_charges(
  p_tenant_id    text DEFAULT NULL,
  p_sidemark     text DEFAULT NULL,
  p_period_start date DEFAULT NULL,
  p_period_end   date DEFAULT NULL
)
RETURNS TABLE (
  total_created    integer,
  total_amount     numeric,
  clients_affected integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_period_start date;
  v_period_end   date;
  v_rows_created integer;
  v_total        numeric;
  v_clients      integer;
  v_role         text;
BEGIN
  IF auth.role() = 'service_role' THEN
    NULL;
  ELSE
    v_role := COALESCE(auth.jwt() -> 'user_metadata' ->> 'role', '');
    IF v_role <> 'admin' THEN
      RAISE EXCEPTION 'generate_storage_charges requires admin role (got %)', v_role
        USING ERRCODE = '42501';
    END IF;
  END IF;

  v_period_start := COALESCE(p_period_start, date_trunc('month', current_date)::date);
  v_period_end   := COALESCE(p_period_end, current_date);

  CREATE TEMP TABLE _stor_pending ON COMMIT DROP AS
    SELECT *
      FROM public._compute_storage_charges(p_tenant_id, p_sidemark, v_period_start, v_period_end);

  -- Delete the regenerable window: Unbilled real rows AND prior
  -- Credited rows (so credit add/delete is reflected on re-run).
  -- Finalized rows (Invoiced/Billed/Void) are never touched.
  CREATE TEMP TABLE _stor_delete ON COMMIT DROP AS
    SELECT DISTINCT b.tenant_id, b.task_id
      FROM public.billing b
     WHERE b.svc_code = 'STOR'
       AND LOWER(COALESCE(b.status, '')) IN ('unbilled', '', 'credited')
       AND b.tenant_id IN (SELECT DISTINCT out_tenant_id FROM _stor_pending)
       AND (
         EXISTS (
           SELECT 1 FROM _stor_pending p
            WHERE p.out_tenant_id = b.tenant_id
              AND p.out_task_id   = b.task_id
         )
         OR EXISTS (
           SELECT 1
             FROM public._parse_stor_task_range(b.task_id) rng
            WHERE rng.range_start IS NOT NULL
              AND rng.range_end   IS NOT NULL
              AND rng.range_start <= v_period_end
              AND rng.range_end   >= v_period_start
         )
       );

  DELETE FROM public.billing b
   USING _stor_delete d
   WHERE b.tenant_id = d.tenant_id
     AND b.task_id   = d.task_id
     AND b.svc_code  = 'STOR'
     AND LOWER(COALESCE(b.status, '')) IN ('unbilled', '', 'credited');

  -- Insert. Credited rows get status 'Credited' (excluded from
  -- the Unbilled→Invoice pipeline) and zero rate/total.
  INSERT INTO public.billing (
    tenant_id, ledger_row_id, status, client_name, date,
    svc_code, svc_name, category, item_id, description,
    item_class, qty, rate, total, task_id,
    shipment_number, item_notes, sidemark
  )
  SELECT
    p.out_tenant_id,
    p.out_task_id,
    CASE WHEN p.out_credited THEN 'Credited' ELSE 'Unbilled' END,
    p.out_client_name,
    p.out_billable_end::text,
    'STOR',
    'Storage',
    'Storage Charges',
    p.out_item_id,
    p.out_description,
    p.out_item_class,
    p.out_billable_days,
    p.out_daily_rate,
    p.out_total_charge,
    p.out_task_id,
    p.out_shipment_no,
    p.out_notes,
    p.out_sidemark
  FROM _stor_pending p
  WHERE NOT EXISTS (
    SELECT 1 FROM public.billing b
     WHERE b.tenant_id = p.out_tenant_id
       AND b.task_id   = p.out_task_id
  );

  GET DIAGNOSTICS v_rows_created = ROW_COUNT;

  -- Headline amount/clients reflect real (non-credited) charges.
  SELECT COALESCE(SUM(out_total_charge), 0),
         COUNT(DISTINCT out_tenant_id)
    INTO v_total, v_clients
    FROM _stor_pending
   WHERE out_credited = false;

  total_created    := v_rows_created;
  total_amount     := v_total;
  clients_affected := v_clients;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.generate_storage_charges(text, text, date, date) IS
  'Storage charges commit. Deletes regenerable (Unbilled + Credited) STOR rows in the window then inserts fresh rows: real charges Unbilled, credit-waived days as zero-dollar Credited rows. Finalized rows untouched. Idempotent.';

GRANT EXECUTE ON FUNCTION public.generate_storage_charges(text, text, date, date)
  TO authenticated, service_role;


-- Refresh PostgREST schema cache so the new table + RPC columns
-- are immediately visible to the browser client.
NOTIFY pgrst, 'reload schema';
