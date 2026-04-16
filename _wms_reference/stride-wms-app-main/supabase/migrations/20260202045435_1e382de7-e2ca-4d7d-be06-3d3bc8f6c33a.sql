-- Fix 1: Add foreign key from claim_audit to users for actor_id
ALTER TABLE public.claim_audit 
ADD CONSTRAINT claim_audit_actor_id_fkey 
FOREIGN KEY (actor_id) REFERENCES auth.users(id);

-- Fix 2: Update documents INSERT policy to be more permissive for staff
-- Drop the existing restrictive policy
DROP POLICY IF EXISTS "Users can insert documents for their tenant" ON public.documents;

-- Create a more flexible INSERT policy
CREATE POLICY "Staff can insert documents for their tenant" 
ON public.documents 
FOR INSERT 
WITH CHECK (
  tenant_id = user_tenant_id() 
  AND (
    -- Either created_by matches the current user
    created_by = auth.uid()
    -- Or the user is staff (admin/manager)
    OR get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'manager'::text, 'tenant_admin'::text, 'warehouse'::text])
  )
);