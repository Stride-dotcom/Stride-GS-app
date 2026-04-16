-- =============================================================================
-- Schedule automatic processing of due template rollouts
-- - Allows rpc_process_due_template_rollouts to run from pg_cron worker
-- - Registers/refreshes cron schedule (every 5 minutes)
-- =============================================================================

-- Allow execution from service-role JWT context OR DB scheduler role.
CREATE OR REPLACE FUNCTION public.rpc_process_due_template_rollouts(
  p_limit integer DEFAULT 25
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_service_role boolean := (SELECT current_setting('request.jwt.claim.role', true)) = 'service_role';
  v_is_scheduler_role boolean := current_user IN ('postgres', 'supabase_admin');
  v_rollout public.platform_template_rollouts%ROWTYPE;
  v_results jsonb := '[]'::jsonb;
  v_processed integer := 0;
  v_errors integer := 0;
  v_exec jsonb;
BEGIN
  IF NOT (v_is_service_role OR v_is_scheduler_role) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  FOR v_rollout IN
    SELECT *
    FROM public.platform_template_rollouts r
    WHERE r.status = 'scheduled'
      AND (
        (
          COALESCE(r.is_security_critical, false) = false
          AND r.scheduled_for <= now()
        )
        OR (
          COALESCE(r.is_security_critical, false) = true
          AND COALESCE(r.security_grace_until, r.scheduled_for) <= now()
        )
      )
    ORDER BY r.scheduled_for ASC, r.created_at ASC
    LIMIT GREATEST(COALESCE(p_limit, 25), 1)
  LOOP
    BEGIN
      SELECT public.rpc_admin_execute_template_rollout(v_rollout.id) INTO v_exec;
      v_processed := v_processed + 1;
      v_results := v_results || jsonb_build_array(
        jsonb_build_object(
          'rollout_id', v_rollout.id,
          'ok', true,
          'result', v_exec
        )
      );
    EXCEPTION
      WHEN OTHERS THEN
        v_errors := v_errors + 1;
        v_results := v_results || jsonb_build_array(
          jsonb_build_object(
            'rollout_id', v_rollout.id,
            'ok', false,
            'error', SQLERRM
          )
        );
        INSERT INTO public.platform_template_rollout_audit (
          rollout_id, tenant_id, trigger_event, channel, action, details, created_by
        ) VALUES (
          v_rollout.id,
          NULL,
          NULL,
          NULL,
          'processor_error',
          jsonb_build_object('error', SQLERRM),
          NULL
        );
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'processed', v_processed,
    'errors', v_errors,
    'results', v_results
  );
END;
$$;

DO $$
DECLARE
  v_job_id bigint;
BEGIN
  -- Skip safely when pg_cron isn't available in this environment.
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron not available; skipping template rollout scheduler registration';
    RETURN;
  END IF;

  -- Remove prior jobs that run this processor, then recreate with desired cadence.
  FOR v_job_id IN
    SELECT jobid
    FROM cron.job
    WHERE command ILIKE '%rpc_process_due_template_rollouts%'
  LOOP
    PERFORM cron.unschedule(v_job_id);
  END LOOP;

  PERFORM cron.schedule(
    '*/5 * * * *',
    $cmd$SELECT public.rpc_process_due_template_rollouts(50);$cmd$
  );
END;
$$;

COMMENT ON FUNCTION public.rpc_process_due_template_rollouts(integer)
IS 'Processes due platform template rollouts (service role + pg_cron scheduler).';
