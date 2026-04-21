-- entity_notes.item_id — enables cross-entity rollup of notes by item.
--
-- Today, useEntityNotes queries by (entity_type, entity_id). To let the
-- Repair panel's Notes tab show inspection notes from the linked Task on
-- the same item, we need a direct item_id anchor on entity_notes. Mirrors
-- the pattern already used by item_photos.item_id.
--
-- Nullability: the column is NULL-able by design. Container entities
-- (will_call, shipment) and claim notes don't have a single owning item,
-- so they carry NULL and the rollup query filters them out with
-- `WHERE item_id IS NOT NULL`.
--
-- Backfill strategy:
--   inventory notes → item_id = entity_id (they're the same thing)
--   task notes      → item_id from tasks.item_id join
--   repair notes    → item_id from repairs.item_id join
--   will_call notes → NULL (container)
--   shipment notes  → NULL (container)
--   claim notes     → NULL (out of rollup scope)

ALTER TABLE public.entity_notes
  ADD COLUMN IF NOT EXISTS item_id text;

-- Backfill: inventory
UPDATE public.entity_notes
   SET item_id = entity_id
 WHERE entity_type = 'inventory'
   AND item_id IS NULL;

-- Backfill: tasks
UPDATE public.entity_notes n
   SET item_id = t.item_id
  FROM public.tasks t
 WHERE n.entity_type = 'task'
   AND n.entity_id   = t.task_id
   AND n.item_id IS NULL
   AND t.item_id IS NOT NULL;

-- Backfill: repairs
UPDATE public.entity_notes n
   SET item_id = r.item_id
  FROM public.repairs r
 WHERE n.entity_type = 'repair'
   AND n.entity_id   = r.repair_id
   AND n.item_id IS NULL
   AND r.item_id IS NOT NULL;

-- Index: selective for the rollup query. Partial index keeps it small
-- (will_call / shipment / claim rows never get scanned for rollup).
CREATE INDEX IF NOT EXISTS idx_entity_notes_item_id
  ON public.entity_notes (item_id)
  WHERE item_id IS NOT NULL;
