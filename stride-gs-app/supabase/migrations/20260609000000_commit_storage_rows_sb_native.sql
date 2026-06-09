-- 20260609000000_commit_storage_rows_sb_native.sql
--
-- Part B of the SB-native storage-commit migration (MIG-005, Phase 4a).
--
-- The SB-native EDITED-ROWS commit. Replaces the `commit-storage-charges-sb`
-- edge function's gasProxy('commitStorageRows') so the real Create-Invoice
-- storage commit runs in Supabase instead of GAS handleCommitStorageRows_
-- (StrideAPI.gs:24921). The edge function calls this function, then mirrors the
-- committed summaries back to the per-tenant Billing_Ledger sheet (reverse
-- write-through) — only GAS can write sheets, so the sheet stays a best-effort
-- mirror of the SB-authoritative public.billing.
--
-- INPUT (p_rows): the operator's EDITED preview — ONLY the checked rows, with
-- any inline rate/qty edits — shaped exactly as the React commit POSTs them
-- (camelCase keys): tenantId, clientName, itemId, description, itemClass,
-- sidemark, qty (=billable days), rate (=daily rate), total (=charge), taskId,
-- notes, billableEnd (YYYY-MM-DD), shipmentNo. We HONOR these exactly and NEVER
-- re-derive from inventory (re-deriving re-bills rows the operator unchecked —
-- the documented billing-checkbox bug).
--
-- PRECISE-REMAINDER (operator decision, 2026-06-09): unlike GAS, we do NOT apply
-- the coarse `sbiAlreadyBilled` skip (GAS drops an item entirely if ANY finalized
-- sbi overlaps the window, losing the un-billed remainder days — ~$284 of June
-- revenue today). The operator's rows already carry the precise remainder (the
-- preview = calculate_storage_charges = _compute, which subtracts finalized
-- date-ranges), so we simply commit them. Double-bill is prevented structurally,
-- NOT by the coarse skip:
--   * the finalized-summary FENCE (sidemark-aware; #671 per-item defer; #672 void
--     is re-billable) blocks re-committing a window already finalized as a
--     summary that has no per-item detail; and
--   * the per-item partial-unique index uq_sbi_active_item_period
--     (tenant,item,period WHERE status<>'Void') + ON CONFLICT DO NOTHING blocks a
--     second active charge for the same item+period (a finalized row stands).
-- The remaining stale-preview partial-overlap race (operator commits a preview
-- computed before another finalization) is the explicit tradeoff of dropping the
-- coarse skip; the amount is still the operator's previewed remainder.
--
-- Landmines preserved (also in _compute_storage_charges + generate_storage_charges):
--   #671 per-item summary-lock defer · #672 void = re-billable · #673 CASE-guarded
--   TEXT date cast · STOR-TRANSFER-* never deleted · admin/service_role gate.
-- Grouping is by sidemark SLUG (matching api_sidemarkSlug_) so two sidemarks
-- slugging alike collapse to ONE summary — billing has UNIQUE(tenant_id,
-- ledger_row_id). Multi-tenant: processes all rows in one transactional call,
-- grouped by tenant (atomic — a malformed payload fails the whole commit rather
-- than partially committing).

CREATE OR REPLACE FUNCTION public.commit_storage_rows(
  p_rows         jsonb,
  p_period_start date,
  p_period_end   date,
  p_caller       text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role          text;
  v_total_created integer := 0;
  v_clients       integer := 0;
  v_committed     jsonb   := '[]'::jsonb;
  v_skipped       jsonb   := '[]'::jsonb;
BEGIN
  -- Admin / service_role gate (mirrors generate_storage_charges).
  IF auth.role() = 'service_role' THEN
    NULL;
  ELSE
    v_role := COALESCE(auth.jwt() -> 'user_metadata' ->> 'role', '');
    IF v_role <> 'admin' THEN
      RAISE EXCEPTION 'commit_storage_rows requires admin role (got %)', v_role USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Validate.
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RETURN jsonb_build_object('success', true, 'totalCreated', 0, 'clientsProcessed', 0,
                              'skippedItems', '[]'::jsonb, 'failedClients', '[]'::jsonb,
                              'committedSummaries', '[]'::jsonb, 'message', 'No rows to commit');
  END IF;
  IF p_period_start IS NULL OR p_period_end IS NULL THEN
    RAISE EXCEPTION 'period_start and period_end are required' USING ERRCODE = '22023';
  END IF;
  IF p_period_end < p_period_start THEN
    RAISE EXCEPTION 'period_end must be on or after period_start' USING ERRCODE = '22023';
  END IF;

  -- 1. Parse + tag each row (separate_by_sidemark -> slug group key + display).
  --    Numerics are read as text then safe-cast so a stray '' never aborts.
  CREATE TEMP TABLE _commit_rows ON COMMIT DROP AS
  SELECT
    NULLIF(trim(r."tenantId"), '')                                              AS tenant_id,
    COALESCE(NULLIF(trim(r."clientName"), ''), NULLIF(trim(r."tenantId"), ''))  AS client_name,
    COALESCE(trim(r."itemId"), '')                                             AS item_id,
    COALESCE(r."description", '')                                              AS description,
    COALESCE(r."itemClass", '')                                                AS item_class,
    COALESCE(r."sidemark", '')                                                 AS sidemark,
    COALESCE(NULLIF(trim(r."qty"),   '')::numeric, 0)                          AS qty,
    NULLIF(trim(r."rate"),  '')::numeric                                       AS rate,
    COALESCE(NULLIF(trim(r."total"), '')::numeric, 0)                          AS total,
    COALESCE(r."taskId", '')                                                   AS task_id,
    COALESCE(r."notes", '')                                                    AS notes,
    CASE WHEN trim(COALESCE(r."billableEnd", '')) ~ '^\d{4}-\d{2}-\d{2}$'
         THEN trim(r."billableEnd")::date ELSE NULL END                        AS billable_end,
    COALESCE(r."shipmentNo", '')                                               AS shipment_no,
    COALESCE(c.separate_by_sidemark, false)                                    AS sep,
    CASE WHEN COALESCE(c.separate_by_sidemark, false)
         THEN regexp_replace(upper(trim(COALESCE(r."sidemark", ''))), '[^A-Z0-9]+', '', 'g')
         ELSE '' END                                                           AS grp_key,
    CASE WHEN COALESCE(c.separate_by_sidemark, false)
         THEN trim(COALESCE(r."sidemark", ''))
         ELSE '' END                                                           AS sidemark_display
  FROM jsonb_to_recordset(p_rows) AS r(
    "tenantId" text, "clientName" text, "itemId" text, "description" text,
    "itemClass" text, "sidemark" text, "qty" text, "rate" text,
    "total" text, "taskId" text, "notes" text, "billableEnd" text, "shipmentNo" text
  )
  LEFT JOIN public.clients c ON c.tenant_id = NULLIF(trim(r."tenantId"), '')
  WHERE NULLIF(trim(r."tenantId"), '') IS NOT NULL;

  IF NOT EXISTS (SELECT 1 FROM _commit_rows) THEN
    RAISE EXCEPTION 'No rows had a tenantId' USING ERRCODE = '22023';
  END IF;
  SELECT count(DISTINCT tenant_id) INTO v_clients FROM _commit_rows;

  -- 2. One summary per (tenant, grp_key) with its deterministic ledger id.
  CREATE TEMP TABLE _stor_summary ON COMMIT DROP AS
  SELECT
    tenant_id, grp_key,
    max(client_name)                                          AS client_name,
    min(NULLIF(sidemark_display, ''))                         AS sidemark_display,
    GREATEST(p_period_end, max(billable_end))                 AS summary_date,
    sum(total)                                                AS total,
    count(DISTINCT item_id) FILTER (WHERE item_id <> '')      AS item_count,
    'STOR-SUMMARY-' || tenant_id
      || CASE WHEN grp_key <> '' THEN '-' || grp_key ELSE '' END
      || '-' || to_char(p_period_start, 'YYYYMMDD')
      || '-' || to_char(p_period_end,   'YYYYMMDD')           AS ledger_row_id
  FROM _commit_rows
  GROUP BY tenant_id, grp_key
  HAVING sum(total) > 0;

  -- 3. Finalized-summary fence (FALLBACK to the per-item guard; sidemark-matched;
  --    #672 void excluded; #671 defer when the summary has per-item detail).
  --    Capture the locked groups for skippedItems, then drop them.
  CREATE TEMP TABLE _locked ON COMMIT DROP AS
  SELECT s.tenant_id, s.grp_key, s.client_name, s.sidemark_display
  FROM _stor_summary s
  WHERE EXISTS (
    SELECT 1 FROM public.billing b
      CROSS JOIN LATERAL public._parse_stor_summary_period(b.ledger_row_id) p
     WHERE b.tenant_id = s.tenant_id
       AND b.svc_code = 'STOR'
       AND b.ledger_row_id LIKE 'STOR-SUMMARY-%'
       AND lower(COALESCE(b.status, '')) IN ('invoiced', 'billed')
       AND p.period_start IS NOT NULL AND p.period_end IS NOT NULL
       AND p.period_start <= p_period_end AND p.period_end >= p_period_start
       AND (
         NULLIF(trim(COALESCE(b.sidemark, '')), '') IS NULL
         OR regexp_replace(upper(trim(COALESCE(b.sidemark, ''))), '[^A-Z0-9]+', '', 'g') = s.grp_key
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.storage_billing_items sbi
         WHERE sbi.tenant_id = b.tenant_id AND sbi.summary_ledger_row_id = b.ledger_row_id
           AND lower(COALESCE(sbi.status, '')) IN ('invoiced', 'billed')
       )
  );

  SELECT COALESCE(jsonb_agg(
           l.client_name
           || CASE WHEN l.grp_key <> '' THEN ' · ' || COALESCE(l.sidemark_display, l.grp_key) ELSE '' END
           || ' (finalized summary already covers window)'
         ), '[]'::jsonb)
    INTO v_skipped
  FROM _locked l;

  DELETE FROM _stor_summary s USING _locked l
   WHERE s.tenant_id = l.tenant_id AND s.grp_key = l.grp_key;

  -- 4. Replace the Unbilled billing working set in the window for affected
  --    tenants (#673 CASE-guard; STOR-TRANSFER-* protected).
  DELETE FROM public.billing b
   USING (SELECT DISTINCT tenant_id FROM _stor_summary) s
   WHERE b.tenant_id = s.tenant_id
     AND b.svc_code = 'STOR'
     AND lower(COALESCE(b.status, '')) IN ('unbilled', '')
     AND COALESCE(b.ledger_row_id, '') NOT LIKE 'STOR-TRANSFER-%'
     AND (
       EXISTS (SELECT 1 FROM public._parse_stor_task_range(b.task_id) rng
          WHERE rng.range_start IS NOT NULL AND rng.range_end IS NOT NULL
            AND rng.range_start <= p_period_end AND rng.range_end >= p_period_start)
       OR EXISTS (SELECT 1 FROM public._parse_stor_summary_period(b.ledger_row_id) p
          WHERE p.period_start IS NOT NULL AND p.period_end IS NOT NULL
            AND p.period_start <= p_period_end AND p.period_end >= p_period_start)
       OR CASE
            WHEN b.date IS NOT NULL AND trim(b.date) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
            THEN trim(b.date)::date BETWEEN p_period_start AND p_period_end
            ELSE false
          END
     );

  -- 5. Replace the Unbilled per-item working set in the window.
  DELETE FROM public.storage_billing_items sbi
   USING (SELECT DISTINCT tenant_id FROM _stor_summary) s
   WHERE sbi.tenant_id = s.tenant_id
     AND sbi.status = 'Unbilled'
     AND sbi.period_start <= p_period_end
     AND sbi.period_end   >= p_period_start;

  -- 6. Insert ONE summary billing row per surviving group (UNIQUE id guarded).
  INSERT INTO public.billing (
    tenant_id, ledger_row_id, status, client_name, date,
    svc_code, svc_name, category, item_id, description,
    item_class, qty, rate, total, task_id, shipment_number, item_notes, sidemark
  )
  SELECT
    s.tenant_id, s.ledger_row_id, 'Unbilled', s.client_name, s.summary_date::text,
    'STOR', 'Storage', 'Storage Charges', NULL, 'Monthly Storage', NULL, 1, NULL, ROUND(s.total, 2), s.ledger_row_id,
    NULL,
    'Storage ' || to_char(p_period_start, 'MM/DD/YY') || ' to ' || to_char(p_period_end, 'MM/DD/YY') || ' (' || s.item_count || ' items)',
    COALESCE(s.sidemark_display, '')
  FROM _stor_summary s
  WHERE NOT EXISTS (
    SELECT 1 FROM public.billing b
     WHERE b.tenant_id = s.tenant_id AND b.ledger_row_id = s.ledger_row_id
  );
  GET DIAGNOSTICS v_total_created = ROW_COUNT;

  -- 7. Insert per-item storage_billing_items, aggregated per item, honoring the
  --    operator's edited totals (precise-remainder). Only for groups that now
  --    have an Unbilled summary (never orphan Unbilled sbi under a finalized id).
  INSERT INTO public.storage_billing_items (
    tenant_id, sidemark, item_id, description,
    period_start, period_end, billable_days, rate, amount,
    summary_ledger_row_id, status
  )
  SELECT
    cr.tenant_id, COALESCE(s.sidemark_display, ''), cr.item_id, max(cr.description),
    p_period_start, p_period_end,
    -- billable_days is informational (the "billed N days" proof on the Invoiced
    -- view); `amount` (sum of the operator's edited totals) is authoritative for
    -- billing. Prefer summed qty, else derive from amount/rate. An operator who
    -- edits ONLY the dollar total thus leaves days*rate <> amount by design —
    -- not a money bug (amount wins, and it reconciles to the summary total).
    CASE WHEN sum(cr.qty) > 0           THEN round(sum(cr.qty))::int
         WHEN max(cr.rate) > 0          THEN round(sum(cr.total) / max(cr.rate))::int
         ELSE NULL END,
    max(cr.rate),
    ROUND(sum(cr.total), 2),
    s.ledger_row_id, 'Unbilled'
  FROM _commit_rows cr
  JOIN _stor_summary s ON s.tenant_id = cr.tenant_id AND s.grp_key = cr.grp_key
  WHERE cr.item_id <> ''
    AND EXISTS (
      SELECT 1 FROM public.billing b
       WHERE b.tenant_id = s.tenant_id AND b.ledger_row_id = s.ledger_row_id
         AND lower(COALESCE(b.status, '')) = 'unbilled'
    )
  GROUP BY cr.tenant_id, cr.grp_key, cr.item_id, s.sidemark_display, s.ledger_row_id
  ON CONFLICT (tenant_id, item_id, period_start, period_end) WHERE status <> 'Void' DO NOTHING;

  -- 8. committedSummaries — shaped exactly like GAS handleCommitStorageRows_ so
  --    the React one-click "Create Invoice" flow bills THESE deterministic ids.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'sourceSheetId', s.tenant_id,
           'tenantId',      s.tenant_id,
           'client',        s.client_name,
           'clientName',    s.client_name,
           'sidemark',      COALESCE(s.sidemark_display, ''),
           'date',          to_char(s.summary_date, 'YYYYMMDD'),
           'svcCode',       'STOR',
           'svcName',       'Storage',
           'category',      'Storage Charges',
           'itemId',        '',
           'description',   'Monthly Storage',
           'itemClass',     '',
           'qty',           1,
           'rate',          '',
           'total',         ROUND(s.total, 2),
           'taskId',        s.ledger_row_id,
           'repairId',      '',
           'shipmentNo',    '',
           'notes',         'Storage ' || to_char(p_period_start, 'MM/DD/YY') || ' to ' || to_char(p_period_end, 'MM/DD/YY') || ' (' || s.item_count || ' items)',
           'ledgerRowId',   s.ledger_row_id
         )), '[]'::jsonb)
    INTO v_committed
  FROM _stor_summary s
  WHERE EXISTS (
    SELECT 1 FROM public.billing b
     WHERE b.tenant_id = s.tenant_id AND b.ledger_row_id = s.ledger_row_id
       AND lower(COALESCE(b.status, '')) = 'unbilled'
  );

  RETURN jsonb_build_object(
    'success',            true,
    'totalCreated',       v_total_created,
    'clientsProcessed',   v_clients,
    'skippedItems',       v_skipped,
    'failedClients',      '[]'::jsonb,
    'committedSummaries', v_committed
  );
END;
$function$;

COMMENT ON FUNCTION public.commit_storage_rows(jsonb, date, date, text) IS
  'SB-native edited-rows storage commit (Part B, MIG-005 Phase 4a). Honors the operator''s edited preview rows exactly (precise-remainder; no GAS sbiAlreadyBilled coarse skip), groups by sidemark slug, writes one STOR-SUMMARY billing row per (tenant, sidemark) group + aggregated per-item storage_billing_items, and returns committedSummaries shaped for the React one-click invoice. Double-bill is prevented by the finalized-summary fence (#671 defer, #672 void) + uq_sbi_active_item_period. Preserves #673 date guard, STOR-TRANSFER protection, and the admin/service_role gate. The edge function mirrors the committed summaries to the Billing_Ledger sheet.';

GRANT EXECUTE ON FUNCTION public.commit_storage_rows(jsonb, date, date, text)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
