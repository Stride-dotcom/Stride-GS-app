-- =============================================================================
-- SMS Stripe billing integration: subscription items + usage sync tracking
-- Migration: 20260225114000_sms_stripe_billing_integration.sql
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Plan-level Stripe price IDs for SMS billing components
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.saas_plans
  ADD COLUMN IF NOT EXISTS stripe_price_id_sms_monthly_addon text,
  ADD COLUMN IF NOT EXISTS stripe_price_id_sms_segment_metered text;

COMMENT ON COLUMN public.saas_plans.stripe_price_id_sms_monthly_addon IS
'Stripe recurring price ID for tenant SMS monthly add-on fee.';
COMMENT ON COLUMN public.saas_plans.stripe_price_id_sms_segment_metered IS
'Stripe metered recurring price ID for tenant SMS per-segment usage.';

-- ---------------------------------------------------------------------------
-- 2) Tenant subscription tracking for SMS-related Stripe item IDs
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.tenant_subscriptions
  ADD COLUMN IF NOT EXISTS stripe_subscription_item_id_per_user text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_item_id_sms_monthly text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_item_id_sms_metered text,
  ADD COLUMN IF NOT EXISTS sms_subscription_items_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS sms_subscription_items_sync_error text;

COMMENT ON COLUMN public.tenant_subscriptions.stripe_subscription_item_id_per_user IS
'Stripe subscription item ID for seat-based billing price (if configured).';
COMMENT ON COLUMN public.tenant_subscriptions.stripe_subscription_item_id_sms_monthly IS
'Stripe subscription item ID for SMS monthly add-on recurring price.';
COMMENT ON COLUMN public.tenant_subscriptions.stripe_subscription_item_id_sms_metered IS
'Stripe subscription item ID for SMS per-segment metered recurring price.';
COMMENT ON COLUMN public.tenant_subscriptions.sms_subscription_items_synced_at IS
'Last successful synchronization timestamp for SMS Stripe subscription items.';
COMMENT ON COLUMN public.tenant_subscriptions.sms_subscription_items_sync_error IS
'Most recent SMS Stripe subscription item sync error, if any.';

-- ---------------------------------------------------------------------------
-- 3) Rollup-level Stripe sync status for per-segment billing reconciliation
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.sms_usage_daily_rollups
  ADD COLUMN IF NOT EXISTS stripe_sync_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS stripe_synced_segment_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stripe_last_sync_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS stripe_last_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS stripe_last_sync_error text,
  ADD COLUMN IF NOT EXISTS stripe_last_usage_record_id text;

DO $$
BEGIN
  IF to_regclass('public.sms_usage_daily_rollups') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
         FROM pg_constraint
        WHERE conname = 'sms_usage_daily_rollups_stripe_sync_status_check'
          AND conrelid = 'public.sms_usage_daily_rollups'::regclass
     )
  THEN
    ALTER TABLE public.sms_usage_daily_rollups
      ADD CONSTRAINT sms_usage_daily_rollups_stripe_sync_status_check
      CHECK (stripe_sync_status IN ('pending', 'synced', 'error', 'skipped'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_sms_usage_daily_rollups_stripe_sync_status
  ON public.sms_usage_daily_rollups (stripe_sync_status, usage_date DESC);

CREATE INDEX IF NOT EXISTS idx_sms_usage_daily_rollups_tenant_pending
  ON public.sms_usage_daily_rollups (tenant_id, usage_date ASC, direction)
  WHERE stripe_sync_status IN ('pending', 'error')
     OR segment_count <> stripe_synced_segment_count;

COMMENT ON COLUMN public.sms_usage_daily_rollups.stripe_sync_status IS
'Stripe sync status for this rollup row: pending/synced/error/skipped.';
COMMENT ON COLUMN public.sms_usage_daily_rollups.stripe_synced_segment_count IS
'Last segment count value successfully pushed to Stripe for this rollup row.';
COMMENT ON COLUMN public.sms_usage_daily_rollups.stripe_last_sync_attempt_at IS
'Most recent attempt timestamp to push this rollup row to Stripe usage records.';
COMMENT ON COLUMN public.sms_usage_daily_rollups.stripe_last_synced_at IS
'Last successful sync timestamp for this rollup row.';
COMMENT ON COLUMN public.sms_usage_daily_rollups.stripe_last_sync_error IS
'Most recent Stripe sync error for this rollup row.';
COMMENT ON COLUMN public.sms_usage_daily_rollups.stripe_last_usage_record_id IS
'Last Stripe usage record ID returned for this rollup row.';

-- ---------------------------------------------------------------------------
-- 4) Admin-dev rollup observability RPC (tenant + sync-state aware)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_admin_list_sms_usage_rollups(
  p_tenant_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 200
)
RETURNS TABLE (
  tenant_id uuid,
  tenant_name text,
  usage_date date,
  direction text,
  message_count integer,
  segment_count integer,
  twilio_exact_segment_count integer,
  estimated_segment_count integer,
  stripe_sync_status text,
  stripe_synced_segment_count integer,
  stripe_last_sync_attempt_at timestamptz,
  stripe_last_synced_at timestamptz,
  stripe_last_sync_error text,
  stripe_last_usage_record_id text,
  last_aggregated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer;
  v_is_service_role boolean := false;
BEGIN
  v_is_service_role := COALESCE(auth.jwt() ->> 'role', '') = 'service_role';
  IF NOT v_is_service_role AND NOT public.current_user_is_admin_dev() THEN
    RAISE EXCEPTION 'Only admin_dev or service_role can view SMS usage rollups';
  END IF;

  v_limit := LEAST(GREATEST(COALESCE(p_limit, 200), 1), 2000);

  RETURN QUERY
  SELECT
    r.tenant_id,
    COALESCE(NULLIF(BTRIM(tcs.company_name), ''), t.name, r.tenant_id::text) AS tenant_name,
    r.usage_date,
    r.direction,
    r.message_count,
    r.segment_count,
    r.twilio_exact_segment_count,
    r.estimated_segment_count,
    r.stripe_sync_status,
    r.stripe_synced_segment_count,
    r.stripe_last_sync_attempt_at,
    r.stripe_last_synced_at,
    r.stripe_last_sync_error,
    r.stripe_last_usage_record_id,
    r.last_aggregated_at
  FROM public.sms_usage_daily_rollups r
  LEFT JOIN public.tenants t
    ON t.id = r.tenant_id
  LEFT JOIN public.tenant_company_settings tcs
    ON tcs.tenant_id = r.tenant_id
  WHERE p_tenant_id IS NULL OR r.tenant_id = p_tenant_id
  ORDER BY r.usage_date DESC, r.last_aggregated_at DESC, r.tenant_id ASC
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_admin_list_sms_usage_rollups(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_admin_list_sms_usage_rollups(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_list_sms_usage_rollups(uuid, integer) TO service_role;

COMMENT ON FUNCTION public.rpc_admin_list_sms_usage_rollups(uuid, integer) IS
'Admin-dev/service-role view of SMS daily rollups with Stripe sync reconciliation fields.';
