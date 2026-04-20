-- Session 74: backfill historical note text from the legacy per-entity
-- columns (tasks.task_notes, repairs.repair_notes, will_calls.notes,
-- shipments.notes, inventory.item_notes) into entity_notes so the new
-- threaded notes UI shows existing content on first load.
--
-- Idempotency: guarded by NOT EXISTS on (entity_type, entity_id,
-- is_system=true) — re-running this migration on rows that were
-- already backfilled is a no-op. is_system=true marks these as
-- imported (renders differently from user-authored notes in the UI).
--
-- Applied counts on first run:
--   inventory:  12
--   shipment:   85
--   task:      202
--   will_call:   7
--   repair:      0  (repair_notes column not populated yet)

INSERT INTO public.entity_notes (tenant_id, entity_type, entity_id, body, note_type, visibility, author_name, is_system, created_at)
SELECT t.tenant_id, 'task', t.task_id, t.task_notes, 'note', 'public', 'Imported', true, COALESCE(t.updated_at, t.created_at, now())
FROM public.tasks t
WHERE t.task_notes IS NOT NULL AND TRIM(t.task_notes) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.entity_notes en
    WHERE en.entity_type = 'task' AND en.entity_id = t.task_id AND en.is_system = true
  );

INSERT INTO public.entity_notes (tenant_id, entity_type, entity_id, body, note_type, visibility, author_name, is_system, created_at)
SELECT r.tenant_id, 'repair', r.repair_id, r.repair_notes, 'note', 'public', 'Imported', true, COALESCE(r.updated_at, r.created_at, now())
FROM public.repairs r
WHERE r.repair_notes IS NOT NULL AND TRIM(r.repair_notes) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.entity_notes en
    WHERE en.entity_type = 'repair' AND en.entity_id = r.repair_id AND en.is_system = true
  );

INSERT INTO public.entity_notes (tenant_id, entity_type, entity_id, body, note_type, visibility, author_name, is_system, created_at)
SELECT w.tenant_id, 'will_call', w.wc_number, w.notes, 'note', 'public', 'Imported', true, COALESCE(w.updated_at, w.created_at, now())
FROM public.will_calls w
WHERE w.notes IS NOT NULL AND TRIM(w.notes) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.entity_notes en
    WHERE en.entity_type = 'will_call' AND en.entity_id = w.wc_number AND en.is_system = true
  );

INSERT INTO public.entity_notes (tenant_id, entity_type, entity_id, body, note_type, visibility, author_name, is_system, created_at)
SELECT s.tenant_id, 'shipment', s.shipment_number, s.notes, 'note', 'public', 'Imported', true, COALESCE(s.updated_at, s.created_at, now())
FROM public.shipments s
WHERE s.notes IS NOT NULL AND TRIM(s.notes) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.entity_notes en
    WHERE en.entity_type = 'shipment' AND en.entity_id = s.shipment_number AND en.is_system = true
  );

INSERT INTO public.entity_notes (tenant_id, entity_type, entity_id, body, note_type, visibility, author_name, is_system, created_at)
SELECT i.tenant_id, 'inventory', i.item_id, i.item_notes, 'note', 'public', 'Imported', true, COALESCE(i.updated_at, i.created_at, now())
FROM public.inventory i
WHERE i.item_notes IS NOT NULL AND TRIM(i.item_notes) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.entity_notes en
    WHERE en.entity_type = 'inventory' AND en.entity_id = i.item_id AND en.is_system = true
  );
