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
-- MIG-016 deploy-order gate against a GAS reverse-writethrough.
--
-- ── SEEDED AT 'gas' — flip is gated on QBO secrets ────────────────────
-- This row seeds at active_backend='gas' (NOT 'supabase') on purpose. The
-- QBO OAuth credentials (QBO_CLIENT_ID / QBO_CLIENT_SECRET /
-- QBO_REFRESH_TOKEN / QBO_REALM_ID) currently live ONLY in GAS Script
-- Properties — they are set at runtime by the QBO OAuth callback
-- (handleQboOauthCallback_ → props.setProperty), not in the repo and not
-- in Supabase Edge Function secrets. Until those 4 values are mirrored
-- onto the Supabase project, qbo-reconcile-payments returns CONFIG_ERROR.
-- Flipping React to the EF before then would break the admin "Sync
-- Payment Status" button in prod while the GAS handler still works.
--
-- GO-LIVE (operator, two steps):
--   1. Mirror the QBO secrets onto the project:
--        npx supabase secrets set \
--          QBO_CLIENT_ID=...      QBO_CLIENT_SECRET=... \
--          QBO_REFRESH_TOKEN=...  QBO_REALM_ID=... \
--          --project-ref uqplppugeickmamycpuz
--      (values come from GAS Script Properties, or re-run the QBO OAuth
--       flow to mint a fresh refresh token.)
--   2. Flip the route to the SB EF:
--        UPDATE public.feature_flags SET active_backend='supabase',
--          updated_at=now() WHERE function_key='qboReconcile';
--      …and schedule the daily cron (see 20260604130000_qbo_reconcile_cron.sql).
--
-- Revert at any time: UPDATE active_backend='gas' on this row.

INSERT INTO public.feature_flags (function_key, active_backend, parity_enabled, notes)
VALUES (
  'qboReconcile',
  'gas',
  false,
  'qbo-reconcile-payments EF deployed + ready. HELD on gas until the 4 QBO OAuth secrets (QBO_CLIENT_ID/SECRET/REFRESH_TOKEN/REALM_ID) are mirrored from GAS Script Properties onto the Supabase project. Go-live = set secrets, then flip this row to supabase + schedule the daily cron.'
)
ON CONFLICT (function_key) DO UPDATE
  SET notes      = EXCLUDED.notes,
      updated_at = now();
-- NOTE: ON CONFLICT does NOT overwrite active_backend, so re-running this
-- migration never clobbers an operator's go-live flip to 'supabase'.
