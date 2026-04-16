-- =============================================================================
-- SAAS Pricing Console + Subscription Invoice Visibility
-- Migration: 20260215043000_saas_pricing_console_and_subscription_invoices.sql
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Global pricing versions (effective-dated)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.saas_pricing_versions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  effective_from         timestamptz NOT NULL,
  app_monthly_fee        numeric NOT NULL CHECK (app_monthly_fee >= 0),
  sms_monthly_addon_fee  numeric NOT NULL CHECK (sms_monthly_addon_fee >= 0),
  sms_segment_fee        numeric NOT NULL CHECK (sms_segment_fee >= 0),
  notes                  text,
  created_by             uuid REFERENCES auth.users(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_saas_pricing_versions_effective_from
  ON public.saas_pricing_versions (effective_from DESC);

DROP TRIGGER IF EXISTS set_saas_pricing_versions_updated_at ON public.saas_pricing_versions;
CREATE TRIGGER set_saas_pricing_versions_updated_at
  BEFORE UPDATE ON public.saas_pricing_versions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.saas_pricing_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "saas_pricing_versions_select_admin_dev" ON public.saas_pricing_versions;
CREATE POLICY "saas_pricing_versions_select_admin_dev"
  ON public.saas_pricing_versions FOR SELECT
  TO authenticated
  USING (public.current_user_is_admin_dev());

DROP POLICY IF EXISTS "saas_pricing_versions_write_admin_dev" ON public.saas_pricing_versions;
CREATE POLICY "saas_pricing_versions_write_admin_dev"
  ON public.saas_pricing_versions FOR ALL
  TO authenticated
  USING (public.current_user_is_admin_dev())
  WITH CHECK (public.current_user_is_admin_dev());

-- ---------------------------------------------------------------------------
-- 2) Pricing notice dispatch audit log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.saas_pricing_notice_dispatches (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pricing_version_id uuid NOT NULL REFERENCES public.saas_pricing_versions(id) ON DELETE CASCADE,
  notice_type        text NOT NULL CHECK (notice_type IN ('upcoming', 'effective_today')),
  recipient_count    integer NOT NULL DEFAULT 0,
  sent_by            uuid REFERENCES auth.users(id),
  sent_at            timestamptz NOT NULL DEFAULT now(),
  metadata           jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_saas_pricing_notice_dispatches_sent_at
  ON public.saas_pricing_notice_dispatches (sent_at DESC);

ALTER TABLE public.saas_pricing_notice_dispatches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "saas_pricing_notice_dispatches_select_admin_dev" ON public.saas_pricing_notice_dispatches;
CREATE POLICY "saas_pricing_notice_dispatches_select_admin_dev"
  ON public.saas_pricing_notice_dispatches FOR SELECT
  TO authenticated
  USING (public.current_user_is_admin_dev());

DROP POLICY IF EXISTS "saas_pricing_notice_dispatches_insert_admin_dev" ON public.saas_pricing_notice_dispatches;
CREATE POLICY "saas_pricing_notice_dispatches_insert_admin_dev"
  ON public.saas_pricing_notice_dispatches FOR INSERT
  TO authenticated
  WITH CHECK (public.current_user_is_admin_dev());

-- ---------------------------------------------------------------------------
-- 3) Tenant-visible Stripe subscription invoice snapshots
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenant_subscription_invoices (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  stripe_invoice_id     text NOT NULL UNIQUE,
  stripe_customer_id    text,
  stripe_subscription_id text,
  status                text NOT NULL,
  currency              text,
  amount_due            numeric NOT NULL DEFAULT 0,
  amount_paid           numeric NOT NULL DEFAULT 0,
  amount_remaining      numeric NOT NULL DEFAULT 0,
  hosted_invoice_url    text,
  invoice_pdf           text,
  period_start          timestamptz,
  period_end            timestamptz,
  due_date              timestamptz,
  paid_at               timestamptz,
  stripe_created_at     timestamptz,
  metadata              jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenant_subscription_invoices_tenant_created
  ON public.tenant_subscription_invoices (tenant_id, stripe_created_at DESC, created_at DESC);

DROP TRIGGER IF EXISTS set_tenant_subscription_invoices_updated_at ON public.tenant_subscription_invoices;
CREATE TRIGGER set_tenant_subscription_invoices_updated_at
  BEFORE UPDATE ON public.tenant_subscription_invoices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.tenant_subscription_invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_subscription_invoices_select_own" ON public.tenant_subscription_invoices;
CREATE POLICY "tenant_subscription_invoices_select_own"
  ON public.tenant_subscription_invoices FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.user_tenant_id()
    OR public.current_user_is_admin_dev()
  );

-- ---------------------------------------------------------------------------
-- 4) RPC: effective pricing resolver (by timestamp)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_get_effective_saas_pricing(
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.saas_pricing_versions%ROWTYPE;
BEGIN
  SELECT *
    INTO v_row
    FROM public.saas_pricing_versions
   WHERE effective_from <= COALESCE(p_at, now())
   ORDER BY effective_from DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'id', NULL,
      'effective_from', NULL,
      'app_monthly_fee', 0,
      'sms_monthly_addon_fee', 0,
      'sms_segment_fee', 0,
      'notes', NULL
    );
  END IF;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'effective_from', v_row.effective_from,
    'app_monthly_fee', v_row.app_monthly_fee,
    'sms_monthly_addon_fee', v_row.sms_monthly_addon_fee,
    'sms_segment_fee', v_row.sms_segment_fee,
    'notes', v_row.notes
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_get_effective_saas_pricing(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_get_effective_saas_pricing(timestamptz) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5) RPC: service-role upsert for Stripe subscription invoice snapshots
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_upsert_subscription_invoice_from_stripe(
  p_tenant_id uuid,
  p_stripe_invoice_id text,
  p_stripe_customer_id text DEFAULT NULL,
  p_stripe_subscription_id text DEFAULT NULL,
  p_status text DEFAULT 'draft',
  p_currency text DEFAULT NULL,
  p_amount_due numeric DEFAULT 0,
  p_amount_paid numeric DEFAULT 0,
  p_amount_remaining numeric DEFAULT 0,
  p_hosted_invoice_url text DEFAULT NULL,
  p_invoice_pdf text DEFAULT NULL,
  p_period_start timestamptz DEFAULT NULL,
  p_period_end timestamptz DEFAULT NULL,
  p_due_date timestamptz DEFAULT NULL,
  p_paid_at timestamptz DEFAULT NULL,
  p_stripe_created_at timestamptz DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'p_tenant_id is required';
  END IF;

  IF COALESCE(BTRIM(p_stripe_invoice_id), '') = '' THEN
    RAISE EXCEPTION 'p_stripe_invoice_id is required';
  END IF;

  INSERT INTO public.tenant_subscription_invoices (
    tenant_id,
    stripe_invoice_id,
    stripe_customer_id,
    stripe_subscription_id,
    status,
    currency,
    amount_due,
    amount_paid,
    amount_remaining,
    hosted_invoice_url,
    invoice_pdf,
    period_start,
    period_end,
    due_date,
    paid_at,
    stripe_created_at,
    metadata
  ) VALUES (
    p_tenant_id,
    BTRIM(p_stripe_invoice_id),
    NULLIF(BTRIM(p_stripe_customer_id), ''),
    NULLIF(BTRIM(p_stripe_subscription_id), ''),
    COALESCE(NULLIF(BTRIM(p_status), ''), 'draft'),
    CASE WHEN p_currency IS NULL THEN NULL ELSE UPPER(BTRIM(p_currency)) END,
    COALESCE(p_amount_due, 0),
    COALESCE(p_amount_paid, 0),
    COALESCE(p_amount_remaining, 0),
    NULLIF(BTRIM(p_hosted_invoice_url), ''),
    NULLIF(BTRIM(p_invoice_pdf), ''),
    p_period_start,
    p_period_end,
    p_due_date,
    p_paid_at,
    p_stripe_created_at,
    COALESCE(p_metadata, '{}'::jsonb)
  )
  ON CONFLICT (stripe_invoice_id) DO UPDATE SET
    tenant_id              = EXCLUDED.tenant_id,
    stripe_customer_id     = COALESCE(EXCLUDED.stripe_customer_id, tenant_subscription_invoices.stripe_customer_id),
    stripe_subscription_id = COALESCE(EXCLUDED.stripe_subscription_id, tenant_subscription_invoices.stripe_subscription_id),
    status                 = EXCLUDED.status,
    currency               = COALESCE(EXCLUDED.currency, tenant_subscription_invoices.currency),
    amount_due             = EXCLUDED.amount_due,
    amount_paid            = EXCLUDED.amount_paid,
    amount_remaining       = EXCLUDED.amount_remaining,
    hosted_invoice_url     = COALESCE(EXCLUDED.hosted_invoice_url, tenant_subscription_invoices.hosted_invoice_url),
    invoice_pdf            = COALESCE(EXCLUDED.invoice_pdf, tenant_subscription_invoices.invoice_pdf),
    period_start           = COALESCE(EXCLUDED.period_start, tenant_subscription_invoices.period_start),
    period_end             = COALESCE(EXCLUDED.period_end, tenant_subscription_invoices.period_end),
    due_date               = COALESCE(EXCLUDED.due_date, tenant_subscription_invoices.due_date),
    paid_at                = COALESCE(EXCLUDED.paid_at, tenant_subscription_invoices.paid_at),
    stripe_created_at      = COALESCE(EXCLUDED.stripe_created_at, tenant_subscription_invoices.stripe_created_at),
    metadata               = COALESCE(EXCLUDED.metadata, tenant_subscription_invoices.metadata);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_upsert_subscription_invoice_from_stripe(
  uuid, text, text, text, text, text, numeric, numeric, numeric, text, text, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_upsert_subscription_invoice_from_stripe(
  uuid, text, text, text, text, text, numeric, numeric, numeric, text, text, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, jsonb
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_upsert_subscription_invoice_from_stripe(
  uuid, text, text, text, text, text, numeric, numeric, numeric, text, text, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, jsonb
) TO service_role;

COMMENT ON TABLE public.saas_pricing_versions IS 'Global app+SMS pricing versions with effective dates.';
COMMENT ON TABLE public.saas_pricing_notice_dispatches IS 'Audit log of bulk pricing notice dispatches sent to subscriber billing contacts.';
COMMENT ON TABLE public.tenant_subscription_invoices IS 'Tenant-visible snapshots of Stripe SaaS subscription invoices.';
COMMENT ON FUNCTION public.rpc_get_effective_saas_pricing(timestamptz) IS 'Resolve effective global SaaS pricing version for a given timestamp.';
COMMENT ON FUNCTION public.rpc_upsert_subscription_invoice_from_stripe(
  uuid, text, text, text, text, text, numeric, numeric, numeric, text, text, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, jsonb
) IS 'Service-role upsert of Stripe subscription invoice snapshots into tenant_subscription_invoices.';

