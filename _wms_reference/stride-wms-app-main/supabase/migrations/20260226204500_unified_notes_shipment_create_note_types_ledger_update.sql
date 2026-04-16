WITH entries AS (
  SELECT * FROM (
    VALUES
      (
        'notes.unified_module.2026-02-26',
        'decision',
        'Unified notes module implementation milestone: shipment create note-type split',
        $$Completed shipment create note-type migration:

- Updated ShipmentCreate UI from a single notes field to explicit Public/Internal note tabs.
- Updated shipment creation payload to keep legacy compatibility columns aligned:
  - public notes -> `shipments.notes`
  - internal notes -> `shipments.receiving_notes`
- Added unified note creation on shipment create for both note types:
  - public note with `legacy_field = shipments.notes`
  - internal note with `legacy_field = shipments.receiving_notes`.$$,
        'accepted',
        'implementation',
        'v1',
        '{"entry_id":"qa-2026-02-26-014","source":"build","topic":"unified-notes-module"}'::jsonb
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
