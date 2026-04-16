-- Fix admin_audit_log INSERT policy to allow all authenticated tenant users.
-- The previous policy restricted INSERT to admin/tenant_admin only, but
-- non-admin users also perform auditable actions (shipment edits, account
-- reassignment, item deletions) that write to this table.
-- The SELECT policy remains admin-only so only admins can review the log.

DROP POLICY IF EXISTS "Admin can insert audit log" ON public.admin_audit_log;

CREATE POLICY "Tenant users can insert audit log"
ON public.admin_audit_log FOR INSERT
TO authenticated
WITH CHECK (
  tenant_id IN (
    SELECT tenant_id FROM public.users WHERE id = auth.uid()
  )
);
