WITH entries AS (
  SELECT * FROM (
    VALUES
      (
        'notes.unified_module.2026-02-26',
        'decision',
        'Unified notes module implementation milestone: extended migration pass',
        $$Completed extended migration pass:

- Replaced legacy shipment detail notes editing/view UI with unified shipment notes sections (public/internal/exception) in both read and edit contexts.
- Removed legacy shipment notes column overwrites from ShipmentDetail save flow to prevent stale-value clobbering.
- Migrated QuoteBuilder existing-quote notes panel to UnifiedNotesSection and mirrored initial create-time quote notes into unified notes.
- Migrated claim notes editors in ClaimEditDialog and ClientClaims to UnifiedNotesSection (client claim notes now use public-thread scope).
- Migrated repair quote office notes editors in RepairQuoteDetail and RepairQuoteDetailDialog to UnifiedNotesSection.
- Added stocktake unified notes rendering in StocktakeReport.
- Added create-flow note mirroring into unified notes for ShipmentCreate, OutboundCreate, ClientInboundCreate, ClientOutboundCreate, and stocktake creation hook.$$,
        'accepted',
        'implementation',
        'v1',
        '{"entry_id":"qa-2026-02-26-009","source":"build","topic":"unified-notes-module"}'::jsonb
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
