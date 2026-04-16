-- Migration 1: Enable RLS and add policies for tables missing RLS (ERROR level)

-- Enable RLS on account_rate_overrides
ALTER TABLE public.account_rate_overrides ENABLE ROW LEVEL SECURITY;

-- Enable RLS on custom_billing_charges  
ALTER TABLE public.custom_billing_charges ENABLE ROW LEVEL SECURITY;

-- RLS Policies for account_rate_overrides
CREATE POLICY "Users can view account_rate_overrides in their tenant"
ON public.account_rate_overrides FOR SELECT
TO authenticated
USING (tenant_id = public.get_current_user_tenant_id());

CREATE POLICY "Admins can insert account_rate_overrides"
ON public.account_rate_overrides FOR INSERT
TO authenticated
WITH CHECK (tenant_id = public.get_current_user_tenant_id() AND public.is_tenant_admin());

CREATE POLICY "Admins can update account_rate_overrides"
ON public.account_rate_overrides FOR UPDATE
TO authenticated
USING (tenant_id = public.get_current_user_tenant_id() AND public.is_tenant_admin());

CREATE POLICY "Admins can delete account_rate_overrides"
ON public.account_rate_overrides FOR DELETE
TO authenticated
USING (tenant_id = public.get_current_user_tenant_id() AND public.is_tenant_admin());

-- RLS Policies for custom_billing_charges
CREATE POLICY "Users can view custom_billing_charges in their tenant"
ON public.custom_billing_charges FOR SELECT
TO authenticated
USING (tenant_id = public.get_current_user_tenant_id());

CREATE POLICY "Users can insert custom_billing_charges in their tenant"
ON public.custom_billing_charges FOR INSERT
TO authenticated
WITH CHECK (tenant_id = public.get_current_user_tenant_id());

CREATE POLICY "Users can update custom_billing_charges in their tenant"
ON public.custom_billing_charges FOR UPDATE
TO authenticated
USING (tenant_id = public.get_current_user_tenant_id());

CREATE POLICY "Admins can delete custom_billing_charges"
ON public.custom_billing_charges FOR DELETE
TO authenticated
USING (tenant_id = public.get_current_user_tenant_id() AND public.is_tenant_admin());