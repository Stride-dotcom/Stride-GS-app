-- ============================================================
-- Stride GS App — Photo Shares: narrow anon column exposure
--
-- The anon SELECT policy on item_photos (added in
-- 20260426120000_photo_shares.sql) already restricts which ROWS
-- anon can read (only ids referenced by an active, non-expired
-- share). This follow-up tightens column-level privileges so anon
-- can only read the columns the public gallery actually renders:
--
--   id, storage_key, thumbnail_key — needed to mint signed URLs
--   file_name                       — image alt + lightbox caption + download
--   photo_type                      — lightbox metadata
--   needs_attention, is_repair      — flag overlays
--   created_at, uploaded_by_name    — lightbox metadata
--
-- Internal IDs that the share creator never opted to expose
-- (tenant_id, item_id, entity_id, entity_type, uploaded_by) are
-- excluded — they would leak structure of the source workspace
-- without giving the public viewer anything useful.
--
-- Also drops the redundant idx_photo_shares_share_id index — the
-- UNIQUE constraint on share_id already creates a btree index.
-- ============================================================

-- Column-level grants. Supabase's anon role has SELECT on all
-- public tables by default; revoke it on item_photos and re-grant
-- only the safe columns.
REVOKE SELECT ON public.item_photos FROM anon;

GRANT SELECT (
  id,
  storage_key,
  thumbnail_key,
  file_name,
  photo_type,
  needs_attention,
  is_repair,
  created_at,
  uploaded_by_name
) ON public.item_photos TO anon;

-- Drop redundant index — UNIQUE on share_id already creates one.
DROP INDEX IF EXISTS public.idx_photo_shares_share_id;
