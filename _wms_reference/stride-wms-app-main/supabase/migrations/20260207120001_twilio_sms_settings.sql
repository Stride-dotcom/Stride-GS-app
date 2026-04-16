-- Add Twilio SMS configuration columns to tenant_company_settings
ALTER TABLE tenant_company_settings
  ADD COLUMN IF NOT EXISTS twilio_account_sid    TEXT,
  ADD COLUMN IF NOT EXISTS twilio_messaging_service_sid TEXT,
  ADD COLUMN IF NOT EXISTS twilio_from_phone     TEXT,
  ADD COLUMN IF NOT EXISTS sms_sender_name       TEXT,
  ADD COLUMN IF NOT EXISTS sms_enabled           BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN tenant_company_settings.twilio_account_sid IS 'Twilio Account SID (starts with AC)';
COMMENT ON COLUMN tenant_company_settings.twilio_messaging_service_sid IS 'Twilio Messaging Service SID (starts with MG). Preferred over from-phone.';
COMMENT ON COLUMN tenant_company_settings.twilio_from_phone IS 'Twilio From phone number in E.164 format. Fallback if no Messaging Service.';
COMMENT ON COLUMN tenant_company_settings.sms_sender_name IS 'Optional display label for SMS sender (UI only).';
COMMENT ON COLUMN tenant_company_settings.sms_enabled IS 'Whether SMS sending is enabled for this tenant.';
