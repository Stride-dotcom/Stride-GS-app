-- [MIGRATION-P3/P5] Operational shadow handlers → parity-on
-- ====================================================================
-- Five operational handlers got pure shadow Edge Functions this session
-- (create-will-call-shadow, release-will-call-shadow, create-task-shadow,
-- release-items-shadow, transfer-items-shadow) and were registered in
-- replay-shadow's SHADOW_REGISTRY. Turn parity ON for their feature_flags
-- rows so replayed calls land in parity_results and the Settings →
-- Migration "Mismatches (7d)" column starts reflecting real data.
--
-- Per MIG-007 the fleet stays on GAS until the three-layer gate
-- (per-call diff → 90d replay → 14d canary) passes in a later session.
-- So: shadow_backend='supabase' + parity_enabled=true, but DO NOT touch
-- active_backend (stays 'gas') and DO NOT set tenant_scope (stays NULL =
-- fleet GAS). Same posture as 20260514210100_complete_task_feature_flag.
--
-- function_key → gas_call_log action mapping (see SHADOW_REGISTRY):
--   createWillCall  → createWillCall
--   releaseWillCall → processWcRelease   (no releaseWillCall doPost case;
--                                         processWcRelease is the action.
--                                         The separate `processWcRelease`
--                                         feature_flags row is the P4a
--                                         atomic-billing variant owned by
--                                         the invoice/billing cluster and
--                                         is intentionally NOT touched here.)
--   createTask      → batchCreateTasks   (no createTask doPost case)
--   releaseItems    → releaseItems
--   transferItems   → transferItems
--
-- The active_backend='gas' guard prevents flipping parity-config on a row
-- already cut over to supabase. Idempotent; safe to re-run.

UPDATE public.feature_flags
SET shadow_backend = 'supabase',
    parity_enabled = true,
    updated_at     = now()
WHERE function_key IN (
    'createWillCall',
    'releaseWillCall',
    'createTask',
    'releaseItems',
    'transferItems'
  )
  AND active_backend = 'gas';
