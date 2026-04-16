WITH entries AS (
  SELECT * FROM (
    VALUES
      (
        'notes.unified_module.2026-02-26',
        'decision',
        'Unified notes module regression fix: expected shipment detail now uses unified notes',
        $$Completed expected-shipment detail notes migration:

- Added unified shipment notes section to `ExpectedShipmentDetail`.
- Expected inbound shipment detail now uses the shared notes module UI instead of legacy/fragmented note behavior.$$,
        'accepted',
        'implementation',
        'v1',
        '{"entry_id":"qa-2026-02-26-019","source":"build","topic":"unified-notes-module"}'::jsonb
      ),
      (
        'notes.unified_module.2026-02-26',
        'decision',
        'Unified notes module regression fix: note save compatibility for client actors',
        $$Completed unified note save compatibility fix:

- Removed frontend hard-block in `useUnifiedNotes.addNote` that required staff profile presence.
- Added SQL compatibility patch for `create_unified_note` so client-portal auth users without `public.users` row can still create public notes without FK failures.
- Added metadata marker for client-portal authored notes when `created_by` is NULL.

This addresses note-create failures observed in diagnostics for client-portal note flows.$$,
        'accepted',
        'implementation',
        'v1',
        '{"entry_id":"qa-2026-02-26-020","source":"build","topic":"unified-notes-module"}'::jsonb
      )
  ) AS t(decision_key, entry_type, title, body, status, phase, version, metadata)
)
INSERT INTO public.decision_ledger_entries (
  decision_key,
  entry_type,
  title,
  body,
  status,
  phase,
  version,
  metadata
)
SELECT
  e.decision_key,
  e.entry_type,
  e.title,
  e.body,
  e.status,
  e.phase,
  e.version,
  e.metadata
FROM entries e
WHERE NOT EXISTS (
  SELECT 1
  FROM public.decision_ledger_entries dle
  WHERE dle.decision_key = e.decision_key
    AND (dle.metadata ->> 'entry_id') = (e.metadata ->> 'entry_id')
);
