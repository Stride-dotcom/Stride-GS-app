-- 2026-05-09 — GAS→Supabase migration parity_dryrun schema (P1.3).
--
-- Project context: stride-gs-app/MIGRATION_STATUS.md, decision MIG-001
-- (dry-run-on-shadow inside prod SB). Companion to P1.1 (PR #310) and
-- P1.2 (PR #311).
--
-- Creates a separate `parity_dryrun` Postgres schema with a column-shape
-- mirror of every public table that a write-handler in the migration
-- inventory touches. The replay harness (P1.7) writes the SB-side
-- shadow handler's would-have-been state into these mirrors instead
-- of public.*, so the diff against the GAS-authored state in public.*
-- can be computed without ever touching production data.
--
-- Why mirror tables vs always-rollback transactions:
--   - External API calls (Resend, Stax, QBO, DT) cannot be rolled
--     back. MIG-008 placeholder credentials prevent the call from
--     succeeding, but only if the handler actually checks credentials
--     before firing — easy to miss. Mirrors are an infra-level
--     guarantee that prod tables aren't written.
--   - Long shadow transactions hold prod-table locks; mirrors
--     decouple shadow latency from prod throughput.
--   - The would-have-been state is queryable for inspection without
--     reconstructing from a rolled-back txn log.
--
-- Mirror set (14 tables, derived from the migration inventory in
-- MIGRATION_STATUS.md "Per-function migration table"):
--
--   public.inventory          — updateItem, releaseItems, transferItems,
--                                receiveShipment, processWcRelease
--   public.tasks              — updateTask, startTask, createTask,
--                                completeTask, transferItems,
--                                receiveShipment
--   public.repairs            — updateRepair, startRepair,
--                                completeRepair, transferItems
--   public.shipments          — updateShipment, receiveShipment
--   public.will_calls         — createWillCall, processWcRelease,
--                                transferItems
--   public.will_call_items    — createWillCall, processWcRelease
--   public.billing            — completeTask, completeRepair,
--                                processWcRelease, commitStorageCharges,
--                                createInvoice, voidInvoice,
--                                reissueInvoice, transferItems,
--                                receiveShipment
--   public.addons             — completeTask, completeRepair,
--                                processWcRelease
--   public.invoice_tracking   — createInvoice, voidInvoice,
--                                reissueInvoice, qboCreateInvoice
--   public.entity_notes       — transferItems
--   public.item_photos        — transferItems
--   public.clients            — onboardClient
--   public.stax_invoices      — createStaxInvoices, qboCreateInvoice,
--                                runStaxCharges
--   public.stax_charges       — runStaxCharges
--
-- Mirrors use `LIKE source INCLUDING DEFAULTS` so column shapes and
-- expression defaults (e.g. gen_random_uuid()) carry over but
-- constraints, indexes, and identity sequences do not. The harness
-- supplies all values explicitly anyway; the mirror just needs the
-- right SHAPE for state-hashing comparisons against public.*.
--
-- IMPORTANT — schema-sync convention:
-- Every future migration that ALTERs a public.* table in this set
-- MUST also ALTER the corresponding parity_dryrun.* mirror in the
-- same migration file. Drift between public.* and parity_dryrun.*
-- breaks the replay harness silently (the shadow INSERT might succeed
-- but produce a state hash that doesn't match prod). Documented in
-- stride-gs-app/MIGRATION_STATUS.md.

CREATE SCHEMA IF NOT EXISTS parity_dryrun;
COMMENT ON SCHEMA parity_dryrun IS
  'Shadow-write target for the GAS→Supabase migration parity harness. '
  'Column-shape mirror of public.* tables in the migration inventory. '
  'See stride-gs-app/MIGRATION_STATUS.md (MIG-001).';

-- Restrict access. Only service_role (which the replay harness Edge
-- Function uses) gets to read/write here. authenticated users do not
-- see this schema at all — keeps it out of the React app's RLS
-- surface.
REVOKE ALL ON SCHEMA parity_dryrun FROM PUBLIC;
GRANT USAGE ON SCHEMA parity_dryrun TO service_role;

-- Mirrors. Each `LIKE public.X INCLUDING DEFAULTS` carries column
-- definitions + expression defaults but skips constraints, indexes,
-- and identity columns.
CREATE TABLE IF NOT EXISTS parity_dryrun.inventory          (LIKE public.inventory          INCLUDING DEFAULTS);
CREATE TABLE IF NOT EXISTS parity_dryrun.tasks              (LIKE public.tasks              INCLUDING DEFAULTS);
CREATE TABLE IF NOT EXISTS parity_dryrun.repairs            (LIKE public.repairs            INCLUDING DEFAULTS);
CREATE TABLE IF NOT EXISTS parity_dryrun.shipments          (LIKE public.shipments          INCLUDING DEFAULTS);
CREATE TABLE IF NOT EXISTS parity_dryrun.will_calls         (LIKE public.will_calls         INCLUDING DEFAULTS);
CREATE TABLE IF NOT EXISTS parity_dryrun.will_call_items    (LIKE public.will_call_items    INCLUDING DEFAULTS);
CREATE TABLE IF NOT EXISTS parity_dryrun.billing            (LIKE public.billing            INCLUDING DEFAULTS);
CREATE TABLE IF NOT EXISTS parity_dryrun.addons             (LIKE public.addons             INCLUDING DEFAULTS);
CREATE TABLE IF NOT EXISTS parity_dryrun.invoice_tracking   (LIKE public.invoice_tracking   INCLUDING DEFAULTS);
CREATE TABLE IF NOT EXISTS parity_dryrun.entity_notes       (LIKE public.entity_notes       INCLUDING DEFAULTS);
CREATE TABLE IF NOT EXISTS parity_dryrun.item_photos        (LIKE public.item_photos        INCLUDING DEFAULTS);
CREATE TABLE IF NOT EXISTS parity_dryrun.clients            (LIKE public.clients            INCLUDING DEFAULTS);
CREATE TABLE IF NOT EXISTS parity_dryrun.stax_invoices      (LIKE public.stax_invoices      INCLUDING DEFAULTS);
CREATE TABLE IF NOT EXISTS parity_dryrun.stax_charges       (LIKE public.stax_charges       INCLUDING DEFAULTS);

-- Grant ALL on each mirror to service_role explicitly. Default
-- privileges via GRANT USAGE on schema don't cover table DML.
GRANT ALL ON ALL TABLES IN SCHEMA parity_dryrun TO service_role;

-- Default privileges for any future tables created in this schema by
-- migrations or by the harness itself.
ALTER DEFAULT PRIVILEGES IN SCHEMA parity_dryrun GRANT ALL ON TABLES TO service_role;

-- Truncate helper. The replay harness calls this at the start of each
-- run so previous-run state doesn't leak into the diff. CASCADE not
-- needed (mirrors have no FKs); RESTART IDENTITY is a no-op (we
-- skipped INCLUDING IDENTITY) but keeps the function safe if a future
-- mirror does have an identity column.
CREATE OR REPLACE FUNCTION parity_dryrun.reset()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  TRUNCATE TABLE
    parity_dryrun.inventory,
    parity_dryrun.tasks,
    parity_dryrun.repairs,
    parity_dryrun.shipments,
    parity_dryrun.will_calls,
    parity_dryrun.will_call_items,
    parity_dryrun.billing,
    parity_dryrun.addons,
    parity_dryrun.invoice_tracking,
    parity_dryrun.entity_notes,
    parity_dryrun.item_photos,
    parity_dryrun.clients,
    parity_dryrun.stax_invoices,
    parity_dryrun.stax_charges
  RESTART IDENTITY;
END;
$$;

-- Restrict who can call the truncate helper. Only service_role.
REVOKE ALL ON FUNCTION parity_dryrun.reset() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION parity_dryrun.reset() TO service_role;

-- Diagnostics: a view of mirror table row counts. Cheap, useful for
-- the Settings → Migration tab to surface "harness writing state
-- recently?" indicators in P1.6.
CREATE OR REPLACE VIEW parity_dryrun.row_counts AS
  SELECT 'inventory'        AS table_name, (SELECT COUNT(*) FROM parity_dryrun.inventory)        AS row_count
  UNION ALL SELECT 'tasks',              (SELECT COUNT(*) FROM parity_dryrun.tasks)
  UNION ALL SELECT 'repairs',            (SELECT COUNT(*) FROM parity_dryrun.repairs)
  UNION ALL SELECT 'shipments',          (SELECT COUNT(*) FROM parity_dryrun.shipments)
  UNION ALL SELECT 'will_calls',         (SELECT COUNT(*) FROM parity_dryrun.will_calls)
  UNION ALL SELECT 'will_call_items',    (SELECT COUNT(*) FROM parity_dryrun.will_call_items)
  UNION ALL SELECT 'billing',            (SELECT COUNT(*) FROM parity_dryrun.billing)
  UNION ALL SELECT 'addons',             (SELECT COUNT(*) FROM parity_dryrun.addons)
  UNION ALL SELECT 'invoice_tracking',   (SELECT COUNT(*) FROM parity_dryrun.invoice_tracking)
  UNION ALL SELECT 'entity_notes',       (SELECT COUNT(*) FROM parity_dryrun.entity_notes)
  UNION ALL SELECT 'item_photos',        (SELECT COUNT(*) FROM parity_dryrun.item_photos)
  UNION ALL SELECT 'clients',            (SELECT COUNT(*) FROM parity_dryrun.clients)
  UNION ALL SELECT 'stax_invoices',      (SELECT COUNT(*) FROM parity_dryrun.stax_invoices)
  UNION ALL SELECT 'stax_charges',       (SELECT COUNT(*) FROM parity_dryrun.stax_charges);

GRANT SELECT ON parity_dryrun.row_counts TO service_role;
