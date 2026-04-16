-- Add use_default_email column to communication_brand_settings
-- This allows tenants to choose between using the default noreply email or their own custom domain

ALTER TABLE public.communication_brand_settings
  ADD COLUMN IF NOT EXISTS use_default_email BOOLEAN DEFAULT true;

-- Update existing records: if they have a verified custom domain, set to false; otherwise true
UPDATE public.communication_brand_settings
SET use_default_email = NOT email_domain_verified
WHERE use_default_email IS NULL;

COMMENT ON COLUMN public.communication_brand_settings.use_default_email IS 'If true, emails are sent from the default noreply address. If false, uses custom_email_domain.';
