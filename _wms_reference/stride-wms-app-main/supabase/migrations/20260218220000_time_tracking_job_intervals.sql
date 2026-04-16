-- =============================================================================
-- Time Tracking (Phase 1): job_time_intervals + timer RPCs
-- =============================================================================
-- Purpose:
-- - Store "active work" intervals for jobs (Tasks, Shipments, Stocktakes).
-- - Enable accurate labor time (sum of intervals) and cycle time (later).
-- - Enforce: ONE active timer per user at a time (across all job types).
--
-- Notes:
-- - Uses a generic job_type + job_id model.
-- - This migration implements core storage + minimal RPCs.
-- - UI/feature rollout can start with Tasks only.
-- =============================================================================

-- ============================================================
-- 1) Table: job_time_intervals
-- ============================================================

CREATE TABLE IF NOT EXISTS public.job_time_intervals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),

  job_type text NOT NULL CHECK (job_type IN ('task', 'shipment', 'stocktake')),
  job_id uuid NOT NULL,

  user_id uuid NOT NULL REFERENCES public.users(id),

  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz NULL,
  ended_reason text NULL,

  created_at timestamptz NOT NULL DEFAULT now()
);

-- Integrity: ended_at must be >= started_at
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'job_time_intervals_end_after_start'
  ) THEN
    ALTER TABLE public.job_time_intervals
      ADD CONSTRAINT job_time_intervals_end_after_start
      CHECK (ended_at IS NULL OR ended_at >= started_at);
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_job_time_intervals_job_started
  ON public.job_time_intervals (tenant_id, job_type, job_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_job_time_intervals_user_started
  ON public.job_time_intervals (tenant_id, user_id, started_at DESC);

-- Enforce one active interval per user (across all jobs)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_job_time_intervals_user_active
  ON public.job_time_intervals (tenant_id, user_id)
  WHERE ended_at IS NULL;

-- ============================================================
-- 2) RLS
-- ============================================================

ALTER TABLE public.job_time_intervals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "job_time_intervals_select_tenant" ON public.job_time_intervals;
CREATE POLICY "job_time_intervals_select_tenant"
  ON public.job_time_intervals
  FOR SELECT
  USING (tenant_id = public.user_tenant_id());

DROP POLICY IF EXISTS "job_time_intervals_insert_self" ON public.job_time_intervals;
CREATE POLICY "job_time_intervals_insert_self"
  ON public.job_time_intervals
  FOR INSERT
  WITH CHECK (
    tenant_id = public.user_tenant_id()
    AND user_id = auth.uid()
  );

DROP POLICY IF EXISTS "job_time_intervals_update_self" ON public.job_time_intervals;
CREATE POLICY "job_time_intervals_update_self"
  ON public.job_time_intervals
  FOR UPDATE
  USING (
    tenant_id = public.user_tenant_id()
    AND user_id = auth.uid()
  )
  WITH CHECK (
    tenant_id = public.user_tenant_id()
    AND user_id = auth.uid()
  );

-- ============================================================
-- 3) RPC: Start/resume a timer for a job
-- ============================================================

CREATE OR REPLACE FUNCTION public.rpc_timer_start_job(
  p_job_type text,
  p_job_id uuid,
  p_pause_existing boolean DEFAULT false
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_user_id uuid;
  v_now timestamptz := now();
  v_active record;
  v_new_id uuid;
BEGIN
  v_tenant_id := public.user_tenant_id();
  v_user_id := auth.uid();

  IF v_tenant_id IS NULL OR v_user_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error_code', 'NOT_AUTHENTICATED', 'error_message', 'Not authenticated');
  END IF;

  IF p_job_type NOT IN ('task', 'shipment', 'stocktake') THEN
    RETURN json_build_object('ok', false, 'error_code', 'INVALID_JOB_TYPE', 'error_message', 'Invalid job type');
  END IF;

  -- Optional safety: verify task exists in this tenant (best-effort)
  IF p_job_type = 'task' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = p_job_id
        AND t.tenant_id = v_tenant_id
        AND t.deleted_at IS NULL
    ) THEN
      RETURN json_build_object('ok', false, 'error_code', 'JOB_NOT_FOUND', 'error_message', 'Task not found');
    END IF;
  END IF;

  -- Lock active interval (if any) for this user to avoid races
  SELECT *
  INTO v_active
  FROM public.job_time_intervals
  WHERE tenant_id = v_tenant_id
    AND user_id = v_user_id
    AND ended_at IS NULL
  LIMIT 1
  FOR UPDATE;

  -- Active timer exists
  IF FOUND THEN
    -- Same job already running -> idempotent success
    IF v_active.job_type = p_job_type AND v_active.job_id = p_job_id THEN
      RETURN json_build_object(
        'ok', true,
        'already_active', true,
        'started_interval_id', v_active.id,
        'paused_interval_id', NULL
      );
    END IF;

    -- Different job running
    IF NOT p_pause_existing THEN
      RETURN json_build_object(
        'ok', false,
        'error_code', 'ACTIVE_TIMER_EXISTS',
        'error_message', 'You already have a job in progress',
        'active_interval_id', v_active.id,
        'active_job_type', v_active.job_type,
        'active_job_id', v_active.job_id
      );
    END IF;

    -- Pause existing timer, then continue to insert
    UPDATE public.job_time_intervals
    SET ended_at = v_now,
        ended_reason = 'auto_pause'
    WHERE id = v_active.id;
  END IF;

  INSERT INTO public.job_time_intervals (
    tenant_id, job_type, job_id, user_id, started_at
  ) VALUES (
    v_tenant_id, p_job_type, p_job_id, v_user_id, v_now
  )
  RETURNING id INTO v_new_id;

  RETURN json_build_object(
    'ok', true,
    'already_active', false,
    'started_interval_id', v_new_id,
    'paused_interval_id', CASE WHEN v_active.id IS NOT NULL THEN v_active.id ELSE NULL END,
    'paused_job_type', CASE WHEN v_active.id IS NOT NULL THEN v_active.job_type ELSE NULL END,
    'paused_job_id', CASE WHEN v_active.id IS NOT NULL THEN v_active.job_id ELSE NULL END
  );
END;
$$;

-- ============================================================
-- 4) RPC: End (pause/complete/etc) active timer for a job
-- ============================================================

CREATE OR REPLACE FUNCTION public.rpc_timer_end_job(
  p_job_type text,
  p_job_id uuid,
  p_reason text DEFAULT 'pause'
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_user_id uuid;
  v_now timestamptz := now();
  v_active_id uuid;
BEGIN
  v_tenant_id := public.user_tenant_id();
  v_user_id := auth.uid();

  IF v_tenant_id IS NULL OR v_user_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error_code', 'NOT_AUTHENTICATED', 'error_message', 'Not authenticated');
  END IF;

  IF p_job_type NOT IN ('task', 'shipment', 'stocktake') THEN
    RETURN json_build_object('ok', false, 'error_code', 'INVALID_JOB_TYPE', 'error_message', 'Invalid job type');
  END IF;

  SELECT id
  INTO v_active_id
  FROM public.job_time_intervals
  WHERE tenant_id = v_tenant_id
    AND user_id = v_user_id
    AND job_type = p_job_type
    AND job_id = p_job_id
    AND ended_at IS NULL
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', true, 'ended', false);
  END IF;

  UPDATE public.job_time_intervals
  SET ended_at = v_now,
      ended_reason = COALESCE(NULLIF(btrim(p_reason), ''), 'pause')
  WHERE id = v_active_id;

  RETURN json_build_object('ok', true, 'ended', true, 'ended_interval_id', v_active_id);
END;
$$;

