-- ============================================================================
-- generate_storage_charges — guard the widen-delete's b.date::date cast so a
-- malformed date string can't abort the whole commit.
--
-- public.billing.date is TEXT. The widen-delete pass's 3rd OR-branch cast
-- `NULLIF(TRIM(b.date),'')::date` for EVERY in-scope STOR row, so a single
-- non-date string for the committing tenant would throw
-- (22007 invalid_datetime_format) and abort the entire commit. The
-- 20260528120000 migration had REMOVED this branch for exactly that reason,
-- but it was re-added out-of-band to the live body.
--
-- This RPC is the SB-commit RECOMPUTE path (the `generateStorageCharges`
-- action). It is reachable when the `commitStorageCharges` flag flips to
-- supabase — though the COMMIT itself (`commitStorageRows`, the Create Invoice
-- flow) proxies to GAS handleCommitStorageRows_, NOT this RPC. Hardening this
-- ahead of SB-commit go-live so the recompute can't be tripped by a stray
-- malformed date.
--
-- FIX: only cast strings that match ISO YYYY-MM-DD (the format ALL 2475 current
-- STOR billing.date values use — verified). A non-conforming string is skipped
-- (not cast), so the cast can never throw — the safe direction, matching the
-- GAS path's api_normalizeDateToMidnight_ (returns null on unparseable → row
-- not deleted). Behavior is byte-identical for all current data. This is the
-- ONLY change vs the live body (20260608236100). Everything else verbatim.
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

  CREATE TEMP TABLE _stor_pending ON COMMIT DROP AS
    SELECT *
      FROM public._compute_storage_charges(p_tenant_id, p_sidemark, v_period_start, v_period_end);

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

  -- Finalized-summary skip gate (defers to per-item; drops 'void') — 20260608236100.
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
       -- Unbilled row whose date column falls in the window. Guard the cast
       -- with CASE (Postgres does NOT guarantee AND short-circuits, so a plain
       -- `regex AND ::date` could still evaluate the cast and throw; CASE
       -- guarantees the cast runs ONLY when the regex matches). Only ISO
       -- YYYY-MM-DD strings are cast (the format every STOR row uses), so a
       -- malformed value is skipped instead of throwing + aborting the whole
       -- commit (the 20260528120000 abort risk).
       OR CASE
            WHEN b.date IS NOT NULL AND TRIM(b.date) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
            THEN TRIM(b.date)::date BETWEEN v_period_start AND v_period_end
            ELSE false
          END
     );

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
