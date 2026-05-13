-- Add UPDATE policies on public.will_calls so authenticated React callers
-- (admin, staff, or tenant-scoped client) can write directly via
-- supabase.from('will_calls').update(...). Pre-this-migration the table
-- only had SELECT policies (will_calls_select_client, will_calls_select_staff)
-- + the standard service_role catch-all (will_calls_service_all). An
-- authenticated UPDATE was silently filtered to zero rows by RLS — no
-- error returned, just nothing changed. Same gap exists today on
-- public.inventory and was masked on PR #378's release path because
-- the parallel GAS-authoritative write-through happens to land the row
-- via service_role anyway. Filed as a follow-up for that table.
--
-- This PR's WC COD inline-edit (WillCallDetailPanel.tsx) does NOT have
-- a parallel GAS write-through — the React path is the only writer —
-- so the RLS gap would manifest as "click checkbox, nothing happens"
-- without these policies.
--
-- Mirrors the existing select-policy split:
--   • will_calls_update_client — clients (and admin/staff with tenant
--     access) can UPDATE rows in their own tenant. user_has_tenant_access
--     is the same JWT-claim-driven helper used by the SELECT policy.
--   • will_calls_update_staff — admin/staff role bypasses tenant scope
--     entirely (matches the existing tasks/repairs/etc staff policies).
-- Both have matching USING + WITH CHECK so a row-level swap to a different
-- tenant is rejected at write time.

DROP POLICY IF EXISTS will_calls_update_client ON public.will_calls;
CREATE POLICY will_calls_update_client
  ON public.will_calls FOR UPDATE TO authenticated
  USING      (public.user_has_tenant_access(tenant_id))
  WITH CHECK (public.user_has_tenant_access(tenant_id));

DROP POLICY IF EXISTS will_calls_update_staff ON public.will_calls;
CREATE POLICY will_calls_update_staff
  ON public.will_calls FOR UPDATE TO authenticated
  USING      (((auth.jwt() -> 'user_metadata') ->> 'role') = ANY (ARRAY['admin','staff']))
  WITH CHECK (((auth.jwt() -> 'user_metadata') ->> 'role') = ANY (ARRAY['admin','staff']));

COMMENT ON POLICY will_calls_update_client ON public.will_calls IS
  'Lets tenant-scoped authenticated callers (clients, plus admin/staff with the tenant in accessibleClientSheetIds) UPDATE will_calls rows in their own tenant. WITH CHECK prevents row-level tenant_id swaps.';
COMMENT ON POLICY will_calls_update_staff ON public.will_calls IS
  'Lets admin/staff UPDATE any will_calls row regardless of tenant scope. Mirrors the existing will_calls_select_staff and the tasks/repairs/etc staff write policies.';
