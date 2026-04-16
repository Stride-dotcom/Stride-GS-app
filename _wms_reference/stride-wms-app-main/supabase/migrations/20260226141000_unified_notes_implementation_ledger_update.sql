WITH entries AS (
  SELECT * FROM (
    VALUES
      (
        'notes.unified_module.2026-02-26',
        'decision',
        'Unified notes module implementation milestone: shared UI + hooks',
        $$Completed implementation milestone:

- Built reusable UnifiedNotesSection UI and useUnifiedNotes data hook.
- Added threaded ordering by latest activity, reply inheritance, edit/delete support, and source-context badges.
- Added @mention parsing/autocomplete + in-app message notification fan-out for internal notes.
- Added username support and note-linking model in unified notes migration for multi-entity context.$$,
        'accepted',
        'implementation',
        'v1',
        '{"entry_id":"qa-2026-02-26-006","source":"build","topic":"unified-notes-module"}'::jsonb
      ),
      (
        'notes.unified_module.2026-02-26',
        'decision',
        'Unified notes module implementation milestone: page integrations',
        $$Completed integration milestone:

- Replaced legacy notes UI in ItemNotesSection, ShipmentNotesSection, DockIntakeNotesPanel, TaskDetail notes panel, and ClaimNotes with unified notes module wiring.
- Kept read-only behavior for linked-source notes in item detail context.
- Kept compatibility write-through to legacy shipment_notes and item_notes tables via wrapper hooks during transition.$$,
        'accepted',
        'implementation',
        'v1',
        '{"entry_id":"qa-2026-02-26-007","source":"build","topic":"unified-notes-module"}'::jsonb
      ),
      (
        'notes.unified_module.2026-02-26',
        'decision',
        'Unified notes module implementation milestone: token rollout',
        $$Completed token milestone:

- Added entity note-type token support in send-alerts for:
  [[shipment.internal_notes]], [[shipment.public_notes]], [[shipment.exception_notes]]
  [[task.internal_notes]], [[task.public_notes]], [[task.exception_notes]]
  [[item.internal_notes]], [[item.public_notes]], [[item.exception_notes]]
  [[claim.internal_notes]], [[claim.public_notes]], [[claim.exception_notes]]
  [[quote.internal_notes]], [[quote.public_notes]], [[quote.exception_notes]]
  [[stocktake.internal_notes]], [[stocktake.public_notes]], [[stocktake.exception_notes]]
  [[repair_quote.internal_notes]], [[repair_quote.public_notes]], [[repair_quote.exception_notes]]
- Added token catalog entries in template editor + CSV token reference.
- Added migration to replace legacy generic note placeholders in system templates with audience-appropriate unified tokens.$$,
        'accepted',
        'implementation',
        'v1',
        '{"entry_id":"qa-2026-02-26-008","source":"build","topic":"unified-notes-module"}'::jsonb
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

