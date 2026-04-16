WITH entries AS (
  SELECT * FROM (
    VALUES
      (
        'notes.unified_module.2026-02-26',
        'decision',
        'Unified notes module implementation milestone: username management UI and validation',
        $$Completed username management UI for @mentions support:

- Added reusable username normalization/format validation utilities.
- Added self-service username edit controls in Settings > Profile.
- Added admin username edit controls in user management dialog.
- Added tenant-scoped uniqueness checks before save and friendly duplicate handling.
- Preserved auto-generation behavior by keeping auto-managed usernames non-manual unless explicitly changed.

This closes the outstanding username editability decision for staff/admin workflows.$$,
        'accepted',
        'implementation',
        'v1',
        '{"entry_id":"qa-2026-02-26-016","source":"build","topic":"unified-notes-module"}'::jsonb
      ),
      (
        'notes.unified_module.2026-02-26',
        'decision',
        'Unified notes module implementation milestone: legacy notes module cleanup',
        $$Completed legacy notes path cleanup:

- Removed deprecated NotesModule/NoteComposer/NotesList/NoteItem UI components.
- Removed deprecated useNotes hook and legacy lib/notes types/service helpers.
- Updated notes barrel exports to point to the unified module utilities/components only.
- Removed duplicate legacy shipment.notes rendering from ClientShipmentDetail so client detail now relies on unified notes rendering path.

This reduces dual-source rendering and keeps unified notes as the canonical UI path.$$,
        'accepted',
        'implementation',
        'v1',
        '{"entry_id":"qa-2026-02-26-017","source":"build","topic":"unified-notes-module"}'::jsonb
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
