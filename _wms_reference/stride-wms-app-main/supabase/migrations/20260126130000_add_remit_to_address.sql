-- Add remit to address fields to tenant_company_settings
-- These fields are used for payment remittance instructions on invoices

ALTER TABLE public.tenant_company_settings
ADD COLUMN IF NOT EXISTS remit_address_line1 TEXT,
ADD COLUMN IF NOT EXISTS remit_address_line2 TEXT,
ADD COLUMN IF NOT EXISTS remit_city TEXT,
ADD COLUMN IF NOT EXISTS remit_state TEXT,
ADD COLUMN IF NOT EXISTS remit_zip TEXT;

-- Add helpful comments
COMMENT ON COLUMN public.tenant_company_settings.remit_address_line1 IS 'Remit to address line 1';
COMMENT ON COLUMN public.tenant_company_settings.remit_address_line2 IS 'Remit to address line 2';
COMMENT ON COLUMN public.tenant_company_settings.remit_city IS 'Remit to city';
COMMENT ON COLUMN public.tenant_company_settings.remit_state IS 'Remit to state';
COMMENT ON COLUMN public.tenant_company_settings.remit_zip IS 'Remit to zip code';
