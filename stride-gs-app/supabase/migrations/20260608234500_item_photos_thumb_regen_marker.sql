-- Thumbnail-regeneration progress marker for the one-time 1000px backfill.
-- ========================================================================
-- PR #664 bumped new-upload thumbnails 400px → 1000px. The ~6,437 existing
-- photos still have 400px thumbnails baked into storage and look soft on the
-- hi-DPI grid. The `backfill-photo-thumbnails` edge function regenerates them
-- in batches; this column lets the backfill be resumable + idempotent and
-- makes "how many are left?" a trivial COUNT.
--
--   NULL      → not yet regenerated (eligible for the backfill, if old enough)
--   timestamp → regenerated at 1000px (or permanently skipped — see error log
--               in the edge-function response; a bad/undecodable original
--               keeps its old thumb and is stamped so the batch can advance)
--
-- New uploads (post-PR-#664) already produce 1000px thumbs, so the backfill
-- bounds its work to rows created before the deploy cutoff — those new rows
-- are simply never eligible and don't need a stamp.

ALTER TABLE public.item_photos
  ADD COLUMN IF NOT EXISTS thumb_regen_at timestamptz;

COMMENT ON COLUMN public.item_photos.thumb_regen_at IS
  'Set by backfill-photo-thumbnails when the thumbnail has been regenerated '
  'at the current 1000px spec (or permanently skipped). NULL = original 400px '
  'thumb from before PR #664. Added 2026-06-08.';

-- Partial index for the drain query: the backfill repeatedly asks for the
-- next batch of un-regenerated rows. Once the backfill completes, every old
-- row is stamped and this index stays tiny (only ever-NULL edge cases).
CREATE INDEX IF NOT EXISTS idx_item_photos_thumb_regen_pending
  ON public.item_photos (created_at)
  WHERE thumb_regen_at IS NULL AND thumbnail_key IS NOT NULL;
