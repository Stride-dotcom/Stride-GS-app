-- [MIGRATION-P6] payments shadows → parity-on, shadow=supabase, active=gas
-- ====================================================================
-- P6 ships four COMPUTE-ONLY shadow Edge Functions (no payment API is
-- ever called — qbo-create-invoice-sb / create-stax-invoices-sb /
-- run-stax-charges-sb / import-iif-sb). Per MIG-007 the fleet stays on
-- GAS; this migration only turns parity ON and pairs shadow_backend so
-- shadowed calls land in parity_results. active_backend stays 'gas' and
-- tenant_scope stays NULL (fleet GAS) for every row.
--
-- qboCreateInvoice / createStaxInvoices / runStaxCharges were seeded by
-- 20260509000001 (the P1.1 substrate) at {active_backend:'gas',
-- parity_enabled:false}. importIif is NOT in the substrate (the IIF
-- import path is tagged P4b/P6 in FUNCTION_INVENTORY and was never a
-- top-level handler flag), so it is INSERTed here with the same posture
-- as the rest of the P1.1 substrate.
--
-- doPost action → function_key mapping (gas_call_log.action):
--   qboCreateInvoice   → qboCreateInvoice
--   createStaxInvoices → createStaxInvoices
--   runStaxCharges     → runStaxCharges
--   importIIF          → importIif       (registry maps action 'importIIF')
--
-- Idempotent; safe to re-run.

-- New flag for the IIF-import shadow (no substrate row exists).
INSERT INTO public.feature_flags (function_key, active_backend, parity_enabled, notes)
VALUES (
  'importIif', 'gas', false,
  'P6 — IIF (QuickBooks export) import → Stax Invoices/Exceptions. '
  || 'GAS handleImportIIF_, doPost action importIIF. Shadow import-iif-sb '
  || 'parses the IIF + computes would-be rows; no Stax/QBO call.'
)
ON CONFLICT (function_key) DO NOTHING;

-- Turn parity ON + pair shadow_backend for all four P6 handlers. Guard:
-- only touch rows still on GAS so a future per-tenant cutover is never
-- clobbered by a re-run (same guard as 20260514210100_complete_task_*).
UPDATE public.feature_flags
SET shadow_backend = 'supabase',
    parity_enabled = true,
    notes          = CASE function_key
      WHEN 'qboCreateInvoice'  THEN 'P6 — QBO invoice push (P4b prereq, MIG-005). '
                                 || 'qbo-create-invoice-sb shadow shipped (compute-only, no QBO API); '
                                 || 'fleet on GAS until MIG-007 gate passes.'
      WHEN 'createStaxInvoices' THEN 'P6 — Stax invoice creation. '
                                 || 'create-stax-invoices-sb shadow shipped (compute-only, no Stax API); '
                                 || 'fleet on GAS until MIG-007 gate passes.'
      WHEN 'runStaxCharges'     THEN 'P6 — Stax auto-charge run (real-money path). '
                                 || 'run-stax-charges-sb shadow shipped (eligibility compute-only, '
                                 || 'no Stax charge); fleet on GAS until MIG-007 gate passes.'
      WHEN 'importIif'          THEN 'P6 — IIF import. import-iif-sb shadow shipped '
                                 || '(parse + would-be rows, no Stax/QBO); fleet on GAS until MIG-007 gate passes.'
      ELSE notes
    END,
    updated_at     = now()
WHERE function_key IN ('qboCreateInvoice', 'createStaxInvoices', 'runStaxCharges', 'importIif')
  AND active_backend = 'gas';
