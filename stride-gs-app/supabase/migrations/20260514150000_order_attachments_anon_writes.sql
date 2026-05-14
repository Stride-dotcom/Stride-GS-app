-- ============================================================
-- Stride GS App — Public-form order attachment writes
--
-- Lets the anonymous /public/service-request form attach photos +
-- documents to the order it just submitted, AND allows nullable
-- tenant_id on item_photos / documents so public-form orders (which
-- carry tenant_id IS NULL until staff maps them to an account during
-- review) can attach files at all.
--
-- Scope is deliberately tight, mirroring the dt_orders_insert_public
-- _form_anon policy added in 20260426220000:
--   • Anon can INSERT item_photos when entity_type='dt_order' AND
--     entity_id references a *public_form / pending_review / null-
--     tenant* dt_order created in the last hour.
--   • Anon can INSERT documents under the same gate.
--   • Storage anon-INSERT to the photos and documents buckets is
--     scoped by path-prefix ('public/dt_order-{id}/...'), which the
--     React-side helper (`lib/orderAttachmentUpload.ts`) is the only
--     thing that produces. Without the path prefix the policy
--     rejects the upload.
--
-- One-hour freshness window prevents a stale-link replay: an anon
-- can't dig up a public-form order id from a week-old confirmation
-- email and start dumping files into it.
-- ============================================================

-- ── 1. tenant_id nullable on item_photos + documents ───────────────────
-- Public-form orders are tenant-less until review; that flows down
-- to any files attached to them. The auth'd paths (usePhotos /
-- useDocuments) always set tenant_id from the JWT, so loosening to
-- nullable doesn't change anything for the authenticated case.
ALTER TABLE public.item_photos
  ALTER COLUMN tenant_id DROP NOT NULL;
COMMENT ON COLUMN public.item_photos.tenant_id IS
  'Tenant scope. NULL is permitted for dt_order attachments on '
  'public-form / external-customer orders that have no tenant '
  'assignment yet (mirrors the same null on dt_orders.tenant_id).';

ALTER TABLE public.documents
  ALTER COLUMN tenant_id DROP NOT NULL;
COMMENT ON COLUMN public.documents.tenant_id IS
  'Tenant scope. NULL is permitted for dt_order context docs on '
  'public-form / external-customer orders that have no tenant '
  'assignment yet (mirrors dt_orders.tenant_id).';

-- ── 2. Gate-check helper — runs as definer so the WITH CHECK can
-- look up dt_orders without granting anon a SELECT path on the
-- whole table. Returns TRUE only when the order id maps to a fresh
-- public-form / null-tenant / pending-review row.
--
-- Edge case (vanishingly small): staff may approve the order
-- in the few hundred ms between submit_public_request returning
-- and the file inserts running, which would flip review_status off
-- 'pending_review' and reject the writes. Net effect: the submitter
-- sees an inline warning to email the attachments. Acceptable for
-- the volume.
CREATE OR REPLACE FUNCTION public.is_fresh_public_form_order(p_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.dt_orders o
    WHERE o.id = p_id
      AND o.source = 'public_form'
      AND o.review_status = 'pending_review'
      AND o.tenant_id IS NULL
      AND o.created_at > now() - interval '1 hour'
  );
$$;
COMMENT ON FUNCTION public.is_fresh_public_form_order(uuid) IS
  'Gate-check for the *_insert_public_form_anon RLS policies. Runs '
  'as definer so anon does not need SELECT on dt_orders.';

GRANT EXECUTE ON FUNCTION public.is_fresh_public_form_order(uuid) TO anon;

-- ── 3. Anon INSERT on item_photos for fresh public-form orders ─────────
DROP POLICY IF EXISTS "item_photos_insert_public_form_anon" ON public.item_photos;
CREATE POLICY "item_photos_insert_public_form_anon"
ON public.item_photos
FOR INSERT
TO anon
WITH CHECK (
  entity_type = 'dt_order'
  AND tenant_id IS NULL
  AND uploaded_by IS NULL
  AND public.is_fresh_public_form_order(item_photos.entity_id::uuid)
);

COMMENT ON POLICY "item_photos_insert_public_form_anon" ON public.item_photos IS
  'Lets the anonymous /public/service-request form attach photos to '
  'the order it just submitted. Gated on a fresh public-form / null-'
  'tenant / pending-review dt_order (1-hour window).';

-- ── 4. Anon INSERT on documents for fresh public-form orders ───────────
-- Same gate as item_photos via the SECURITY DEFINER helper.
DROP POLICY IF EXISTS "documents_insert_public_form_anon" ON public.documents;
CREATE POLICY "documents_insert_public_form_anon"
ON public.documents
FOR INSERT
TO anon
WITH CHECK (
  context_type = 'dt_order'
  AND tenant_id IS NULL
  AND uploaded_by IS NULL
  AND public.is_fresh_public_form_order(documents.context_id::uuid)
);

COMMENT ON POLICY "documents_insert_public_form_anon" ON public.documents IS
  'Lets the anonymous /public/service-request form attach docs to '
  'the order it just submitted. Same gate as the photos policy.';

-- ── 4. Storage: anon INSERT to photos bucket under public-form path ────
-- Path convention emitted by lib/orderAttachmentUpload.ts is:
--   public/dt_order-{orderId}/{ts}-{rand}-{file}
-- The path-prefix check enforces that the storage key matches the
-- helper's convention. Without this policy the anon upload 403s
-- regardless of whether the table-level policy would have allowed
-- the row insert.
DROP POLICY IF EXISTS "photos_anon_insert_public_form" ON storage.objects;
CREATE POLICY "photos_anon_insert_public_form"
ON storage.objects
FOR INSERT
TO anon
WITH CHECK (
  bucket_id = 'photos'
  AND name LIKE 'public/dt_order-%'
);

-- ── 5. Storage: anon INSERT to documents bucket under same path ────────
DROP POLICY IF EXISTS "documents_anon_insert_public_form" ON storage.objects;
CREATE POLICY "documents_anon_insert_public_form"
ON storage.objects
FOR INSERT
TO anon
WITH CHECK (
  bucket_id = 'documents'
  AND name LIKE 'public/dt_order-%'
);

-- ── 6. Anon column-level GRANT for INSERT on item_photos + documents ───
-- RLS row policies allow the INSERT; column-level grants control which
-- columns the anon role can write at all. Without explicit per-column
-- grants the role can't fill in any field — the insert fails before
-- the policy check. List exactly the columns the helper writes plus
-- the FK / scope columns that the policy USING/CHECK clauses inspect.
GRANT INSERT (
  tenant_id,
  entity_type,
  entity_id,
  item_id,
  storage_key,
  file_name,
  file_size,
  mime_type,
  is_primary,
  needs_attention,
  is_repair,
  photo_type,
  uploaded_by,
  uploaded_by_name
) ON public.item_photos TO anon;

GRANT INSERT (
  tenant_id,
  context_type,
  context_id,
  storage_key,
  file_name,
  file_size,
  mime_type,
  uploaded_by,
  uploaded_by_name
) ON public.documents TO anon;
