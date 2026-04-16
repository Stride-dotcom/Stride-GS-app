-- Promo Codes - Discount codes that can be assigned to accounts
-- This migration creates the base promo_codes table and required enums

-- Create enums for promo codes (IF NOT EXISTS pattern for safety)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'promo_discount_type') THEN
    CREATE TYPE promo_discount_type AS ENUM ('percentage', 'flat_rate');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'expiration_type') THEN
    CREATE TYPE expiration_type AS ENUM ('none', 'date');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'service_scope_type') THEN
    CREATE TYPE service_scope_type AS ENUM ('all', 'selected');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'usage_limit_type') THEN
    CREATE TYPE usage_limit_type AS ENUM ('unlimited', 'limited');
  END IF;
END $$;

-- Create the promo_codes table
CREATE TABLE IF NOT EXISTS promo_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  discount_type promo_discount_type NOT NULL,
  discount_value NUMERIC(10, 2) NOT NULL,
  expiration_type expiration_type NOT NULL DEFAULT 'none',
  expiration_date TIMESTAMPTZ,
  service_scope service_scope_type NOT NULL DEFAULT 'all',
  selected_services JSONB,
  usage_limit_type usage_limit_type NOT NULL DEFAULT 'unlimited',
  usage_limit INTEGER,
  usage_count INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  deleted_at TIMESTAMPTZ,

  -- Code must be unique within tenant (for non-deleted codes)
  CONSTRAINT promo_codes_unique_code UNIQUE (tenant_id, code)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_promo_codes_tenant ON promo_codes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_promo_codes_code ON promo_codes(tenant_id, code);
CREATE INDEX IF NOT EXISTS idx_promo_codes_active ON promo_codes(tenant_id, is_active) WHERE is_active = true AND deleted_at IS NULL;

-- Enable RLS
ALTER TABLE promo_codes ENABLE ROW LEVEL SECURITY;

-- RLS Policies for tenant isolation
CREATE POLICY "promo_codes_select" ON promo_codes
  FOR SELECT
  USING (tenant_id::text = auth.jwt() ->> 'tenant_id');

CREATE POLICY "promo_codes_insert" ON promo_codes
  FOR INSERT
  WITH CHECK (tenant_id::text = auth.jwt() ->> 'tenant_id');

CREATE POLICY "promo_codes_update" ON promo_codes
  FOR UPDATE
  USING (tenant_id::text = auth.jwt() ->> 'tenant_id');

CREATE POLICY "promo_codes_delete" ON promo_codes
  FOR DELETE
  USING (tenant_id::text = auth.jwt() ->> 'tenant_id');

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_promo_codes_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS promo_codes_updated_at ON promo_codes;
CREATE TRIGGER promo_codes_updated_at
  BEFORE UPDATE ON promo_codes
  FOR EACH ROW
  EXECUTE FUNCTION update_promo_codes_updated_at();

-- Comments
COMMENT ON TABLE promo_codes IS 'Promo codes that can be assigned to accounts for billing discounts';
COMMENT ON COLUMN promo_codes.code IS 'The promo code string (unique per tenant)';
COMMENT ON COLUMN promo_codes.discount_type IS 'Whether the discount is a percentage or flat rate';
COMMENT ON COLUMN promo_codes.discount_value IS 'The discount amount (percentage or flat rate value)';
COMMENT ON COLUMN promo_codes.expiration_type IS 'Whether the code expires or not';
COMMENT ON COLUMN promo_codes.service_scope IS 'Whether discount applies to all services or selected ones';
COMMENT ON COLUMN promo_codes.usage_limit_type IS 'Whether there is a usage limit per account';
COMMENT ON COLUMN promo_codes.usage_count IS 'Total times this code has been used';
