
-- Fix Security Definer View issue: recreate views with security_invoker = true
-- This ensures RLS policies of the querying user are enforced, not the view creator's.

-- 1. users_report_v1
DROP VIEW IF EXISTS public.users_report_v1;
CREATE VIEW public.users_report_v1 WITH (security_invoker = true) AS
SELECT id,
    tenant_id,
    email,
    COALESCE(NULLIF(btrim(concat_ws(' '::text, first_name, last_name)), ''::text), email::text) AS full_name,
    first_name,
    last_name,
    status,
    deleted_at,
    created_at,
    updated_at
   FROM users u;

-- 2. job_time_intervals_report_v1
DROP VIEW IF EXISTS public.job_time_intervals_report_v1;
CREATE VIEW public.job_time_intervals_report_v1 WITH (security_invoker = true) AS
SELECT jti.id,
    jti.tenant_id,
    jti.job_type,
    jti.job_id,
    jti.user_id,
    u.email AS user_email,
    NULLIF(btrim(concat_ws(' '::text, u.first_name, u.last_name)), ''::text) AS user_name,
    jti.started_at,
    jti.ended_at,
    jti.ended_reason,
    jti.ended_at IS NULL AS is_active,
        CASE
            WHEN jti.ended_at IS NULL THEN NULL::numeric
            ELSE round(EXTRACT(epoch FROM jti.ended_at - jti.started_at) / 60.0, 2)
        END AS duration_minutes,
    round(EXTRACT(epoch FROM COALESCE(jti.ended_at, now()) - jti.started_at) / 60.0, 2) AS elapsed_minutes,
    COALESCE(t.account_id, s.account_id, st.account_id) AS account_id,
    a.account_name,
    COALESCE(t.warehouse_id, s.warehouse_id, st.warehouse_id) AS warehouse_id,
    w.name AS warehouse_name,
    COALESCE(t.completed_at, s.completed_at, s.received_at, st.closed_at, st.completed_at) AS job_completed_at,
        CASE
            WHEN jti.job_type = 'task'::text THEN COALESCE(t.title, concat_ws(' '::text, t.task_type, 'task'), 'Task'::text)
            WHEN jti.job_type = 'shipment'::text THEN
            CASE
                WHEN s.shipment_number IS NOT NULL THEN concat('Shipment ', s.shipment_number)
                ELSE 'Shipment'::text
            END
            WHEN jti.job_type = 'stocktake'::text THEN COALESCE(st.name, concat('Stocktake ', st.stocktake_number), 'Stocktake'::text)
            ELSE concat(COALESCE(NULLIF(btrim(jti.job_type), ''::text), 'job'::text), ' job')
        END AS job_label,
        CASE
            WHEN jti.job_type = 'task'::text THEN t.task_type
            WHEN jti.job_type = 'shipment'::text THEN s.shipment_type
            ELSE NULL::text
        END AS job_subtype,
        CASE
            WHEN jti.job_type = 'task'::text THEN t.status
            WHEN jti.job_type = 'shipment'::text THEN s.status
            WHEN jti.job_type = 'stocktake'::text THEN st.status
            ELSE NULL::text
        END AS job_status,
    jti.created_at
   FROM job_time_intervals jti
     LEFT JOIN users u ON u.id = jti.user_id AND u.deleted_at IS NULL
     LEFT JOIN tasks t ON jti.job_type = 'task'::text AND t.id = jti.job_id AND t.tenant_id = jti.tenant_id AND t.deleted_at IS NULL
     LEFT JOIN shipments s ON jti.job_type = 'shipment'::text AND s.id = jti.job_id AND s.tenant_id = jti.tenant_id AND s.deleted_at IS NULL
     LEFT JOIN stocktakes st ON jti.job_type = 'stocktake'::text AND st.id = jti.job_id AND st.tenant_id = jti.tenant_id AND st.deleted_at IS NULL
     LEFT JOIN accounts a ON a.id = COALESCE(t.account_id, s.account_id, st.account_id) AND a.tenant_id = jti.tenant_id AND a.deleted_at IS NULL
     LEFT JOIN warehouses w ON w.id = COALESCE(t.warehouse_id, s.warehouse_id, st.warehouse_id) AND w.tenant_id = jti.tenant_id AND w.deleted_at IS NULL;

-- 3. service_time_jobs_report_v1
DROP VIEW IF EXISTS public.service_time_jobs_report_v1;
CREATE VIEW public.service_time_jobs_report_v1 WITH (security_invoker = true) AS
SELECT concat('task:', t.id) AS id,
    t.tenant_id,
    'task'::text AS job_type,
    t.id AS job_id,
    t.status AS job_status,
    COALESCE(t.title, concat_ws(' '::text, t.task_type, 'task'), 'Task'::text) AS job_label,
    t.task_type AS job_subtype,
    t.account_id,
    a.account_name,
    t.warehouse_id,
    w.name AS warehouse_name,
    COALESCE(NULLIF((t.metadata -> 'service_time'::text) ->> 'actual_snapshot_at'::text, ''::text)::timestamp with time zone, t.completed_at) AS completed_at,
    NULLIF((t.metadata -> 'service_time'::text) ->> 'estimated_snapshot_at'::text, ''::text)::timestamp with time zone AS estimated_snapshot_at,
    NULLIF((t.metadata -> 'service_time'::text) ->> 'actual_snapshot_at'::text, ''::text)::timestamp with time zone AS actual_snapshot_at,
    NULLIF((t.metadata -> 'service_time'::text) ->> 'estimated_minutes'::text, ''::text)::numeric AS estimated_minutes,
    COALESCE(NULLIF((t.metadata -> 'service_time'::text) ->> 'actual_labor_minutes'::text, ''::text)::numeric, t.duration_minutes::numeric) AS actual_minutes,
    NULLIF((t.metadata -> 'service_time'::text) ->> 'actual_cycle_minutes'::text, ''::text)::numeric AS actual_cycle_minutes,
        CASE
            WHEN NULLIF((t.metadata -> 'service_time'::text) ->> 'estimated_minutes'::text, ''::text) IS NULL THEN NULL::numeric
            WHEN COALESCE(NULLIF((t.metadata -> 'service_time'::text) ->> 'actual_labor_minutes'::text, ''::text)::numeric, t.duration_minutes::numeric) IS NULL THEN NULL::numeric
            ELSE COALESCE(NULLIF((t.metadata -> 'service_time'::text) ->> 'actual_labor_minutes'::text, ''::text)::numeric, t.duration_minutes::numeric) - NULLIF((t.metadata -> 'service_time'::text) ->> 'estimated_minutes'::text, ''::text)::numeric
        END AS variance_minutes
   FROM tasks t
     LEFT JOIN accounts a ON a.id = t.account_id AND a.tenant_id = t.tenant_id AND a.deleted_at IS NULL
     LEFT JOIN warehouses w ON w.id = t.warehouse_id AND w.tenant_id = t.tenant_id AND w.deleted_at IS NULL
  WHERE t.deleted_at IS NULL
UNION ALL
 SELECT concat('shipment:', s.id) AS id,
    s.tenant_id,
    'shipment'::text AS job_type,
    s.id AS job_id,
    s.status AS job_status,
        CASE
            WHEN s.shipment_number IS NOT NULL THEN concat('Shipment ', s.shipment_number)
            ELSE 'Shipment'::text
        END AS job_label,
    s.shipment_type AS job_subtype,
    s.account_id,
    a.account_name,
    s.warehouse_id,
    w.name AS warehouse_name,
    COALESCE(NULLIF((s.metadata -> 'service_time'::text) ->> 'actual_snapshot_at'::text, ''::text)::timestamp with time zone, s.completed_at, s.received_at) AS completed_at,
    NULLIF((s.metadata -> 'service_time'::text) ->> 'estimated_snapshot_at'::text, ''::text)::timestamp with time zone AS estimated_snapshot_at,
    NULLIF((s.metadata -> 'service_time'::text) ->> 'actual_snapshot_at'::text, ''::text)::timestamp with time zone AS actual_snapshot_at,
    NULLIF((s.metadata -> 'service_time'::text) ->> 'estimated_minutes'::text, ''::text)::numeric AS estimated_minutes,
    NULLIF((s.metadata -> 'service_time'::text) ->> 'actual_labor_minutes'::text, ''::text)::numeric AS actual_minutes,
    NULLIF((s.metadata -> 'service_time'::text) ->> 'actual_cycle_minutes'::text, ''::text)::numeric AS actual_cycle_minutes,
        CASE
            WHEN NULLIF((s.metadata -> 'service_time'::text) ->> 'estimated_minutes'::text, ''::text) IS NULL THEN NULL::numeric
            WHEN NULLIF((s.metadata -> 'service_time'::text) ->> 'actual_labor_minutes'::text, ''::text) IS NULL THEN NULL::numeric
            ELSE NULLIF((s.metadata -> 'service_time'::text) ->> 'actual_labor_minutes'::text, ''::text)::numeric - NULLIF((s.metadata -> 'service_time'::text) ->> 'estimated_minutes'::text, ''::text)::numeric
        END AS variance_minutes
   FROM shipments s
     LEFT JOIN accounts a ON a.id = s.account_id AND a.tenant_id = s.tenant_id AND a.deleted_at IS NULL
     LEFT JOIN warehouses w ON w.id = s.warehouse_id AND w.tenant_id = s.tenant_id AND w.deleted_at IS NULL
  WHERE s.deleted_at IS NULL
UNION ALL
 SELECT concat('stocktake:', st.id) AS id,
    st.tenant_id,
    'stocktake'::text AS job_type,
    st.id AS job_id,
    st.status AS job_status,
    COALESCE(st.name, concat('Stocktake ', st.stocktake_number), 'Stocktake'::text) AS job_label,
    NULL::text AS job_subtype,
    st.account_id,
    a.account_name,
    st.warehouse_id,
    w.name AS warehouse_name,
    COALESCE(NULLIF((st.metadata -> 'service_time'::text) ->> 'actual_snapshot_at'::text, ''::text)::timestamp with time zone, st.closed_at, st.completed_at) AS completed_at,
    NULLIF((st.metadata -> 'service_time'::text) ->> 'estimated_snapshot_at'::text, ''::text)::timestamp with time zone AS estimated_snapshot_at,
    NULLIF((st.metadata -> 'service_time'::text) ->> 'actual_snapshot_at'::text, ''::text)::timestamp with time zone AS actual_snapshot_at,
    NULLIF((st.metadata -> 'service_time'::text) ->> 'estimated_minutes'::text, ''::text)::numeric AS estimated_minutes,
    COALESCE(NULLIF((st.metadata -> 'service_time'::text) ->> 'actual_labor_minutes'::text, ''::text)::numeric, st.duration_minutes::numeric) AS actual_minutes,
    NULLIF((st.metadata -> 'service_time'::text) ->> 'actual_cycle_minutes'::text, ''::text)::numeric AS actual_cycle_minutes,
        CASE
            WHEN NULLIF((st.metadata -> 'service_time'::text) ->> 'estimated_minutes'::text, ''::text) IS NULL THEN NULL::numeric
            WHEN COALESCE(NULLIF((st.metadata -> 'service_time'::text) ->> 'actual_labor_minutes'::text, ''::text)::numeric, st.duration_minutes::numeric) IS NULL THEN NULL::numeric
            ELSE COALESCE(NULLIF((st.metadata -> 'service_time'::text) ->> 'actual_labor_minutes'::text, ''::text)::numeric, st.duration_minutes::numeric) - NULLIF((st.metadata -> 'service_time'::text) ->> 'estimated_minutes'::text, ''::text)::numeric
        END AS variance_minutes
   FROM stocktakes st
     LEFT JOIN accounts a ON a.id = st.account_id AND a.tenant_id = st.tenant_id AND a.deleted_at IS NULL
     LEFT JOIN warehouses w ON w.id = st.warehouse_id AND w.tenant_id = st.tenant_id AND w.deleted_at IS NULL
  WHERE st.deleted_at IS NULL;
