-- 2026-06-04 — Route qboReconcileInvoices through qbo-reconcile-payments
-- (SB-primary, NO GAS involvement).
--
-- Project context: stride-gs-app/MIGRATION_STATUS.md — Phase 6 payments.
--
-- Background: v38.242.0 shipped the QBO payment-status reconcile as a GAS
-- handler (handleQboReconcileInvoices_) plus the invoice_tracking
-- payment-status columns (20260528160000) and the React "Reconcile with
-- QBO" button. This migration completes the migration of that action to a
-- native Supabase Edge Function — the GAS handler is bypassed entirely.
--
-- The qbo-reconcile-payments EF:
--   • queries QBO for every pushed invoice in scope (per-id GET for rows
--     with qbo_invoice_id; bulk Query API for historical backfill),
--   • writes qbo_balance / qbo_paid / qbo_doc_number / qbo_invoice_id /
--     qbo_last_verified_at back onto public.invoice_tracking,
--   • logs any "pushed per Stride but missing in QBO" row to
--     billing_activity_log (action='qbo_push_failed').
--
-- It mutates ONLY verification columns (never billing dollar totals, never
-- the v38.182 invoice counter, never the push path), so there is no
-- MIG-016 deploy-order gate against a GAS reverse-writethrough — flipping
-- straight to 'supabase' fleet-wide is safe once the EF is deployed.
--
-- Revert: UPDATE active_backend='gas' on this row → apiRouter falls back
-- to the GAS handler (still present in StrideAPI.gs).

INSERT INTO public.feature_flags (function_key, active_backend, parity_enabled, notes)
VALUES (
  'qboReconcile',
  'supabase',
  false,
  'Routed to qbo-reconcile-payments (SB-primary, no GAS). Pulls QBO Invoice Balance back onto invoice_tracking (qbo_balance/qbo_paid/qbo_last_verified_at). Read-from-QBO + verification-column writes only — no billing-dollar mutation. Daily pg_cron sweep in 20260604130000_qbo_reconcile_cron.sql.'
)
ON CONFLICT (function_key) DO UPDATE
  SET active_backend = EXCLUDED.active_backend,
      notes          = EXCLUDED.notes,
      updated_at     = now();
