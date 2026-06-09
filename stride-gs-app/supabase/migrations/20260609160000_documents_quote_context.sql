-- documents — allow `quote` as a context_type so files attached to a quote
-- (floor plans, packing lists, purchase orders, etc.) reuse the existing
-- documents module instead of a parallel table or a JSON column on `quotes`.
--
-- RLS on public.documents already gives us exactly the shape we want: the
-- Quote Tool is an admin/staff-only surface, and `documents_write_staff` /
-- `documents_select_staff` grant admin/staff full read+write regardless of
-- tenant_id. Quote docs are stamped with tenant_id = the quote's linked
-- client sheet id when present (so a future client-facing quote view would
-- scope correctly via documents_select_own_tenant), else a `quotes`
-- sentinel. Either way the storage `documents_write_staff` policy lets
-- staff write any path in the bucket. No new policies needed — one CHECK
-- tweak is the whole migration (mirrors the Session-77 `client` addition in
-- 20260420130000_documents_client_context.sql).

ALTER TABLE public.documents
  DROP CONSTRAINT IF EXISTS documents_context_type_check;

ALTER TABLE public.documents
  ADD CONSTRAINT documents_context_type_check
  CHECK (context_type = ANY (ARRAY['shipment','item','task','repair','willcall','claim','client','dt_order','quote']));
