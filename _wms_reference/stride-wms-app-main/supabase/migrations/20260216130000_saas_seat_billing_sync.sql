-- =============================================================================
-- SaaS seat-based billing: billable staff count + Stripe quantity sync support
-- Migration: 20260216130000_saas_seat_billing_sync.sql
-- =============================================================================
-- Purpose:
--   1) Define a deterministic "billable staff seats" count per tenant.
--   2) Persist last synced count on tenant_subscriptions for observability.
--   3) Provide a service-role RPC used by Edge Functions to compute seats.
--
-- Seat definition (Phase 5):
--   - Users in this tenant (users.tenant_id = tenant)
--   - Not soft-deleted (users.deleted_at IS NULL)
--   - Status is billable: active/pending/invited
--   - Has at least one NON-system role that is NOT client_user
-- Notes:
--   - This counts seats as soon as an admin adds/invites staff (pending/invited),
--     which matches expected "adding staff increases billing seats" behavior.

-- ---------------------------------------------------------------------------
-- 1) Persist last computed seat count on tenant_subscriptions
-- ---------------------------------------------------------------------------
ALTER TABLE public.tenant_subscriptions
  ADD COLUMN IF NOT EXISTS billable_seat_count integer,
  ADD COLUMN IF NOT EXISTS billable_seat_count_updated_at timestamptz;

COMMENT ON COLUMN public.tenant_subscriptions.billable_seat_count IS
'Last computed billable staff seat count used for Stripe per-user quantity sync.';
COMMENT ON COLUMN public.tenant_subscriptions.billable_seat_count_updated_at IS
'Timestamp when billable_seat_count was last computed/synced.';

-- ---------------------------------------------------------------------------
-- 2) Service-role RPC: compute billable seat count for a tenant
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_get_tenant_billable_seat_count(
  p_tenant_id uuid
)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(COUNT(DISTINCT u.id), 0)::integer
  FROM public.users u
  JOIN public.user_roles ur
    ON ur.user_id = u.id
   AND ur.deleted_at IS NULL
  JOIN public.roles r
    ON r.id = ur.role_id
   AND r.deleted_at IS NULL
  WHERE u.tenant_id = p_tenant_id
    AND u.deleted_at IS NULL
    AND COALESCE(NULLIF(BTRIM(u.status), ''), 'active') IN ('active', 'pending', 'invited')
    AND r.tenant_id = p_tenant_id
    AND r.name <> 'client_user';
$$;

REVOKE ALL ON FUNCTION public.rpc_get_tenant_billable_seat_count(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_get_tenant_billable_seat_count(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_get_tenant_billable_seat_count(uuid) TO service_role;

COMMENT ON FUNCTION public.rpc_get_tenant_billable_seat_count(uuid) IS
'Service-role only. Returns billable staff seat count for a tenant (excludes system roles and client_user).';
