WITH entries AS (
  SELECT * FROM (
    VALUES
      (
        'notes.unified_module.2026-02-26',
        'decision',
        'Unified notes module implementation milestone: repair quote token bridge',
        $$Completed token-portal bridge milestone:

- Added `create_unified_note_from_repair_quote_token` RPC to allow tech/client magic-link repair quote flows to append unified notes without authenticated session context.
- Enforced token validation (exists, not expired, not already used, allowed token type).
- Forced note visibility/type by token context:
  - `tech_quote` -> internal notes
  - `client_review` -> public notes
- Wired token portal hooks to append unified notes on:
  - technician quote submission notes
  - technician decline reason
  - client decline reason.$$,
        'accepted',
        'implementation',
        'v1',
        '{"entry_id":"qa-2026-02-26-011","source":"build","topic":"unified-notes-module"}'::jsonb
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
