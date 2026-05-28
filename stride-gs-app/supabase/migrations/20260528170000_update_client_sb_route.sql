-- 2026-05-28 — Route updateClient through update-client-sb (SB-primary).
--
-- Project context: stride-gs-app/MIGRATION_STATUS.md, MIG-014 (clients
-- table SB-authoritative) + MIG-016 (deploy order — GAS writethrough
-- first, then EF, then flag flip).
--
-- Why: prior to today's PR `updateClient` resolved via the grouped
-- `client-setup-sb` Edge Function (GROUPED_CLIENT_SETUP_ACTIONS in
-- src/lib/apiRouter.ts), which proxies straight back to GAS
-- handleUpdateClient_. That GAS handler writes only the CB Clients
-- sheet and the per-tenant Settings tab — it never updates
-- `public.clients`. Result: React's Supabase read cache for clients
-- stays stale after any edit. The Hyrel Mathias stax_customer_id push
-- exposed this — the value would land in CB but never in SB.
--
-- The fix in apiRouter.ts removes `updateClient` from the grouped list
-- so the dedicated direct entry sticks:
--   updateClient: { ef: 'update-client-sb', flagKey: 'updateClient' }
--
-- The `update-client-sb` EF (supabase/functions/update-client-sb/) is
-- the SB-primary path: it PATCHes public.clients first, then fires
-- `writeThroughReverse` against the per-tenant spreadsheet, where the
-- existing `__writeThroughReverseClients_` writer (StrideAPI.gs
-- v38.224.0) mirrors the row OUT to BOTH the per-tenant Settings tab
-- AND the CB Clients tab.
--
-- This migration upserts the feature_flag row at active_backend='supabase'
-- fleet-wide. The EF + writethrough writer are already deployed (PR #518,
-- v38.224.0) so no MIG-016 deploy-order gate is needed beyond pushing
-- this session's StrideAPI bump (v38.244.0 — adds the Hyrel one-shot,
-- doesn't change the writer itself).
--
-- Revert: UPDATE active_backend='gas' on the same row.

INSERT INTO public.feature_flags (function_key, active_backend, parity_enabled, notes)
VALUES (
  'updateClient',
  'supabase',
  false,
  'Routed to update-client-sb (SB-primary). EF writes public.clients then fires reverse-writethrough via __writeThroughReverseClients_ (StrideAPI.gs v38.224.0) to mirror to per-tenant Settings + CB Clients sheet.'
)
ON CONFLICT (function_key) DO UPDATE
  SET active_backend = EXCLUDED.active_backend,
      notes          = EXCLUDED.notes,
      updated_at     = now();
