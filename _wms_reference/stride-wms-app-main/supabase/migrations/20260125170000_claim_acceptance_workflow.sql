-- Claim Acceptance Workflow Migration
-- ================================================================================
-- Adds support for:
-- 1. Token-based public claim acceptance
-- 2. Settlement terms and acceptance tracking
-- 3. Payout method selection (credit/check/ACH)
-- 4. Decline with reason/counter functionality
-- 5. Approval thresholds at organization level
-- 6. Auto-create repair tasks after acceptance

-- 1. Add acceptance workflow fields to claims table
ALTER TABLE public.claims
  ADD COLUMN IF NOT EXISTS acceptance_token UUID DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS acceptance_token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS status_before_acceptance TEXT,
  ADD COLUMN IF NOT EXISTS sent_for_acceptance_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sent_for_acceptance_by UUID REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS payout_method TEXT DEFAULT 'credit',
  ADD COLUMN IF NOT EXISTS settlement_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS settlement_accepted_by UUID,
  ADD COLUMN IF NOT EXISTS settlement_accepted_ip TEXT,
  ADD COLUMN IF NOT EXISTS settlement_declined_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS settlement_declined_by UUID,
  ADD COLUMN IF NOT EXISTS decline_reason TEXT,
  ADD COLUMN IF NOT EXISTS counter_offer_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS counter_offer_notes TEXT,
  ADD COLUMN IF NOT EXISTS requires_admin_approval BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS admin_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS admin_approved_by UUID REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS admin_approval_notes TEXT,
  ADD COLUMN IF NOT EXISTS repair_task_created_id UUID;

-- Add unique index on acceptance_token for fast lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_claims_acceptance_token ON public.claims(acceptance_token) WHERE acceptance_token IS NOT NULL;

-- Add payout_method constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'claims_payout_method_check'
  ) THEN
    ALTER TABLE public.claims
      ADD CONSTRAINT claims_payout_method_check
      CHECK (payout_method IS NULL OR payout_method = ANY (ARRAY['credit', 'check', 'ach']));
  END IF;
END $$;

-- 2. Add new claim statuses for the acceptance workflow
-- Update the status field to allow new values
COMMENT ON COLUMN public.claims.status IS 'Claim status: initiated, under_review, pending_approval, pending_acceptance, accepted, declined, credited, paid, closed';

-- 3. Create organization claim settings table
CREATE TABLE IF NOT EXISTS public.organization_claim_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL UNIQUE REFERENCES public.tenants(id) ON DELETE CASCADE,

  -- Approval thresholds
  approval_threshold_amount NUMERIC(12,2) DEFAULT 1000.00,
  approval_required_above_threshold BOOLEAN DEFAULT true,

  -- Default payout method
  default_payout_method TEXT DEFAULT 'credit',

  -- Settlement terms template
  settlement_terms_template TEXT,

  -- Acceptance token expiry (in days)
  acceptance_token_expiry_days INTEGER DEFAULT 30,

  -- Auto-create repair task after acceptance
  auto_create_repair_task BOOLEAN DEFAULT true,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.organization_claim_settings ENABLE ROW LEVEL SECURITY;

-- RLS policies
DROP POLICY IF EXISTS "organization_claim_settings_tenant_select" ON public.organization_claim_settings;
CREATE POLICY "organization_claim_settings_tenant_select" ON public.organization_claim_settings
  FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "organization_claim_settings_tenant_insert" ON public.organization_claim_settings;
CREATE POLICY "organization_claim_settings_tenant_insert" ON public.organization_claim_settings
  FOR INSERT WITH CHECK (
    tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "organization_claim_settings_tenant_update" ON public.organization_claim_settings;
CREATE POLICY "organization_claim_settings_tenant_update" ON public.organization_claim_settings
  FOR UPDATE USING (
    tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid())
  );

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_organization_claim_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS organization_claim_settings_updated_at ON public.organization_claim_settings;
CREATE TRIGGER organization_claim_settings_updated_at
  BEFORE UPDATE ON public.organization_claim_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_organization_claim_settings_updated_at();

-- 4. Create claim acceptance log for audit trail
CREATE TABLE IF NOT EXISTS public.claim_acceptance_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  claim_id UUID NOT NULL REFERENCES public.claims(id) ON DELETE CASCADE,
  action TEXT NOT NULL, -- 'viewed', 'accepted', 'declined', 'counter_offered'
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_claim_acceptance_log_claim ON public.claim_acceptance_log(claim_id);

-- Enable RLS
ALTER TABLE public.claim_acceptance_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "claim_acceptance_log_tenant_select" ON public.claim_acceptance_log;
CREATE POLICY "claim_acceptance_log_tenant_select" ON public.claim_acceptance_log
  FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "claim_acceptance_log_insert" ON public.claim_acceptance_log;
CREATE POLICY "claim_acceptance_log_insert" ON public.claim_acceptance_log
  FOR INSERT WITH CHECK (true); -- Allow inserts from public (token-based access)

-- 5. Function to validate and get claim by acceptance token (public access)
CREATE OR REPLACE FUNCTION public.get_claim_by_acceptance_token(p_token UUID)
RETURNS TABLE (
  id UUID,
  tenant_id UUID,
  claim_number TEXT,
  claim_type TEXT,
  status TEXT,
  description TEXT,
  account_id UUID,
  account_name TEXT,
  total_approved_amount NUMERIC(12,2),
  settlement_terms_text TEXT,
  settlement_terms_version TEXT,
  payout_method TEXT,
  settlement_accepted_at TIMESTAMPTZ,
  settlement_declined_at TIMESTAMPTZ,
  acceptance_token_expires_at TIMESTAMPTZ,
  sent_for_acceptance_at TIMESTAMPTZ,
  item_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.tenant_id,
    c.claim_number,
    c.claim_type,
    c.status,
    c.description,
    c.account_id,
    a.account_name,
    c.total_approved_amount,
    c.settlement_terms_text,
    c.settlement_terms_version,
    c.payout_method,
    c.settlement_accepted_at,
    c.settlement_declined_at,
    c.acceptance_token_expires_at,
    c.sent_for_acceptance_at,
    (SELECT COUNT(*) FROM public.claim_items ci WHERE ci.claim_id = c.id)::BIGINT as item_count
  FROM public.claims c
  LEFT JOIN public.accounts a ON a.id = c.account_id
  WHERE c.acceptance_token = p_token
    AND c.deleted_at IS NULL
    AND (c.acceptance_token_expires_at IS NULL OR c.acceptance_token_expires_at > NOW());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Function to get claim items by acceptance token (public access)
CREATE OR REPLACE FUNCTION public.get_claim_items_by_acceptance_token(p_token UUID)
RETURNS TABLE (
  id UUID,
  item_code TEXT,
  description TEXT,
  coverage_type TEXT,
  declared_value NUMERIC(12,2),
  weight_lbs NUMERIC(10,2),
  approved_amount NUMERIC(12,2),
  repairable BOOLEAN,
  repair_cost NUMERIC(12,2),
  use_repair_cost BOOLEAN
) AS $$
DECLARE
  v_claim_id UUID;
BEGIN
  -- First get the claim_id from the token
  SELECT c.id INTO v_claim_id
  FROM public.claims c
  WHERE c.acceptance_token = p_token
    AND c.deleted_at IS NULL
    AND (c.acceptance_token_expires_at IS NULL OR c.acceptance_token_expires_at > NOW());

  IF v_claim_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    ci.id,
    i.item_code,
    i.description,
    ci.coverage_type,
    ci.declared_value,
    ci.weight_lbs,
    ci.approved_amount,
    ci.repairable,
    ci.repair_cost,
    ci.use_repair_cost
  FROM public.claim_items ci
  LEFT JOIN public.items i ON i.id = ci.item_id
  WHERE ci.claim_id = v_claim_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. Function to accept claim settlement (public access via token)
CREATE OR REPLACE FUNCTION public.accept_claim_settlement(
  p_token UUID,
  p_ip_address TEXT DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_claim RECORD;
  v_result JSONB;
BEGIN
  -- Get the claim
  SELECT * INTO v_claim
  FROM public.claims
  WHERE acceptance_token = p_token
    AND deleted_at IS NULL
    AND (acceptance_token_expires_at IS NULL OR acceptance_token_expires_at > NOW());

  IF v_claim IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid or expired acceptance token');
  END IF;

  IF v_claim.settlement_accepted_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Settlement has already been accepted');
  END IF;

  IF v_claim.settlement_declined_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Settlement has already been declined');
  END IF;

  -- Update the claim
  UPDATE public.claims
  SET
    settlement_accepted_at = NOW(),
    settlement_accepted_ip = p_ip_address,
    status = 'accepted'
  WHERE id = v_claim.id;

  -- Log the acceptance
  INSERT INTO public.claim_acceptance_log (tenant_id, claim_id, action, ip_address, user_agent)
  VALUES (v_claim.tenant_id, v_claim.id, 'accepted', p_ip_address, p_user_agent);

  -- Add audit entry
  INSERT INTO public.claim_audit (tenant_id, claim_id, action, details)
  VALUES (
    v_claim.tenant_id,
    v_claim.id,
    'settlement_accepted_by_client',
    jsonb_build_object('ip_address', p_ip_address, 'accepted_at', NOW())
  );

  RETURN jsonb_build_object(
    'success', true,
    'claim_id', v_claim.id,
    'claim_number', v_claim.claim_number
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. Function to decline claim settlement with optional counter offer (public access via token)
CREATE OR REPLACE FUNCTION public.decline_claim_settlement(
  p_token UUID,
  p_reason TEXT,
  p_counter_offer_amount NUMERIC DEFAULT NULL,
  p_counter_offer_notes TEXT DEFAULT NULL,
  p_ip_address TEXT DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_claim RECORD;
BEGIN
  -- Get the claim
  SELECT * INTO v_claim
  FROM public.claims
  WHERE acceptance_token = p_token
    AND deleted_at IS NULL
    AND (acceptance_token_expires_at IS NULL OR acceptance_token_expires_at > NOW());

  IF v_claim IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid or expired acceptance token');
  END IF;

  IF v_claim.settlement_accepted_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Settlement has already been accepted');
  END IF;

  -- Update the claim
  UPDATE public.claims
  SET
    settlement_declined_at = NOW(),
    decline_reason = p_reason,
    counter_offer_amount = p_counter_offer_amount,
    counter_offer_notes = p_counter_offer_notes,
    status = 'declined'
  WHERE id = v_claim.id;

  -- Log the decline
  INSERT INTO public.claim_acceptance_log (tenant_id, claim_id, action, ip_address, user_agent, metadata)
  VALUES (
    v_claim.tenant_id,
    v_claim.id,
    CASE WHEN p_counter_offer_amount IS NOT NULL THEN 'counter_offered' ELSE 'declined' END,
    p_ip_address,
    p_user_agent,
    jsonb_build_object(
      'reason', p_reason,
      'counter_offer_amount', p_counter_offer_amount,
      'counter_offer_notes', p_counter_offer_notes
    )
  );

  -- Add audit entry
  INSERT INTO public.claim_audit (tenant_id, claim_id, action, details)
  VALUES (
    v_claim.tenant_id,
    v_claim.id,
    CASE WHEN p_counter_offer_amount IS NOT NULL THEN 'settlement_countered_by_client' ELSE 'settlement_declined_by_client' END,
    jsonb_build_object(
      'reason', p_reason,
      'counter_offer_amount', p_counter_offer_amount,
      'counter_offer_notes', p_counter_offer_notes,
      'ip_address', p_ip_address
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'claim_id', v_claim.id,
    'claim_number', v_claim.claim_number,
    'action', CASE WHEN p_counter_offer_amount IS NOT NULL THEN 'counter_offered' ELSE 'declined' END
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 9. Function to send claim for acceptance (generates token and sets expiry)
CREATE OR REPLACE FUNCTION public.send_claim_for_acceptance(
  p_claim_id UUID,
  p_settlement_terms TEXT,
  p_payout_method TEXT DEFAULT 'credit',
  p_sent_by UUID DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_claim RECORD;
  v_settings RECORD;
  v_token UUID;
  v_expiry_days INTEGER;
BEGIN
  -- Get the claim
  SELECT * INTO v_claim
  FROM public.claims
  WHERE id = p_claim_id AND deleted_at IS NULL;

  IF v_claim IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Claim not found');
  END IF;

  -- Get organization settings for expiry days
  SELECT * INTO v_settings
  FROM public.organization_claim_settings
  WHERE tenant_id = v_claim.tenant_id;

  v_expiry_days := COALESCE(v_settings.acceptance_token_expiry_days, 30);

  -- Generate new token
  v_token := gen_random_uuid();

  -- Update the claim
  UPDATE public.claims
  SET
    acceptance_token = v_token,
    acceptance_token_expires_at = NOW() + (v_expiry_days || ' days')::INTERVAL,
    status_before_acceptance = status,
    status = 'pending_acceptance',
    sent_for_acceptance_at = NOW(),
    sent_for_acceptance_by = p_sent_by,
    settlement_terms_text = p_settlement_terms,
    settlement_terms_version = '1.0',
    payout_method = p_payout_method,
    settlement_acceptance_required = true
  WHERE id = p_claim_id;

  -- Add audit entry
  INSERT INTO public.claim_audit (tenant_id, claim_id, actor_id, action, details)
  VALUES (
    v_claim.tenant_id,
    p_claim_id,
    p_sent_by,
    'sent_for_acceptance',
    jsonb_build_object(
      'payout_method', p_payout_method,
      'expires_at', NOW() + (v_expiry_days || ' days')::INTERVAL
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'claim_id', p_claim_id,
    'acceptance_token', v_token,
    'expires_at', NOW() + (v_expiry_days || ' days')::INTERVAL
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 10. Grant execute permissions on public functions
GRANT EXECUTE ON FUNCTION public.get_claim_by_acceptance_token(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_claim_items_by_acceptance_token(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_claim_settlement(UUID, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decline_claim_settlement(UUID, TEXT, NUMERIC, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_claim_for_acceptance(UUID, TEXT, TEXT, UUID) TO authenticated;

-- 11. Add comments for documentation
COMMENT ON COLUMN public.claims.acceptance_token IS 'Unique token for public claim acceptance access';
COMMENT ON COLUMN public.claims.payout_method IS 'How the claim payout will be issued: credit (default), check, or ach';
COMMENT ON COLUMN public.claims.decline_reason IS 'Reason provided by client when declining settlement';
COMMENT ON COLUMN public.claims.counter_offer_amount IS 'Counter offer amount if client disagrees with determination';
COMMENT ON TABLE public.organization_claim_settings IS 'Per-tenant claim settings including approval thresholds and settlement templates';
COMMENT ON TABLE public.claim_acceptance_log IS 'Audit log for claim acceptance page views and actions';
