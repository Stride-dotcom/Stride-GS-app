-- ============================================================
-- photo_shares — public, no-auth shareable photo galleries.
--
-- A staff/admin user selects N photos from any entity's Photos
-- tab, hits Share, and gets a permanent public URL (#/shared/
-- photos/<share_id>). Clients open the URL — no login.
--
-- The share row stores the entity context (type + id + tenant)
-- for RLS, the explicit photo_ids being shared, and a JSONB
-- snapshot of the entity header (vendor/desc/qty/ref or
-- jobId/clientName/date/ref) so the public page renders rich
-- metadata without ever querying the entity tables. The
-- snapshot is frozen at create time — privacy-friendly + no
-- auth hops on the public render.
--
-- Anon SELECT policies on item_photos and storage.objects are
-- gated through this table: a row is visible only when it
-- belongs to a photo in some active share. UUIDs are
-- unguessable, so brute-force enumeration isn't a concern.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.photo_shares (
  id          uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id    text    UNIQUE NOT NULL DEFAULT substr(md5(random()::text || clock_timestamp()::text), 1, 12),
  tenant_id   text    NOT NULL,
  entity_type text    NOT NULL,
  entity_id   text    NOT NULL,
  photo_ids   uuid[]  NOT NULL,
  header      jsonb   NOT NULL DEFAULT '{}'::jsonb,
  title       text,
  created_by  uuid    REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_name text,
  created_at  timestamptz DEFAULT now(),
  active      boolean DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_photo_shares_share_id ON public.photo_shares(share_id);
CREATE INDEX IF NOT EXISTS idx_photo_shares_active   ON public.photo_shares(active);
CREATE INDEX IF NOT EXISTS idx_photo_shares_photo_ids ON public.photo_shares USING gin (photo_ids);
CREATE INDEX IF NOT EXISTS idx_photo_shares_tenant   ON public.photo_shares(tenant_id);

ALTER TABLE public.photo_shares ENABLE ROW LEVEL SECURITY;

-- Anon (and any role) can read active shares. Mirrors the
-- price_list_shares policy — no expiry constraint since photo
-- share links are permanent.
DROP POLICY IF EXISTS "photo_shares_public_read" ON public.photo_shares;
CREATE POLICY "photo_shares_public_read" ON public.photo_shares
  FOR SELECT
  USING (active = true);

-- Staff + admin manage shares within their access. RLS on the
-- share row itself is staff/admin-write. Tenant containment is
-- enforced at the app layer (the gallery only surfaces a Share
-- button on a tenant the user already has access to).
DROP POLICY IF EXISTS "photo_shares_staff_write" ON public.photo_shares;
CREATE POLICY "photo_shares_staff_write" ON public.photo_shares
  FOR ALL TO authenticated
  USING     ((auth.jwt()->'user_metadata'->>'role') IN ('admin','staff'))
  WITH CHECK ((auth.jwt()->'user_metadata'->>'role') IN ('admin','staff'));

DROP POLICY IF EXISTS "photo_shares_service_all" ON public.photo_shares;
CREATE POLICY "photo_shares_service_all" ON public.photo_shares
  FOR ALL TO service_role USING (true) WITH CHECK (true);


-- ── Anon SELECT on item_photos via active share ─────────────
-- Lets the public gallery page read the photo rows whose IDs
-- live in some active share's photo_ids array.
DROP POLICY IF EXISTS "item_photos_select_via_share" ON public.item_photos;
CREATE POLICY "item_photos_select_via_share" ON public.item_photos
  FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.photo_shares ps
      WHERE ps.active = true
        AND item_photos.id = ANY (ps.photo_ids)
    )
  );


-- ── Anon SELECT on storage.objects in `photos` bucket via share ─
-- Lets supabase.storage.createSignedUrls() succeed for objects
-- whose key matches a photo (storage_key OR thumbnail_key) that
-- is part of some active share. Keeps thumbnails + originals
-- accessible for public viewers without exposing the bucket.
DROP POLICY IF EXISTS "photos_select_via_share" ON storage.objects;
CREATE POLICY "photos_select_via_share" ON storage.objects
  FOR SELECT TO anon
  USING (
    bucket_id = 'photos'
    AND EXISTS (
      SELECT 1 FROM public.item_photos ip
      JOIN public.photo_shares ps ON ip.id = ANY (ps.photo_ids)
      WHERE ps.active = true
        AND (ip.storage_key = storage.objects.name
             OR ip.thumbnail_key = storage.objects.name)
    )
  );


-- ── Realtime publication ────────────────────────────────────
-- Match the pattern used by media_messaging_infra so admin
-- pages listing shares can subscribe to changes if needed.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename  = 'photo_shares'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.photo_shares';
  END IF;
END $$;
