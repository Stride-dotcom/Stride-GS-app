-- =============================================================================
-- RPC: rpc_ensure_flag_alert_trigger
--
-- Server-side, tenant-safe function to create/enable/disable a per-flag
-- communication_alerts trigger.  Tenant is derived from auth.uid() via
-- user_tenant_id() — never caller-provided.
--
-- Idempotency: relies on UNIQUE(tenant_id, key) on communication_alerts
-- (already present) and uses INSERT ... ON CONFLICT for race safety.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.rpc_ensure_flag_alert_trigger(
  p_charge_type_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id    uuid;
  v_charge_code  text;
  v_charge_name  text;
  v_alert_rule   text;
  v_trigger_key  text;
  v_trigger_evt  text;
  v_enabled      boolean;
  v_alert_id     uuid;
  v_was_created  boolean := false;
  v_alert_name   text;
BEGIN
  -- 1) Derive tenant from authenticated session (NEVER from caller)
  v_tenant_id := public.user_tenant_id();

  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error_code', 'AUTH_REQUIRED',
      'message', 'Could not resolve tenant for current user.'
    );
  END IF;

  -- 2) Load the charge_type row and verify it belongs to this tenant
  SELECT ct.charge_code, ct.charge_name, ct.alert_rule
  INTO   v_charge_code, v_charge_name, v_alert_rule
  FROM   public.charge_types ct
  WHERE  ct.id = p_charge_type_id
    AND  ct.tenant_id = v_tenant_id
    AND  ct.add_flag = true;

  IF v_charge_code IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error_code', 'TENANT_MISMATCH',
      'message', 'Charge type not found or does not belong to current tenant.'
    );
  END IF;

  -- 3) Derive deterministic key + event (matches existing frontend convention)
  v_trigger_key := 'flag_alert_' || v_charge_code;
  v_trigger_evt := 'item.flag_added.' || v_charge_code;
  v_enabled     := (v_alert_rule IS NOT NULL AND v_alert_rule <> 'none');
  v_alert_name  := 'Flag Alert: ' || v_charge_name;

  -- 4) Upsert: INSERT if missing, UPDATE is_enabled on conflict
  INSERT INTO public.communication_alerts (
    tenant_id, name, key, description, is_enabled, channels,
    trigger_event, timing_rule, created_at, updated_at
  )
  VALUES (
    v_tenant_id,
    v_alert_name,
    v_trigger_key,
    'Automatically created trigger for the "' || v_charge_name || '" flag.',
    v_enabled,
    '{"email": true, "sms": false, "in_app": true}'::jsonb,
    v_trigger_evt,
    'immediate',
    now(),
    now()
  )
  ON CONFLICT (tenant_id, key) DO UPDATE
    SET is_enabled = EXCLUDED.is_enabled,
        updated_at = now()
  RETURNING id, (xmax = 0) INTO v_alert_id, v_was_created;

  -- 5) If freshly created, add default templates (email + sms + in_app)
  IF v_was_created AND v_enabled THEN
    INSERT INTO public.communication_templates
      (tenant_id, alert_id, channel, subject_template, body_template, body_format, in_app_recipients)
    VALUES
      (
        v_tenant_id, v_alert_id, 'email',
        '[[tenant_name]]: Flag "' || v_charge_name || '" Added — [[item_code]]',
        E'A flag has been added to an item.\n\n**Item:** [[item_code]]\n**Description:** [[item_description]]',
        'text', NULL
      ),
      (
        v_tenant_id, v_alert_id, 'sms',
        NULL,
        '[[tenant_name]]: Flag "' || v_charge_name || '" added to item [[item_code]]. View: [[item_photos_link]]',
        'text', NULL
      ),
      (
        v_tenant_id, v_alert_id, 'in_app',
        'Flag "' || v_charge_name || '" added',
        'Flag "' || v_charge_name || '" added to item [[item_code]].',
        'text', '[[manager_role]], [[warehouse_role]]'
      )
    ON CONFLICT DO NOTHING;  -- templates may already exist from a previous partial run
  END IF;

  -- 6) Return result
  RETURN jsonb_build_object(
    'ok', true,
    'alert_id', v_alert_id,
    'key', v_trigger_key,
    'trigger_event', v_trigger_evt,
    'is_enabled', v_enabled,
    'created', v_was_created
  );
END;
$$;

-- Grant execute to authenticated users (RLS + SECURITY DEFINER protects data)
GRANT EXECUTE ON FUNCTION public.rpc_ensure_flag_alert_trigger(uuid) TO authenticated;
