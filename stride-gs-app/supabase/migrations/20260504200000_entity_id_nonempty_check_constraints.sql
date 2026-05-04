-- Migration: CHECK constraints on entity-key columns so blank IDs fail loud at INSERT.
--
-- Why: api_fullClientSync_ silently `continue`s when an entity row has an
-- empty key column (ledger_row_id, task_id, etc.). The May 2026 WC bug
-- (handleProcessWcRelease_ wrote billing rows with no Ledger Row ID) hid
-- in production for ~5 weeks because Postgres accepted empty strings on
-- the (tenant_id, ledger_row_id) UNIQUE — every blank row collapsed onto
-- the same key and all but one disappeared. With these CHECKs in place,
-- any future writer that forgets a key column will hit a constraint
-- violation on the very first attempt instead of silently dropping data.
--
-- Audit before this ran (2026-05-04):
--   billing_blank=0 tasks_blank=0 repairs_blank=0 wc_blank=0 ship_blank=0 inv_blank=0
-- so the constraints can be added without backfill.
--
-- These complement the existing UNIQUE (tenant_id, <key>) constraints —
-- UNIQUE prevents duplicates of the same non-empty key; CHECK prevents
-- the empty key from existing at all.

ALTER TABLE billing
  ADD CONSTRAINT billing_ledger_row_id_nonempty CHECK (ledger_row_id <> '');

ALTER TABLE tasks
  ADD CONSTRAINT tasks_task_id_nonempty CHECK (task_id <> '');

ALTER TABLE repairs
  ADD CONSTRAINT repairs_repair_id_nonempty CHECK (repair_id <> '');

ALTER TABLE will_calls
  ADD CONSTRAINT will_calls_wc_number_nonempty CHECK (wc_number <> '');

ALTER TABLE shipments
  ADD CONSTRAINT shipments_shipment_number_nonempty CHECK (shipment_number <> '');

ALTER TABLE inventory
  ADD CONSTRAINT inventory_item_id_nonempty CHECK (item_id <> '');
