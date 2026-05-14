-- [MIGRATION-P3] Seed missing feature_flags rows for the repair P3 cluster
--
-- The P1.1 substrate seeded 25 feature_flags rows but missed three repair
-- lifecycle handlers that exist in GAS: requestRepairQuote (single-item
-- create), respondRepairQuote (client approve/decline), and cancelRepair.
-- Adding them now so the full repair migration can flow through the
-- standard P3 path:
--
--   feature_flags row → shadow handler → parity_results
--                      ↓
--   primary handler → React-side resolveFlagBackend() flip → canary tenant
--                                                          → fleet-flip
--                                                          → graduate
--
-- All three seed at active_backend='gas' + parity_enabled=false, matching
-- the rest of the P1.1 substrate. Operators flip via Settings → Migration
-- once a shadow handler is wired up.
--
-- See MIGRATION_STATUS.md "Per-function migration table" — these three
-- rows are added alongside this migration.

INSERT INTO public.feature_flags (function_key, active_backend, parity_enabled, notes)
VALUES
  ('requestRepairQuote',  'gas', false, 'Single-item repair quote request (used by TaskDetailPanel + ItemDetailPanel). Multi-item path is net-new and lives in request-repair-quote-sb without parity. P3.'),
  ('respondRepairQuote',  'gas', false, 'Client approve / decline on a sent quote. Status flip + REPAIR_APPROVED or REPAIR_DECLINED email. P3.'),
  ('cancelRepair',        'gas', false, 'Cancel an in-flight repair — status flip only, no email, no billing. Simplest of the repair P3 handlers; used as the template for the rest of the cluster. P3.')
ON CONFLICT (function_key) DO NOTHING;
