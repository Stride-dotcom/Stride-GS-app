-- Storage policies for the public client-intake upload path.
--
-- Prospects have no auth session — they arrive via a magic /intake/:linkId
-- URL and need to upload a resale certificate / additional docs. The
-- anonymous INSERT policy is locked to the `intakes/` prefix of the
-- existing `documents` bucket so the public form can't write to any
-- other path in the bucket (client invoices, etc.).
--
-- Read stays authenticated + role-gated so only staff/admin can open
-- an intake's uploaded files during review.

DROP POLICY IF EXISTS "intakes_anon_upload" ON storage.objects;
CREATE POLICY "intakes_anon_upload" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'documents' AND (storage.foldername(name))[1] = 'intakes');

DROP POLICY IF EXISTS "intakes_staff_read" ON storage.objects;
CREATE POLICY "intakes_staff_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'documents'
         AND (storage.foldername(name))[1] = 'intakes'
         AND (auth.jwt()->'user_metadata'->>'role') IN ('admin','staff'));
