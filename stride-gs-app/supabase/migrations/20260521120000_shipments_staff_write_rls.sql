-- 2026-05-21 — shipments staff-write RLS policies
--
-- Why: the 2-stage receiving workflow writes the Stage-1 dock intake row
-- directly from the React client (admin/staff JWT) into `public.shipments`
-- (INSERT with inbound_status='in_progress'), then later updates the
-- GAS-created Stage-2 row (UPDATE inbound_status='received' + dock_*) and
-- deletes the DOCK placeholder. Before this migration only `service_role`
-- could write to `shipments`; authenticated user writes were blocked.
--
-- Scope: write access is admin/staff only (matches the `/receiving` route's
-- RoleGuard). Client-role users have no receiving workflow and should not
-- get table-level write access. Reads continue to follow the existing
-- `shipments_select_client` (tenant-scoped) + `shipments_select_staff`
-- (admin/staff cross-tenant) policies.
--
-- Service role write policy (`shipments_service_all`) is untouched — GAS
-- write-through and Edge Functions continue to use it.

CREATE POLICY shipments_insert_staff ON public.shipments
  FOR INSERT TO authenticated
  WITH CHECK (
    (((auth.jwt() -> 'user_metadata'::text) ->> 'role'::text) = ANY (ARRAY['admin'::text, 'staff'::text]))
  );

CREATE POLICY shipments_update_staff ON public.shipments
  FOR UPDATE TO authenticated
  USING (
    (((auth.jwt() -> 'user_metadata'::text) ->> 'role'::text) = ANY (ARRAY['admin'::text, 'staff'::text]))
  )
  WITH CHECK (
    (((auth.jwt() -> 'user_metadata'::text) ->> 'role'::text) = ANY (ARRAY['admin'::text, 'staff'::text]))
  );

CREATE POLICY shipments_delete_staff ON public.shipments
  FOR DELETE TO authenticated
  USING (
    (((auth.jwt() -> 'user_metadata'::text) ->> 'role'::text) = ANY (ARRAY['admin'::text, 'staff'::text]))
  );

-- Table-level grants — required alongside RLS per the 2026-10-30 PostgREST
-- behavior change. RLS decides which rows the role sees; the grants decide
-- whether the role can attempt the verb at all.
GRANT INSERT, UPDATE, DELETE ON public.shipments TO authenticated;

COMMENT ON POLICY shipments_insert_staff ON public.shipments IS
  'Staff/admin can INSERT shipments rows from React (2-stage receiving Stage 1 dock intake).';
COMMENT ON POLICY shipments_update_staff ON public.shipments IS
  'Staff/admin can UPDATE shipments rows from React (2-stage receiving Stage 2 reconciliation: inbound_status, dock_*).';
COMMENT ON POLICY shipments_delete_staff ON public.shipments IS
  'Staff/admin can DELETE shipments rows from React (2-stage receiving Stage 2 reconciliation: removing the DOCK placeholder after the GAS-created SHP row absorbs its metadata).';
