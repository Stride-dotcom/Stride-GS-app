-- ============================================================
-- Stride GS App — Photo Shares (public photo gallery links)
--
-- photo_shares: a permanent shareable link to a curated set of
-- photos from one entity (inventory item, shipment, will call,
-- task, repair, claim). The selecting user picks the photos in
-- the entity's Photos tab and clicks Share; the row records the
-- entity context + the chosen photo ids and gets a public URL.
--
-- The public gallery (#/shared/photos/:share_id) is rendered
-- without authentication, so:
--   - anon can SELECT active, non-expired photo_shares rows
--   - anon can SELECT the item_photos rows whose ids appear in
--     an active share's photo_ids
--   - anon can SELECT the underlying storage.objects in the
--     `photos` bucket that back those photos (so the public
--     page can mint signed URLs the same way the authenticated
--     gallery already does)
--
-- "Permanent" means expires_at is NULL by default. Admins can
-- still set an expiry and can revoke a share via active=false.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.photo_shares (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id        text        UNIQUE NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', ''),
  entity_type     text        NOT NULL,
  entity_id       text        NOT NULL,
  tenant_id       text        NOT NULL,
  photo_ids       uuid[]      NOT NULL,
  -- Snapshot of the header info shown on the public gallery so the
  -- public page never has to query (and never gains anon read on)
  -- inventory_cache / shipments_cache / etc. Shape is:
  --   { label: string, title?: string, subtitle?: string,
  --     meta?: { [k: string]: string | number | null } }
  entity_context  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  title           text,
  created_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_name text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz,
  active          boolean     NOT NULL DEFAULT true,
  CHECK (array_length(photo_ids, 1) > 0)
);

COMMENT ON TABLE public.photo_shares
  IS 'Public-link photo galleries. share_id is the URL slug; photo_ids are the chosen item_photos.id values. entity_context is a snapshot of the header info so the unauthenticated public page never needs to read entity tables.';

CREATE INDEX IF NOT EXISTS idx_photo_shares_share_id ON public.photo_shares(share_id);
CREATE INDEX IF NOT EXISTS idx_photo_shares_active   ON public.photo_shares(active) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_photo_shares_entity   ON public.photo_shares(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_photo_shares_tenant   ON public.photo_shares(tenant_id);
-- GIN index on photo_ids so the storage RLS lookup (uuid = ANY(photo_ids))
-- has an index path even with thousands of shares.
CREATE INDEX IF NOT EXISTS idx_photo_shares_photo_ids ON public.photo_shares USING gin (photo_ids);

ALTER TABLE public.photo_shares ENABLE ROW LEVEL SECURITY;

-- Public (anon) read: active, non-expired only.
DROP POLICY IF EXISTS "photo_shares_public_read" ON public.photo_shares;
CREATE POLICY "photo_shares_public_read" ON public.photo_shares
  FOR SELECT
  USING (active = true AND (expires_at IS NULL OR expires_at > now()));

-- Staff + admin can manage every share (revoke / list).
DROP POLICY IF EXISTS "photo_shares_staff_all" ON public.photo_shares;
CREATE POLICY "photo_shares_staff_all" ON public.photo_shares
  FOR ALL TO authenticated
  USING     ((auth.jwt()->'user_metadata'->>'role') IN ('admin','staff'))
  WITH CHECK ((auth.jwt()->'user_metadata'->>'role') IN ('admin','staff'));

-- Clients can create + read shares scoped to their own tenant. They
-- cannot deactivate or rewrite shares created by staff (the matching
-- write policy below enforces created_by = auth.uid() on UPDATE/DELETE).
DROP POLICY IF EXISTS "photo_shares_client_read_own_tenant" ON public.photo_shares;
CREATE POLICY "photo_shares_client_read_own_tenant" ON public.photo_shares
  FOR SELECT TO authenticated
  USING (
    (auth.jwt()->'user_metadata'->>'role') = 'client'
    AND tenant_id = (auth.jwt()->'user_metadata'->>'clientSheetId')
  );

DROP POLICY IF EXISTS "photo_shares_client_insert_own_tenant" ON public.photo_shares;
CREATE POLICY "photo_shares_client_insert_own_tenant" ON public.photo_shares
  FOR INSERT TO authenticated
  WITH CHECK (
    (auth.jwt()->'user_metadata'->>'role') = 'client'
    AND tenant_id = (auth.jwt()->'user_metadata'->>'clientSheetId')
    AND created_by = auth.uid()
  );

DROP POLICY IF EXISTS "photo_shares_client_revoke_own" ON public.photo_shares;
CREATE POLICY "photo_shares_client_revoke_own" ON public.photo_shares
  FOR UPDATE TO authenticated
  USING (
    (auth.jwt()->'user_metadata'->>'role') = 'client'
    AND created_by = auth.uid()
  )
  WITH CHECK (
    (auth.jwt()->'user_metadata'->>'role') = 'client'
    AND created_by = auth.uid()
  );

DROP POLICY IF EXISTS "photo_shares_service_all" ON public.photo_shares;
CREATE POLICY "photo_shares_service_all" ON public.photo_shares
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── Anon read on item_photos rows referenced by an active share ──
-- The existing item_photos RLS policies are authenticated-only; this
-- adds a narrow anon path so the public gallery can SELECT only the
-- specific rows whose ids were curated into an active, non-expired
-- share. Anon never gets to enumerate the table.

DROP POLICY IF EXISTS "item_photos_anon_read_via_share" ON public.item_photos;
CREATE POLICY "item_photos_anon_read_via_share" ON public.item_photos
  FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.photo_shares ps
      WHERE item_photos.id = ANY(ps.photo_ids)
        AND ps.active = true
        AND (ps.expires_at IS NULL OR ps.expires_at > now())
    )
  );

-- ── Anon read on storage.objects for the photos bucket, scoped to
-- objects whose path matches a storage_key / thumbnail_key in a row
-- referenced by an active share. Lets the public page call
-- storage.from('photos').createSignedUrls(...) with the anon key.
DROP POLICY IF EXISTS "photos_anon_read_via_share" ON storage.objects;
CREATE POLICY "photos_anon_read_via_share" ON storage.objects
  FOR SELECT TO anon
  USING (
    bucket_id = 'photos'
    AND EXISTS (
      SELECT 1
      FROM public.item_photos ip
      JOIN public.photo_shares ps ON ip.id = ANY(ps.photo_ids)
      WHERE ps.active = true
        AND (ps.expires_at IS NULL OR ps.expires_at > now())
        AND (
          storage.objects.name = ip.storage_key
          OR storage.objects.name = ip.thumbnail_key
        )
    )
  );
