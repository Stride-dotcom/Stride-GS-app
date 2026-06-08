-- ============================================================================
-- Fix the entity_audit_log INSERT RLS policy to read user_metadata.role
--
-- BUG: the "Admin and staff insert audit logs" INSERT policy checks the
-- TOP-LEVEL jwt 'role' claim:
--     (current_setting('request.jwt.claims', true)::jsonb ->> 'role') IN ('admin','staff')
-- For a browser session that top-level claim is always 'authenticated' (the
-- Postgres role), NOT the app role — which lives in user_metadata.role (what
-- the table's SELECT policy and EVERY app RPC correctly read). So the WITH
-- CHECK is effectively always false for browser callers, and EVERY client-side
-- `entity_audit_log` insert is silently rejected (those inserts are fire-and-
-- forget with only a console.warn). Verified 2026-06-08: there is NO source='app'
-- row anywhere in the table — every audit row comes from GAS / edge functions /
-- triggers / backfills using the service-role (which bypasses RLS).
--
-- Effect of the bug: several SB-native client actions never appear in the
-- Activity tab — delivery-order create/approve/reject/push/cancel/update/
-- release (`dtOrderAudit` / `CreateDeliveryOrderModal` / `DtOrderReleasePanel`)
-- and storage-credit create/remove (`StorageCreditModal` / `StorageCreditsSection`).
--
-- FIX: evaluate the SAME claim path the SELECT policy + RPC role gates use —
-- `auth.jwt() -> 'user_metadata' ->> 'role'`. This un-breaks all the above
-- client-side writers at once. A 'client'-role user still cannot insert (the
-- check requires admin/staff); service_role still bypasses RLS.
--
-- No duplication: audited 2026-06-08 — the only dt_order action with a live
-- server-side (edge) writer is `release_items`, written by the AUTO-release path
-- (`_shared/release-on-dt-finished.ts`, fired by DT webhook/sync). The client
-- writes `release_items` only for MANUAL releases (DtOrderReleasePanel, whose
-- edge call `push-inventory-release-to-sheet` does NOT audit). A release happens
-- via one path or the other, never both, so no double rows. All other client
-- actions (and all storage_credit) have no server-side audit writer.
--
-- 2026-06-08 PST
-- ============================================================================

ALTER POLICY "Admin and staff insert audit logs"
  ON public.entity_audit_log
  WITH CHECK (
    (auth.jwt() -> 'user_metadata' ->> 'role') = ANY (ARRAY['admin'::text, 'staff'::text])
  );
