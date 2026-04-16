-- Add resend_domain_id column to store the Resend domain ID for verification
-- Also add columns to store the actual DNS records from Resend
ALTER TABLE public.communication_brand_settings 
  ADD COLUMN IF NOT EXISTS resend_domain_id TEXT,
  ADD COLUMN IF NOT EXISTS resend_dns_records JSONB;