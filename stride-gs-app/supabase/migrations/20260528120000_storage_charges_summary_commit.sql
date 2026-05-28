-- ============================================================
-- Storage charges — summarize at commit (one row per tenant)
--
-- Replaces public.generate_storage_charges(...) with a variant
-- that aggregates the per-item rows from _compute_storage_charges
-- into ONE summary public.billing row per tenant per commit.
--
-- Pre-change: every per-item × period charge landed as a
-- separate billing row. Roche Bobois produced 372 rows for a
-- single monthly cycle; the fleet shipped 2,340 STOR rows after
-- one cycle. React's Billing.tsx summarizeStorageRowsForInvoice
-- already collapses the lot into one customer-facing line at
-- invoice time, so the per-item rows existed only to bloat the
-- ledger between commit and invoice.
--
-- New behavior:
--   • Compute via _compute_storage_charges (unchanged — preview
--     still shows per-item detail).
--   • Group computed rows by tenant. Aggregate sum(total_charge)
--     into one summary line per tenant.
--   • ledger_row_id / task_id = STOR-SUMMARY-<tenantId>-<YYYYMMDD>-<YYYYMMDD>
--     (deterministic, sheet-resident, distinct from the legacy
--     React invoice-time synthetic STOR-SUMMARY-<uuid> form).
--   • description = "Monthly Storage", qty = 1, rate = NULL,
--     total = aggregate, date = period_end, item_id = NULL,
--     item_class = NULL, sidemark = NULL.
--   • item_notes carries "Storage MM/DD/YY to MM/DD/YY (N items)"
--     so a human reading the row can see the period + count.
--
-- Safety gate: when ANY finalized (Invoiced/Billed/Void)
-- STOR-SUMMARY row already covers an overlapping window for the
-- tenant, the tenant is skipped from the commit. Without this
-- gate, an accidental re-run after invoicing would double-bill —
-- _compute_storage_charges's per-item dedup keys on item_id
-- (blank on summary rows) so it cannot catch this case.
--
-- The "delete existing Unbilled STOR in window" pass widens to
-- remove any Unbilled STOR row in the window (per-item leftovers
-- from older builds + prior summaries in the same window). This
-- keeps re-running idempotent within the Unbilled state.
--
-- _compute_storage_charges + _parse_stor_task_range + the
-- preview function calculate_storage_charges are unchanged.
-- Only public.generate_storage_charges (the COMMIT entry point)
-- is replaced.
--
-- 2026-05-28 PST
-- ============================================================

-- ── New helper: parse period from a STOR-SUMMARY ledger row id ──
-- Accepts the deterministic format only:
--   STOR-SUMMARY-<tenantId>-<YYYYMMDD>-<YYYYMMDD>
-- Returns NULL for the legacy synthetic STOR-SUMMARY-<uuid> form
-- (no parseable trailing date pair — uuids end in hex segments).

CREATE OR REPLACE FUNCTION public._parse_stor_summary_period(p_ledger_row_id text)
RETURNS TABLE(period_start date, period_end date)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  m text[];
BEGIN
  IF p_ledger_row_id IS NULL OR p_ledger_row_id = '' THEN
    RETURN;
  END IF;
  IF position('STOR-SUMMARY-' IN p_ledger_row_id) <> 1 THEN
    RETURN;
  END IF;

  m := regexp_match(p_ledger_row_id, '-(\d{8})-(\d{8})$');
  IF m IS NOT NULL THEN
    period_start := to_date(m[1], 'YYYYMMDD');
    period_end   := to_date(m[2], 'YYYYMMDD');
    RETURN NEXT;
    RETURN;
  END IF;
END;
$$;

COMMENT ON FUNCTION public._parse_stor_summary_period(text) IS
  'Parse (period_start, period_end) from STOR-SUMMARY-<tenantId>-<YYYYMMDD>-<YYYYMMDD> ledger row ids. Returns no rows for the legacy synthetic STOR-SUMMARY-<uuid> form (those carry no period — they are keyed to the invoice).';


-- ── Replace generate_storage_charges with the aggregating commit ──

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

  -- Stage the per-item computed rows. Same path as preview, so totals
  -- match cell-for-cell with what the operator reviewed.
  CREATE TEMP TABLE _stor_pending ON COMMIT DROP AS
    SELECT *
      FROM public._compute_storage_charges(p_tenant_id, p_sidemark, v_period_start, v_period_end);

  -- Aggregate per tenant. ONE summary row per tenant per commit.
  -- summary_date = max billable_end (so the row's Date column reflects
  -- the latest day actually billed, not just period_end which would lie
  -- if all items in this commit got released earlier in the window).
  CREATE TEMP TABLE _stor_summary ON COMMIT DROP AS
    SELECT
      out_tenant_id                                                     AS tenant_id,
      MAX(out_client_name)                                              AS client_name,
      MAX(out_billable_end)                                             AS summary_date,
      SUM(out_total_charge)                                             AS total,
      COUNT(DISTINCT out_item_id)                                       AS item_count
    FROM _stor_pending
    GROUP BY out_tenant_id
    HAVING SUM(out_total_charge) > 0;

  -- Safety gate: skip any tenant whose window is already covered by a
  -- finalized STOR-SUMMARY row. Per-item dedup in _compute_storage_charges
  -- cannot catch this (item_id is blank on summary rows). Without this
  -- gate, an accidental re-run after invoicing would double-bill.
  DELETE FROM _stor_summary s
   WHERE EXISTS (
     SELECT 1
       FROM public.billing b
       CROSS JOIN LATERAL public._parse_stor_summary_period(b.ledger_row_id) p
      WHERE b.tenant_id = s.tenant_id
        AND b.svc_code  = 'STOR'
        AND LOWER(COALESCE(b.status, '')) IN ('invoiced', 'billed', 'void')
        AND p.period_start IS NOT NULL
        AND p.period_end   IS NOT NULL
        AND p.period_start <= v_period_end
        AND p.period_end   >= v_period_start
   );

  -- Widen the delete pass: any Unbilled STOR row whose parsed task_id
  -- range overlaps the window (per-item leftovers from pre-summary
  -- builds), plus any Unbilled STOR row whose parsed STOR-SUMMARY
  -- period overlaps (a prior summary in the same window being replaced
  -- by this re-run). public.billing.date is text, so dropping a third
  -- "date column in window" fallback intentionally — a malformed date
  -- string would throw on the ::date cast and abort the entire commit.
  -- Both helpers below tolerate malformed input by returning no rows;
  -- an Unbilled STOR row with NEITHER a parseable task_id NOR a
  -- parseable summary id is by definition externally produced and is
  -- left in place.
  DELETE FROM public.billing b
   USING (SELECT DISTINCT tenant_id FROM _stor_summary) s
   WHERE b.tenant_id = s.tenant_id
     AND b.svc_code  = 'STOR'
     AND LOWER(COALESCE(b.status, '')) IN ('unbilled', '')
     AND (
       EXISTS (
         SELECT 1
           FROM public._parse_stor_task_range(b.task_id) rng
          WHERE rng.range_start IS NOT NULL
            AND rng.range_end   IS NOT NULL
            AND rng.range_start <= v_period_end
            AND rng.range_end   >= v_period_start
       )
       OR EXISTS (
         SELECT 1
           FROM public._parse_stor_summary_period(b.ledger_row_id) p
          WHERE p.period_start IS NOT NULL
            AND p.period_end   IS NOT NULL
            AND p.period_start <= v_period_end
            AND p.period_end   >= v_period_start
       )
     );

  -- Insert one summary row per surviving tenant.
  INSERT INTO public.billing (
    tenant_id, ledger_row_id, status, client_name, date,
    svc_code, svc_name, category, item_id, description,
    item_class, qty, rate, total, task_id,
    shipment_number, item_notes, sidemark
  )
  SELECT
    s.tenant_id,
    'STOR-SUMMARY-' || s.tenant_id || '-'
      || to_char(v_period_start, 'YYYYMMDD') || '-'
      || to_char(v_period_end,   'YYYYMMDD')                  AS ledger_row_id,
    'Unbilled',
    s.client_name,
    s.summary_date::text,
    'STOR',
    'Storage',
    'Storage Charges',
    NULL,
    'Monthly Storage',
    NULL,
    1,
    NULL,
    ROUND(s.total, 2),
    'STOR-SUMMARY-' || s.tenant_id || '-'
      || to_char(v_period_start, 'YYYYMMDD') || '-'
      || to_char(v_period_end,   'YYYYMMDD')                  AS task_id,
    NULL,
    'Storage ' || to_char(v_period_start, 'MM/DD/YY')
      || ' to ' || to_char(v_period_end,   'MM/DD/YY')
      || ' (' || s.item_count || ' items)',
    NULL
  FROM _stor_summary s
  WHERE NOT EXISTS (
    SELECT 1 FROM public.billing b
     WHERE b.tenant_id     = s.tenant_id
       AND b.ledger_row_id = 'STOR-SUMMARY-' || s.tenant_id || '-'
            || to_char(v_period_start, 'YYYYMMDD') || '-'
            || to_char(v_period_end,   'YYYYMMDD')
  );

  GET DIAGNOSTICS v_rows_created = ROW_COUNT;

  SELECT COALESCE(SUM(total), 0),
         COUNT(*)
    INTO v_total, v_clients
    FROM _stor_summary;

  total_created    := v_rows_created;
  total_amount     := v_total;
  clients_affected := v_clients;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.generate_storage_charges(text, text, date, date) IS
  'Storage charges commit (summary form). Aggregates per-item rows from _compute_storage_charges into ONE public.billing row per tenant per commit (svc_code=STOR, description="Monthly Storage", ledger_row_id=STOR-SUMMARY-<tenant>-<YYYYMMDD>-<YYYYMMDD>). Idempotent: re-running with identical bounds replaces Unbilled rows in place; finalized (Invoiced/Billed/Void) STOR-SUMMARY rows fence the tenant off from a re-commit covering the same window. Per-item Invoiced rows from prior builds are left alone and treated as historical detail.';

GRANT EXECUTE ON FUNCTION public.generate_storage_charges(text, text, date, date)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
