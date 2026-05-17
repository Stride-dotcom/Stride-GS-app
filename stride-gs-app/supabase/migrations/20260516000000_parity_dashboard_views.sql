-- 2026-05-16 — Parity Dashboard read views (powers src/pages/ParityDashboard.tsx).
--
-- Project context: stride-gs-app/MIGRATION_STATUS.md. The Settings → Migration
-- tab reads feature_flags + the mismatch_count_7d rollup directly; this
-- dashboard needs a denormalized per-function rollup of public.parity_results
-- joined to public.feature_flags, plus a billing-specific feed for Justin to
-- watch the auto-pay / invoice shadow runs.
--
-- Two views, both security_invoker so the existing RLS on feature_flags
-- (authenticated read) and parity_results / gas_call_log (admin+staff read)
-- continues to gate access — the dashboard route is admin/staff only.
--
-- Non-disruptive: read-only views over already-populated tables.

-- ------------------------------------------------------------------
-- 1. parity_summary — one row per migrating function
-- ------------------------------------------------------------------

CREATE OR REPLACE VIEW public.parity_summary
WITH (security_invoker = on) AS
SELECT
  ff.function_key,
  ff.active_backend,
  ff.shadow_backend,
  ff.parity_enabled,
  COALESCE(pr.total_checks, 0)                              AS total_checks,
  COALESCE(pr.mismatch_count, 0)                            AS mismatch_count,
  CASE WHEN COALESCE(pr.total_checks, 0) = 0 THEN NULL
       ELSE ROUND(100.0 * pr.match_count / pr.total_checks, 2)
  END                                                       AS match_rate_pct,
  pr.last_run_at,
  COALESCE(pr7.total, 0)                                    AS last_7d_total,
  COALESCE(pr7.matches, 0)                                  AS last_7d_matches,
  COALESCE(pr7.mismatches, 0)                               AS last_7d_mismatches,
  CASE WHEN COALESCE(pr7.total, 0) = 0 THEN NULL
       ELSE ROUND(100.0 * pr7.matches / pr7.total, 2)
  END                                                       AS last_7d_match_rate,
  pr.avg_gas_ms,
  pr.avg_sb_ms,
  -- Positive = Supabase is faster than GAS by this %.
  CASE WHEN COALESCE(pr.avg_gas_ms, 0) = 0 OR pr.avg_sb_ms IS NULL THEN NULL
       ELSE ROUND(100.0 * (pr.avg_gas_ms - pr.avg_sb_ms) / pr.avg_gas_ms, 1)
  END                                                       AS sb_speed_improvement_pct,
  ff.notes
FROM public.feature_flags ff
LEFT JOIN LATERAL (
  SELECT
    COUNT(*)                                AS total_checks,
    COUNT(*) FILTER (WHERE r.match)         AS match_count,
    COUNT(*) FILTER (WHERE NOT r.match)     AS mismatch_count,
    MAX(r.created_at)                       AS last_run_at,
    ROUND(AVG(r.gas_duration_ms))::int      AS avg_gas_ms,
    ROUND(AVG(r.sb_duration_ms))::int       AS avg_sb_ms
  FROM public.parity_results r
  WHERE r.function_key = ff.function_key
) pr ON true
LEFT JOIN LATERAL (
  SELECT
    COUNT(*)                              AS total,
    COUNT(*) FILTER (WHERE r.match)       AS matches,
    COUNT(*) FILTER (WHERE NOT r.match)   AS mismatches
  FROM public.parity_results r
  WHERE r.function_key = ff.function_key
    AND r.created_at >= now() - interval '7 days'
) pr7 ON true;

GRANT SELECT ON public.parity_summary TO authenticated, service_role;

-- ------------------------------------------------------------------
-- 2. parity_billing_shadow — billing/payment shadow runs only
-- ------------------------------------------------------------------
-- Justin watches this to confirm the auto-pay + invoice shadow handlers
-- match GAS before any P4a/P6 flip. input_summary surfaces the redacted
-- GAS input payload (gas_call_log.input_redacted) so the dollar amounts
-- that drove the run are visible alongside the match verdict.

CREATE OR REPLACE VIEW public.parity_billing_shadow
WITH (security_invoker = on) AS
SELECT
  r.id,
  r.created_at,
  r.function_key,
  r.tenant_id,
  r.match,
  r.gas_duration_ms,
  r.sb_duration_ms,
  r.mismatch_details,
  g.input_redacted AS input_summary
FROM public.parity_results r
LEFT JOIN public.gas_call_log g ON g.correlation_id = r.call_id
WHERE r.function_key IN (
  'completeTask', 'completeRepair', 'processWcRelease', 'commitStorageCharges',
  'createInvoice', 'voidInvoice', 'reissueInvoice',
  'createStaxInvoices', 'runStaxCharges', 'qboCreateInvoice'
);

GRANT SELECT ON public.parity_billing_shadow TO authenticated, service_role;
