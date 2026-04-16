-- ============================================================================
-- Admin Stripe Ops tenant snapshot RPC
-- Adds a tenant-selectable snapshot payload for /admin/stripe-ops.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.rpc_admin_get_tenant_stripe_ops_snapshot(
  p_tenant_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_status text := 'none';
  v_is_active boolean := true;
  v_is_in_grace boolean := false;
  v_is_restricted boolean := false;
  v_comped_raw boolean := false;
  v_comped_expires timestamptz;
  v_is_comped_active boolean := false;
  v_sub record;
BEGIN
  IF NOT public.current_user_is_admin_dev() THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'TENANT_ID_REQUIRED';
  END IF;

  SELECT bo.is_comped, bo.expires_at
    INTO v_comped_raw, v_comped_expires
  FROM public.tenant_billing_overrides bo
  WHERE bo.tenant_id = p_tenant_id;

  v_is_comped_active := COALESCE(v_comped_raw, false)
    AND (v_comped_expires IS NULL OR v_comped_expires > v_now);

  SELECT
    ts.tenant_id,
    ts.status,
    ts.current_period_end,
    ts.grace_until,
    ts.cancel_at_period_end,
    ts.last_payment_failed_at,
    ts.updated_at,
    ts.stripe_customer_id,
    ts.stripe_subscription_id,
    sp.name AS plan_name,
    sp.stripe_product_id,
    sp.stripe_price_id_base,
    sp.stripe_price_id_per_user
  INTO v_sub
  FROM public.tenant_subscriptions ts
  LEFT JOIN public.saas_plans sp
    ON sp.id = ts.plan_id
  WHERE ts.tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    IF v_is_comped_active THEN
      v_status := 'comped';
    END IF;

    RETURN jsonb_build_object(
      'found', false,
      'tenant_id', p_tenant_id,
      'status', v_status,
      'is_active', true,
      'is_in_grace', false,
      'is_restricted', false,
      'is_comped', v_is_comped_active,
      'comp_expires_at', v_comped_expires
    );
  END IF;

  v_status := COALESCE(v_sub.status, 'none');

  IF v_is_comped_active THEN
    v_status := 'comped';
    v_is_active := true;
    v_is_in_grace := false;
    v_is_restricted := false;
  ELSIF v_status = 'active' THEN
    v_is_active := true;
    v_is_in_grace := false;
    v_is_restricted := false;
  ELSIF v_sub.grace_until IS NOT NULL AND v_sub.grace_until > v_now THEN
    v_is_active := true;
    v_is_in_grace := true;
    v_is_restricted := false;
  ELSE
    v_is_active := false;
    v_is_in_grace := false;
    v_is_restricted := true;
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'tenant_id', p_tenant_id,
    'status', v_status,
    'is_active', v_is_active,
    'is_in_grace', v_is_in_grace,
    'is_restricted', v_is_restricted,
    'is_comped', v_is_comped_active,
    'comp_expires_at', v_comped_expires,
    'grace_until', v_sub.grace_until,
    'stripe_customer_id', v_sub.stripe_customer_id,
    'stripe_subscription_id', v_sub.stripe_subscription_id,
    'current_period_end', v_sub.current_period_end,
    'cancel_at_period_end', COALESCE(v_sub.cancel_at_period_end, false),
    'last_payment_failed_at', v_sub.last_payment_failed_at,
    'updated_at', v_sub.updated_at,
    'plan_name', v_sub.plan_name,
    'stripe_product_id', v_sub.stripe_product_id,
    'stripe_price_id_base', v_sub.stripe_price_id_base,
    'stripe_price_id_per_user', v_sub.stripe_price_id_per_user
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_admin_get_tenant_stripe_ops_snapshot(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_admin_get_tenant_stripe_ops_snapshot(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_get_tenant_stripe_ops_snapshot(uuid) TO authenticated;

