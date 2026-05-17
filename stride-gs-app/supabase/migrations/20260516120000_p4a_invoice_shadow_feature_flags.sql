-- [MIGRATION-P4a] createInvoice / voidInvoice / generateUnbilledReport
-- → parity-on, shadow_backend='supabase', active_backend stays 'gas'
-- =====================================================================
-- Ships the three billing-core SHADOW/parity Edge Functions:
--   create-invoice-sb, void-invoice-sb, generate-unbilled-report-sb
-- (compute-only, zero writes — see each function's header).
--
-- Per MIG-007 the fleet stays on GAS until the three-layer gate
-- (per-call diff → 90d replay → 14d canary) passes in a later session.
-- So: turn parity ON + pair shadow_backend='supabase', but DO NOT touch
-- active_backend (stays 'gas') and DO NOT set tenant_scope (stays NULL =
-- fleet GAS). Same posture + guard idiom as
-- 20260514210100_complete_task_feature_flag.sql. Idempotent.
--
-- createInvoice + voidInvoice were seeded at {gas,parity:false} by
-- 20260509000001 (P1.1). generateUnbilledReport is NOT a P1.1 handler
-- (it's a cross-tenant report, not in the 25-row substrate) so it is
-- INSERTed here, mirroring the 20260513200000 repair-P3 seed pattern.
--
-- parity_dryrun schema-sync: NONE REQUIRED. This migration only
-- UPDATEs/INSERTs public.feature_flags, which is NOT in the 14-table
-- parity_dryrun mirror set, and ALTERs no public.* mirror table. No
-- paired parity_dryrun.* change is needed; check_drift() is unaffected.
--
-- SHADOW_REGISTRY (replay-shadow): intentionally NOT wired for these
-- three. The replay harness (MIG-007 layer 2) expects a shadow that
-- returns {ok, changes} diffed against entity_audit_log.changes — a
-- fixed audit shape. Invoice creation has no fixed audit-changes shape;
-- its parity is data-derived (line items / totals / tokens). These
-- functions serve MIG-007 layer 1 (per-call live shadow — "return the
-- computed result for parity comparison"), which is what the parity
-- caller diffs. Layer-2 historical replay for the billing cluster is
-- deferred (same rationale shape as MIG-013's Path-C replay deferral)
-- and tracked in MIGRATION_STATUS.md.

UPDATE public.feature_flags
SET shadow_backend = 'supabase',
    parity_enabled = true,
    notes          = 'P4a — create-invoice-sb shadow/parity (compute-only: line '
                   || 'items, totals, PDF tokens, QB customer name). No CB / '
                   || 'public.billing / invoice_tracking write, no PDF, no email, '
                   || 'no invoice-no consume. Fleet on GAS until MIG-007 gate.',
    updated_at     = now()
WHERE function_key = 'createInvoice'
  AND active_backend = 'gas';   -- guard: never flip parity-config on a row
                                -- already cut over to supabase

UPDATE public.feature_flags
SET shadow_backend = 'supabase',
    parity_enabled = true,
    notes          = 'P4a — void-invoice-sb shadow/parity (compute-only: which '
                   || 'public.billing rows would flip Invoiced->Void). CB '
                   || 'Consolidated_Ledger symmetry (MIG-005) is GAS-side only; '
                   || 'SB has one billing table. Fleet on GAS until MIG-007 gate.',
    updated_at     = now()
WHERE function_key = 'voidInvoice'
  AND active_backend = 'gas';

INSERT INTO public.feature_flags
  (function_key, active_backend, shadow_backend, parity_enabled, notes)
VALUES
  ('generateUnbilledReport', 'gas', 'supabase', true,
   'P4a — generate-unbilled-report-sb shadow/parity (compute-only: '
   || 'cross-tenant Unbilled row-set from public.billing). Read-only; no '
   || 'CB Unbilled_Report sheet write. Not a P1.1 substrate handler '
   || '(report, not a write handler) — seeded here. Fleet on GAS.')
ON CONFLICT (function_key) DO NOTHING;
