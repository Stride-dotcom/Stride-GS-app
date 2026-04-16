-- Fix tasks RLS policy - it incorrectly compares tenant_id to auth.uid() 
-- when it should compare to get_current_user_tenant_id()

-- Drop the incorrect policy
DROP POLICY IF EXISTS "Tenants see own tasks" ON public.tasks;

-- Create proper RLS policies for tasks table
CREATE POLICY "Users can view tasks in their tenant"
ON public.tasks FOR SELECT
TO authenticated
USING (tenant_id = public.get_current_user_tenant_id());

CREATE POLICY "Users can insert tasks in their tenant"
ON public.tasks FOR INSERT
TO authenticated
WITH CHECK (tenant_id = public.get_current_user_tenant_id());

CREATE POLICY "Users can update tasks in their tenant"
ON public.tasks FOR UPDATE
TO authenticated
USING (tenant_id = public.get_current_user_tenant_id());

CREATE POLICY "Users can delete tasks in their tenant"
ON public.tasks FOR DELETE
TO authenticated
USING (tenant_id = public.get_current_user_tenant_id());