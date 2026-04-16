WITH entries AS (
  SELECT * FROM (
    VALUES
      (
        'notes.unified_module.2026-02-26',
        'decision',
        'Unified notes module implementation milestone: client create pages notes migration',
        $$Completed client create-page notes migration:

- Updated `ClientInboundCreate` and `ClientOutboundCreate` to support unified threaded public notes during create flow.
- Added draft-shipment bootstrap path used specifically for unified note composition before final submit.
- Preserved fallback textarea behavior if draft bootstrap is not available.
- On submit, latest unified public note is mirrored back into legacy `shipments.notes` for compatibility.
- Existing create-time note mirroring remains in place for non-draft fallback flow.

This closes the remaining create-page notes UI gap for client inbound/outbound workflows.$$,
        'accepted',
        'implementation',
        'v1',
        '{"entry_id":"qa-2026-02-26-018","source":"build","topic":"unified-notes-module"}'::jsonb
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
