-- Session 93 — `invoices` storage bucket. Auto-generates a PDF for
-- every invoice on the React side immediately after handleCreateInvoice_
-- succeeds, then PATCHes billing.invoice_url to point at a long-lived
-- signed URL into this bucket. Replaces the optional Drive PDF flow.
--
-- Path layout: {tenant_id}/{invoice_no}.pdf
--
-- RLS mirrors `resale-certs`:
--   - admin/staff read all
--   - client reads own tenant (path prefix match)
--   - service role full
--   - upload via authenticated insert by admin/staff (the React app
--     drives generation post-create using the user's session)

INSERT INTO storage.buckets (id, name, public)
VALUES ('invoices', 'invoices', false)
ON CONFLICT (id) DO NOTHING;

-- Read: admin/staff see every tenant's invoices.
DROP POLICY IF EXISTS "invoices_read_staff" ON storage.objects;
CREATE POLICY "invoices_read_staff" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'invoices'
    AND (auth.jwt()->'user_metadata'->>'role') IN ('admin','staff')
  );

-- Read: client reads their own tenant's invoices (first path segment
-- = client's spreadsheet_id).
DROP POLICY IF EXISTS "invoices_read_own_tenant" ON storage.objects;
CREATE POLICY "invoices_read_own_tenant" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'invoices'
    AND (auth.jwt()->'user_metadata'->>'role') = 'client'
    AND (storage.foldername(name))[1] = (auth.jwt()->'user_metadata'->>'clientSheetId')
  );

-- Insert + update: admin/staff (the React app uploads with the user's
-- session). Service role full access for any future server-side path.
DROP POLICY IF EXISTS "invoices_write_staff" ON storage.objects;
CREATE POLICY "invoices_write_staff" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'invoices'
    AND (auth.jwt()->'user_metadata'->>'role') IN ('admin','staff')
  );

DROP POLICY IF EXISTS "invoices_update_staff" ON storage.objects;
CREATE POLICY "invoices_update_staff" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'invoices'
    AND (auth.jwt()->'user_metadata'->>'role') IN ('admin','staff')
  )
  WITH CHECK (
    bucket_id = 'invoices'
    AND (auth.jwt()->'user_metadata'->>'role') IN ('admin','staff')
  );

DROP POLICY IF EXISTS "invoices_service_all" ON storage.objects;
CREATE POLICY "invoices_service_all" ON storage.objects
  FOR ALL TO service_role
  USING (bucket_id = 'invoices') WITH CHECK (bucket_id = 'invoices');
