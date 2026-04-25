-- ============================================================
-- Fix critical RLS policy gaps on Stax tables, billing_activity_log,
-- and service_catalog_audit.
--
-- Problem: *_service_role_all policies on Stax tables omit TO service_role,
-- defaulting to PUBLIC — any authenticated user gets full CRUD.
-- billing_activity_log SELECT is open to anon/public.
-- service_catalog_audit INSERT allows any authenticated user to forge rows.
--
-- 2026-04-24 PST — Security fix from code review
-- ============================================================

-- ═══════════ Fix 1: Stax tables — add TO service_role ═══════════

-- stax_invoices
DROP POLICY IF EXISTS "stax_invoices_service_role_all" ON public.stax_invoices;
CREATE POLICY "stax_invoices_service_role_all" ON public.stax_invoices
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- stax_charges
DROP POLICY IF EXISTS "stax_charges_service_role_all" ON public.stax_charges;
CREATE POLICY "stax_charges_service_role_all" ON public.stax_charges
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- stax_exceptions
DROP POLICY IF EXISTS "stax_exceptions_service_role_all" ON public.stax_exceptions;
CREATE POLICY "stax_exceptions_service_role_all" ON public.stax_exceptions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- stax_customers
DROP POLICY IF EXISTS "stax_customers_service_role_all" ON public.stax_customers;
CREATE POLICY "stax_customers_service_role_all" ON public.stax_customers
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- stax_run_log
DROP POLICY IF EXISTS "stax_run_log_service_role_all" ON public.stax_run_log;
CREATE POLICY "stax_run_log_service_role_all" ON public.stax_run_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);


-- ═══════════ Fix 2: billing_activity_log — restrict SELECT ═══════════
-- Was: USING (true) with no role restriction → anon could read all billing data.
-- Now: admin/staff see all; clients see only their own tenant.

DROP POLICY IF EXISTS bal_select ON public.billing_activity_log;
CREATE POLICY bal_select ON public.billing_activity_log
  FOR SELECT TO authenticated
  USING (
    (auth.jwt()->'user_metadata'->>'role') IN ('admin', 'staff')
    OR tenant_id = (auth.jwt()->'user_metadata'->>'tenant_id')
  );


-- ═══════════ Fix 3: service_catalog_audit — restrict INSERT to admin ═══════════
-- Was: any authenticated user could insert audit rows (forgery risk).
-- Now: admin-only insert. Service role still has full access via separate policy.

DROP POLICY IF EXISTS "service_catalog_audit_insert_any" ON public.service_catalog_audit;
CREATE POLICY "service_catalog_audit_insert_admin" ON public.service_catalog_audit
  FOR INSERT TO authenticated
  WITH CHECK ((auth.jwt()->'user_metadata'->>'role') = 'admin');
