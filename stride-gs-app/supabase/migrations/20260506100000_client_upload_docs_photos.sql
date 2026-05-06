-- 20260506100000_client_upload_docs_photos.sql
--
-- Allow authenticated CLIENT users to upload documents + photos to entities
-- in their own tenant. Pre-migration: only admin/staff could upload (every
-- write policy on storage.objects + public.documents + public.item_photos
-- was gated on role IN ('admin','staff')). Justin's customer hit this when
-- attempting to attach a doc to a will call from the client portal — the
-- React UI surfaces the upload affordance for clients but the backing RLS
-- silently 403'd every upload.
--
-- Scope of this migration:
--   - Clients can INSERT into public.documents + public.item_photos when
--     tenant_id matches one of their accessible tenants (via the existing
--     user_has_tenant_access helper).
--   - Clients can INSERT into the `documents` and `photos` storage buckets
--     when the storage path's first folder matches one of their accessible
--     tenants (matches the existing tenant-isolation pattern used by every
--     `*_select_tenant` policy).
--   - UPDATE / DELETE on documents + item_photos remains staff-only. If a
--     client uploads the wrong file, they ask staff to remove it. Future
--     work: track uploaded_by = auth.uid() and allow clients to soft-delete
--     their own uploads.
--   - The existing `intakes_anon_upload` storage policy (anonymous public
--     intake form uploads to documents/intakes/...) is untouched — it lives
--     on a different folder root.

-- ─── public.documents ───────────────────────────────────────────────────────
--
-- Adds INSERT-only permission for client role on rows where tenant_id is
-- accessible. Existing documents_write_staff (FOR ALL) is preserved so staff
-- continue to have full write access — RLS policies are OR'd, so adding
-- this is purely additive.
CREATE POLICY "documents_insert_own_tenant_client"
ON public.documents
FOR INSERT
TO authenticated
WITH CHECK (
  ((auth.jwt() -> 'user_metadata' ->> 'role') = 'client')
  AND user_has_tenant_access(tenant_id)
);

-- ─── public.item_photos ─────────────────────────────────────────────────────
CREATE POLICY "item_photos_insert_own_tenant_client"
ON public.item_photos
FOR INSERT
TO authenticated
WITH CHECK (
  ((auth.jwt() -> 'user_metadata' ->> 'role') = 'client')
  AND user_has_tenant_access(tenant_id)
);

-- ─── storage.objects: documents bucket ──────────────────────────────────────
--
-- Storage path layout (set by uploadDocument in src/hooks/useDocuments.ts):
--   {tenant_id}/{contextType}-{contextId}/{ts}-{rand}-{filename}
--
-- so split_part(name, '/', 1) gives the tenant_id, matching the pattern the
-- existing documents_select_tenant policy already uses for read access.
CREATE POLICY "documents_insert_own_tenant_client"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'documents'
  AND ((auth.jwt() -> 'user_metadata' ->> 'role') = 'client')
  AND user_has_tenant_access_storage(split_part(name, '/', 1))
);

-- ─── storage.objects: photos bucket ─────────────────────────────────────────
--
-- Path layout: {tenant_id}/... — matches photos_select_tenant pattern.
CREATE POLICY "photos_insert_own_tenant_client"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'photos'
  AND ((auth.jwt() -> 'user_metadata' ->> 'role') = 'client')
  AND user_has_tenant_access_storage(split_part(name, '/', 1))
);
