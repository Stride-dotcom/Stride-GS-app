-- =============================================================================
-- SaaS plan bootstrap + SMS billing backfill safety migration
-- Migration: 20260225132000_saas_plan_bootstrap_and_sms_billing_backfill.sql
-- =============================================================================
--
-- Purpose:
-- 1) If saas_plans is empty, create a default active plan row.
-- 2) Ensure SMS Stripe billing columns exist in case environments are behind.
-- 3) Backfill tenant_subscriptions.plan_id to the active/default plan when NULL.
-- 4) Default meter event name for SMS segments to "sms_segments".

-- ---------------------------------------------------------------------------
-- 1) Ensure plan-level SMS Stripe fields exist
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.saas_plans
  ADD COLUMN IF NOT EXISTS stripe_price_id_sms_monthly_addon text,
  ADD COLUMN IF NOT EXISTS stripe_price_id_sms_segment_metered text,
  ADD COLUMN IF NOT EXISTS stripe_meter_event_name_sms_segments text;

UPDATE public.saas_plans
   SET stripe_meter_event_name_sms_segments = COALESCE(
     NULLIF(BTRIM(stripe_meter_event_name_sms_segments), ''),
     'sms_segments'
   )
 WHERE COALESCE(BTRIM(stripe_meter_event_name_sms_segments), '') = '';

COMMENT ON COLUMN public.saas_plans.stripe_price_id_sms_monthly_addon IS
'Stripe recurring price ID for tenant SMS monthly add-on fee.';
COMMENT ON COLUMN public.saas_plans.stripe_price_id_sms_segment_metered IS
'Stripe usage-based/metered recurring price ID for SMS per-segment usage.';
COMMENT ON COLUMN public.saas_plans.stripe_meter_event_name_sms_segments IS
'Stripe billing meter event_name used for SMS segment usage reporting (default: sms_segments).';

-- ---------------------------------------------------------------------------
-- 2) Ensure tenant subscription SMS item sync fields exist
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.tenant_subscriptions
  ADD COLUMN IF NOT EXISTS stripe_subscription_item_id_per_user text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_item_id_sms_monthly text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_item_id_sms_metered text,
  ADD COLUMN IF NOT EXISTS sms_subscription_items_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS sms_subscription_items_sync_error text;

-- ---------------------------------------------------------------------------
-- 3) Ensure rollup Stripe sync reconciliation fields exist
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

-- ---------------------------------------------------------------------------
-- 4) Bootstrap default plan if table is empty + backfill tenant_subscriptions
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_default_base_price numeric := 0;
  v_default_plan_id uuid;
BEGIN
  -- saas_plans table may not exist in partial/older environments.
  IF to_regclass('public.saas_plans') IS NULL THEN
    RETURN;
  END IF;

  -- Pull a sensible default from current effective pricing, if available.
  BEGIN
    SELECT COALESCE(spv.app_monthly_fee, 0)
      INTO v_default_base_price
      FROM public.saas_pricing_versions spv
     ORDER BY spv.effective_from DESC
     LIMIT 1;
  EXCEPTION
    WHEN undefined_table THEN
      v_default_base_price := 0;
  END;

  -- If no rows exist, create a default active plan scaffold.
  INSERT INTO public.saas_plans (
    name,
    stripe_product_id,
    stripe_price_id_base,
    stripe_price_id_per_user,
    stripe_price_id_sms_monthly_addon,
    stripe_price_id_sms_segment_metered,
    stripe_meter_event_name_sms_segments,
    base_price,
    per_user_price,
    is_active
  )
  SELECT
    'Stride SaaS Default',
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    'sms_segments',
    COALESCE(v_default_base_price, 0),
    0,
    true
  WHERE NOT EXISTS (SELECT 1 FROM public.saas_plans);

  -- Resolve an active plan row. If none marked active, activate earliest row.
  SELECT p.id
    INTO v_default_plan_id
    FROM public.saas_plans p
   WHERE p.is_active = true
   ORDER BY p.created_at ASC, p.id ASC
   LIMIT 1;

  IF v_default_plan_id IS NULL THEN
    SELECT p.id
      INTO v_default_plan_id
      FROM public.saas_plans p
     ORDER BY p.created_at ASC, p.id ASC
     LIMIT 1;

    IF v_default_plan_id IS NOT NULL THEN
      UPDATE public.saas_plans
         SET is_active = true
       WHERE id = v_default_plan_id;
    END IF;
  END IF;

  -- Backfill existing tenant subscriptions that are missing plan_id.
  IF to_regclass('public.tenant_subscriptions') IS NOT NULL
     AND v_default_plan_id IS NOT NULL
  THEN
    UPDATE public.tenant_subscriptions
       SET plan_id = v_default_plan_id
     WHERE plan_id IS NULL;
  END IF;
END
$$;

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
