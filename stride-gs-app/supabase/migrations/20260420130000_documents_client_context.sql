-- documents — allow `client` as a context_type so per-client files
-- (original intake packets, COI renewals, tax exemption updates, parent/
-- child addenda) reuse the existing documents module instead of a
-- parallel table.
--
-- RLS on public.documents already handles the authorization shape we
-- want for client-scoped docs: staff/admin full access, client-role
-- users restricted to rows with tenant_id = their own clientSheetId.
-- That's unchanged here.
--
-- Session 77 rationale: we originally planned a separate
-- `client_documents` table for this, but the existing documents module
-- (DocumentList / DocumentUploadButton / useDocuments) already gives us
-- everything needed. One CHECK tweak is the whole migration.

ALTER TABLE public.documents
  DROP CONSTRAINT IF EXISTS documents_context_type_check;

ALTER TABLE public.documents
  ADD CONSTRAINT documents_context_type_check
  CHECK (context_type = ANY (ARRAY['shipment','item','task','repair','willcall','claim','client']));
