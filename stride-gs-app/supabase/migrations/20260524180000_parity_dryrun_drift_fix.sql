-- Realigns parity_dryrun.* mirrors with their public.* sources after
-- three recent migrations forgot the corresponding mirror ALTER per the
-- MIGRATION_STATUS.md "parity_dryrun schema-sync convention".
--
-- Drift detected via parity_dryrun.check_drift() (2026-05-24):
--   - inventory.parent_item_id            missing (Split workflow v38.225)
--   - shipments.dock_completed_at         missing (2-stage receiving)
--   - shipments.dock_completed_by         missing (2-stage receiving)
--   - shipments.dock_piece_count          missing (2-stage receiving)
--   - shipments.inbound_status            missing (2-stage receiving)
--   - tasks.qty                           missing (qty column add)
--   - tasks.metadata                      missing (qty column add)
--   - item_photos.tenant_id  nullability  mismatch (NOT NULL in dryrun → YES in public)
--
-- Replay-shadow writes to parity_dryrun.*; missing columns silently
-- drop data and the resulting state hash diverges from public.*. Fixing
-- the mirror schema restores hash parity for those tables.

ALTER TABLE parity_dryrun.inventory
  ADD COLUMN IF NOT EXISTS parent_item_id text;

ALTER TABLE parity_dryrun.shipments
  ADD COLUMN IF NOT EXISTS dock_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS dock_completed_by text,
  ADD COLUMN IF NOT EXISTS dock_piece_count integer,
  ADD COLUMN IF NOT EXISTS inbound_status text DEFAULT 'expected'::text;

ALTER TABLE parity_dryrun.tasks
  ADD COLUMN IF NOT EXISTS qty integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE parity_dryrun.item_photos
  ALTER COLUMN tenant_id DROP NOT NULL;

-- Verify drift is gone (should return zero rows).
DO $$
DECLARE
  drift_count int;
BEGIN
  SELECT COUNT(*) INTO drift_count FROM parity_dryrun.check_drift();
  IF drift_count > 0 THEN
    RAISE NOTICE 'parity_dryrun.check_drift() still returns % rows after this migration; investigate', drift_count;
  END IF;
END$$;
