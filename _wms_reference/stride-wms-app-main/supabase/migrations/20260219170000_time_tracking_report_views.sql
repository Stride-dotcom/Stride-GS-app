-- =============================================================================
-- Time Tracking: Reporting views for Report Builder (phase 2)
-- =============================================================================
-- Purpose:
-- - Expose time tracking data in a "report-friendly" shape for the Custom Report Builder.
-- - Avoid client-side fan-out joins by providing flattened columns (labels, names, durations).
--
-- Notes:
-- - These are INVOKER views; RLS on underlying tables still applies.
-- - We explicitly GRANT SELECT to authenticated for PostgREST access.
-- =============================================================================

-- Safety: the report views below reference stocktake "closed" timestamps.
-- Some environments may have migration history repaired without executing older
-- stocktake enhancements, so ensure the column exists before creating views.
ALTER TABLE public.stocktakes
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

ALTER TABLE public.stocktakes
  ADD COLUMN IF NOT EXISTS name text;

ALTER TABLE public.stocktakes
  ADD COLUMN IF NOT EXISTS metadata jsonb;

ALTER TABLE public.stocktakes
  ADD COLUMN IF NOT EXISTS duration_minutes integer;

-- ============================================================
-- 1) job_time_intervals_report_v1
--    - interval-level rows
--    - includes job label + account/warehouse/user display fields
-- ============================================================

CREATE OR REPLACE VIEW public.job_time_intervals_report_v1 AS
SELECT
  jti.id,
  jti.tenant_id,
  jti.job_type,
  jti.job_id,
  jti.user_id,
  u.email AS user_email,
  NULLIF(btrim(concat_ws(' ', u.first_name, u.last_name)), '') AS user_name,
  jti.started_at,
  jti.ended_at,
  jti.ended_reason,
  (jti.ended_at IS NULL) AS is_active,
  CASE
    WHEN jti.ended_at IS NULL THEN NULL
    ELSE round(extract(epoch from (jti.ended_at - jti.started_at)) / 60.0, 2)
  END AS duration_minutes,
  round(extract(epoch from (coalesce(jti.ended_at, now()) - jti.started_at)) / 60.0, 2) AS elapsed_minutes,

  coalesce(t.account_id, s.account_id, st.account_id) AS account_id,
  a.account_name AS account_name,
  coalesce(t.warehouse_id, s.warehouse_id, st.warehouse_id) AS warehouse_id,
  w.name AS warehouse_name,

  coalesce(t.completed_at, s.completed_at, s.received_at, st.closed_at, st.completed_at) AS job_completed_at,

  CASE
    WHEN jti.job_type = 'task' THEN coalesce(t.title, concat_ws(' ', t.task_type, 'task'), 'Task')
    WHEN jti.job_type = 'shipment' THEN
      CASE
        WHEN s.shipment_number IS NOT NULL THEN concat('Shipment ', s.shipment_number)
        ELSE 'Shipment'
      END
    WHEN jti.job_type = 'stocktake' THEN coalesce(st.name, concat('Stocktake ', st.stocktake_number), 'Stocktake')
    ELSE concat(coalesce(nullif(btrim(jti.job_type), ''), 'job'), ' job')
  END AS job_label,

  CASE
    WHEN jti.job_type = 'task' THEN t.task_type
    WHEN jti.job_type = 'shipment' THEN s.shipment_type
    ELSE NULL
  END AS job_subtype,

  CASE
    WHEN jti.job_type = 'task' THEN t.status
    WHEN jti.job_type = 'shipment' THEN s.status
    WHEN jti.job_type = 'stocktake' THEN st.status
    ELSE NULL
  END AS job_status,

  jti.created_at
FROM public.job_time_intervals jti
LEFT JOIN public.users u
  ON u.id = jti.user_id
  AND u.deleted_at IS NULL
LEFT JOIN public.tasks t
  ON jti.job_type = 'task'
  AND t.id = jti.job_id
  AND t.tenant_id = jti.tenant_id
  AND t.deleted_at IS NULL
LEFT JOIN public.shipments s
  ON jti.job_type = 'shipment'
  AND s.id = jti.job_id
  AND s.tenant_id = jti.tenant_id
  AND s.deleted_at IS NULL
LEFT JOIN public.stocktakes st
  ON jti.job_type = 'stocktake'
  AND st.id = jti.job_id
  AND st.tenant_id = jti.tenant_id
  AND st.deleted_at IS NULL
LEFT JOIN public.accounts a
  ON a.id = coalesce(t.account_id, s.account_id, st.account_id)
  AND a.tenant_id = jti.tenant_id
  AND a.deleted_at IS NULL
LEFT JOIN public.warehouses w
  ON w.id = coalesce(t.warehouse_id, s.warehouse_id, st.warehouse_id)
  AND w.tenant_id = jti.tenant_id
  AND w.deleted_at IS NULL;

GRANT SELECT ON public.job_time_intervals_report_v1 TO authenticated;

-- ============================================================
-- 2) service_time_jobs_report_v1
--    - job-level rows (tasks/shipments/stocktakes)
--    - flattens metadata.service_time snapshots into numeric columns
-- ============================================================

CREATE OR REPLACE VIEW public.service_time_jobs_report_v1 AS
SELECT
  concat('task:', t.id)::text AS id,
  t.tenant_id,
  'task'::text AS job_type,
  t.id AS job_id,
  t.status AS job_status,
  coalesce(t.title, concat_ws(' ', t.task_type, 'task'), 'Task') AS job_label,
  t.task_type AS job_subtype,
  t.account_id,
  a.account_name AS account_name,
  t.warehouse_id,
  w.name AS warehouse_name,

  coalesce(
    nullif(t.metadata->'service_time'->>'actual_snapshot_at', '')::timestamptz,
    t.completed_at
  ) AS completed_at,
  nullif(t.metadata->'service_time'->>'estimated_snapshot_at', '')::timestamptz AS estimated_snapshot_at,
  nullif(t.metadata->'service_time'->>'actual_snapshot_at', '')::timestamptz AS actual_snapshot_at,

  nullif(t.metadata->'service_time'->>'estimated_minutes', '')::numeric AS estimated_minutes,
  coalesce(
    nullif(t.metadata->'service_time'->>'actual_labor_minutes', '')::numeric,
    t.duration_minutes::numeric
  ) AS actual_minutes,
  nullif(t.metadata->'service_time'->>'actual_cycle_minutes', '')::numeric AS actual_cycle_minutes,

  CASE
    WHEN nullif(t.metadata->'service_time'->>'estimated_minutes', '') IS NULL THEN NULL
    WHEN coalesce(nullif(t.metadata->'service_time'->>'actual_labor_minutes', '')::numeric, t.duration_minutes::numeric) IS NULL THEN NULL
    ELSE coalesce(nullif(t.metadata->'service_time'->>'actual_labor_minutes', '')::numeric, t.duration_minutes::numeric)
      - nullif(t.metadata->'service_time'->>'estimated_minutes', '')::numeric
  END AS variance_minutes
FROM public.tasks t
LEFT JOIN public.accounts a
  ON a.id = t.account_id
  AND a.tenant_id = t.tenant_id
  AND a.deleted_at IS NULL
LEFT JOIN public.warehouses w
  ON w.id = t.warehouse_id
  AND w.tenant_id = t.tenant_id
  AND w.deleted_at IS NULL
WHERE t.deleted_at IS NULL

UNION ALL

SELECT
  concat('shipment:', s.id)::text AS id,
  s.tenant_id,
  'shipment'::text AS job_type,
  s.id AS job_id,
  s.status AS job_status,
  CASE
    WHEN s.shipment_number IS NOT NULL THEN concat('Shipment ', s.shipment_number)
    ELSE 'Shipment'
  END AS job_label,
  s.shipment_type AS job_subtype,
  s.account_id,
  a.account_name AS account_name,
  s.warehouse_id,
  w.name AS warehouse_name,

  coalesce(
    nullif(s.metadata->'service_time'->>'actual_snapshot_at', '')::timestamptz,
    s.completed_at,
    s.received_at
  ) AS completed_at,
  nullif(s.metadata->'service_time'->>'estimated_snapshot_at', '')::timestamptz AS estimated_snapshot_at,
  nullif(s.metadata->'service_time'->>'actual_snapshot_at', '')::timestamptz AS actual_snapshot_at,

  nullif(s.metadata->'service_time'->>'estimated_minutes', '')::numeric AS estimated_minutes,
  nullif(s.metadata->'service_time'->>'actual_labor_minutes', '')::numeric AS actual_minutes,
  nullif(s.metadata->'service_time'->>'actual_cycle_minutes', '')::numeric AS actual_cycle_minutes,

  CASE
    WHEN nullif(s.metadata->'service_time'->>'estimated_minutes', '') IS NULL THEN NULL
    WHEN nullif(s.metadata->'service_time'->>'actual_labor_minutes', '') IS NULL THEN NULL
    ELSE nullif(s.metadata->'service_time'->>'actual_labor_minutes', '')::numeric
      - nullif(s.metadata->'service_time'->>'estimated_minutes', '')::numeric
  END AS variance_minutes
FROM public.shipments s
LEFT JOIN public.accounts a
  ON a.id = s.account_id
  AND a.tenant_id = s.tenant_id
  AND a.deleted_at IS NULL
LEFT JOIN public.warehouses w
  ON w.id = s.warehouse_id
  AND w.tenant_id = s.tenant_id
  AND w.deleted_at IS NULL
WHERE s.deleted_at IS NULL

UNION ALL

SELECT
  concat('stocktake:', st.id)::text AS id,
  st.tenant_id,
  'stocktake'::text AS job_type,
  st.id AS job_id,
  st.status AS job_status,
  coalesce(st.name, concat('Stocktake ', st.stocktake_number), 'Stocktake') AS job_label,
  NULL::text AS job_subtype,
  st.account_id,
  a.account_name AS account_name,
  st.warehouse_id,
  w.name AS warehouse_name,

  coalesce(
    nullif(st.metadata->'service_time'->>'actual_snapshot_at', '')::timestamptz,
    st.closed_at,
    st.completed_at
  ) AS completed_at,
  nullif(st.metadata->'service_time'->>'estimated_snapshot_at', '')::timestamptz AS estimated_snapshot_at,
  nullif(st.metadata->'service_time'->>'actual_snapshot_at', '')::timestamptz AS actual_snapshot_at,

  nullif(st.metadata->'service_time'->>'estimated_minutes', '')::numeric AS estimated_minutes,
  coalesce(
    nullif(st.metadata->'service_time'->>'actual_labor_minutes', '')::numeric,
    st.duration_minutes::numeric
  ) AS actual_minutes,
  nullif(st.metadata->'service_time'->>'actual_cycle_minutes', '')::numeric AS actual_cycle_minutes,

  CASE
    WHEN nullif(st.metadata->'service_time'->>'estimated_minutes', '') IS NULL THEN NULL
    WHEN coalesce(nullif(st.metadata->'service_time'->>'actual_labor_minutes', '')::numeric, st.duration_minutes::numeric) IS NULL THEN NULL
    ELSE coalesce(nullif(st.metadata->'service_time'->>'actual_labor_minutes', '')::numeric, st.duration_minutes::numeric)
      - nullif(st.metadata->'service_time'->>'estimated_minutes', '')::numeric
  END AS variance_minutes
FROM public.stocktakes st
LEFT JOIN public.accounts a
  ON a.id = st.account_id
  AND a.tenant_id = st.tenant_id
  AND a.deleted_at IS NULL
LEFT JOIN public.warehouses w
  ON w.id = st.warehouse_id
  AND w.tenant_id = st.tenant_id
  AND w.deleted_at IS NULL
WHERE st.deleted_at IS NULL;

GRANT SELECT ON public.service_time_jobs_report_v1 TO authenticated;

