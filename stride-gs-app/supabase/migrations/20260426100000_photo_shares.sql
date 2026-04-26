-- ============================================================
-- Stride GS App — Photo Shares
--
-- photo_shares: per-entity public link for sharing a selected
-- subset of item_photos with an external recipient (typically a
-- client). Created from any entity panel that mounts the shared
-- Photos module. Permanent — no expiration; shares are revoked
-- by flipping `active=false`.
--
-- The share record snapshots the header context (item / job
-- fields) at create time so the public gallery can render a
-- meaningful header without joining live entity tables (which
-- live in Google Sheets and aren't reachable from the anon
-- client).
--
-- Anon access is gated three ways:
--   1. photo_shares: anon SELECT on active rows
--   2. item_photos:  anon SELECT when row.id is in any active share's photo_ids
--   3. storage.objects (photos bucket): anon SELECT when name matches the
--      storage_key/thumbnail_key of any photo visible via #2
--
-- That last policy is what lets createSignedUrls() work for anon —
-- the storage REST API checks SELECT permission on the object
-- before issuing a signed token.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.photo_shares (
  id              uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id        text    UNIQUE NOT NULL DEFAULT substr(md5(random()::text || clock_timestamp()::text), 1, 12),
  entity_type     text    NOT NULL,
  entity_id       text    NOT NULL,
  tenant_id       text    NOT NULL,
  photo_ids       uuid[]  NOT NULL,
  -- Snapshot of the entity's header fields at share time. Free-form
  -- so the producer can stash whatever the public page needs:
  --   item-level: { itemId, vendor, description, quantity, reference }
  --   job-level:  { jobId, clientName, date, reference }
  header_context  jsonb   NOT NULL DEFAULT '{}'::jsonb,
  title           text,
  created_by      uuid    REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_name text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  active          boolean NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_photo_shares_share_id ON public.photo_shares (share_id);
CREATE INDEX IF NOT EXISTS idx_photo_shares_active   ON public.photo_shares (active);
CREATE INDEX IF NOT EXISTS idx_photo_shares_entity   ON public.photo_shares (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_photo_shares_tenant   ON public.photo_shares (tenant_id);
-- GIN over the uuid[] column lets the RLS join on item_photos use an
-- index-backed `id = ANY(photo_ids)` rather than a sequential scan
-- per row.
CREATE INDEX IF NOT EXISTS idx_photo_shares_photo_ids ON public.photo_shares USING GIN (photo_ids);

ALTER TABLE public.photo_shares ENABLE ROW LEVEL SECURITY;

-- Public (anon) can read active shares
DROP POLICY IF EXISTS "photo_shares_public_read" ON public.photo_shares;
CREATE POLICY "photo_shares_public_read" ON public.photo_shares
  FOR SELECT
  USING (active = true);

-- Authenticated staff/admin can create + manage shares. Clients are
-- intentionally excluded from this initial cut — staff own the
-- external-share workflow today. Easy to broaden later if clients
-- need to share their own photos outward.
DROP POLICY IF EXISTS "photo_shares_staff_write" ON public.photo_shares;
CREATE POLICY "photo_shares_staff_write" ON public.photo_shares
  FOR ALL TO authenticated
  USING     ((auth.jwt()->'user_metadata'->>'role') IN ('admin','staff'))
  WITH CHECK ((auth.jwt()->'user_metadata'->>'role') IN ('admin','staff'));

DROP POLICY IF EXISTS "photo_shares_service_all" ON public.photo_shares;
CREATE POLICY "photo_shares_service_all" ON public.photo_shares
  FOR ALL TO service_role USING (true) WITH CHECK (true);


-- ── Anon SELECT on item_photos via active share ──────────────
-- Only the photo IDs included in some active share are visible to anon.
-- All other policies on item_photos remain unchanged (staff/own-tenant
-- continue to apply for authenticated users).

DROP POLICY IF EXISTS "item_photos_select_via_share" ON public.item_photos;
CREATE POLICY "item_photos_select_via_share" ON public.item_photos
  FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.photo_shares ps
      WHERE ps.active = true
        AND public.item_photos.id = ANY(ps.photo_ids)
    )
  );


-- ── Anon SELECT on storage.objects (photos bucket) via share ──
-- Matches each shared photo row's storage_key + thumbnail_key against
-- the object's name. createSignedUrl() requires SELECT on the underlying
-- object; this policy is what unblocks the public gallery rendering.

DROP POLICY IF EXISTS "photos_select_via_share" ON storage.objects;
CREATE POLICY "photos_select_via_share" ON storage.objects
  FOR SELECT TO anon
  USING (
    bucket_id = 'photos'
    AND EXISTS (
      SELECT 1
      FROM public.item_photos p
      WHERE (p.storage_key = storage.objects.name OR p.thumbnail_key = storage.objects.name)
        AND EXISTS (
          SELECT 1 FROM public.photo_shares ps
          WHERE ps.active = true AND p.id = ANY(ps.photo_ids)
        )
    )
  );
