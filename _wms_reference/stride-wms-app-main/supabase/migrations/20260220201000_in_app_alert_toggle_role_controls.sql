-- =============================================================================
-- In-app alert toggle role controls
-- - Manager/admin can disable in-app alerts for operational roles only
-- - Any user can enable self back on
-- =============================================================================

CREATE OR REPLACE FUNCTION public.rpc_get_user_in_app_alert_preference(
  p_user_id uuid
)
RETURNS TABLE (
  user_id uuid,
  enabled boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_can_view boolean;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT
    p_user_id = v_actor_id
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.user_id = v_actor_id
        AND ur.deleted_at IS NULL
        AND r.deleted_at IS NULL
        AND r.name IN ('manager', 'admin', 'tenant_admin', 'admin_dev')
    )
  INTO v_can_view;

  IF NOT COALESCE(v_can_view, false) THEN
    RAISE EXCEPTION 'Not authorized to view this preference';
  END IF;

  RETURN QUERY
  SELECT
    p_user_id AS user_id,
    COALESCE(
      (
        SELECT
          (up.preference_value ->> 'enabled')::boolean IS DISTINCT FROM false
          AND (up.preference_value ->> 'in_app_alerts_enabled')::boolean IS DISTINCT FROM false
        FROM public.user_preferences up
        WHERE up.user_id = p_user_id
          AND up.preference_key = 'in_app_alerts'
        LIMIT 1
      ),
      true
    ) AS enabled;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_set_user_in_app_alert_preference(
  p_user_id uuid,
  p_enabled boolean
)
RETURNS TABLE (
  user_id uuid,
  enabled boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_can_manage boolean;
  v_target_is_operational boolean;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'User id is required';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = v_actor_id
      AND ur.deleted_at IS NULL
      AND r.deleted_at IS NULL
      AND r.name IN ('manager', 'admin', 'tenant_admin', 'admin_dev')
  ) INTO v_actor_can_manage;

  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = p_user_id
      AND ur.deleted_at IS NULL
      AND r.deleted_at IS NULL
      AND r.name IN ('client_user', 'warehouse', 'warehouse_staff')
  ) INTO v_target_is_operational;

  -- Turning OFF requires explicit privilege and an operational target role.
  IF p_enabled = false THEN
    IF NOT COALESCE(v_actor_can_manage, false) THEN
      RAISE EXCEPTION 'Not authorized to disable in-app alerts for this user';
    END IF;

    IF NOT COALESCE(v_target_is_operational, false) THEN
      RAISE EXCEPTION 'In-app alerts can only be disabled for client/warehouse roles';
    END IF;
  ELSE
    -- Turning ON is always allowed for self; otherwise privileged users only.
    IF p_user_id <> v_actor_id AND NOT COALESCE(v_actor_can_manage, false) THEN
      RAISE EXCEPTION 'Not authorized to enable in-app alerts for this user';
    END IF;
  END IF;

  INSERT INTO public.user_preferences (user_id, preference_key, preference_value)
  VALUES (
    p_user_id,
    'in_app_alerts',
    jsonb_build_object(
      'enabled', p_enabled,
      'in_app_alerts_enabled', p_enabled,
      'updated_by', v_actor_id,
      'updated_at', now()
    )
  )
  ON CONFLICT (user_id, preference_key)
  DO UPDATE
  SET
    preference_value = jsonb_build_object(
      'enabled', p_enabled,
      'in_app_alerts_enabled', p_enabled,
      'updated_by', v_actor_id,
      'updated_at', now()
    ),
    updated_at = now();

  RETURN QUERY SELECT p_user_id, p_enabled;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_get_user_in_app_alert_preference(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_set_user_in_app_alert_preference(uuid, boolean) TO authenticated;
