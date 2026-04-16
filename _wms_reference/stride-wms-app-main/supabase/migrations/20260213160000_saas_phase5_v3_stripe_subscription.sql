-- =============================================================================
-- STRIDE SAAS PHASE 5 v3 — Stripe Subscription Automation
-- Migration: 20260213160000_saas_phase5_v3_stripe_subscription.sql
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) saas_plans — GLOBAL table (no tenant_id)
-- ---------------------------------------------------------------------------
CREATE TABLE public.saas_plans (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text        NOT NULL,
  stripe_product_id      text,
  stripe_price_id_base   text,
  stripe_price_id_per_user text,
  base_price    numeric     NOT NULL DEFAULT 0,
  per_user_price numeric   NOT NULL DEFAULT 0,
  is_active     boolean     NOT NULL DEFAULT true,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

-- Attach existing set_updated_at trigger
CREATE TRIGGER set_saas_plans_updated_at
  BEFORE UPDATE ON public.saas_plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.saas_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "saas_plans_select_active"
  ON public.saas_plans FOR SELECT
  TO authenticated
  USING (is_active = true);

CREATE POLICY "saas_plans_write_admin_dev"
  ON public.saas_plans FOR ALL
  TO authenticated
  USING (public.current_user_is_admin_dev())
  WITH CHECK (public.current_user_is_admin_dev());

-- ---------------------------------------------------------------------------
-- 2) tenant_subscriptions — TENANT table (tenant_id is PK)
-- ---------------------------------------------------------------------------
CREATE TABLE public.tenant_subscriptions (
  tenant_id               uuid        PRIMARY KEY REFERENCES public.tenants(id),
  stripe_customer_id      text,
  stripe_subscription_id  text,
  plan_id                 uuid        REFERENCES public.saas_plans(id),
  status                  text        NOT NULL DEFAULT 'inactive',
  current_period_end      timestamptz,
  cancel_at_period_end    boolean     DEFAULT false,
  base_price_override     numeric,
  per_user_override       numeric,
  promo_expiration_date   date,
  last_payment_failed_at  timestamptz,
  grace_until             timestamptz,
  created_at              timestamptz DEFAULT now(),
  updated_at              timestamptz DEFAULT now()
);

-- Attach existing set_updated_at trigger
CREATE TRIGGER set_tenant_subscriptions_updated_at
  BEFORE UPDATE ON public.tenant_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.tenant_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_subscriptions_select_own"
  ON public.tenant_subscriptions FOR SELECT
  TO authenticated
  USING (tenant_id = public.user_tenant_id());

-- No client write policies — writes only via service_role RPCs

-- ---------------------------------------------------------------------------
-- 3) RPC: rpc_get_my_subscription_gate()
--    Callable by authenticated users. FAIL-OPEN for Phase 5.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_get_my_subscription_gate()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_status    text;
  v_grace     timestamptz;
BEGIN
  v_tenant_id := public.user_tenant_id();

  SELECT ts.status, ts.grace_until
    INTO v_status, v_grace
    FROM public.tenant_subscriptions ts
   WHERE ts.tenant_id = v_tenant_id;

  -- FAIL-OPEN: no subscription row means tenant is active
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status',        'none',
      'is_active',     true,
      'is_in_grace',   false,
      'is_restricted', false
    );
  END IF;

  -- Active subscription
  IF v_status = 'active' THEN
    RETURN jsonb_build_object(
      'status',        v_status,
      'is_active',     true,
      'is_in_grace',   false,
      'is_restricted', false
    );
  END IF;

  -- In grace period
  IF v_grace IS NOT NULL AND v_grace > now() THEN
    RETURN jsonb_build_object(
      'status',        v_status,
      'is_active',     true,
      'is_in_grace',   true,
      'is_restricted', false,
      'grace_until',   v_grace
    );
  END IF;

  -- Restricted (past grace or cancelled/inactive with no grace)
  RETURN jsonb_build_object(
    'status',        v_status,
    'is_active',     false,
    'is_in_grace',   false,
    'is_restricted', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_get_my_subscription_gate() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_get_my_subscription_gate() TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) SERVICE-ROLE ONLY RPCs
-- ---------------------------------------------------------------------------

-- 4a) rpc_initialize_tenant_subscription_from_checkout
CREATE OR REPLACE FUNCTION public.rpc_initialize_tenant_subscription_from_checkout(
  p_tenant_id              uuid,
  p_stripe_customer_id     text,
  p_stripe_subscription_id text,
  p_plan_id                uuid DEFAULT NULL,
  p_current_period_end     timestamptz DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.tenant_subscriptions (
    tenant_id,
    stripe_customer_id,
    stripe_subscription_id,
    plan_id,
    status,
    current_period_end
  ) VALUES (
    p_tenant_id,
    p_stripe_customer_id,
    p_stripe_subscription_id,
    p_plan_id,
    'active',
    p_current_period_end
  )
  ON CONFLICT (tenant_id) DO UPDATE SET
    stripe_customer_id     = EXCLUDED.stripe_customer_id,
    stripe_subscription_id = EXCLUDED.stripe_subscription_id,
    plan_id                = COALESCE(EXCLUDED.plan_id, tenant_subscriptions.plan_id),
    status                 = 'active',
    current_period_end     = COALESCE(EXCLUDED.current_period_end, tenant_subscriptions.current_period_end),
    last_payment_failed_at = NULL,
    grace_until            = NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_initialize_tenant_subscription_from_checkout(uuid, text, text, uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_initialize_tenant_subscription_from_checkout(uuid, text, text, uuid, timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_initialize_tenant_subscription_from_checkout(uuid, text, text, uuid, timestamptz) TO service_role;

-- 4b) rpc_upsert_tenant_subscription_from_stripe
CREATE OR REPLACE FUNCTION public.rpc_upsert_tenant_subscription_from_stripe(
  p_tenant_id              uuid,
  p_stripe_customer_id     text,
  p_stripe_subscription_id text,
  p_status                 text,
  p_current_period_end     timestamptz DEFAULT NULL,
  p_cancel_at_period_end   boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.tenant_subscriptions (
    tenant_id,
    stripe_customer_id,
    stripe_subscription_id,
    status,
    current_period_end,
    cancel_at_period_end
  ) VALUES (
    p_tenant_id,
    p_stripe_customer_id,
    p_stripe_subscription_id,
    p_status,
    p_current_period_end,
    p_cancel_at_period_end
  )
  ON CONFLICT (tenant_id) DO UPDATE SET
    stripe_customer_id     = EXCLUDED.stripe_customer_id,
    stripe_subscription_id = EXCLUDED.stripe_subscription_id,
    status                 = EXCLUDED.status,
    current_period_end     = COALESCE(EXCLUDED.current_period_end, tenant_subscriptions.current_period_end),
    cancel_at_period_end   = EXCLUDED.cancel_at_period_end;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_upsert_tenant_subscription_from_stripe(uuid, text, text, text, timestamptz, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_upsert_tenant_subscription_from_stripe(uuid, text, text, text, timestamptz, boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_upsert_tenant_subscription_from_stripe(uuid, text, text, text, timestamptz, boolean) TO service_role;

-- 4c) rpc_mark_payment_failed_and_start_grace
CREATE OR REPLACE FUNCTION public.rpc_mark_payment_failed_and_start_grace(
  p_stripe_subscription_id text,
  p_grace_days             integer DEFAULT 7
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.tenant_subscriptions
     SET status                 = 'past_due',
         last_payment_failed_at = now(),
         grace_until            = now() + (p_grace_days || ' days')::interval
   WHERE stripe_subscription_id = p_stripe_subscription_id;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_mark_payment_failed_and_start_grace(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_mark_payment_failed_and_start_grace(text, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_mark_payment_failed_and_start_grace(text, integer) TO service_role;

-- 4d) rpc_mark_payment_ok
CREATE OR REPLACE FUNCTION public.rpc_mark_payment_ok(
  p_stripe_subscription_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.tenant_subscriptions
     SET status                 = 'active',
         last_payment_failed_at = NULL,
         grace_until            = NULL
   WHERE stripe_subscription_id = p_stripe_subscription_id;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_mark_payment_ok(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_mark_payment_ok(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_mark_payment_ok(text) TO service_role;
