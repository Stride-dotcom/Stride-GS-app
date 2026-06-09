-- 20260608238000_generate_storage_charges_sbi_sidemark_parity.sql
--
-- Part A of the SB-native storage-commit migration (MIG-005, Phase 4a).
--
-- Brings public.generate_storage_charges (the RECOMPUTE path behind the
-- commit-storage-charges-sb edge function / flag commitStorageCharges) to parity
-- with the GAS authority handleCommitStorageRows_ on the two gaps that block a
-- safe flag flip:
--
--   1. PER-ITEM storage_billing_items WRITE.  Storage dedup is per-item
--      authoritative (storage_billing_items, guarded by uq_sbi_active_item_period).
--      The OLD generate_storage_charges wrote ONLY a STOR-SUMMARY billing row and
--      NO sbi rows, so the #671 per-item summary-lock DEFERRAL it already carried
--      had nothing to defer to: once such a summary was invoiced, partial
--      selection stranded every unselected item.  We now write one aggregated sbi
--      row per item (period = the commit window, linked to its summary's
--      ledger_row_id, status Unbilled), deleting the Unbilled-in-window working
--      set first and ON CONFLICT DO NOTHING so a concurrent/finalized row stands
--      (idempotent).  sbi rows are written ONLY for a group that actually has an
--      Unbilled summary row after the insert pass, so we never orphan Unbilled
--      sbi under a finalized/void summary id (the unique billing id is occupied).
--
--   2. SIDEMARK-AWARE summaries.  The OLD function GROUPed BY tenant only -> ONE
--      blank-sidemark whole-tenant summary.  For separate_by_sidemark clients that
--      breaks per-sidemark invoicing (Allison Lind 2026-05-30: a blank summary +
--      per-sidemark invoice grouping -> orphan CB invoices).  We now group
--      separate_by_sidemark tenants by sidemark SLUG (matching api_sidemarkSlug_:
--      strip non-alphanumerics, uppercase) and emit the deterministic id form
--      handleCommitStorageRows_ writes:
--        separate + non-blank slug  : STOR-SUMMARY-<tenant>-<SLUG>-<YYYYMMDD>-<YYYYMMDD>
--        else (blank / not separate): STOR-SUMMARY-<tenant>-<YYYYMMDD>-<YYYYMMDD>
--      Both keep the trailing -YYYYMMDD-YYYYMMDD that _parse_stor_summary_period
--      and the handleCreateInvoice_ sheet-mark regex key off.  We group by SLUG
--      (not raw upper/trim) because billing has UNIQUE(tenant_id, ledger_row_id):
--      two sidemarks slugging to the same value must collapse to ONE summary, or
--      the INSERT would violate that constraint.
--
-- Landmines PRESERVED (do not regress — they also live in _compute_storage_charges
-- AND handleCommitStorageRows_):
--   * #671  the summary lock DEFERS to per-item when finalized sbi rows exist for
--           that summary (NOT EXISTS ... storage_billing_items ... invoiced/billed).
--   * #672  'void' is NOT a locking status — a voided summary is re-billable.
--   * #673  the widen-delete date predicate is CASE-guarded (Postgres does not
--           guarantee AND short-circuits) so a malformed TEXT billing.date can
--           never abort the commit.
--
-- Latent bugs in the OLD body, fixed here as part of parity:
--   * The finalized-summary lock was TENANT-level: with per-sidemark groups it
--     would over-lock (a finalized sidemark-A summary suppressing sidemark-B).
--     Now sidemark-matched (blank finalized summary = whole-tenant lock, exactly
--     as handleCommitStorageRows_).
--   * The Unbilled-delete pass had no STOR-TRANSFER exclusion and would wipe
--     Unbilled STOR-TRANSFER-* backfill rows (v38.258.0 landmine: they bill the
--     pre-transfer holding window the monthly summary does not cover).  Now
--     excluded.
--
-- PARITY NOTE — partially-billed items (intentional, NOT a money bug): GAS
-- handleCommitStorageRows_ SKIPS an item entirely when any FINALIZED sbi row
-- overlaps the commit window (its sbiAlreadyBilled set).  This recompute instead
-- bills the precise UN-billed remainder: _compute subtracts only the finalized
-- date-range, leaving the remainder days, and step 8 writes a fresh Unbilled sbi
-- for them.  Dollars are correct and there is no double-bill (verified: day-level
-- overlap with finalized sbi/summaries is 0; the partial-unique index tolerates
-- the distinct period tuple), and this matches the PRIOR recompute behaviour —
-- but it is NOT byte-identical to the GAS edited-rows commit's coarse skip.  The
-- Part B edited-rows commit must make the same precise-vs-skip choice consciously.
--
-- Still DORMANT (no live React caller of generateStorageCharges today); this is
-- correctness/parity prep so the commitStorageCharges flip is safe, and so the
-- sbi+sidemark SQL is a reference for the Part B edited-rows commit.

CREATE OR REPLACE FUNCTION public.generate_storage_charges(
  p_tenant_id    text DEFAULT NULL::text,
  p_sidemark     text DEFAULT NULL::text,
  p_period_start date DEFAULT NULL::date,
  p_period_end   date DEFAULT NULL::date
)
RETURNS TABLE(total_created integer, total_amount numeric, clients_affected integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_period_start date;
  v_period_end   date;
  v_rows_created integer;
  v_total        numeric;
  v_clients      integer;
  v_role         text;
BEGIN
  -- Admin / service_role gate (unchanged).
  IF auth.role() = 'service_role' THEN
    NULL;
  ELSE
    v_role := COALESCE(auth.jwt() -> 'user_metadata' ->> 'role', '');
    IF v_role <> 'admin' THEN
      RAISE EXCEPTION 'generate_storage_charges requires admin role (got %)', v_role USING ERRCODE = '42501';
    END IF;
  END IF;

  v_period_start := COALESCE(p_period_start, date_trunc('month', current_date)::date);
  v_period_end   := COALESCE(p_period_end, current_date);

  -- 1. Per-item compute.  Already the not-yet-billed remainder: _compute
  --    subtracts finalized sbi rows, finalized summaries (sidemark-matched +
  --    #671 defer), storage_credits, and Unbilled STOR-TRANSFER ranges.
  CREATE TEMP TABLE _stor_pending ON COMMIT DROP AS
    SELECT * FROM public._compute_storage_charges(p_tenant_id, p_sidemark, v_period_start, v_period_end);

  -- 2. Tag each pending row with its tenant's separate_by_sidemark flag, the
  --    sidemark SLUG, the group key, and a display sidemark.
  --      grp_key = slug for separate_by_sidemark tenants ('' = blank group),
  --                '' for non-separating tenants (one blank group per tenant).
  CREATE TEMP TABLE _stor_grouped ON COMMIT DROP AS
    SELECT
      p.*,
      COALESCE(c.separate_by_sidemark, false) AS sep,
      CASE WHEN COALESCE(c.separate_by_sidemark, false)
           THEN regexp_replace(upper(trim(COALESCE(p.out_sidemark, ''))), '[^A-Z0-9]+', '', 'g')
           ELSE '' END AS grp_key,
      CASE WHEN COALESCE(c.separate_by_sidemark, false)
           THEN trim(COALESCE(p.out_sidemark, ''))
           ELSE '' END AS sidemark_display
    FROM _stor_pending p
    LEFT JOIN public.clients c ON c.tenant_id = p.out_tenant_id;

  -- 3. One summary per (tenant, grp_key); compute its deterministic ledger id.
  CREATE TEMP TABLE _stor_summary ON COMMIT DROP AS
    SELECT
      g.out_tenant_id AS tenant_id,
      g.grp_key,
      max(g.out_client_name) AS client_name,
      -- representative display sidemark (cosmetic; the slug drives the id)
      min(NULLIF(g.sidemark_display, '')) AS sidemark_display,
      max(g.out_billable_end) AS summary_date,
      sum(g.out_total_charge) AS total,
      count(DISTINCT g.out_item_id) AS item_count,
      'STOR-SUMMARY-' || g.out_tenant_id
        || CASE WHEN g.grp_key <> '' THEN '-' || g.grp_key ELSE '' END
        || '-' || to_char(v_period_start, 'YYYYMMDD')
        || '-' || to_char(v_period_end, 'YYYYMMDD') AS ledger_row_id
    FROM _stor_grouped g
    GROUP BY g.out_tenant_id, g.grp_key
    HAVING sum(g.out_total_charge) > 0;

  -- 4. Finalized-summary lock (FALLBACK to the per-item guard).  Drop a summary
  --    group when a FINALIZED STOR-SUMMARY (invoiced/billed; #672: NOT void)
  --    overlapping the window covers it AND that summary has NO per-item detail
  --    (#671 defer: when it does, the per-item layer dedups precisely, so we must
  --    NOT strand the unchecked items).  Sidemark-matched: a blank finalized
  --    summary = whole-tenant lock; otherwise it must match this group's slug.
  DELETE FROM _stor_summary s
   WHERE EXISTS (
     SELECT 1 FROM public.billing b
       CROSS JOIN LATERAL public._parse_stor_summary_period(b.ledger_row_id) p
      WHERE b.tenant_id = s.tenant_id
        AND b.svc_code = 'STOR'
        AND b.ledger_row_id LIKE 'STOR-SUMMARY-%'
        AND lower(COALESCE(b.status, '')) IN ('invoiced', 'billed')
        AND p.period_start IS NOT NULL AND p.period_end IS NOT NULL
        AND p.period_start <= v_period_end AND p.period_end >= v_period_start
        AND (
          NULLIF(trim(COALESCE(b.sidemark, '')), '') IS NULL
          OR regexp_replace(upper(trim(COALESCE(b.sidemark, ''))), '[^A-Z0-9]+', '', 'g') = s.grp_key
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.storage_billing_items sbi
          WHERE sbi.tenant_id = b.tenant_id
            AND sbi.summary_ledger_row_id = b.ledger_row_id
            AND lower(COALESCE(sbi.status, '')) IN ('invoiced', 'billed')
        )
   );

  -- 5. Replace the Unbilled working set in the window for affected tenants.
  --    #673: CASE-guard the TEXT date cast.  NEVER delete STOR-TRANSFER-* rows
  --    (v38.258.0 backfill: pre-transfer holding window not in the summary).
  DELETE FROM public.billing b
   USING (SELECT DISTINCT tenant_id FROM _stor_summary) s
   WHERE b.tenant_id = s.tenant_id
     AND b.svc_code = 'STOR'
     AND lower(COALESCE(b.status, '')) IN ('unbilled', '')
     AND COALESCE(b.ledger_row_id, '') NOT LIKE 'STOR-TRANSFER-%'
     AND (
       EXISTS (SELECT 1 FROM public._parse_stor_task_range(b.task_id) rng
          WHERE rng.range_start IS NOT NULL AND rng.range_end IS NOT NULL
            AND rng.range_start <= v_period_end AND rng.range_end >= v_period_start)
       OR EXISTS (SELECT 1 FROM public._parse_stor_summary_period(b.ledger_row_id) p
          WHERE p.period_start IS NOT NULL AND p.period_end IS NOT NULL
            AND p.period_start <= v_period_end AND p.period_end >= v_period_start)
       OR CASE
            WHEN b.date IS NOT NULL AND trim(b.date) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
            THEN trim(b.date)::date BETWEEN v_period_start AND v_period_end
            ELSE false
          END
     );

  -- 6. Replace the Unbilled per-item working set (mirrors the sheet delete; GAS
  --    supabaseDelete_ of Unbilled sbi overlapping the window). Tenant-wide on
  --    purpose: step 8 re-inserts only for surviving groups, and a locked group's
  --    sbi are FINALIZED (not Unbilled) so this delete never touches them.
  DELETE FROM public.storage_billing_items sbi
   USING (SELECT DISTINCT tenant_id FROM _stor_summary) s
   WHERE sbi.tenant_id = s.tenant_id
     AND sbi.status = 'Unbilled'
     AND sbi.period_start <= v_period_end
     AND sbi.period_end   >= v_period_start;

  -- 7. Insert ONE summary billing row per surviving group.  NOT EXISTS guards
  --    the UNIQUE(tenant_id, ledger_row_id) constraint: if a finalized/void row
  --    already holds this id, skip (it stays; the remainder is handled by the
  --    invoice-time flow, not a second summary with the same deterministic id).
  INSERT INTO public.billing (
    tenant_id, ledger_row_id, status, client_name, date,
    svc_code, svc_name, category, item_id, description,
    item_class, qty, rate, total, task_id,
    shipment_number, item_notes, sidemark
  )
  SELECT
    s.tenant_id, s.ledger_row_id, 'Unbilled', s.client_name, s.summary_date::text,
    'STOR', 'Storage', 'Storage Charges', NULL, 'Monthly Storage', NULL, 1, NULL, ROUND(s.total, 2), s.ledger_row_id,
    NULL,
    'Storage ' || to_char(v_period_start, 'MM/DD/YY') || ' to ' || to_char(v_period_end, 'MM/DD/YY') || ' (' || s.item_count || ' items)',
    COALESCE(s.sidemark_display, '')
  FROM _stor_summary s
  WHERE NOT EXISTS (
    SELECT 1 FROM public.billing b
     WHERE b.tenant_id = s.tenant_id AND b.ledger_row_id = s.ledger_row_id
  );

  GET DIAGNOSTICS v_rows_created = ROW_COUNT;

  -- 8. Insert per-item storage_billing_items (aggregated per item, period = the
  --    commit window, linked to the surviving summary).  Only for groups that
  --    now have an Unbilled summary row (so we never orphan Unbilled sbi under a
  --    finalized/void id).  ON CONFLICT DO NOTHING: the partial-unique index
  --    (tenant,item,period WHERE status<>'Void') keeps the table free of
  --    double-active charges; a finalized row stands (idempotent).
  INSERT INTO public.storage_billing_items (
    tenant_id, sidemark, item_id, description,
    period_start, period_end, billable_days, rate, amount,
    summary_ledger_row_id, status
  )
  SELECT
    g.out_tenant_id, COALESCE(s.sidemark_display, ''), g.out_item_id, max(g.out_description),
    v_period_start, v_period_end, sum(g.out_billable_days), max(g.out_daily_rate), ROUND(sum(g.out_total_charge), 2),
    s.ledger_row_id, 'Unbilled'
  FROM _stor_grouped g
  JOIN _stor_summary s ON s.tenant_id = g.out_tenant_id AND s.grp_key = g.grp_key
  WHERE EXISTS (
    SELECT 1 FROM public.billing b
     WHERE b.tenant_id = s.tenant_id AND b.ledger_row_id = s.ledger_row_id
       AND lower(COALESCE(b.status, '')) = 'unbilled'
  )
  GROUP BY g.out_tenant_id, g.grp_key, g.out_item_id, s.sidemark_display, s.ledger_row_id
  ON CONFLICT (tenant_id, item_id, period_start, period_end) WHERE status <> 'Void' DO NOTHING;

  -- Return counts.  clients_affected = distinct tenants (the OLD body conflated
  -- this with summary-row count because it grouped by tenant; with per-sidemark
  -- groups they differ).  total_created = summary rows inserted.
  SELECT COALESCE(sum(total), 0), count(DISTINCT tenant_id) INTO v_total, v_clients FROM _stor_summary;
  total_created := v_rows_created; total_amount := v_total; clients_affected := v_clients;
  RETURN NEXT;
END;
$function$;

COMMENT ON FUNCTION public.generate_storage_charges(text, text, date, date) IS
  'Storage charges recompute (summary form), sidemark-aware + per-item. Derives the not-yet-billed remainder from _compute_storage_charges and writes ONE public.billing STOR-SUMMARY row per (tenant, sidemark-slug) group plus one aggregated storage_billing_items row per item (period = commit window, linked by summary_ledger_row_id). separate_by_sidemark tenants group by sidemark slug (STOR-SUMMARY-<tenant>-<SLUG>-<YYYYMMDD>-<YYYYMMDD>); others keep the legacy blank-sidemark id. Idempotent: re-running identical bounds replaces the Unbilled working set in place. Preserves the #671 per-item summary-lock deferral, #672 void=re-billable, #673 CASE-guarded date cast, and the admin/service_role gate; never deletes STOR-TRANSFER-* backfill rows.';

GRANT EXECUTE ON FUNCTION public.generate_storage_charges(text, text, date, date)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
