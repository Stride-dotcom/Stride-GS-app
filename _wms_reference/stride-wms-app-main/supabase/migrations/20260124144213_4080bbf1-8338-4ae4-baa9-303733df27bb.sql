-- =====================================================================
-- STEP 1: Documents-private bucket + RLS policies (Stabilization Plan)
-- =====================================================================

-- 1.1 Bucket already exists, verified via query

-- 1.3 Add missing DELETE policy for documents table
DROP POLICY IF EXISTS documents_staff_delete ON public.documents;
CREATE POLICY documents_staff_delete
ON public.documents FOR DELETE
USING (tenant_id = public.user_tenant_id());

-- 1.4 Storage policies for bucket `documents-private`
-- SELECT: allow read within tenant folder
DROP POLICY IF EXISTS "documents-private read tenant" ON storage.objects;
CREATE POLICY "documents-private read tenant"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'documents-private'
  AND auth.role() = 'authenticated'
  AND (storage.objects.name LIKE ('tenants/' || public.user_tenant_id()::text || '/%'))
);

-- INSERT: allow upload within tenant folder
DROP POLICY IF EXISTS "documents-private insert tenant" ON storage.objects;
CREATE POLICY "documents-private insert tenant"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'documents-private'
  AND auth.role() = 'authenticated'
  AND (storage.objects.name LIKE ('tenants/' || public.user_tenant_id()::text || '/%'))
);

-- UPDATE: allow update within tenant folder
DROP POLICY IF EXISTS "documents-private update tenant" ON storage.objects;
CREATE POLICY "documents-private update tenant"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'documents-private'
  AND auth.role() = 'authenticated'
  AND (storage.objects.name LIKE ('tenants/' || public.user_tenant_id()::text || '/%'))
)
WITH CHECK (
  bucket_id = 'documents-private'
  AND auth.role() = 'authenticated'
  AND (storage.objects.name LIKE ('tenants/' || public.user_tenant_id()::text || '/%'))
);

-- DELETE: allow delete within tenant folder
DROP POLICY IF EXISTS "documents-private delete tenant" ON storage.objects;
CREATE POLICY "documents-private delete tenant"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'documents-private'
  AND auth.role() = 'authenticated'
  AND (storage.objects.name LIKE ('tenants/' || public.user_tenant_id()::text || '/%'))
);