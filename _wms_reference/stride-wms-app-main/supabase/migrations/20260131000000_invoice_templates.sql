-- Invoice Templates - Store customizable invoice templates for each tenant
-- Supports the new WYSIWYG Template Editor with TipTap

-- Create the invoice_templates table
CREATE TABLE IF NOT EXISTS invoice_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  html_content TEXT NOT NULL,
  css_content TEXT,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_default BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id)
);

-- Create indexes for fast lookups
CREATE INDEX idx_invoice_templates_tenant ON invoice_templates(tenant_id);
CREATE INDEX idx_invoice_templates_default ON invoice_templates(tenant_id, is_default) WHERE is_default = true;
CREATE INDEX idx_invoice_templates_active ON invoice_templates(tenant_id, is_active) WHERE is_active = true;

-- Enable Row Level Security
ALTER TABLE invoice_templates ENABLE ROW LEVEL SECURITY;

-- RLS Policies for tenant isolation
CREATE POLICY "invoice_templates_select" ON invoice_templates
  FOR SELECT
  USING (tenant_id::text = auth.jwt() ->> 'tenant_id');

CREATE POLICY "invoice_templates_insert" ON invoice_templates
  FOR INSERT
  WITH CHECK (tenant_id::text = auth.jwt() ->> 'tenant_id');

CREATE POLICY "invoice_templates_update" ON invoice_templates
  FOR UPDATE
  USING (tenant_id::text = auth.jwt() ->> 'tenant_id');

CREATE POLICY "invoice_templates_delete" ON invoice_templates
  FOR DELETE
  USING (tenant_id::text = auth.jwt() ->> 'tenant_id');

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_invoice_templates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER invoice_templates_updated_at
  BEFORE UPDATE ON invoice_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_invoice_templates_updated_at();

-- Function to ensure only one default template per tenant
CREATE OR REPLACE FUNCTION ensure_single_default_invoice_template()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_default = true THEN
    -- Unset any existing default for this tenant
    UPDATE invoice_templates
    SET is_default = false
    WHERE tenant_id = NEW.tenant_id
    AND id != NEW.id
    AND is_default = true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ensure_single_default_invoice_template_trigger
  BEFORE INSERT OR UPDATE ON invoice_templates
  FOR EACH ROW
  WHEN (NEW.is_default = true)
  EXECUTE FUNCTION ensure_single_default_invoice_template();

-- Add brand_settings column to tenants table if it doesn't exist
-- This stores brand colors, logo URL, and other brand-specific settings
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tenants' AND column_name = 'brand_settings'
  ) THEN
    ALTER TABLE tenants ADD COLUMN brand_settings JSONB DEFAULT '{}'::jsonb;
  END IF;
END $$;

-- Comments for documentation
COMMENT ON TABLE invoice_templates IS 'Stores customizable invoice templates for each tenant. Supports WYSIWYG editing with the Template Editor.';
COMMENT ON COLUMN invoice_templates.html_content IS 'The HTML content of the template, including tokens like {{invoice_number}}';
COMMENT ON COLUMN invoice_templates.css_content IS 'Optional CSS styles for the template';
COMMENT ON COLUMN invoice_templates.settings IS 'JSON settings including colors, typography, tableColumns, pageSetup, and contentOptions';
COMMENT ON COLUMN invoice_templates.is_default IS 'Whether this is the default template for the tenant. Only one template can be default per tenant.';
