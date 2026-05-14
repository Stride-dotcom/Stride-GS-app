-- ============================================================
-- Stride GS App — Unified attachment shares (photos + docs)
--
-- Extends photo_shares to optionally carry a curated set of
-- documents alongside photos. Driven by dispatchtrack's
-- "Attachments" custom field (additional_field_3): one short URL
-- per order, regardless of how many files were attached, so the
-- driver-app's text renderer auto-linkifies cleanly and tapping
-- the link opens a single gallery page showing every photo + doc
-- for that order.
--
-- Backward compatibility:
--   • Existing photos-only shares stay valid (doc_ids defaults to
--     an empty array).
--   • The /#/shared/photos/<id> route keeps resolving to the same
--     viewer component, so any link already in the wild keeps
--     working. The new /#/shared/attachments/<id> route is the
--     canonical URL emitted by dt-push-order v23+.
--   • tenant_id becomes nullable so public-form / external-
--     customer orders (which carry tenant_id IS NULL) can also
--     produce attachment shares. The client_*_own_tenant policies
--     already exclude null-tenant rows via the equality compare
--     to a JWT claim (NULL = something → NULL → false), so the
--     looser column constraint doesn't widen client visibility.
-- ============================================================

-- ── 1. doc_ids column + relaxed null-tenant + CHECK constraint ──
ALTER TABLE public.photo_shares
  ADD COLUMN IF NOT EXISTS doc_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

COMMENT ON COLUMN public.photo_shares.doc_ids IS
  'Optional curated set of documents.id values. Anon SELECT on '
  'documents + storage.objects in the documents bucket is gated '
  'through this column via documents_anon_read_via_share / '
  'documents_storage_anon_read_via_share.';

ALTER TABLE public.photo_shares
  ALTER COLUMN tenant_id DROP NOT NULL;

COMMENT ON COLUMN public.photo_shares.tenant_id IS
  'Tenant scope for the share. NULL is permitted for dt_order '
  'shares on public-form / external-customer orders that have no '
  'tenant assignment yet. Client RLS policies exclude null-tenant '
  'rows automatically because tenant_id = jwt_claim evaluates to '
  'NULL.';

-- Replace the original "photo_ids non-empty" CHECK with a unified
-- "at least one of photos or docs is non-empty" rule. The original
-- constraint was created inline on table creation so its auto-
-- generated name is brittle — look it up and drop by name.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.photo_shares'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%photo_ids%'
      AND pg_get_constraintdef(oid) NOT LIKE '%doc_ids%'
  LOOP
    EXECUTE format('ALTER TABLE public.photo_shares DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.photo_shares
  DROP CONSTRAINT IF EXISTS photo_shares_at_least_one_attachment;
ALTER TABLE public.photo_shares
  ADD CONSTRAINT photo_shares_at_least_one_attachment
    CHECK (cardinality(photo_ids) > 0 OR cardinality(doc_ids) > 0);

-- GIN index so the documents RLS lookup (id = ANY(doc_ids)) has an
-- index path even with thousands of shares — mirrors the existing
-- idx_photo_shares_photo_ids.
CREATE INDEX IF NOT EXISTS idx_photo_shares_doc_ids
  ON public.photo_shares USING gin (doc_ids);

-- ── 2. Anon read on documents rows referenced by an active share ──
-- Mirrors item_photos_anon_read_via_share. Soft-deleted rows
-- (deleted_at IS NOT NULL) stay invisible even if they were curated
-- into the share before deletion — the driver shouldn't see files
-- the operator removed.

DROP POLICY IF EXISTS "documents_anon_read_via_share" ON public.documents;
CREATE POLICY "documents_anon_read_via_share" ON public.documents
  FOR SELECT TO anon
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.photo_shares ps
      WHERE documents.id = ANY(ps.doc_ids)
        AND ps.active = true
        AND (ps.expires_at IS NULL OR ps.expires_at > now())
    )
  );

-- Column-level grants: anon can read the public-safe subset only.
-- ocr_text could carry sensitive content (extracted PII from a
-- receipt); uploaded_by / tenant_id leak workspace structure;
-- deleted_at is redundant with the row policy. Everything else the
-- public viewer actually renders is exposed.
--
-- ASSUMPTION: anon has no prior table-wide SELECT grant on documents
-- (the table predates anon read paths). If a future migration grants
-- anon broader access and is later run after this file is replayed
-- (e.g. dev DB reset), this REVOKE/GRANT pair will silently re-strip
-- it. The new migration should restate the broader grant.
REVOKE SELECT ON public.documents FROM anon;
GRANT SELECT (
  id,
  storage_key,
  file_name,
  mime_type,
  file_size,
  page_count,
  created_at,
  uploaded_by_name
) ON public.documents TO anon;

-- ── 3. Anon read on storage.objects for the documents bucket ──
-- Scoped to objects whose path matches a storage_key in a documents
-- row referenced by an active share. Lets the public attachment-
-- share page call storage.from('documents').createSignedUrls(...)
-- with the anon key. Mirrors photos_anon_read_via_share.
DROP POLICY IF EXISTS "documents_storage_anon_read_via_share" ON storage.objects;
CREATE POLICY "documents_storage_anon_read_via_share" ON storage.objects
  FOR SELECT TO anon
  USING (
    bucket_id = 'documents'
    AND EXISTS (
      SELECT 1
      FROM public.documents d
      JOIN public.photo_shares ps ON d.id = ANY(ps.doc_ids)
      WHERE ps.active = true
        AND (ps.expires_at IS NULL OR ps.expires_at > now())
        AND d.deleted_at IS NULL
        AND storage.objects.name = d.storage_key
    )
  );
