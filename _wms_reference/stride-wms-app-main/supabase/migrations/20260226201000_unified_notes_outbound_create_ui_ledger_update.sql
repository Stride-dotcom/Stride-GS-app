WITH entries AS (
  SELECT * FROM (
    VALUES
      (
        'notes.unified_module.2026-02-26',
        'decision',
        'Unified notes module implementation milestone: outbound create unified notes UI',
        $$Completed outbound create UI migration:

- Upgraded OutboundCreate notes tabs to use the shared ShipmentNotesSection (UnifiedNotesSection wrapper) for:
  - Public notes
  - Internal notes
  - Exception notes
- Kept fallback textareas while draft shipment ID is initializing.
- Updated submit flow to resolve latest unified public/internal notes from the draft shipment and use those values for:
  - shipment legacy column sync (`notes`, `receiving_notes`)
  - split-task request note payloads
- Added duplicate guard in legacy-sync helper to avoid creating duplicate unified notes when users already authored notes directly in unified UI.$$,
        'accepted',
        'implementation',
        'v1',
        '{"entry_id":"qa-2026-02-26-013","source":"build","topic":"unified-notes-module"}'::jsonb
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
