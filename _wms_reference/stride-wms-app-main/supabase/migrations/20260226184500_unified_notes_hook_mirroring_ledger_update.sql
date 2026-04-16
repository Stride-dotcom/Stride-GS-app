WITH entries AS (
  SELECT * FROM (
    VALUES
      (
        'notes.unified_module.2026-02-26',
        'decision',
        'Unified notes module implementation milestone: legacy hook note mirroring',
        $$Completed additional migration tasks:

- Removed unused legacy task note state/save path in TaskDetail now that UnifiedNotesSection is the authoritative UI.
- Added unified-note mirroring in claims hook paths:
  - createClaim (public/internal legacy fields)
  - updateClaimStatus (including denial resolution notes)
  - updateClaim (legacy note fields)
- Added unified-note mirroring for legacy repair quote create notes in useRepairQuotes.

This preserves compatibility with remaining legacy columns while keeping unified notes as the canonical threaded surface.$$,
        'accepted',
        'implementation',
        'v1',
        '{"entry_id":"qa-2026-02-26-010","source":"build","topic":"unified-notes-module"}'::jsonb
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
