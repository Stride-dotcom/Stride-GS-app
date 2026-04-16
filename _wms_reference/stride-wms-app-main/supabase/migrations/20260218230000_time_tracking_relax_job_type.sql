-- =============================================================================
-- Time Tracking: Relax job_type validation for future job types
-- =============================================================================
-- Purpose:
-- - Allow the timer engine to be "plugged into" new job types later without
--   requiring new DB migrations.
-- - Replace strict job_type enum-like checks with "non-empty text" checks.
-- =============================================================================

-- ============================================================
-- 1) Relax job_time_intervals.job_type CHECK constraint
-- ============================================================

DO $$
BEGIN
  -- Column-level CHECK created from the table definition will typically be:
  --   job_time_intervals_job_type_check
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'job_time_intervals_job_type_check'
  ) THEN
    ALTER TABLE public.job_time_intervals
      DROP CONSTRAINT job_time_intervals_job_type_check;
  END IF;
END $$;

-- Ensure job_type is not blank
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'job_time_intervals_job_type_nonempty'
  ) THEN
    ALTER TABLE public.job_time_intervals
      ADD CONSTRAINT job_time_intervals_job_type_nonempty
      CHECK (btrim(job_type) <> '');
  END IF;
END $$;

-- ============================================================
-- 2) Update RPCs to accept any non-empty job_type
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

  IF p_job_type IS NULL OR btrim(p_job_type) = '' THEN
    RETURN json_build_object('ok', false, 'error_code', 'INVALID_JOB_TYPE', 'error_message', 'Job type is required');
  END IF;

  -- Optional safety: verify known job types exist in this tenant (best-effort)
  IF p_job_type = 'task' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = p_job_id
        AND t.tenant_id = v_tenant_id
        AND t.deleted_at IS NULL
    ) THEN
      RETURN json_build_object('ok', false, 'error_code', 'JOB_NOT_FOUND', 'error_message', 'Task not found');
    END IF;
  ELSIF p_job_type = 'shipment' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.shipments s
      WHERE s.id = p_job_id
        AND s.tenant_id = v_tenant_id
        AND s.deleted_at IS NULL
    ) THEN
      RETURN json_build_object('ok', false, 'error_code', 'JOB_NOT_FOUND', 'error_message', 'Shipment not found');
    END IF;
  ELSIF p_job_type = 'stocktake' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.stocktakes st
      WHERE st.id = p_job_id
        AND st.tenant_id = v_tenant_id
        AND st.deleted_at IS NULL
    ) THEN
      RETURN json_build_object('ok', false, 'error_code', 'JOB_NOT_FOUND', 'error_message', 'Stocktake not found');
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

  IF p_job_type IS NULL OR btrim(p_job_type) = '' THEN
    RETURN json_build_object('ok', false, 'error_code', 'INVALID_JOB_TYPE', 'error_message', 'Job type is required');
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

