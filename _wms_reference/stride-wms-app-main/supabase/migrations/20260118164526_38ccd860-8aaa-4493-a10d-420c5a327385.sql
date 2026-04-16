-- Drop existing restrictive RLS policy that uses session variable
DROP POLICY IF EXISTS "Tenants can manage their own accounts" ON public.accounts;

-- Create new RLS policies that work with client-side auth
-- Users can view accounts belonging to their tenant
CREATE POLICY "Users can view their tenant accounts" 
ON public.accounts 
FOR SELECT 
USING (
  tenant_id IN (
    SELECT u.tenant_id FROM public.users u WHERE u.id = auth.uid()
  )
);

-- Users can insert accounts into their own tenant
CREATE POLICY "Users can insert accounts in their tenant" 
ON public.accounts 
FOR INSERT 
WITH CHECK (
  tenant_id IN (
    SELECT u.tenant_id FROM public.users u WHERE u.id = auth.uid()
  )
);

-- Users can update accounts in their tenant
CREATE POLICY "Users can update their tenant accounts" 
ON public.accounts 
FOR UPDATE 
USING (
  tenant_id IN (
    SELECT u.tenant_id FROM public.users u WHERE u.id = auth.uid()
  )
);

-- Users can delete accounts in their tenant
CREATE POLICY "Users can delete their tenant accounts" 
ON public.accounts 
FOR DELETE 
USING (
  tenant_id IN (
    SELECT u.tenant_id FROM public.users u WHERE u.id = auth.uid()
  )
);