-- ============================================================
-- Storage charges — Postgres-resident calculation + generation
--
-- Replaces the GAS handlePreviewStorageCharges_ /
-- handleGenerateStorageCharges_ pair for the React Billing →
-- Storage tab. The GAS path was timing out (>5 min) on large
-- clients (e.g. Allison Lind Design with thousands of items)
-- because every item required a per-row sheet read + remote
-- service_catalog lookup + per-row write. Both were folded into
-- this single Postgres pair, which runs against the Supabase
-- mirror tables (inventory, service_catalog, item_classes,
-- clients, billing) and finishes in seconds for any sized client.
--
-- Two SECURITY DEFINER functions ship here:
--
--   public.calculate_storage_charges(...)  → SETOF row, read-only
--   public.generate_storage_charges(...)   → INSERTs Unbilled rows
--                                            into public.billing
--
-- Both share the same inner CTE so the preview math is identical
-- to what generate writes. Logic mirrors handleGenerate /
-- handlePreview in StrideAPI.gs lines 18816-19491:
--
--   • billable_start = max(receive_date + free_storage_days, period_start)
--   • effective_end  = min(release_date - 1, period_end)        [released]
--                    | min(transfer_date - 1, period_end)       [source side]
--                    | period_end                               [otherwise]
--   • effective_recv = transfer_date when destination side
--   • billable_days  = effective_end - billable_start + 1   (inclusive)
--   • daily_rate     = STOR jsonb rate × class.storage_size
--                      × (1 + discount_storage_pct / 100)
--   • total          = days × daily_rate
--
-- Dedup against finalized rows (status in Invoiced/Billed/Void
-- and svc_code='STOR'): subtract any already-billed (start, end)
-- range from the new charge period, splitting around the gap so
-- a partial-month overlap leaves only the non-overlapping
-- portion. Implemented per-item in plpgsql since SQL doesn't
-- have a clean primitive for "subtract a list of intervals
-- from another list of intervals."
--
-- Task ID format mirrors api_buildStorTaskId_:
--   STOR-<itemId>-<YYYYMMDD_start>-<YYYYMMDD_end>
-- Dedup also accepts the legacy YYYY-MM-DD-YYYY-MM-DD format
-- written by older GAS versions (still present in finalized
-- rows for migrated clients).
--
-- 2026-05-02 PST
-- ============================================================

-- ── Helpers ──────────────────────────────────────────────────

-- Parse the (start, end) range out of a STOR task id. Returns
-- (start, end) as dates, or NULL if no recognizable date pair
-- is present. Both formats supported:
--   STOR-<id>-YYYYMMDD-YYYYMMDD          (current)
--   STOR-<id>-YYYY-MM-DD-YYYY-MM-DD      (legacy)
CREATE OR REPLACE FUNCTION public._parse_stor_task_range(p_task_id text)
RETURNS TABLE(range_start date, range_end date)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  m text[];
BEGIN
  IF p_task_id IS NULL OR p_task_id = '' THEN
    RETURN;
  END IF;

  -- Current format: -YYYYMMDD-YYYYMMDD at the end
  m := regexp_match(p_task_id, '-(\d{8})-(\d{8})$');
  IF m IS NOT NULL THEN
    range_start := to_date(m[1], 'YYYYMMDD');
    range_end   := to_date(m[2], 'YYYYMMDD');
    RETURN NEXT;
    RETURN;
  END IF;

  -- Legacy format: -YYYY-MM-DD-YYYY-MM-DD at the end
  m := regexp_match(p_task_id, '-(\d{4}-\d{2}-\d{2})-(\d{4}-\d{2}-\d{2})$');
  IF m IS NOT NULL THEN
    range_start := to_date(m[1], 'YYYY-MM-DD');
    range_end   := to_date(m[2], 'YYYY-MM-DD');
    RETURN NEXT;
    RETURN;
  END IF;
END;
$$;

COMMENT ON FUNCTION public._parse_stor_task_range(text) IS
  'Helper for storage-charge dedup: extracts (start, end) date pair from STOR task ids. Supports both YYYYMMDD and legacy YYYY-MM-DD encodings.';


-- ── Inner builder: yields the raw computed-row set ──────────
-- This is the meat of the calculation. Both calculate_ and
-- generate_ wrap it. Returns one row per non-empty charge
-- period, post-dedup against finalized billing.

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
            -- Overlapping portion is dropped (already billed).
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
  'Internal: shared compute path for calculate_storage_charges + generate_storage_charges. Mirrors GAS handleGenerateStorageCharges_/handlePreviewStorageCharges_ exactly so totals match cell-for-cell.';


-- ── Public: read-only preview ────────────────────────────────

CREATE OR REPLACE FUNCTION public.calculate_storage_charges(
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
  location       text
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
    out_notes, out_shipment_no, out_location
  FROM public._compute_storage_charges(p_tenant_id, p_sidemark, p_period_start, p_period_end)
  ORDER BY out_client_name, out_item_id, out_billable_start
$$;

COMMENT ON FUNCTION public.calculate_storage_charges(text, text, date, date) IS
  'Storage charges preview (read-only). Returns one row per item × charge period after dedup. Used by Billing → Storage Charges tab via supabase.rpc.';

GRANT EXECUTE ON FUNCTION public.calculate_storage_charges(text, text, date, date)
  TO anon, authenticated, service_role;


-- ── Public: generate (writes Unbilled rows) ──────────────────
-- Mirrors handleGenerateStorageCharges_'s "delete-then-rebuild
-- unbilled in window" flow:
--   1. Compute new pending rows (same path as preview).
--   2. Delete existing Unbilled STOR rows in the window for the
--      affected tenants (so re-running cleanly replaces them).
--   3. Insert pending rows. Conflicts on (tenant_id, ledger_row_id)
--      are skipped to keep the operation idempotent.

CREATE OR REPLACE FUNCTION public.generate_storage_charges(
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
  -- Admin gate. SECURITY DEFINER would otherwise let any authenticated
  -- caller write Unbilled rows for any tenant. service_role calls
  -- (StrideAPI.gs / scripted runs) bypass via auth.role().
  IF auth.role() = 'service_role' THEN
    -- service_role bypass; nothing to check.
    NULL;
  ELSE
    v_role := COALESCE(
      auth.jwt() -> 'user_metadata' ->> 'role',
      ''
    );
    IF v_role <> 'admin' THEN
      RAISE EXCEPTION 'generate_storage_charges requires admin role (got %)', v_role
        USING ERRCODE = '42501';
    END IF;
  END IF;

  v_period_start := COALESCE(p_period_start, date_trunc('month', current_date)::date);
  v_period_end   := COALESCE(p_period_end, current_date);

  -- Stage the computed rows in a temp table so we can delete the
  -- corresponding window from billing first, then insert without
  -- racing with our own SELECT.
  CREATE TEMP TABLE _stor_pending ON COMMIT DROP AS
    SELECT *
      FROM public._compute_storage_charges(p_tenant_id, p_sidemark, v_period_start, v_period_end);

  -- Stage which (tenant_id, task_id) tuples should be deleted before
  -- the insert. Two cases, mirroring handleGenerateStorageCharges_:
  --   • Same task_id as a pending row → being replaced exactly.
  --   • Different task_id but its parsed period overlaps the window
  --     → stale row whose item no longer qualifies; would otherwise
  --       linger after a re-run with new bounds.
  CREATE TEMP TABLE _stor_delete ON COMMIT DROP AS
    SELECT DISTINCT b.tenant_id, b.task_id
      FROM public.billing b
     WHERE b.svc_code = 'STOR'
       AND LOWER(COALESCE(b.status, '')) IN ('unbilled', '')
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
     AND LOWER(COALESCE(b.status, '')) IN ('unbilled', '');

  -- Insert the new rows. Conflicts on the insurance-style partial
  -- unique index don't apply here, but we guard with a NOT EXISTS
  -- so a second concurrent generate doesn't double-insert.
  INSERT INTO public.billing (
    tenant_id, ledger_row_id, status, client_name, date,
    svc_code, svc_name, category, item_id, description,
    item_class, qty, rate, total, task_id,
    shipment_number, item_notes, sidemark
  )
  SELECT
    p.out_tenant_id,
    p.out_task_id,
    'Unbilled',
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

  SELECT COALESCE(SUM(out_total_charge), 0),
         COUNT(DISTINCT out_tenant_id)
    INTO v_total, v_clients
    FROM _stor_pending;

  total_created    := v_rows_created;
  total_amount     := v_total;
  clients_affected := v_clients;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.generate_storage_charges(text, text, date, date) IS
  'Storage charges commit. Deletes Unbilled STOR rows in the window then inserts fresh rows from _compute_storage_charges. Idempotent: re-running with identical bounds replaces unbilled rows in place; finalized (Invoiced/Billed/Void) rows are left alone and dedupped against.';

-- Restrict generate to admins (role asserted via JWT) plus the
-- service role. The Billing page is admin-only in the React app
-- (RoleGuard wraps the route) but the RPC also enforces here.
GRANT EXECUTE ON FUNCTION public.generate_storage_charges(text, text, date, date)
  TO authenticated, service_role;


-- Refresh PostgREST schema cache so the new RPCs are immediately
-- callable from the browser without waiting for the periodic
-- reload.
NOTIFY pgrst, 'reload schema';
