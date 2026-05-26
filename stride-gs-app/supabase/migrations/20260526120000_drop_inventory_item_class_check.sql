-- 2026-05-26 — Unblock saving NC (No Charge) as an item class.
--
-- Context: NC was added to public.item_classes and PR #529 switched the
-- ItemDetailPanel dropdown to source from Supabase, so the option appears.
-- Saves still fail. Repo-side code paths (ItemDetailPanel, api.ts,
-- StrideAPI.gs handleUpdateInventoryItem_, update-item-sb EF) have no
-- hardcoded class allowlist, so the only remaining blocker is a CHECK
-- constraint added live via the dashboard that whitelists XS/S/M/L/XL/XXL.
-- AUDIT-schema-alignment.md (2026-05-24) already documents several
-- out-of-band columns in live tables that have no tracked migration —
-- a constraint added the same way is consistent with that.
--
-- This migration dynamically drops ANY CHECK constraint on inventory,
-- billing, billing_parity_log, and addons whose definition references
-- item_class. Idempotent — DO blocks RAISE NOTICE per drop so an
-- operator running this with no matching constraint sees no output and
-- the migration completes cleanly.
--
-- Also re-asserts NC in public.item_classes (idempotent UPSERT) in case
-- it was deactivated or has the wrong shape.

DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT n.nspname AS schema_name, c.relname AS table_name,
           con.conname AS constraint_name,
           pg_get_constraintdef(con.oid) AS def
    FROM pg_constraint con
    JOIN pg_class       c ON c.oid = con.conrelid
    JOIN pg_namespace   n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('inventory', 'billing', 'billing_parity_log', 'addons')
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%item_class%'
  LOOP
    RAISE NOTICE 'Dropping CHECK constraint %.% — %',
      rec.table_name, rec.constraint_name, rec.def;
    EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT %I',
                   rec.schema_name, rec.table_name, rec.constraint_name);
  END LOOP;
END $$;

-- Re-assert NC seed. Uses only columns guaranteed by tracked migrations
-- (id, name, display_order, active). storage_size + delivery_minutes
-- have DEFAULTs (0) in live or are nullable, so the insert is safe.
INSERT INTO public.item_classes (id, name, display_order, active)
VALUES ('NC', 'No Charge', 99, true)
ON CONFLICT (id) DO UPDATE SET
  active        = true,
  name          = EXCLUDED.name,
  display_order = EXCLUDED.display_order;
