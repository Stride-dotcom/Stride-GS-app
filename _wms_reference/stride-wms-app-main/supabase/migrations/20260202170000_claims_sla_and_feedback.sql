-- Phase 9: Claims SLA Tracking and AI Feedback Loop
-- Add SLA timers, feedback tracking, and insights support

-- 1) Add SLA configuration to organization_claim_settings
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'organization_claim_settings' AND column_name = 'enable_sla_tracking') THEN
    ALTER TABLE organization_claim_settings ADD COLUMN enable_sla_tracking BOOLEAN DEFAULT TRUE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'organization_claim_settings' AND column_name = 'sla_ack_minutes') THEN
    ALTER TABLE organization_claim_settings ADD COLUMN sla_ack_minutes INTEGER DEFAULT 0;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'organization_claim_settings' AND column_name = 'sla_initial_review_business_hours') THEN
    ALTER TABLE organization_claim_settings ADD COLUMN sla_initial_review_business_hours INTEGER DEFAULT 8;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'organization_claim_settings' AND column_name = 'sla_manual_review_business_hours') THEN
    ALTER TABLE organization_claim_settings ADD COLUMN sla_manual_review_business_hours INTEGER DEFAULT 16;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'organization_claim_settings' AND column_name = 'sla_auto_approved_payout_hours') THEN
    ALTER TABLE organization_claim_settings ADD COLUMN sla_auto_approved_payout_hours INTEGER DEFAULT 24;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'organization_claim_settings' AND column_name = 'sla_shipping_damage_packet_business_hours') THEN
    ALTER TABLE organization_claim_settings ADD COLUMN sla_shipping_damage_packet_business_hours INTEGER DEFAULT 16;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'organization_claim_settings' AND column_name = 'sla_public_report_business_hours') THEN
    ALTER TABLE organization_claim_settings ADD COLUMN sla_public_report_business_hours INTEGER DEFAULT 24;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'organization_claim_settings' AND column_name = 'sla_missing_docs_pause') THEN
    ALTER TABLE organization_claim_settings ADD COLUMN sla_missing_docs_pause BOOLEAN DEFAULT TRUE;
  END IF;
END$$;

-- 2) Add SLA tracking fields to claims table
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'claims' AND column_name = 'sla_stage') THEN
    ALTER TABLE claims ADD COLUMN sla_stage TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'claims' AND column_name = 'sla_due_at') THEN
    ALTER TABLE claims ADD COLUMN sla_due_at TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'claims' AND column_name = 'sla_status') THEN
    ALTER TABLE claims ADD COLUMN sla_status TEXT DEFAULT 'on_track'
      CHECK (sla_status IN ('on_track', 'due_soon', 'overdue', 'paused'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'claims' AND column_name = 'sla_paused_at') THEN
    ALTER TABLE claims ADD COLUMN sla_paused_at TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'claims' AND column_name = 'sla_pause_reason') THEN
    ALTER TABLE claims ADD COLUMN sla_pause_reason TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'claims' AND column_name = 'sla_total_paused_minutes') THEN
    ALTER TABLE claims ADD COLUMN sla_total_paused_minutes INTEGER DEFAULT 0;
  END IF;
END$$;

-- 3) Create claim_ai_feedback table for tracking decisions vs recommendations
CREATE TABLE IF NOT EXISTS claim_ai_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  claim_id UUID NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  analysis_id UUID REFERENCES claim_ai_analysis(id) ON DELETE SET NULL,

  -- Final outcome
  final_status TEXT NOT NULL,
  final_payout_amount NUMERIC(12,2),

  -- Decision tracking
  decision_source TEXT NOT NULL CHECK (decision_source IN ('system_auto', 'human_accept', 'human_override')),
  override_reason_code TEXT CHECK (override_reason_code IN (
    'missing_docs', 'customer_goodwill', 'exception', 'incorrect_input', 'policy_override', 'other'
  )),
  override_notes TEXT,

  -- Metrics
  delta_amount NUMERIC(12,2),

  -- Who decided
  decided_by UUID REFERENCES users(id),

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_claim_ai_feedback_tenant_claim ON claim_ai_feedback(tenant_id, claim_id);
CREATE INDEX IF NOT EXISTS idx_claim_ai_feedback_tenant_created ON claim_ai_feedback(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_claim_ai_feedback_decision_source ON claim_ai_feedback(decision_source);

-- RLS for claim_ai_feedback
ALTER TABLE claim_ai_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their tenant's claim feedback"
  ON claim_ai_feedback FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Users can insert their tenant's claim feedback"
  ON claim_ai_feedback FOR INSERT
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- 4) Create index for SLA queries on claims
CREATE INDEX IF NOT EXISTS idx_claims_sla_status ON claims(tenant_id, sla_status) WHERE sla_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_claims_sla_due ON claims(tenant_id, sla_due_at) WHERE sla_due_at IS NOT NULL;

-- 5) Add comments
COMMENT ON TABLE claim_ai_feedback IS 'Tracks final claim decisions vs AI recommendations for insights';
COMMENT ON COLUMN claims.sla_stage IS 'Current SLA stage: acknowledged, initial_review, auto_approved, manual_review, awaiting_customer, packet_preparation, report_ready';
COMMENT ON COLUMN claims.sla_due_at IS 'When current SLA stage is due';
COMMENT ON COLUMN claims.sla_status IS 'SLA status: on_track, due_soon, overdue, paused';
COMMENT ON COLUMN claims.sla_paused_at IS 'When SLA was paused (for pause duration calculation)';
COMMENT ON COLUMN claims.sla_total_paused_minutes IS 'Total accumulated pause time in minutes';
COMMENT ON COLUMN claim_ai_feedback.decision_source IS 'How decision was made: system_auto, human_accept, human_override';
COMMENT ON COLUMN claim_ai_feedback.delta_amount IS 'Difference between final payout and AI recommendation';

COMMENT ON COLUMN organization_claim_settings.enable_sla_tracking IS 'Enable SLA tracking for claims';
COMMENT ON COLUMN organization_claim_settings.sla_ack_minutes IS 'Minutes to acknowledge new claim (0=immediate)';
COMMENT ON COLUMN organization_claim_settings.sla_initial_review_business_hours IS 'Business hours to complete initial review';
COMMENT ON COLUMN organization_claim_settings.sla_manual_review_business_hours IS 'Business hours to complete manual review';
COMMENT ON COLUMN organization_claim_settings.sla_auto_approved_payout_hours IS 'Hours to process auto-approved payout';
COMMENT ON COLUMN organization_claim_settings.sla_shipping_damage_packet_business_hours IS 'Business hours to prepare shipping damage packet';
COMMENT ON COLUMN organization_claim_settings.sla_public_report_business_hours IS 'Business hours to generate public report';
COMMENT ON COLUMN organization_claim_settings.sla_missing_docs_pause IS 'Pause SLA when documents are missing';
