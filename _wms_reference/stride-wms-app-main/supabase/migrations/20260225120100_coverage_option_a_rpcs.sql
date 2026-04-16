-- ============================================================================
-- Coverage System Reintegration — Option A RPC Functions
-- All coverage mutations go through these SECURITY DEFINER RPCs.
-- ============================================================================

-- ============================================================================
-- Helper: get caller's tenant_id and account_id for permission checks
-- ============================================================================
CREATE OR REPLACE FUNCTION public._coverage_get_caller_context()
RETURNS TABLE (caller_tenant_id uuid, caller_account_id uuid, caller_role text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT u.tenant_id, u.account_id, public.get_user_role(u.id)
  FROM public.users u
  WHERE u.id = auth.uid();
END;
$$;

-- ============================================================================
-- Helper: check permission (staff=any in tenant, client=own account only)
-- ============================================================================
CREATE OR REPLACE FUNCTION public._coverage_check_permission(
  p_shipment_account_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ctx RECORD;
BEGIN
  SELECT * INTO v_ctx FROM public._coverage_get_caller_context() LIMIT 1;

  IF v_ctx IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: no user context';
  END IF;

  -- Staff roles can operate on anything within their tenant
  IF v_ctx.caller_role IN ('admin', 'tenant_admin', 'manager', 'warehouse') THEN
    RETURN;
  END IF;

  -- Client roles can only operate on their own account
  IF v_ctx.caller_role IN ('account_admin', 'account_manager') THEN
    IF v_ctx.caller_account_id IS NULL OR v_ctx.caller_account_id != p_shipment_account_id THEN
      RAISE EXCEPTION 'Forbidden: client can only manage coverage for their own account';
    END IF;
    RETURN;
  END IF;

  RAISE EXCEPTION 'Insufficient permissions for coverage operations';
END;
$$;

-- ============================================================================
-- 3.1 rpc_get_effective_coverage_rates
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rpc_get_effective_coverage_rates(
  p_account_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_rates RECORD;
  v_min_dv numeric(12,2);
BEGIN
  v_tenant_id := public.get_current_user_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: no tenant context';
  END IF;

  -- Use the existing get_coverage_rates function
  SELECT * INTO v_rates
  FROM public.get_coverage_rates(v_tenant_id, p_account_id);

  -- Get min declared value from org settings
  SELECT COALESCE(ocs.coverage_min_declared_value, 0)
  INTO v_min_dv
  FROM public.organization_claim_settings ocs
  WHERE ocs.tenant_id = v_tenant_id;

  RETURN jsonb_build_object(
    'rate_full_replacement_no_deductible', COALESCE(v_rates.rate_full_no_deductible, 0.0188),
    'rate_full_replacement_deductible', COALESCE(v_rates.rate_full_deductible, 0.0142),
    'deductible_amount', COALESCE(v_rates.deductible_amount, 300.00),
    'coverage_min_declared_value', COALESCE(v_min_dv, 0),
    'source', COALESCE(v_rates.source, 'tenant')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_get_effective_coverage_rates(uuid) TO authenticated;

-- ============================================================================
-- 3.4 rpc_update_item_declared_value (defined before 3.2 since 3.2 calls it)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rpc_update_item_declared_value(
  p_item_id uuid,
  p_declared_value numeric(12,2)
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_item RECORD;
  v_shipment RECORD;
  v_effective_account_id uuid;
  v_shipment_id uuid;
  v_shipment_coverage_type text;
  v_rates RECORD;
  v_rate numeric;
  v_new_premium numeric;
  v_existing_net numeric;
  v_delta numeric;
  v_min_dv numeric;
  v_old_dv numeric;
  v_action text;
BEGIN
  v_tenant_id := public.get_current_user_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: no tenant context';
  END IF;

  -- Load item
  SELECT i.id, i.tenant_id, i.account_id, i.declared_value, i.coverage_type,
         i.receiving_shipment_id, i.sidemark_id, i.class_id
  INTO v_item
  FROM public.items i
  WHERE i.id = p_item_id AND i.tenant_id = v_tenant_id AND i.deleted_at IS NULL;

  IF v_item IS NULL THEN
    RAISE EXCEPTION 'Item not found or access denied';
  END IF;

  -- Load parent shipment
  SELECT s.id, s.coverage_type, s.account_id
  INTO v_shipment
  FROM public.shipments s
  WHERE s.id = v_item.receiving_shipment_id AND s.tenant_id = v_tenant_id;

  v_effective_account_id := v_item.account_id;
  v_shipment_id := NULL;
  v_shipment_coverage_type := NULL;
  IF v_shipment IS NOT NULL THEN
    v_effective_account_id := COALESCE(v_shipment.account_id, v_item.account_id);
    v_shipment_id := v_shipment.id;
    v_shipment_coverage_type := v_shipment.coverage_type;
  END IF;

  -- Permission check
  PERFORM public._coverage_check_permission(
    v_effective_account_id
  );

  -- Get min DV threshold
  SELECT COALESCE(ocs.coverage_min_declared_value, 0)
  INTO v_min_dv
  FROM public.organization_claim_settings ocs
  WHERE ocs.tenant_id = v_tenant_id;

  -- Validate declared value
  IF p_declared_value IS NULL OR p_declared_value <= 0 THEN
    RAISE EXCEPTION 'Declared value must be greater than 0';
  END IF;

  IF p_declared_value < v_min_dv AND v_min_dv > 0 THEN
    RAISE EXCEPTION 'Declared value must be at least %', v_min_dv;
  END IF;

  -- Store old DV for audit
  v_old_dv := v_item.declared_value;

  -- Update declared value
  UPDATE public.items
  SET declared_value = p_declared_value
  WHERE id = p_item_id;

  -- Determine action for audit
  IF v_old_dv IS NULL THEN
    v_action := 'declared_value_set';
  ELSE
    v_action := 'declared_value_modified';
  END IF;

  -- If parent shipment has paid coverage, handle billing
  IF v_shipment_coverage_type IN ('full_replacement_no_deductible', 'full_replacement_deductible') THEN
    -- Update item coverage type from pending to active
    UPDATE public.items
    SET coverage_type = v_shipment_coverage_type,
        coverage_selected_at = now(),
        coverage_selected_by = auth.uid()
    WHERE id = p_item_id;

    -- Get effective rate
    SELECT * INTO v_rates
    FROM public.get_coverage_rates(v_tenant_id, v_effective_account_id);

    IF v_shipment_coverage_type = 'full_replacement_no_deductible' THEN
      v_rate := COALESCE(v_rates.rate_full_no_deductible, 0.0188);
    ELSE
      v_rate := COALESCE(v_rates.rate_full_deductible, 0.0142);
    END IF;

    -- Calculate new premium
    v_new_premium := ROUND(p_declared_value * v_rate, 2);

    -- Calculate existing net (sum of all coverage events for this item)
    SELECT COALESCE(SUM(be.total_amount), 0)
    INTO v_existing_net
    FROM public.billing_events be
    WHERE be.item_id = p_item_id
      AND be.charge_type = 'handling_coverage'
      AND be.tenant_id = v_tenant_id;

    -- Calculate delta
    v_delta := ROUND(v_new_premium - v_existing_net, 2);

    -- Insert delta billing event if non-zero
    IF v_delta != 0 THEN
      INSERT INTO public.billing_events (
        tenant_id, account_id, item_id, sidemark_id, class_id,
        event_type, charge_type, description,
        quantity, unit_rate, total_amount,
        status, occurred_at, created_by, metadata
      ) VALUES (
        v_tenant_id,
        v_effective_account_id,
        p_item_id,
        v_item.sidemark_id,
        v_item.class_id,
        'coverage',
        'handling_coverage',
        CASE WHEN v_delta > 0
          THEN format('Coverage: %s on DV $%s', v_shipment_coverage_type, p_declared_value)
          ELSE format('Coverage adjustment: %s DV $%s→$%s', v_shipment_coverage_type, v_old_dv, p_declared_value)
        END,
        1,
        v_delta,
        v_delta,
        'unbilled',
        now(),
        auth.uid(),
        jsonb_build_object(
          'coverage_type', v_shipment_coverage_type,
          'rate', v_rate,
          'declared_value', p_declared_value,
          'previous_declared_value', v_old_dv,
          'delta', v_delta,
          'source', 'rpc_update_item_declared_value'
        )
      );
    END IF;
  ELSE
    -- No paid coverage on shipment; set item to standard
    UPDATE public.items
    SET coverage_type = 'standard'
    WHERE id = p_item_id AND coverage_type IS DISTINCT FROM 'standard';
  END IF;

  -- Write audit log
  INSERT INTO public.coverage_history (
    tenant_id, shipment_id, item_id, changed_by,
    action, old_declared_value, new_declared_value,
    old_coverage_type, new_coverage_type
  ) VALUES (
    v_tenant_id,
    v_shipment_id,
    p_item_id,
    auth.uid(),
    v_action,
    v_old_dv,
    p_declared_value,
    v_item.coverage_type,
    CASE WHEN v_shipment_coverage_type IN ('full_replacement_no_deductible', 'full_replacement_deductible')
      THEN v_shipment_coverage_type
      ELSE COALESCE(v_item.coverage_type, 'standard')
    END
  );

  RETURN jsonb_build_object(
    'success', true,
    'new_premium', COALESCE(v_new_premium, 0),
    'delta', COALESCE(v_delta, 0),
    'pending_removed', v_item.coverage_type = 'pending'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_update_item_declared_value(uuid, numeric) TO authenticated;

-- ============================================================================
-- 3.2 rpc_apply_shipment_coverage
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rpc_apply_shipment_coverage(
  p_shipment_id uuid,
  p_coverage_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_shipment RECORD;
  v_item RECORD;
  v_billed_count int := 0;
  v_pending_count int := 0;
  v_total_premium numeric := 0;
  v_rates RECORD;
  v_rate numeric;
  v_premium numeric;
  v_existing_net numeric;
  v_delta numeric;
BEGIN
  -- Validate coverage type
  IF p_coverage_type NOT IN ('full_replacement_no_deductible', 'full_replacement_deductible') THEN
    RAISE EXCEPTION 'Invalid coverage type. Must be a paid tier.';
  END IF;

  v_tenant_id := public.get_current_user_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: no tenant context';
  END IF;

  -- Load shipment
  SELECT s.id, s.account_id, s.coverage_type, s.shipment_number
  INTO v_shipment
  FROM public.shipments s
  WHERE s.id = p_shipment_id AND s.tenant_id = v_tenant_id;

  IF v_shipment IS NULL THEN
    RAISE EXCEPTION 'Shipment not found or access denied';
  END IF;

  -- Permission check
  PERFORM public._coverage_check_permission(v_shipment.account_id);

  -- Get effective rates
  SELECT * INTO v_rates
  FROM public.get_coverage_rates(v_tenant_id, v_shipment.account_id);

  IF p_coverage_type = 'full_replacement_no_deductible' THEN
    v_rate := COALESCE(v_rates.rate_full_no_deductible, 0.0188);
  ELSE
    v_rate := COALESCE(v_rates.rate_full_deductible, 0.0142);
  END IF;

  -- Update shipment
  UPDATE public.shipments
  SET coverage_type = p_coverage_type,
      coverage_selected_at = now(),
      coverage_selected_by = auth.uid(),
      -- Null deprecated columns
      coverage_premium = NULL,
      coverage_rate = NULL,
      coverage_declared_value = NULL,
      coverage_deductible = NULL,
      coverage_scope = NULL
  WHERE id = p_shipment_id;

  -- Write shipment-level audit
  INSERT INTO public.coverage_history (
    tenant_id, shipment_id, changed_by, action,
    old_coverage_type, new_coverage_type, note
  ) VALUES (
    v_tenant_id, p_shipment_id, auth.uid(), 'coverage_applied',
    v_shipment.coverage_type, p_coverage_type,
    format('Applied to shipment %s', v_shipment.shipment_number)
  );

  -- Process each item on this shipment
  FOR v_item IN
    SELECT i.id, i.declared_value, i.coverage_type, i.sidemark_id, i.class_id, i.account_id
    FROM public.items i
    WHERE i.receiving_shipment_id = p_shipment_id
      AND i.tenant_id = v_tenant_id
      AND i.deleted_at IS NULL
  LOOP
    IF v_item.declared_value IS NOT NULL AND v_item.declared_value > 0 THEN
      -- Item has DV: set active coverage and compute billing delta
      UPDATE public.items
      SET coverage_type = p_coverage_type,
          coverage_rate = v_rate,
          coverage_source = 'shipment',
          coverage_selected_at = now(),
          coverage_selected_by = auth.uid()
      WHERE id = v_item.id;

      -- Calculate premium
      v_premium := ROUND(v_item.declared_value * v_rate, 2);

      -- Get existing net for this item
      SELECT COALESCE(SUM(be.total_amount), 0)
      INTO v_existing_net
      FROM public.billing_events be
      WHERE be.item_id = v_item.id
        AND be.charge_type = 'handling_coverage'
        AND be.tenant_id = v_tenant_id;

      v_delta := ROUND(v_premium - v_existing_net, 2);

      IF v_delta != 0 THEN
        INSERT INTO public.billing_events (
          tenant_id, account_id, item_id, sidemark_id, class_id,
          event_type, charge_type, description,
          quantity, unit_rate, total_amount,
          status, occurred_at, created_by, metadata
        ) VALUES (
          v_tenant_id,
          COALESCE(v_shipment.account_id, v_item.account_id),
          v_item.id,
          v_item.sidemark_id,
          v_item.class_id,
          'coverage',
          'handling_coverage',
          format('Coverage: %s on DV $%s (%s)', p_coverage_type, v_item.declared_value, v_shipment.shipment_number),
          1,
          v_delta,
          v_delta,
          'unbilled',
          now(),
          auth.uid(),
          jsonb_build_object(
            'coverage_type', p_coverage_type,
            'rate', v_rate,
            'declared_value', v_item.declared_value,
            'source', 'rpc_apply_shipment_coverage'
          )
        );
      END IF;

      v_billed_count := v_billed_count + 1;
      v_total_premium := v_total_premium + v_premium;
    ELSE
      -- No DV: set pending
      UPDATE public.items
      SET coverage_type = 'pending',
          coverage_source = 'shipment',
          coverage_selected_at = now(),
          coverage_selected_by = auth.uid()
      WHERE id = v_item.id;

      v_pending_count := v_pending_count + 1;
    END IF;

    -- Per-item audit
    INSERT INTO public.coverage_history (
      tenant_id, shipment_id, item_id, changed_by, action,
      old_coverage_type, new_coverage_type
    ) VALUES (
      v_tenant_id, p_shipment_id, v_item.id, auth.uid(),
      CASE WHEN v_item.declared_value IS NOT NULL AND v_item.declared_value > 0
        THEN 'coverage_applied' ELSE 'coverage_applied'
      END,
      v_item.coverage_type,
      CASE WHEN v_item.declared_value IS NOT NULL AND v_item.declared_value > 0
        THEN p_coverage_type ELSE 'pending'
      END
    );
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'billed_count', v_billed_count,
    'pending_count', v_pending_count,
    'total_premium', v_total_premium,
    'coverage_type', p_coverage_type
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_apply_shipment_coverage(uuid, text) TO authenticated;

-- ============================================================================
-- 3.3 rpc_remove_shipment_coverage
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rpc_remove_shipment_coverage(
  p_shipment_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_shipment RECORD;
  v_item RECORD;
  v_deleted_count int := 0;
  v_rows_deleted int := 0;
  v_credited_amount numeric := 0;
BEGIN
  v_tenant_id := public.get_current_user_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: no tenant context';
  END IF;

  -- Load shipment
  SELECT s.id, s.account_id, s.coverage_type, s.shipment_number
  INTO v_shipment
  FROM public.shipments s
  WHERE s.id = p_shipment_id AND s.tenant_id = v_tenant_id;

  IF v_shipment IS NULL THEN
    RAISE EXCEPTION 'Shipment not found or access denied';
  END IF;

  PERFORM public._coverage_check_permission(v_shipment.account_id);

  -- Update shipment to standard
  UPDATE public.shipments
  SET coverage_type = 'standard',
      coverage_selected_at = now(),
      coverage_selected_by = auth.uid(),
      coverage_premium = NULL,
      coverage_rate = NULL,
      coverage_declared_value = NULL,
      coverage_deductible = NULL,
      coverage_scope = NULL
  WHERE id = p_shipment_id;

  -- Process each item: remove coverage, handle billing
  FOR v_item IN
    SELECT i.id, i.coverage_type, i.account_id, i.sidemark_id, i.class_id
    FROM public.items i
    WHERE i.receiving_shipment_id = p_shipment_id
      AND i.tenant_id = v_tenant_id
      AND i.deleted_at IS NULL
  LOOP
    -- Set item to standard
    UPDATE public.items
    SET coverage_type = 'standard',
        coverage_source = NULL
    WHERE id = v_item.id;

    -- Delete uninvoiced coverage events
    DELETE FROM public.billing_events
    WHERE item_id = v_item.id
      AND charge_type = 'handling_coverage'
      AND tenant_id = v_tenant_id
      AND invoice_id IS NULL
      AND invoiced_at IS NULL;

    GET DIAGNOSTICS v_rows_deleted = ROW_COUNT;
    v_deleted_count := v_deleted_count + v_rows_deleted;

    -- For invoiced events, create credit adjustments
    DECLARE
      v_invoiced_total numeric;
    BEGIN
      SELECT COALESCE(SUM(be.total_amount), 0)
      INTO v_invoiced_total
      FROM public.billing_events be
      WHERE be.item_id = v_item.id
        AND be.charge_type = 'handling_coverage'
        AND be.tenant_id = v_tenant_id
        AND (be.invoice_id IS NOT NULL OR be.invoiced_at IS NOT NULL);

      IF v_invoiced_total > 0 THEN
        INSERT INTO public.billing_events (
          tenant_id, account_id, item_id, sidemark_id, class_id,
          event_type, charge_type, description,
          quantity, unit_rate, total_amount,
          status, occurred_at, created_by, metadata
        ) VALUES (
          v_tenant_id,
          COALESCE(v_shipment.account_id, v_item.account_id),
          v_item.id,
          v_item.sidemark_id,
          v_item.class_id,
          'coverage',
          'handling_coverage',
          format('Coverage removal credit (%s)', v_shipment.shipment_number),
          1,
          -v_invoiced_total,
          -v_invoiced_total,
          'unbilled',
          now(),
          auth.uid(),
          jsonb_build_object(
            'source', 'rpc_remove_shipment_coverage',
            'is_credit', true,
            'original_invoiced_total', v_invoiced_total
          )
        );
        v_credited_amount := v_credited_amount + v_invoiced_total;
      END IF;
    END;

    -- Item-level audit
    INSERT INTO public.coverage_history (
      tenant_id, shipment_id, item_id, changed_by, action,
      old_coverage_type, new_coverage_type
    ) VALUES (
      v_tenant_id, p_shipment_id, v_item.id, auth.uid(), 'coverage_removed',
      v_item.coverage_type, 'standard'
    );
  END LOOP;

  -- Shipment-level audit
  INSERT INTO public.coverage_history (
    tenant_id, shipment_id, changed_by, action,
    old_coverage_type, new_coverage_type, note
  ) VALUES (
    v_tenant_id, p_shipment_id, auth.uid(), 'coverage_removed',
    v_shipment.coverage_type, 'standard',
    format('Removed from shipment %s', v_shipment.shipment_number)
  );

  RETURN jsonb_build_object(
    'success', true,
    'events_deleted', v_deleted_count,
    'credited_amount', v_credited_amount
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_remove_shipment_coverage(uuid) TO authenticated;

-- ============================================================================
-- 3.5 rpc_auto_apply_coverage_on_receipt
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rpc_auto_apply_coverage_on_receipt(
  p_shipment_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_shipment RECORD;
  v_account RECORD;
  v_result jsonb;
BEGIN
  v_tenant_id := public.get_current_user_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: no tenant context';
  END IF;

  -- Load shipment
  SELECT s.id, s.account_id, s.coverage_type, s.status
  INTO v_shipment
  FROM public.shipments s
  WHERE s.id = p_shipment_id AND s.tenant_id = v_tenant_id;

  IF v_shipment IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'shipment_not_found');
  END IF;

  -- Must be received status
  IF v_shipment.status != 'received' THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'not_received');
  END IF;

  -- Idempotent: if coverage already set (paid tier or even standard explicitly), do nothing
  IF v_shipment.coverage_type IS NOT NULL AND v_shipment.coverage_type != '' THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'coverage_already_set');
  END IF;

  -- Check account auto-apply settings
  SELECT a.auto_apply_coverage_on_receiving, a.default_coverage_type
  INTO v_account
  FROM public.accounts a
  WHERE a.id = v_shipment.account_id AND a.tenant_id = v_tenant_id;

  IF v_account IS NULL
     OR NOT COALESCE(v_account.auto_apply_coverage_on_receiving, false)
     OR v_account.default_coverage_type IS NULL
     OR v_account.default_coverage_type NOT IN ('full_replacement_no_deductible', 'full_replacement_deductible')
  THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'auto_apply_not_enabled');
  END IF;

  -- Apply coverage using the main RPC logic
  v_result := public.rpc_apply_shipment_coverage(p_shipment_id, v_account.default_coverage_type);

  RETURN jsonb_build_object(
    'applied', true,
    'coverage_type', v_account.default_coverage_type,
    'pending_count', (v_result->>'pending_count')::int,
    'billed_count', (v_result->>'billed_count')::int
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_auto_apply_coverage_on_receipt(uuid) TO authenticated;

-- ============================================================================
-- 3.6 rpc_set_account_auto_coverage
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rpc_set_account_auto_coverage(
  p_account_id uuid,
  p_enabled boolean,
  p_default_type text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_account RECORD;
BEGIN
  v_tenant_id := public.get_current_user_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: no tenant context';
  END IF;

  -- Load account
  SELECT a.id, a.tenant_id
  INTO v_account
  FROM public.accounts a
  WHERE a.id = p_account_id AND a.tenant_id = v_tenant_id;

  IF v_account IS NULL THEN
    RAISE EXCEPTION 'Account not found or access denied';
  END IF;

  -- Permission check
  PERFORM public._coverage_check_permission(p_account_id);

  -- Validate
  IF p_enabled AND (p_default_type IS NULL OR p_default_type NOT IN ('full_replacement_no_deductible', 'full_replacement_deductible')) THEN
    RAISE EXCEPTION 'When enabling auto-coverage, default_type must be a paid tier';
  END IF;

  IF NOT p_enabled THEN
    p_default_type := NULL;
  END IF;

  -- Update account
  UPDATE public.accounts
  SET auto_apply_coverage_on_receiving = p_enabled,
      default_coverage_type = p_default_type
  WHERE id = p_account_id;

  RETURN jsonb_build_object(
    'success', true,
    'auto_apply', p_enabled,
    'default_type', p_default_type
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_set_account_auto_coverage(uuid, boolean, text) TO authenticated;

-- ============================================================================
-- 3.7 rpc_preview_shipment_coverage_change
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rpc_preview_shipment_coverage_change(
  p_shipment_id uuid,
  p_new_type text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_shipment RECORD;
  v_rates RECORD;
  v_rate numeric;
  v_predicted_total numeric := 0;
  v_existing_net numeric := 0;
  v_item RECORD;
BEGIN
  v_tenant_id := public.get_current_user_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: no tenant context';
  END IF;

  SELECT s.id, s.account_id, s.coverage_type
  INTO v_shipment
  FROM public.shipments s
  WHERE s.id = p_shipment_id AND s.tenant_id = v_tenant_id;

  IF v_shipment IS NULL THEN
    RAISE EXCEPTION 'Shipment not found';
  END IF;

  PERFORM public._coverage_check_permission(v_shipment.account_id);

  -- Get existing net coverage billing
  SELECT COALESCE(SUM(be.total_amount), 0)
  INTO v_existing_net
  FROM public.billing_events be
  JOIN public.items i ON i.id = be.item_id
  WHERE i.receiving_shipment_id = p_shipment_id
    AND be.charge_type = 'handling_coverage'
    AND be.tenant_id = v_tenant_id;

  -- If removing (p_new_type is NULL or standard), predicted total = 0
  IF p_new_type IS NULL OR p_new_type = 'standard' THEN
    RETURN jsonb_build_object(
      'predicted_new_total', 0,
      'current_existing_net', v_existing_net,
      'predicted_delta', -v_existing_net
    );
  END IF;

  -- Get rates for new type
  SELECT * INTO v_rates
  FROM public.get_coverage_rates(v_tenant_id, v_shipment.account_id);

  IF p_new_type = 'full_replacement_no_deductible' THEN
    v_rate := COALESCE(v_rates.rate_full_no_deductible, 0.0188);
  ELSE
    v_rate := COALESCE(v_rates.rate_full_deductible, 0.0142);
  END IF;

  -- Sum predicted premiums for items with DV
  SELECT COALESCE(SUM(ROUND(i.declared_value * v_rate, 2)), 0)
  INTO v_predicted_total
  FROM public.items i
  WHERE i.receiving_shipment_id = p_shipment_id
    AND i.tenant_id = v_tenant_id
    AND i.deleted_at IS NULL
    AND i.declared_value IS NOT NULL
    AND i.declared_value > 0;

  RETURN jsonb_build_object(
    'predicted_new_total', v_predicted_total,
    'current_existing_net', v_existing_net,
    'predicted_delta', v_predicted_total - v_existing_net
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_preview_shipment_coverage_change(uuid, text) TO authenticated;

-- ============================================================================
-- 3.8 rpc_coverage_analytics
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rpc_coverage_analytics(
  p_date_from date DEFAULT (CURRENT_DATE - INTERVAL '30 days')::date,
  p_date_to date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_net_premium numeric;
  v_total_received int;
  v_covered_received int;
  v_total_dv numeric;
  v_pending_count int;
BEGIN
  v_tenant_id := public.get_current_user_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: no tenant context';
  END IF;

  -- Staff only
  IF NOT (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'tenant_admin')
    OR public.has_role(auth.uid(), 'manager')
  ) THEN
    RAISE EXCEPTION 'Forbidden: staff only';
  END IF;

  -- Net coverage premium billed in date range
  SELECT COALESCE(SUM(be.total_amount), 0)
  INTO v_net_premium
  FROM public.billing_events be
  WHERE be.tenant_id = v_tenant_id
    AND be.charge_type = 'handling_coverage'
    AND be.occurred_at >= p_date_from::timestamptz
    AND be.occurred_at < (p_date_to + 1)::timestamptz;

  -- Adoption rate
  SELECT COUNT(*)
  INTO v_total_received
  FROM public.shipments s
  WHERE s.tenant_id = v_tenant_id
    AND s.status IN ('received', 'completed')
    AND s.received_at >= p_date_from::timestamptz
    AND s.received_at < (p_date_to + 1)::timestamptz;

  SELECT COUNT(*)
  INTO v_covered_received
  FROM public.shipments s
  WHERE s.tenant_id = v_tenant_id
    AND s.status IN ('received', 'completed')
    AND s.coverage_type IN ('full_replacement_no_deductible', 'full_replacement_deductible')
    AND s.received_at >= p_date_from::timestamptz
    AND s.received_at < (p_date_to + 1)::timestamptz;

  -- Total declared value under paid coverage
  SELECT COALESCE(SUM(i.declared_value), 0)
  INTO v_total_dv
  FROM public.items i
  WHERE i.tenant_id = v_tenant_id
    AND i.coverage_type IN ('full_replacement_no_deductible', 'full_replacement_deductible')
    AND i.declared_value > 0
    AND i.deleted_at IS NULL;

  -- Pending DV count
  SELECT COUNT(*)
  INTO v_pending_count
  FROM public.items i
  WHERE i.tenant_id = v_tenant_id
    AND i.coverage_type = 'pending'
    AND i.deleted_at IS NULL;

  RETURN jsonb_build_object(
    'net_coverage_premium', v_net_premium,
    'total_received_shipments', v_total_received,
    'covered_received_shipments', v_covered_received,
    'adoption_rate', CASE WHEN v_total_received > 0
      THEN ROUND(v_covered_received::numeric / v_total_received, 4)
      ELSE 0
    END,
    'total_declared_value_under_coverage', v_total_dv,
    'pending_declared_value_items', v_pending_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_coverage_analytics(date, date) TO authenticated;

-- ============================================================================
-- Inline callout: rpc_cleanup_item_coverage_on_delete
-- Called when an item is soft-deleted from a covered shipment
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rpc_cleanup_item_coverage_on_delete(
  p_item_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_item RECORD;
  v_deleted_count int := 0;
  v_credited_amount numeric := 0;
  v_invoiced_total numeric;
BEGIN
  v_tenant_id := public.get_current_user_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: no tenant context';
  END IF;

  -- Load item
  SELECT i.id, i.coverage_type, i.account_id, i.receiving_shipment_id,
         i.sidemark_id, i.class_id
  INTO v_item
  FROM public.items i
  WHERE i.id = p_item_id AND i.tenant_id = v_tenant_id;

  IF v_item IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'item_not_found');
  END IF;

  -- Delete uninvoiced coverage events
  DELETE FROM public.billing_events
  WHERE item_id = p_item_id
    AND charge_type = 'handling_coverage'
    AND tenant_id = v_tenant_id
    AND invoice_id IS NULL
    AND invoiced_at IS NULL;

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

  -- Credit invoiced coverage events
  SELECT COALESCE(SUM(be.total_amount), 0)
  INTO v_invoiced_total
  FROM public.billing_events be
  WHERE be.item_id = p_item_id
    AND be.charge_type = 'handling_coverage'
    AND be.tenant_id = v_tenant_id
    AND (be.invoice_id IS NOT NULL OR be.invoiced_at IS NOT NULL);

  IF v_invoiced_total > 0 THEN
    INSERT INTO public.billing_events (
      tenant_id, account_id, item_id, sidemark_id, class_id,
      event_type, charge_type, description,
      quantity, unit_rate, total_amount,
      status, occurred_at, created_by, metadata
    ) VALUES (
      v_tenant_id,
      v_item.account_id,
      p_item_id,
      v_item.sidemark_id,
      v_item.class_id,
      'coverage',
      'handling_coverage',
      'Coverage credit: item deleted',
      1,
      -v_invoiced_total,
      -v_invoiced_total,
      'unbilled',
      now(),
      auth.uid(),
      jsonb_build_object(
        'source', 'rpc_cleanup_item_coverage_on_delete',
        'is_credit', true
      )
    );
    v_credited_amount := v_invoiced_total;
  END IF;

  -- Audit log
  INSERT INTO public.coverage_history (
    tenant_id, shipment_id, item_id, changed_by, action,
    old_coverage_type, new_coverage_type, note
  ) VALUES (
    v_tenant_id,
    v_item.receiving_shipment_id,
    p_item_id,
    auth.uid(),
    'coverage_removed',
    v_item.coverage_type,
    NULL,
    'Item deleted — coverage billing cleaned up'
  );

  RETURN jsonb_build_object(
    'success', true,
    'events_deleted', v_deleted_count,
    'credited_amount', v_credited_amount
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_cleanup_item_coverage_on_delete(uuid) TO authenticated;
