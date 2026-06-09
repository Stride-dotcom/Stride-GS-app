-- ============================================================================
-- generate_storage_charges (Supabase commit RPC) — apply the SAME two rules as
-- the live GAS commit path + the preview, for consistency / future-proofing.
--
-- This RPC is the SB-primary storage COMMIT (the twin of GAS
-- handleCommitStorageRows_). It is NOT reachable today — feature flag
-- `commitStorageCharges` = 'gas', and it has no live React caller (its recompute
-- path re-derives the full set from inventory, so a partial subset can't occur).
-- But its finalized-summary skip gate had both bugs the live path just fixed:
--   • whole-tenant lock with no per-item deferral (would skip a tenant entirely
--     once any partial summary is finalized), and
--   • 'void' in the status filter (a voided summary would keep locking).
--
-- FIX (gate only): defer to per-item storage_billing_items via NOT EXISTS, and
-- drop 'void'. Mirrors `_compute_storage_charges` source (b) (20260608236000) +
-- `handleCommitStorageRows_` (StrideAPI v38.267.0). Everything else is the live
-- body verbatim. SECURITY DEFINER + admin gate + search_path preserved.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.generate_storage_charges(
  p_tenant_id text DEFAULT NULL::text,
  p_sidemark text DEFAULT NULL::text,
  p_period_start date DEFAULT NULL::date,
  p_period_end date DEFAULT NULL::date
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
  --
  -- v38.267.0 — defer to per-item + drop 'void': skip the whole-tenant lock
  -- when the finalized summary has per-item storage_billing_items detail (the
  -- per-item layer dedups precisely), and don't let a VOIDED summary lock
  -- (voided storage is re-billable). Mirrors the live GAS gate + preview (b).
  DELETE FROM _stor_summary s
   WHERE EXISTS (
     SELECT 1
       FROM public.billing b
       CROSS JOIN LATERAL public._parse_stor_summary_period(b.ledger_row_id) p
      WHERE b.tenant_id = s.tenant_id
        AND b.svc_code  = 'STOR'
        AND LOWER(COALESCE(b.status, '')) IN ('invoiced', 'billed')
        AND p.period_start IS NOT NULL
        AND p.period_end   IS NOT NULL
        AND p.period_start <= v_period_end
        AND p.period_end   >= v_period_start
        AND NOT EXISTS (
          SELECT 1 FROM public.storage_billing_items sbi
          WHERE sbi.tenant_id = b.tenant_id
            AND sbi.summary_ledger_row_id = b.ledger_row_id
            AND LOWER(COALESCE(sbi.status, '')) IN ('invoiced','billed')
        )
   );

  -- Widen the delete pass: any Unbilled STOR row in the window goes
  -- (per-item leftovers from older builds + prior summary in the same
  -- window). Idempotent re-runs replace cleanly.
  DELETE FROM public.billing b
   USING (SELECT DISTINCT tenant_id FROM _stor_summary) s
   WHERE b.tenant_id = s.tenant_id
     AND b.svc_code  = 'STOR'
     AND LOWER(COALESCE(b.status, '')) IN ('unbilled', '')
     AND (
       -- Unbilled per-item rows whose parsed range overlaps the window.
       EXISTS (
         SELECT 1
           FROM public._parse_stor_task_range(b.task_id) rng
          WHERE rng.range_start IS NOT NULL
            AND rng.range_end   IS NOT NULL
            AND rng.range_start <= v_period_end
            AND rng.range_end   >= v_period_start
       )
       -- OR Unbilled summary row whose parsed period overlaps the window.
       OR EXISTS (
         SELECT 1
           FROM public._parse_stor_summary_period(b.ledger_row_id) p
          WHERE p.period_start IS NOT NULL
            AND p.period_end   IS NOT NULL
            AND p.period_start <= v_period_end
            AND p.period_end   >= v_period_start
       )
       -- OR Unbilled row whose date column falls in the window (catches
       -- any legacy per-item Unbilled row written without a parseable task id).
       OR (
         b.date IS NOT NULL
         AND NULLIF(TRIM(b.date), '')::date BETWEEN v_period_start AND v_period_end
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
$function$;

NOTIFY pgrst, 'reload schema';
