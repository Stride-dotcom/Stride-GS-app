WITH entries AS (
  SELECT * FROM (
    VALUES
      (
        'notes.unified_module.2026-02-26',
        'decision',
        'Unified notes module implementation milestone: shipment operations note mirroring',
        $$Completed shipment-operations migration pass:

- Added unified note appends for shipment operational actions in ShipmentDetail:
  - cancel shipment
  - partial release note events
- Added unified note appends in ShipmentExceptionActions:
  - resolve unknown account note
  - return draft creation note
- Added unified note appends in ReassignAccountDialog for shipment split operations:
  - split note on newly created shipment
  - source shipment split trace note
- Added unified note mirroring to ShipmentEditDialog for legacy `shipments.notes` edits.

Legacy column writes are still preserved for compatibility, while unified notes now receive the same operational context.$$,
        'accepted',
        'implementation',
        'v1',
        '{"entry_id":"qa-2026-02-26-012","source":"build","topic":"unified-notes-module"}'::jsonb
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
