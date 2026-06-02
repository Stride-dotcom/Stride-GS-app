-- [MIGRATION-P4a] Seed missing billing feature_flags + enable shadow on all
-- ==========================================================================
-- Context: AUDIT-billing-sb-readiness.md (2026-06-01). createInvoice is the
-- #1 GAS handler (128 calls/week); the billing lifecycle is the critical
-- path to killing GAS. This migration is part 1 of the cutover: surface
-- shadow signal for every billing handler so parity_results populates before
-- any flag flips to active_backend='supabase'.
--
-- Two parts (both idempotent, safe to re-run):
--   1. INSERT … ON CONFLICT DO NOTHING — seeds the 6 billing function_keys
--      missing from prior seed migrations (the seed in 20260509000001
--      only covered the P4a top-level handlers + commitStorageCharges;
--      the billing-light handlers added in PR #519/#522 were never seeded
--      because they shipped as direct EFs with no feature_flag row).
--   2. UPDATE … SET parity_enabled=true, shadow_backend='supabase' for all
--      11 billing-related flags. Guarded by WHERE active_backend='gas'
--      (per the MIG-007 / completeTask precedent at 20260514210100) so a
--      row already cut over to supabase isn't accidentally rewound.
--
-- This DOES NOT flip active_backend. Shadow traffic only — proves the diff
-- pipeline is healthy before per-handler cutover. See AUDIT report
-- "Cutover plan" for the per-handler flip order.

-- ── Part 1: Seed the 6 missing function_keys ─────────────────────────────
INSERT INTO public.feature_flags (function_key, active_backend, parity_enabled, notes)
VALUES
  ('syncClientBilling',     'gas', false,
   'P4a (transitional) — sync-client-billing-sb bridges back to GAS '
   || 'full-client-sync via writeThroughReverse?op=resync.'),
  ('updateBillingRow',      'gas', false,
   'P4a — update-billing-row-sb. Per-row edit of billing rate/qty/total/'
   || 'description/sidemark with Unbilled-only guard.'),
  ('generateUnbilledReport','gas', false,
   'P4a — generate-unbilled-report-sb. Read-only aggregation for invoice '
   || 'preview before commit.'),
  ('addManualCharge',       'gas', false,
   'P4a — add-manual-charge-sb. Operator-entered Unbilled billing row '
   || 'with MANUAL- ledger_row_id prefix.'),
  ('voidManualCharge',      'gas', false,
   'P4a — void-manual-charge-sb. Voids a MANUAL- row; Unbilled-only.'),
  ('voidUnbilledRows',      'gas', false,
   'P4a — void-unbilled-rows-sb. Bulk-void of Unbilled rows; per-row '
   || 'guard rejects Invoiced/Void.')
ON CONFLICT (function_key) DO NOTHING;

-- ── Part 2: Enable shadow on all 11 billing-related flags ────────────────
-- Same pattern as 20260514210100_complete_task_feature_flag.sql.
UPDATE public.feature_flags
SET shadow_backend = 'supabase',
    parity_enabled = true,
    updated_at     = now()
WHERE function_key IN (
        'createInvoice',
        'voidInvoice',
        'reissueInvoice',
        'syncClientBilling',
        'updateBillingRow',
        'generateUnbilledReport',
        'commitStorageCharges',
        'addManualCharge',
        'voidManualCharge',
        'voidUnbilledRows',
        'billingExtras'
      )
  AND active_backend = 'gas';
