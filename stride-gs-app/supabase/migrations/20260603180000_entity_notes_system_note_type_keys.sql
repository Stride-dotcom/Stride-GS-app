-- Allow system-generated dynamic note_type keys on entity_notes (2026-06-03)
--
-- entity_notes.note_type was created (20260419200000_media_messaging_infra.sql)
-- with CHECK (note_type IN ('note','system','status_change','mention')).
--
-- Two system-note helpers use a DYNAMIC note_type that embeds an entity
-- identifier as an idempotency / dedup key (so a repeated webhook/sync
-- run won't stack duplicate notes for the same event):
--   • _shared/release-on-dt-finished.ts  postSkippedNote
--       → note_type = 'auto_release_skipped:<sorted item ids>'
--   • dt-sync-statuses                    postIdRematchNote_
--       → note_type = 'dt_id_rematch:<itemId>'   (added this PR)
--
-- Both VIOLATE the original constraint. The first is a LATENT BUG today:
-- postSkippedNote is `await`ed un-try-caught in the auto-release path, so
-- an order with a short/refused delivery would throw 23514 on the note
-- insert and bubble up. (It just hasn't fired in prod yet because that
-- branch is rare.) The second would have been silently swallowed by its
-- try/catch — but then the review note never posts.
--
-- This widens the constraint to permit those two system prefixes (LIKE
-- patterns) alongside the original four canonical values. Widening can't
-- invalidate any existing row (all current rows use the canonical four).
--
-- Safe re: rendering — the notes UI (useEntityNotes + NotesSection) selects
-- '*' and renders on is_system / body / author_name; it never branches on
-- note_type, so these custom keys render as ordinary system notes.

ALTER TABLE public.entity_notes
  DROP CONSTRAINT IF EXISTS entity_notes_note_type_check;

ALTER TABLE public.entity_notes
  ADD CONSTRAINT entity_notes_note_type_check
  CHECK (
    note_type IN ('note', 'system', 'status_change', 'mention')
    OR note_type LIKE 'auto_release_skipped:%'
    OR note_type LIKE 'dt_id_rematch:%'
  );
