-- Valuation Coverage Settings Migration
-- ============================================================================
-- Adds tenant-level and account-level coverage configuration
-- Coverage pricing is percentage-of-declared-value, NOT service-based
-- ============================================================================

-- 1. Add coverage settings to organization_claim_settings table
ALTER TABLE public.organization_claim_settings
ADD COLUMN IF NOT EXISTS coverage_enabled BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS coverage_default_type VARCHAR(50) DEFAULT 'standard',
ADD COLUMN IF NOT EXISTS coverage_rate_full_no_deductible NUMERIC(10,6) DEFAULT 0.0188,
ADD COLUMN IF NOT EXISTS coverage_rate_full_deductible NUMERIC(10,6) DEFAULT 0.0142,
ADD COLUMN IF NOT EXISTS coverage_deductible_amount NUMERIC(10,2) DEFAULT 300.00,
ADD COLUMN IF NOT EXISTS coverage_allow_shipment BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS coverage_allow_item BOOLEAN DEFAULT true;

-- Add comments for documentation
COMMENT ON COLUMN public.organization_claim_settings.coverage_enabled IS 'Master toggle for valuation coverage feature';
COMMENT ON COLUMN public.organization_claim_settings.coverage_default_type IS 'Default coverage type: standard, full_replacement_no_deductible, full_replacement_deductible';
COMMENT ON COLUMN public.organization_claim_settings.coverage_rate_full_no_deductible IS 'Rate multiplier for full replacement no deductible (default 1.88%)';
COMMENT ON COLUMN public.organization_claim_settings.coverage_rate_full_deductible IS 'Rate multiplier for full replacement with deductible (default 1.42%)';
COMMENT ON COLUMN public.organization_claim_settings.coverage_deductible_amount IS 'Deductible amount for full_replacement_deductible coverage';
COMMENT ON COLUMN public.organization_claim_settings.coverage_allow_shipment IS 'Allow shipment-level coverage selection';
COMMENT ON COLUMN public.organization_claim_settings.coverage_allow_item IS 'Allow item-level coverage selection';

-- 2. Create account_coverage_settings table for account-level overrides
CREATE TABLE IF NOT EXISTS public.account_coverage_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,

    -- Override toggle
    override_enabled BOOLEAN DEFAULT false,

    -- Coverage rates (only used if override_enabled = true)
    coverage_rate_full_no_deductible NUMERIC(10,6),
    coverage_rate_full_deductible NUMERIC(10,6),
    coverage_deductible_amount NUMERIC(10,2),

    -- Default coverage type for this account
    default_coverage_type VARCHAR(50),

    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    created_by UUID REFERENCES public.users(id),
    updated_by UUID REFERENCES public.users(id),

    -- Ensure one settings row per account
    UNIQUE(tenant_id, account_id)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_account_coverage_settings_account_id
ON public.account_coverage_settings(account_id);

-- Enable RLS
ALTER TABLE public.account_coverage_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "tenant_isolation_account_coverage_settings" ON public.account_coverage_settings
    FOR ALL USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- Add comments
COMMENT ON TABLE public.account_coverage_settings IS 'Account-level overrides for valuation coverage rates';
COMMENT ON COLUMN public.account_coverage_settings.override_enabled IS 'If true, use account rates instead of tenant defaults';

-- 3. Add coverage fields to shipments table for shipment-level coverage
ALTER TABLE public.shipments
ADD COLUMN IF NOT EXISTS coverage_type VARCHAR(50),
ADD COLUMN IF NOT EXISTS coverage_declared_value NUMERIC(12,2),
ADD COLUMN IF NOT EXISTS coverage_rate NUMERIC(10,6),
ADD COLUMN IF NOT EXISTS coverage_deductible NUMERIC(10,2),
ADD COLUMN IF NOT EXISTS coverage_premium NUMERIC(12,2),
ADD COLUMN IF NOT EXISTS coverage_selected_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS coverage_selected_by UUID REFERENCES public.users(id),
ADD COLUMN IF NOT EXISTS coverage_scope VARCHAR(20); -- 'shipment' or 'items'

COMMENT ON COLUMN public.shipments.coverage_type IS 'Coverage type: standard, full_replacement_no_deductible, full_replacement_deductible';
COMMENT ON COLUMN public.shipments.coverage_scope IS 'Coverage scope: shipment (entire shipment) or items (individual items selected)';

-- 4. Update items.coverage_type constraint to use canonical values
-- Note: This may have been done already, but ensure the constraint exists
DO $$
BEGIN
    -- Drop old constraint if exists
    ALTER TABLE public.items DROP CONSTRAINT IF EXISTS items_coverage_type_check;

    -- Add new constraint with canonical values
    ALTER TABLE public.items ADD CONSTRAINT items_coverage_type_check
    CHECK (coverage_type IN ('standard', 'full_replacement_no_deductible', 'full_replacement_deductible', 'pending'));
EXCEPTION
    WHEN others THEN
        RAISE NOTICE 'Could not update coverage_type constraint: %', SQLERRM;
END $$;

-- 5. Create a function to get effective coverage rates for an account
CREATE OR REPLACE FUNCTION get_coverage_rates(
    p_tenant_id UUID,
    p_account_id UUID DEFAULT NULL
) RETURNS TABLE (
    rate_full_no_deductible NUMERIC,
    rate_full_deductible NUMERIC,
    deductible_amount NUMERIC,
    source VARCHAR
) AS $$
DECLARE
    v_org_settings RECORD;
    v_account_settings RECORD;
BEGIN
    -- Get org-level settings (cast to handle potential type mismatches)
    SELECT
        coverage_rate_full_no_deductible,
        coverage_rate_full_deductible,
        coverage_deductible_amount
    INTO v_org_settings
    FROM organization_claim_settings
    WHERE tenant_id::text = p_tenant_id::text;

    -- If no account specified or no override, return org settings
    IF p_account_id IS NULL THEN
        RETURN QUERY SELECT
            COALESCE(v_org_settings.coverage_rate_full_no_deductible, 0.0188),
            COALESCE(v_org_settings.coverage_rate_full_deductible, 0.0142),
            COALESCE(v_org_settings.coverage_deductible_amount, 300.00),
            'tenant'::VARCHAR;
        RETURN;
    END IF;

    -- Check for account override (cast to handle potential type mismatches)
    SELECT
        override_enabled,
        coverage_rate_full_no_deductible,
        coverage_rate_full_deductible,
        coverage_deductible_amount
    INTO v_account_settings
    FROM account_coverage_settings
    WHERE tenant_id::text = p_tenant_id::text AND account_id::text = p_account_id::text;

    -- Return account rates if override is enabled
    IF v_account_settings.override_enabled THEN
        RETURN QUERY SELECT
            COALESCE(v_account_settings.coverage_rate_full_no_deductible, v_org_settings.coverage_rate_full_no_deductible, 0.0188),
            COALESCE(v_account_settings.coverage_rate_full_deductible, v_org_settings.coverage_rate_full_deductible, 0.0142),
            COALESCE(v_account_settings.coverage_deductible_amount, v_org_settings.coverage_deductible_amount, 300.00),
            'account'::VARCHAR;
    ELSE
        RETURN QUERY SELECT
            COALESCE(v_org_settings.coverage_rate_full_no_deductible, 0.0188),
            COALESCE(v_org_settings.coverage_rate_full_deductible, 0.0142),
            COALESCE(v_org_settings.coverage_deductible_amount, 300.00),
            'tenant'::VARCHAR;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_coverage_rates IS 'Get effective coverage rates for a tenant/account, respecting account overrides';
