-- =============================================================================
-- Alert template rollout hardening
-- - Tenant per-rollout decisions + tenant preference RPCs
-- - Security-critical grace window fields
-- - Scheduled auto-processing RPC (service_role)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Rollout metadata enhancements
-- ---------------------------------------------------------------------------
ALTER TABLE public.platform_template_rollouts
  ADD COLUMN IF NOT EXISTS is_security_critical boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS security_grace_hours integer NOT NULL DEFAULT 72
    CHECK (security_grace_hours >= 0 AND security_grace_hours <= 8760),
  ADD COLUMN IF NOT EXISTS security_grace_until timestamptz;

UPDATE public.platform_template_rollouts
SET security_grace_until = scheduled_for + make_interval(hours => COALESCE(security_grace_hours, 72))
WHERE is_security_critical = true
  AND security_grace_until IS NULL;

-- ---------------------------------------------------------------------------
-- 2) Tenant per-rollout decision table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenant_template_rollout_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rollout_id uuid NOT NULL REFERENCES public.platform_template_rollouts(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  decision text NOT NULL CHECK (decision IN ('replace_all', 'layout_only', 'do_not_update')),
  decided_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rollout_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_template_rollout_decisions_tenant_rollout
  ON public.tenant_template_rollout_decisions(tenant_id, rollout_id);

ALTER TABLE public.tenant_template_rollout_decisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_template_rollout_decisions_select" ON public.tenant_template_rollout_decisions;
CREATE POLICY "tenant_template_rollout_decisions_select"
  ON public.tenant_template_rollout_decisions
  FOR SELECT
  TO authenticated
  USING (
    (SELECT current_setting('request.jwt.claim.role', true)) = 'service_role'
    OR public.current_user_is_admin_dev()
    OR tenant_id = public.user_tenant_id()
  );

DROP POLICY IF EXISTS "tenant_template_rollout_decisions_write" ON public.tenant_template_rollout_decisions;
CREATE POLICY "tenant_template_rollout_decisions_write"
  ON public.tenant_template_rollout_decisions
  FOR ALL
  TO authenticated
  USING (
    (SELECT current_setting('request.jwt.claim.role', true)) = 'service_role'
    OR public.current_user_is_admin_dev()
    OR tenant_id = public.user_tenant_id()
  )
  WITH CHECK (
    (SELECT current_setting('request.jwt.claim.role', true)) = 'service_role'
    OR public.current_user_is_admin_dev()
    OR tenant_id = public.user_tenant_id()
  );

-- ---------------------------------------------------------------------------
-- 3) Tenant-facing preference + decision RPCs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_get_my_template_rollout_preference()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid := public.user_tenant_id();
  v_opt_out boolean := false;
BEGIN
  IF auth.uid() IS NULL OR v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  SELECT COALESCE(opt_out_non_critical, false)
  INTO v_opt_out
  FROM public.tenant_template_rollout_preferences
  WHERE tenant_id = v_tenant_id;

  RETURN COALESCE(v_opt_out, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_set_my_template_rollout_preference(
  p_opt_out_non_critical boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid := public.user_tenant_id();
  v_value boolean;
BEGIN
  IF auth.uid() IS NULL OR v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  INSERT INTO public.tenant_template_rollout_preferences (
    tenant_id,
    opt_out_non_critical,
    updated_at,
    updated_by
  )
  VALUES (
    v_tenant_id,
    COALESCE(p_opt_out_non_critical, false),
    now(),
    auth.uid()
  )
  ON CONFLICT (tenant_id) DO UPDATE
  SET
    opt_out_non_critical = EXCLUDED.opt_out_non_critical,
    updated_at = now(),
    updated_by = auth.uid()
  RETURNING opt_out_non_critical INTO v_value;

  RETURN COALESCE(v_value, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_list_my_pending_template_rollouts()
RETURNS TABLE (
  rollout_id uuid,
  name text,
  notes text,
  scheduled_for timestamptz,
  status text,
  update_mode text,
  preserve_subject boolean,
  preserve_body_text boolean,
  allow_tenant_opt_out boolean,
  is_security_critical boolean,
  security_grace_until timestamptz,
  tenant_decision text,
  decision_locked boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid := public.user_tenant_id();
BEGIN
  IF auth.uid() IS NULL OR v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  RETURN QUERY
  SELECT
    r.id AS rollout_id,
    r.name,
    r.notes,
    r.scheduled_for,
    r.status,
    r.update_mode,
    r.preserve_subject,
    r.preserve_body_text,
    r.allow_tenant_opt_out,
    r.is_security_critical,
    r.security_grace_until,
    d.decision AS tenant_decision,
    (
      r.status <> 'scheduled'
      OR NOT COALESCE(r.allow_tenant_opt_out, true)
      OR (
        COALESCE(r.is_security_critical, false)
        AND now() >= COALESCE(r.security_grace_until, r.scheduled_for)
      )
    ) AS decision_locked
  FROM public.platform_template_rollouts r
  LEFT JOIN public.tenant_template_rollout_decisions d
    ON d.rollout_id = r.id
   AND d.tenant_id = v_tenant_id
  WHERE r.status = 'scheduled'
  ORDER BY r.scheduled_for ASC, r.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_set_my_template_rollout_decision(
  p_rollout_id uuid,
  p_decision text
)
RETURNS public.tenant_template_rollout_decisions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid := public.user_tenant_id();
  v_rollout public.platform_template_rollouts%ROWTYPE;
  v_row public.tenant_template_rollout_decisions;
BEGIN
  IF auth.uid() IS NULL OR v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  IF p_rollout_id IS NULL THEN
    RAISE EXCEPTION 'p_rollout_id is required';
  END IF;
  IF p_decision NOT IN ('replace_all', 'layout_only', 'do_not_update') THEN
    RAISE EXCEPTION 'Invalid decision: %', p_decision;
  END IF;

  SELECT * INTO v_rollout
  FROM public.platform_template_rollouts
  WHERE id = p_rollout_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rollout not found: %', p_rollout_id;
  END IF;
  IF v_rollout.status <> 'scheduled' THEN
    RAISE EXCEPTION 'Rollout is no longer editable: %', v_rollout.status;
  END IF;
  IF NOT COALESCE(v_rollout.allow_tenant_opt_out, true) THEN
    RAISE EXCEPTION 'Tenant decisions are disabled for this rollout';
  END IF;
  IF COALESCE(v_rollout.is_security_critical, false)
     AND now() >= COALESCE(v_rollout.security_grace_until, v_rollout.scheduled_for) THEN
    RAISE EXCEPTION 'Security-critical grace window elapsed; decision is locked';
  END IF;

  INSERT INTO public.tenant_template_rollout_decisions (
    rollout_id,
    tenant_id,
    decision,
    decided_at,
    decided_by,
    updated_at
  )
  VALUES (
    p_rollout_id,
    v_tenant_id,
    p_decision,
    now(),
    auth.uid(),
    now()
  )
  ON CONFLICT (rollout_id, tenant_id) DO UPDATE
  SET
    decision = EXCLUDED.decision,
    decided_at = now(),
    decided_by = auth.uid(),
    updated_at = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4) Admin schedule RPC: add security-critical options
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.rpc_admin_schedule_template_rollout(
  text,
  text,
  timestamptz,
  text,
  boolean,
  boolean,
  boolean,
  text[],
  uuid
);

CREATE OR REPLACE FUNCTION public.rpc_admin_schedule_template_rollout(
  p_name text,
  p_notes text DEFAULT NULL,
  p_scheduled_for timestamptz DEFAULT now(),
  p_update_mode text DEFAULT 'layout_only',
  p_preserve_subject boolean DEFAULT true,
  p_preserve_body_text boolean DEFAULT true,
  p_allow_tenant_opt_out boolean DEFAULT true,
  p_include_triggers text[] DEFAULT NULL,
  p_wrapper_version_id uuid DEFAULT NULL,
  p_is_security_critical boolean DEFAULT false,
  p_security_grace_hours integer DEFAULT 72
)
RETURNS public.platform_template_rollouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_row public.platform_template_rollouts;
  v_scheduled_for timestamptz := COALESCE(p_scheduled_for, now());
  v_grace_hours integer := LEAST(GREATEST(COALESCE(p_security_grace_hours, 72), 0), 8760);
BEGIN
  IF NOT public.current_user_is_admin_dev() THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'p_name is required';
  END IF;
  IF p_update_mode NOT IN ('replace_all', 'layout_only', 'do_not_update') THEN
    RAISE EXCEPTION 'Invalid update mode: %', p_update_mode;
  END IF;

  INSERT INTO public.platform_template_rollouts (
    name,
    notes,
    scheduled_for,
    status,
    update_mode,
    preserve_subject,
    preserve_body_text,
    allow_tenant_opt_out,
    include_triggers,
    wrapper_version_id,
    is_security_critical,
    security_grace_hours,
    security_grace_until,
    created_by,
    updated_by
  ) VALUES (
    btrim(p_name),
    NULLIF(btrim(p_notes), ''),
    v_scheduled_for,
    'scheduled',
    p_update_mode,
    COALESCE(p_preserve_subject, true),
    COALESCE(p_preserve_body_text, true),
    COALESCE(p_allow_tenant_opt_out, true),
    p_include_triggers,
    p_wrapper_version_id,
    COALESCE(p_is_security_critical, false),
    v_grace_hours,
    CASE
      WHEN COALESCE(p_is_security_critical, false)
      THEN v_scheduled_for + make_interval(hours => v_grace_hours)
      ELSE NULL
    END,
    v_user_id,
    v_user_id
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5) Recipient list RPC: critical updates always notify
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_admin_list_rollout_notice_recipients(
  p_rollout_id uuid
)
RETURNS TABLE (
  user_id uuid,
  email text,
  tenant_id uuid,
  tenant_name text,
  company_name text,
  app_base_url text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rollout public.platform_template_rollouts%ROWTYPE;
BEGIN
  IF NOT public.current_user_is_admin_dev() THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  SELECT * INTO v_rollout
  FROM public.platform_template_rollouts
  WHERE id = p_rollout_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rollout not found: %', p_rollout_id;
  END IF;

  RETURN QUERY
  SELECT DISTINCT
    u.id AS user_id,
    lower(u.email) AS email,
    t.id AS tenant_id,
    t.name AS tenant_name,
    tcs.company_name,
    tcs.app_base_url
  FROM public.users u
  JOIN public.user_roles ur
    ON ur.user_id = u.id
   AND ur.deleted_at IS NULL
  JOIN public.roles r
    ON r.id = ur.role_id
   AND r.deleted_at IS NULL
   AND r.tenant_id = u.tenant_id
   AND r.name IN ('tenant_admin', 'admin')
  JOIN public.tenants t
    ON t.id = u.tenant_id
  LEFT JOIN public.tenant_company_settings tcs
    ON tcs.tenant_id = t.id
  LEFT JOIN public.tenant_template_rollout_preferences pref
    ON pref.tenant_id = t.id
  WHERE u.deleted_at IS NULL
    AND u.email IS NOT NULL
    AND btrim(u.email) <> ''
    AND (
      COALESCE(v_rollout.is_security_critical, false)
      OR NOT COALESCE(v_rollout.allow_tenant_opt_out, true)
      OR COALESCE(pref.opt_out_non_critical, false) = false
    )
  ORDER BY t.name, lower(u.email);
END;
$$;

-- ---------------------------------------------------------------------------
-- 6) Execute rollout RPC with tenant decisions + security force handling
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_admin_execute_template_rollout(
  p_rollout_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rollout public.platform_template_rollouts%ROWTYPE;
  v_wrapper public.platform_email_wrapper_versions%ROWTYPE;
  v_lib public.platform_alert_template_library%ROWTYPE;
  v_alert record;
  v_existing public.communication_templates%ROWTYPE;
  v_is_customized boolean;
  v_opt_out boolean;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_actor uuid := auth.uid();
  v_is_service_role boolean := (SELECT current_setting('request.jwt.claim.role', true)) = 'service_role';
  v_force_security boolean := false;
  v_tenant_decision text;
  v_has_tenant_decision boolean;
  v_effective_mode text;
  v_effective_preserve_subject boolean;
  v_effective_preserve_body_text boolean;
BEGIN
  IF NOT (v_is_service_role OR public.current_user_is_admin_dev()) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  SELECT * INTO v_rollout
  FROM public.platform_template_rollouts
  WHERE id = p_rollout_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rollout not found: %', p_rollout_id;
  END IF;

  IF v_rollout.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Rollout is cancelled');
  END IF;
  IF v_rollout.status = 'launched' THEN
    RETURN jsonb_build_object('ok', true, 'message', 'Rollout already launched');
  END IF;

  v_force_security := COALESCE(v_rollout.is_security_critical, false)
    AND now() >= COALESCE(v_rollout.security_grace_until, v_rollout.scheduled_for);

  -- Apply selected wrapper globally (layout updates happen at render time)
  IF v_rollout.wrapper_version_id IS NOT NULL THEN
    SELECT * INTO v_wrapper
    FROM public.platform_email_wrapper_versions
    WHERE id = v_rollout.wrapper_version_id;

    IF FOUND THEN
      UPDATE public.platform_email_wrapper_versions
      SET is_active = (id = v_wrapper.id), updated_at = now(), updated_by = v_actor
      WHERE is_active = true OR id = v_wrapper.id;

      UPDATE public.platform_email_settings
      SET wrapper_html_template = v_wrapper.wrapper_html_template, updated_at = now(), updated_by = v_actor
      WHERE id = 1;
    END IF;
  END IF;

  FOR v_lib IN
    SELECT *
    FROM public.platform_alert_template_library
    WHERE is_active = true
      AND (
        COALESCE(array_length(v_rollout.include_triggers, 1), 0) = 0
        OR trigger_event = ANY(v_rollout.include_triggers)
      )
    ORDER BY trigger_event, channel
  LOOP
    FOR v_alert IN
      SELECT id, tenant_id, trigger_event
      FROM public.communication_alerts
      WHERE trigger_event = v_lib.trigger_event
    LOOP
      v_tenant_decision := NULL;
      v_has_tenant_decision := false;
      SELECT d.decision
      INTO v_tenant_decision
      FROM public.tenant_template_rollout_decisions d
      WHERE d.rollout_id = v_rollout.id
        AND d.tenant_id = v_alert.tenant_id;
      v_has_tenant_decision := FOUND;

      v_opt_out := false;
      IF NOT v_force_security AND v_rollout.allow_tenant_opt_out THEN
        SELECT COALESCE(opt_out_non_critical, false)
        INTO v_opt_out
        FROM public.tenant_template_rollout_preferences
        WHERE tenant_id = v_alert.tenant_id;
      END IF;

      IF v_opt_out AND NOT v_has_tenant_decision THEN
        v_skipped := v_skipped + 1;
        INSERT INTO public.platform_template_rollout_audit (
          rollout_id, tenant_id, trigger_event, channel, action, details, created_by
        ) VALUES (
          v_rollout.id, v_alert.tenant_id, v_lib.trigger_event, v_lib.channel, 'skipped_opt_out',
          jsonb_build_object('reason', 'tenant_opt_out_non_critical'),
          v_actor
        );
        CONTINUE;
      END IF;

      IF v_force_security THEN
        v_effective_mode := 'replace_all';
        v_effective_preserve_subject := false;
        v_effective_preserve_body_text := false;
      ELSE
        v_effective_mode := COALESCE(v_tenant_decision, v_rollout.update_mode);
        IF v_effective_mode = 'replace_all' THEN
          IF v_has_tenant_decision THEN
            v_effective_preserve_subject := false;
            v_effective_preserve_body_text := false;
          ELSE
            v_effective_preserve_subject := v_rollout.preserve_subject;
            v_effective_preserve_body_text := v_rollout.preserve_body_text;
          END IF;
        ELSE
          v_effective_preserve_subject := true;
          v_effective_preserve_body_text := true;
        END IF;
      END IF;

      IF v_has_tenant_decision AND v_effective_mode = 'do_not_update' THEN
        v_skipped := v_skipped + 1;
        INSERT INTO public.platform_template_rollout_audit (
          rollout_id, tenant_id, trigger_event, channel, action, details, created_by
        ) VALUES (
          v_rollout.id, v_alert.tenant_id, v_lib.trigger_event, v_lib.channel, 'skipped_tenant_decision',
          jsonb_build_object('decision', v_tenant_decision),
          v_actor
        );
        CONTINUE;
      END IF;

      SELECT *
      INTO v_existing
      FROM public.communication_templates
      WHERE alert_id = v_alert.id
        AND channel = v_lib.channel;

      IF NOT FOUND THEN
        INSERT INTO public.communication_templates (
          tenant_id,
          alert_id,
          channel,
          subject_template,
          body_template,
          body_format,
          editor_json
        ) VALUES (
          v_alert.tenant_id,
          v_alert.id,
          v_lib.channel,
          v_lib.subject_template,
          v_lib.body_template,
          v_lib.body_format,
          v_lib.editor_json
        );
        v_inserted := v_inserted + 1;

        INSERT INTO public.platform_template_rollout_audit (
          rollout_id, tenant_id, trigger_event, channel, action, details, created_by
        ) VALUES (
          v_rollout.id, v_alert.tenant_id, v_lib.trigger_event, v_lib.channel, 'inserted_missing_template',
          jsonb_build_object(
            'effective_mode', v_effective_mode,
            'force_security', v_force_security
          ),
          v_actor
        );
      ELSE
        v_is_customized := v_existing.updated_at > v_existing.created_at;

        IF v_is_customized AND v_effective_mode = 'do_not_update' THEN
          v_skipped := v_skipped + 1;
          INSERT INTO public.platform_template_rollout_audit (
            rollout_id, tenant_id, trigger_event, channel, action, details, created_by
          ) VALUES (
            v_rollout.id, v_alert.tenant_id, v_lib.trigger_event, v_lib.channel, 'skipped_customized',
            jsonb_build_object('effective_mode', v_effective_mode),
            v_actor
          );
          CONTINUE;
        END IF;

        IF v_effective_mode = 'layout_only' THEN
          UPDATE public.communication_templates
          SET
            editor_json = COALESCE(v_lib.editor_json, editor_json),
            updated_at = now()
          WHERE id = v_existing.id;

          v_updated := v_updated + 1;
          INSERT INTO public.platform_template_rollout_audit (
            rollout_id, tenant_id, trigger_event, channel, action, details, created_by
          ) VALUES (
            v_rollout.id, v_alert.tenant_id, v_lib.trigger_event, v_lib.channel, 'updated_layout_only',
            jsonb_build_object(
              'customized', v_is_customized,
              'effective_mode', v_effective_mode
            ),
            v_actor
          );
          CONTINUE;
        END IF;

        UPDATE public.communication_templates
        SET
          subject_template = CASE
            WHEN v_effective_preserve_subject THEN public.communication_templates.subject_template
            ELSE v_lib.subject_template
          END,
          body_template = CASE
            WHEN v_effective_preserve_body_text THEN public.communication_templates.body_template
            ELSE v_lib.body_template
          END,
          body_format = CASE
            WHEN v_effective_preserve_body_text THEN public.communication_templates.body_format
            ELSE v_lib.body_format
          END,
          editor_json = COALESCE(v_lib.editor_json, public.communication_templates.editor_json),
          updated_at = now()
        WHERE id = v_existing.id;

        v_updated := v_updated + 1;
        INSERT INTO public.platform_template_rollout_audit (
          rollout_id, tenant_id, trigger_event, channel, action, details, created_by
        ) VALUES (
          v_rollout.id, v_alert.tenant_id, v_lib.trigger_event, v_lib.channel, 'updated_template',
          jsonb_build_object(
            'customized', v_is_customized,
            'effective_mode', v_effective_mode,
            'preserve_subject', v_effective_preserve_subject,
            'preserve_body_text', v_effective_preserve_body_text,
            'force_security', v_force_security
          ),
          v_actor
        );
      END IF;
    END LOOP;
  END LOOP;

  UPDATE public.platform_template_rollouts
  SET
    status = 'launched',
    launched_at = now(),
    updated_at = now(),
    updated_by = v_actor
  WHERE id = v_rollout.id
    AND status <> 'cancelled';

  RETURN jsonb_build_object(
    'ok', true,
    'rollout_id', v_rollout.id,
    'inserted', v_inserted,
    'updated', v_updated,
    'skipped', v_skipped,
    'force_security', v_force_security
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 7) Scheduled processor RPC (service_role only)
-- ---------------------------------------------------------------------------
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
  v_rollout public.platform_template_rollouts%ROWTYPE;
  v_results jsonb := '[]'::jsonb;
  v_processed integer := 0;
  v_errors integer := 0;
  v_exec jsonb;
BEGIN
  IF NOT v_is_service_role THEN
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

-- ---------------------------------------------------------------------------
-- 8) Grants
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.rpc_get_my_template_rollout_preference() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_set_my_template_rollout_preference(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_list_my_pending_template_rollouts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_set_my_template_rollout_decision(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_schedule_template_rollout(text, text, timestamptz, text, boolean, boolean, boolean, text[], uuid, boolean, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_list_rollout_notice_recipients(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_execute_template_rollout(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_process_due_template_rollouts(integer) TO authenticated;
