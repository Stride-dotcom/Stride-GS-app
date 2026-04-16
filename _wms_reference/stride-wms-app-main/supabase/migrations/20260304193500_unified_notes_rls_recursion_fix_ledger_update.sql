WITH entries AS (
  SELECT * FROM (
    VALUES
      (
        'notes.unified_module.2026-02-26',
        'decision',
        'Unified notes module regression fix: RLS recursion in notes policies',
        $$Diagnostics-driven fix completed for unified notes read/write failures:

- Investigated latest `app_issues` fingerprints and found repeated Supabase error `42P17`:
  "infinite recursion detected in policy for relation \"notes\"".
- Root cause: circular RLS dependency between:
  - notes client SELECT policy referencing `note_entity_links`
  - note_entity_links client SELECT policy referencing `notes`
- Implemented policy rewrite so notes client SELECT resolves account access directly from source entities (shipment/item/task/claim/quote/repair_quote), removing the recursive dependency.

Expected outcome:
- Unified notes fetch/add flows no longer fail with `42P17`.
- Affected pages (dock intake, shipments, tasks, inventory, quotes, repair quotes, outbound create) can load/save notes normally once migration is applied.$$,
        'accepted',
        'implementation',
        'v1',
        '{"entry_id":"qa-2026-02-26-021","source":"build","topic":"unified-notes-module"}'::jsonb
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
