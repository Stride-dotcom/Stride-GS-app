-- Drop existing policies that use incorrect tenant check
DROP POLICY IF EXISTS "invoice_templates_select" ON public.invoice_templates;
DROP POLICY IF EXISTS "invoice_templates_insert" ON public.invoice_templates;
DROP POLICY IF EXISTS "invoice_templates_update" ON public.invoice_templates;
DROP POLICY IF EXISTS "invoice_templates_delete" ON public.invoice_templates;

-- Create new policies using the correct user_tenant_id() function
CREATE POLICY "invoice_templates_select" 
ON public.invoice_templates 
FOR SELECT 
USING (tenant_id = public.user_tenant_id());

CREATE POLICY "invoice_templates_insert" 
ON public.invoice_templates 
FOR INSERT 
WITH CHECK (tenant_id = public.user_tenant_id());

CREATE POLICY "invoice_templates_update" 
ON public.invoice_templates 
FOR UPDATE 
USING (tenant_id = public.user_tenant_id());

CREATE POLICY "invoice_templates_delete" 
ON public.invoice_templates 
FOR DELETE 
USING (tenant_id = public.user_tenant_id());