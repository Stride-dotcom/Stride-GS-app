-- Add office_alert_emails to tenant_company_settings
ALTER TABLE public.tenant_company_settings
ADD COLUMN IF NOT EXISTS office_alert_emails text DEFAULT NULL;

COMMENT ON COLUMN public.tenant_company_settings.office_alert_emails IS 'Comma-separated list of email addresses for internal office alerts (fallback recipient for all alert types)';
