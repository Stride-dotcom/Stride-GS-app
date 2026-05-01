-- Photos / documents storage RLS — tolerate `_` ↔ `-` in clientSheetId path prefix.
--
-- Background: the React upload path sanitizes the tenant ID into a path-safe
-- form, replacing `_` with `-` (sanitizeTenantForPath in usePhotos /
-- useDocuments). The original storage RLS compared the raw JWT clientSheetId
-- (which keeps `_`) against the path's first segment (where `_` was rewritten
-- to `-`), so any client whose tenant_id contains `_` (e.g. Nip Tuck:
-- `1_CINtvp...`) could not fetch their own photos via signed URLs.
--
-- Fix: accept either the raw or the underscore-stripped form of the
-- clientSheetId in the path-prefix check. Admin/staff continue to bypass.

DROP POLICY IF EXISTS "photos_select_tenant" ON storage.objects;
CREATE POLICY "photos_select_tenant" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'photos'
    AND (
      (auth.jwt()->'user_metadata'->>'role') IN ('admin','staff')
      OR split_part(name, '/', 1) = (auth.jwt()->'user_metadata'->>'clientSheetId')
      OR split_part(name, '/', 1) = replace((auth.jwt()->'user_metadata'->>'clientSheetId'), '_', '-')
    )
  );

DROP POLICY IF EXISTS "documents_select_tenant" ON storage.objects;
CREATE POLICY "documents_select_tenant" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'documents'
    AND (
      (auth.jwt()->'user_metadata'->>'role') IN ('admin','staff')
      OR split_part(name, '/', 1) = (auth.jwt()->'user_metadata'->>'clientSheetId')
      OR split_part(name, '/', 1) = replace((auth.jwt()->'user_metadata'->>'clientSheetId'), '_', '-')
    )
  );
