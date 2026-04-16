-- Promo Code Usages - Track per-account promo code usage
-- Usage limits apply per account group (parent + sub-accounts count as one)

CREATE TABLE IF NOT EXISTS promo_code_usages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promo_code_id UUID NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
  -- Store the root account (parent if sub-account, or self if no parent)
  root_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- The actual account that used it (may be a sub-account)
  used_by_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  billing_event_id UUID REFERENCES billing_events(id) ON DELETE SET NULL,
  used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_by UUID REFERENCES auth.users(id),

  -- Indexes for fast lookups
  CONSTRAINT unique_usage_per_event UNIQUE(promo_code_id, billing_event_id)
);

-- Enable RLS
ALTER TABLE promo_code_usages ENABLE ROW LEVEL SECURITY;

-- RLS Policies (use IF NOT EXISTS pattern)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'promo_code_usages_tenant_access' AND tablename = 'promo_code_usages'
  ) THEN
    CREATE POLICY "promo_code_usages_tenant_access" ON promo_code_usages
      FOR ALL
      USING (
        EXISTS (
          SELECT 1 FROM promo_codes pc
          WHERE pc.id = promo_code_usages.promo_code_id
          AND pc.tenant_id::text = auth.jwt() ->> 'tenant_id'
        )
      );
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_promo_code_usages_promo ON promo_code_usages(promo_code_id);
CREATE INDEX IF NOT EXISTS idx_promo_code_usages_root_account ON promo_code_usages(root_account_id);
CREATE INDEX IF NOT EXISTS idx_promo_code_usages_lookup ON promo_code_usages(promo_code_id, root_account_id);

-- Function to get the root account ID (parent if exists, otherwise self)
CREATE OR REPLACE FUNCTION get_root_account_id(p_account_id UUID)
RETURNS UUID AS $$
DECLARE
  v_parent_id UUID;
BEGIN
  SELECT parent_account_id INTO v_parent_id
  FROM accounts
  WHERE id = p_account_id;

  IF v_parent_id IS NOT NULL THEN
    RETURN v_parent_id;
  ELSE
    RETURN p_account_id;
  END IF;
END;
$$ LANGUAGE plpgsql STABLE;

-- Function to count usages for an account group (parent + all sub-accounts)
CREATE OR REPLACE FUNCTION get_promo_usage_count(p_promo_code_id UUID, p_account_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_root_id UUID;
  v_count INTEGER;
BEGIN
  -- Get the root account (parent or self)
  v_root_id := get_root_account_id(p_account_id);

  -- Count usages for this root account
  SELECT COUNT(*) INTO v_count
  FROM promo_code_usages
  WHERE promo_code_id = p_promo_code_id
  AND root_account_id = v_root_id;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql STABLE;

-- Comments
COMMENT ON TABLE promo_code_usages IS 'Tracks promo code usage per account group. Usage limits apply to parent account + all sub-accounts as one unit.';
COMMENT ON COLUMN promo_code_usages.root_account_id IS 'The parent account ID, or the account itself if no parent. Used for grouping sub-account usage.';
