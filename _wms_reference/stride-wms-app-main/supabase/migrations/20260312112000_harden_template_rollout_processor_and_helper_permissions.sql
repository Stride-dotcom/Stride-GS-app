-- =============================================================================
-- Harden rollout processor/helper RPC execution permissions
-- -----------------------------------------------------------------------------
-- Why:
-- - `rpc_process_due_template_rollouts` is SECURITY DEFINER and used
--   `current_user` to detect scheduler roles. Under SECURITY DEFINER,
--   `current_user` is the function owner, so this check can be bypassed.
-- - Internal helper `_ensure_catalog_trigger_for_all_tenants` should not be
--   callable by regular API roles.
--
-- This migration:
-- 1) Replaces scheduler-role detection with `session_user`.
-- 2) Restricts `rpc_process_due_template_rollouts` execute privileges to
--    `service_role` (owner/scheduler DB roles remain valid).
-- 3) Restricts `_ensure_catalog_trigger_for_all_tenants` execute privileges
--    to `service_role` only.
-- =============================================================================

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
  v_is_scheduler_role boolean := session_user IN ('postgres', 'supabase_admin');
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
        (COALESCE(r.is_security_critical, false) = false AND r.scheduled_for <= now())
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
      v_results := v_results || jsonb_build_array(jsonb_build_object('rollout_id', v_rollout.id, 'ok', true, 'result', v_exec));
    EXCEPTION
      WHEN OTHERS THEN
        v_errors := v_errors + 1;
        v_results := v_results || jsonb_build_array(jsonb_build_object('rollout_id', v_rollout.id, 'ok', false, 'error', SQLERRM));
        INSERT INTO public.platform_template_rollout_audit (
          rollout_id, tenant_id, trigger_event, channel, action, details, created_by
        ) VALUES (
          v_rollout.id, NULL, NULL, NULL, 'processor_error', jsonb_build_object('error', SQLERRM), NULL
        );
    END;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'processed', v_processed, 'errors', v_errors, 'results', v_results);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_process_due_template_rollouts(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_process_due_template_rollouts(integer) FROM anon;
REVOKE ALL ON FUNCTION public.rpc_process_due_template_rollouts(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_process_due_template_rollouts(integer) TO service_role;

REVOKE ALL ON FUNCTION public._ensure_catalog_trigger_for_all_tenants(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._ensure_catalog_trigger_for_all_tenants(text) FROM anon;
REVOKE ALL ON FUNCTION public._ensure_catalog_trigger_for_all_tenants(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public._ensure_catalog_trigger_for_all_tenants(text) TO service_role;
