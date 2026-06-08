-- ============================================================================
-- P1 hardening — security_definer_view (5 ERRORs)
--
-- These 5 monitoring/diagnostic views ran SECURITY DEFINER (the default), so a
-- caller with SELECT on them saw the OWNER's data, bypassing their own RLS — a
-- cross-tenant read path for any authenticated user who reached them.
--
-- Fix: security_invoker = on → the views now respect the CALLER's RLS.
-- Verified safe: every underlying table has an authenticated/staff read policy
--   • parity_summary / parity_mismatches_recent / parity_billing_shadow →
--     parity_results (parity_results_staff SELECT) + feature_flags
--     (feature_flags_read_authenticated SELECT)
--   • item_id_ledger_conflicts → inventory (admin/staff/client policies) +
--     item_id_ledger ("authenticated read item_id_ledger" SELECT)
--   • billable_event_coverage → tasks/repairs/will_calls/inventory/billing/
--     clients (all have admin/staff read policies)
-- So an admin (broad RLS) still sees the full cross-tenant audit in the
-- ParityDashboard / BillingCoverageTab; a non-admin now sees only their own
-- tenant (no leak) instead of everything. Both pages are admin-gated in the UI.
-- ============================================================================

ALTER VIEW public.parity_summary           SET (security_invoker = on);
ALTER VIEW public.parity_mismatches_recent SET (security_invoker = on);
ALTER VIEW public.parity_billing_shadow    SET (security_invoker = on);
ALTER VIEW public.billable_event_coverage  SET (security_invoker = on);
ALTER VIEW public.item_id_ledger_conflicts SET (security_invoker = on);
