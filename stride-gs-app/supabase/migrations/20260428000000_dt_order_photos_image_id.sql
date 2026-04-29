-- 20260428000000_dt_order_photos_image_id.sql
--
-- DT's export.xml `<image>` element carries a stable `id` attribute
-- (32-hex-char hash) that doesn't change across regenerations of the
-- ephemeral src/thumbnail URLs. We use it as the dedupe key for
-- dt_order_photos so re-running dt-sync-statuses doesn't double-store
-- the same photo each time URLs are refreshed.
--
-- Also stashes the original DT image filename + thumbnail URL +
-- thumbnail storage path so the UI can show real thumbnails instead
-- of full-res in the gallery.

ALTER TABLE public.dt_order_photos
  ADD COLUMN IF NOT EXISTS dt_image_id        text,
  ADD COLUMN IF NOT EXISTS dt_image_name      text,
  ADD COLUMN IF NOT EXISTS thumbnail_dt_url   text;

-- One row per (order, image-id). The original schema didn't enforce
-- this because it pre-dated the image_id field; without the unique
-- constraint, repeated syncs would insert duplicates every 30 min as
-- DT URLs rotate.
CREATE UNIQUE INDEX IF NOT EXISTS dt_order_photos_order_image_uniq
  ON public.dt_order_photos (dt_order_id, dt_image_id)
  WHERE dt_image_id IS NOT NULL;

COMMENT ON COLUMN public.dt_order_photos.dt_image_id IS
  'Stable photo identifier from DT (image[id] attribute). NULL for legacy rows or photos sourced outside the export API.';
