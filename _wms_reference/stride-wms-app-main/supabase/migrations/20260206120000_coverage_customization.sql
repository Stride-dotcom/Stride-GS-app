-- Add coverage customization fields to organization_claim_settings
-- Allows tenants to rename coverage type and customize the standard rate

ALTER TABLE organization_claim_settings
  ADD COLUMN IF NOT EXISTS coverage_display_name TEXT NOT NULL DEFAULT 'Valuation',
  ADD COLUMN IF NOT EXISTS coverage_rate_standard NUMERIC NOT NULL DEFAULT 0.60;

-- Add comment for documentation
COMMENT ON COLUMN organization_claim_settings.coverage_display_name IS 'Custom display name for coverage (e.g., Valuation, Insurance)';
COMMENT ON COLUMN organization_claim_settings.coverage_rate_standard IS 'Standard coverage rate per pound (default 60 cents/lb)';
