-- =============================================================================
-- Unified Notes Module - Decision Ledger Q&A Log (Pre-Implementation Lock)
-- =============================================================================
-- Purpose:
--   Append the complete Q&A and finalized decisions for the unified notes module
--   into the immutable decision_ledger_entries table before implementation work.
--
-- Notes:
--   - Append-only insert pattern with idempotency guard via metadata.entry_id.
--   - Does not mutate existing decision ledger entries.
-- =============================================================================

WITH entries AS (
  SELECT * FROM (
    VALUES
      (
        'notes.unified_module.2026-02-26',
        'decision',
        'Unified notes system scope and architecture locked',
        $$Decision locked for implementation:

Build a single pluggable notes module used by all pages/entities with notes (shipments, tasks, items, quotes, claims, stocktakes, and related workflows), using a global canonical notes model with cross-entity links, unified UX, and centralized token rendering.

This supersedes fragmented per-entity note implementations and legacy single-field note columns as the long-term source of truth.$$,
        'accepted',
        'discovery',
        'v1',
        '{"entry_id":"qa-2026-02-26-001","source":"chat","topic":"unified-notes-module"}'::jsonb
      ),
      (
        'notes.unified_module.2026-02-26',
        'note',
        NULL,
        $$Q&A / Decision log (part 1):

Q1: Scope of unified notes module?
A1: Every page/entity with notes should use one unified module (shipments, tasks, quotes, claims, stocktake, etc.).

Q2: How should template tokens work?
A2: Use explicit per-entity, per-note-type tokens for maximum template flexibility.
Examples: [[task.internal_notes]], [[task.public_notes]], [[task.exception_notes]] and equivalents across entities.

Q3: Token migration strategy?
A3: Full switch to new note-type tokens; update system templates accordingly.
Client-facing templates use public/exception notes; internal templates use internal notes.

Q4: Data architecture recommendation?
A4: Global notes table + note_entity_links table selected for scale, organization, and cross-entity querying.

Q5: Cross-entity viewing requirement?
A5: Item detail notes should be able to show related task/shipment/item notes in corresponding note type views.

Q6: Auto-link behavior?
A6: Every note links to the originating job/entity and to directly related items (e.g., task + task.items).

Q7: Exception notes scope?
A7: Exception notes remain shipment-only (inbound/outbound); hide exception UI for non-shipment entities.$$,
        NULL,
        'discovery',
        'v1',
        '{"entry_id":"qa-2026-02-26-002","source":"chat","topic":"unified-notes-module"}'::jsonb
      ),
      (
        'notes.unified_module.2026-02-26',
        'note',
        NULL,
        $$Q&A / Decision log (part 2):

Q8: Cross-entity notes editability in related views?
A8: Read-only when viewed from a related entity context.

Q9: Thread sorting behavior?
A9: Threaded notes; when a reply is added, the parent thread moves to top based on latest thread activity.

Q10: Source context in cross-entity notes?
A10: Show clickable source badges (e.g., "Task TSK-123") that deep-link to source detail pages.

Q11: Reply note type behavior?
A11: Replies inherit parent note type/visibility.

Q12: Mentions?
A12: Internal notes support @mentions with Instagram-style autocomplete; mention sends in-app message/alert without template setup.

Q13: Mention reply workflow?
A13: Message inbox replies should sync back into original entity note thread.

Q14: Username model?
A14: Add usernames auto-generated from profile name (firstname_lastname + numeric suffix collision handling).
Usernames auto-update only when profile name changes (option B), and remain manually editable with uniqueness validation.

Q15: Mention scope?
A15: Internal notes only; suggest staff users only.

Q16: Internal-note UX helper?
A16: Add HelpTip "(i)" by internal notes control explaining @mention behavior.

Q17: Rich token rendering requirement?
A17: Note tokens render as formatted thread blocks with author + timestamp + note + source links.$$,
        NULL,
        'discovery',
        'v1',
        '{"entry_id":"qa-2026-02-26-003","source":"chat","topic":"unified-notes-module"}'::jsonb
      ),
      (
        'notes.unified_module.2026-02-26',
        'note',
        NULL,
        $$Q&A / Decision log (part 3):

Q18: Legacy data migration?
A18: Legacy single-field notes migrate to internal note type by default.

Q19: Edit permissions?
A19: Editable across all note types by author, admin, and manager.

Q20: Deletion behavior?
A20: Soft-delete notes (accidental entry recovery/audit trail) by author, admin, and manager.

Q21: Final implementation preference?
A21: Option A selected where previously presented ("opt a"), and implementation to proceed after decision lock.

Implementation gate:
- Decisions captured and locked in ledger before coding.
- Implementation updates must append completion statuses back to same decision_key.$$,
        NULL,
        'discovery',
        'v1',
        '{"entry_id":"qa-2026-02-26-004","source":"chat","topic":"unified-notes-module"}'::jsonb
      ),
      (
        'notes.unified_module.2026-02-26',
        'status',
        NULL,
        $$Decision discovery and Q&A logging completed. Implementation authorized to begin.$$,
        'scope_locked_ready_for_build',
        'implementation',
        'v1',
        '{"entry_id":"qa-2026-02-26-005","source":"chat","topic":"unified-notes-module"}'::jsonb
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
