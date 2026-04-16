-- SMS Consent Tracking
-- Tracks per-phone-number opt-in/opt-out status for TCPA compliance
-- and Twilio toll-free verification requirements.

-- 1. Add SMS compliance message templates and toll-free verification fields to tenant_company_settings
ALTER TABLE tenant_company_settings
  ADD COLUMN IF NOT EXISTS sms_opt_in_message TEXT,
  ADD COLUMN IF NOT EXISTS sms_help_message TEXT,
  ADD COLUMN IF NOT EXISTS sms_stop_message TEXT,
  ADD COLUMN IF NOT EXISTS sms_opt_in_keywords TEXT DEFAULT 'YES, OK, ACCEPT, APPROVE',
  ADD COLUMN IF NOT EXISTS sms_privacy_policy_url TEXT,
  ADD COLUMN IF NOT EXISTS sms_terms_conditions_url TEXT,
  ADD COLUMN IF NOT EXISTS sms_use_case_description TEXT,
  ADD COLUMN IF NOT EXISTS sms_sample_message TEXT,
  ADD COLUMN IF NOT EXISTS sms_estimated_monthly_volume TEXT,
  ADD COLUMN IF NOT EXISTS sms_opt_in_type TEXT,
  ADD COLUMN IF NOT EXISTS sms_use_case_categories TEXT,
  ADD COLUMN IF NOT EXISTS sms_notification_email TEXT,
  ADD COLUMN IF NOT EXISTS sms_proof_of_consent_url TEXT,
  ADD COLUMN IF NOT EXISTS sms_additional_info TEXT;

COMMENT ON COLUMN tenant_company_settings.sms_opt_in_message
  IS 'Confirmation message sent when a recipient opts in to SMS notifications.';
COMMENT ON COLUMN tenant_company_settings.sms_help_message
  IS 'Response message sent when a recipient texts HELP.';
COMMENT ON COLUMN tenant_company_settings.sms_stop_message
  IS 'Confirmation message sent when a recipient texts STOP to opt out.';
COMMENT ON COLUMN tenant_company_settings.sms_opt_in_keywords
  IS 'Comma-separated keywords that trigger opt-in (e.g. YES, OK, ACCEPT, APPROVE).';
COMMENT ON COLUMN tenant_company_settings.sms_privacy_policy_url
  IS 'URL to the company privacy policy for Twilio toll-free verification.';
COMMENT ON COLUMN tenant_company_settings.sms_terms_conditions_url
  IS 'URL to the company terms and conditions for Twilio toll-free verification.';
COMMENT ON COLUMN tenant_company_settings.sms_use_case_description
  IS 'Description of how SMS is used, for Twilio toll-free verification.';
COMMENT ON COLUMN tenant_company_settings.sms_sample_message
  IS 'Example SMS message content for Twilio toll-free verification.';
COMMENT ON COLUMN tenant_company_settings.sms_estimated_monthly_volume
  IS 'Estimated monthly SMS volume for Twilio toll-free verification.';
COMMENT ON COLUMN tenant_company_settings.sms_opt_in_type
  IS 'How opt-in consent is collected (e.g. Via Text, Web Form, Verbal).';
COMMENT ON COLUMN tenant_company_settings.sms_use_case_categories
  IS 'Comma-separated use case categories (e.g. Delivery Notifications, Account Notifications).';
COMMENT ON COLUMN tenant_company_settings.sms_notification_email
  IS 'Email address for Twilio verification notifications.';
COMMENT ON COLUMN tenant_company_settings.sms_proof_of_consent_url
  IS 'URL where proof of opt-in consent is collected.';
COMMENT ON COLUMN tenant_company_settings.sms_additional_info
  IS 'Additional information for Twilio toll-free verification.';

-- 2. Create sms_consent table
CREATE TABLE IF NOT EXISTS sms_consent (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  phone_number  TEXT NOT NULL,
  account_id    UUID REFERENCES accounts(id) ON DELETE SET NULL,
  contact_name  TEXT,
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('opted_in', 'opted_out', 'pending')),
  consent_method TEXT
                  CHECK (consent_method IS NULL OR consent_method IN (
                    'text_keyword', 'web_form', 'verbal', 'admin_manual', 'imported'
                  )),
  opted_in_at   TIMESTAMPTZ,
  opted_out_at  TIMESTAMPTZ,
  last_keyword  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID REFERENCES auth.users(id),

  UNIQUE (tenant_id, phone_number)
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_sms_consent_tenant_phone
  ON sms_consent(tenant_id, phone_number);

CREATE INDEX IF NOT EXISTS idx_sms_consent_tenant_account
  ON sms_consent(tenant_id, account_id);

CREATE INDEX IF NOT EXISTS idx_sms_consent_status
  ON sms_consent(tenant_id, status);

-- 3. RLS policies
ALTER TABLE sms_consent ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation for sms_consent"
  ON sms_consent
  FOR ALL
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()))
  WITH CHECK (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- 4. Updated_at trigger
CREATE OR REPLACE FUNCTION update_sms_consent_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sms_consent_updated_at
  BEFORE UPDATE ON sms_consent
  FOR EACH ROW
  EXECUTE FUNCTION update_sms_consent_updated_at();

-- 5. Audit log table for consent changes (TCPA compliance)
CREATE TABLE IF NOT EXISTS sms_consent_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  consent_id    UUID NOT NULL REFERENCES sms_consent(id) ON DELETE CASCADE,
  phone_number  TEXT NOT NULL,
  action        TEXT NOT NULL CHECK (action IN ('opt_in', 'opt_out', 'status_change', 'created')),
  method        TEXT,
  keyword       TEXT,
  previous_status TEXT,
  new_status    TEXT,
  actor_user_id UUID REFERENCES auth.users(id),
  actor_name    TEXT,
  ip_address    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE sms_consent_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation for sms_consent_log"
  ON sms_consent_log
  FOR ALL
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()))
  WITH CHECK (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_sms_consent_log_consent_id
  ON sms_consent_log(consent_id);

CREATE INDEX IF NOT EXISTS idx_sms_consent_log_tenant
  ON sms_consent_log(tenant_id, created_at DESC);
