-- [MIGRATION-P4a] completeTask → parity-on, shadow=supabase, active=gas
-- ====================================================================
-- The completeTask row was seeded at {active_backend:'gas',
-- parity_enabled:false} by 20260509000001. This PR ships the SB-primary
-- handler (complete-task) + shadow (complete-task-shadow) but per MIG-007
-- the fleet stays on GAS until the three-layer gate (per-call diff →
-- 90d replay → 14d canary) passes in a later session.
--
-- So: turn parity ON (so shadowed calls land in parity_results) and pair
-- shadow_backend='supabase', but DO NOT touch active_backend (stays
-- 'gas') and DO NOT set tenant_scope (stays NULL = fleet GAS).
-- Idempotent; safe to re-run.

UPDATE public.feature_flags
SET shadow_backend = 'supabase',
    parity_enabled = true,
    notes          = 'P4a — atomic with billing + addons + email (MIG-004). '
                   || 'complete-task-sb + complete-task-shadow shipped; fleet on GAS '
                   || 'until MIG-007 three-layer gate passes.',
    updated_at     = now()
WHERE function_key = 'completeTask'
  AND active_backend = 'gas';   -- guard: never flip parity-config on a row
                                -- that's already been cut over to supabase
