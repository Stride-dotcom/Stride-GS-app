-- 2026-06-04 — Client invoice portal: pdf_path column + client read RLS.
--
-- New feature: a client-facing /invoices page that lists a client's own
-- invoices and links to the archived PDF in the `invoices` storage bucket.
-- Two changes are needed on invoice_tracking to support it:
--
--   1. pdf_path — the storage object path ({tenant_id}/{invoice_no}.pdf) for
--      the archived invoice PDF. The PDF itself is generated React-side by
--      lib/invoicePdf.ts and uploaded to the `invoices` bucket immediately
--      after createInvoice (and by the one-time admin backfill in
--      lib/invoiceBackfill.ts for historical invoices). We store the stable
--      object PATH here rather than a signed URL so each viewer mints their
--      own RLS-scoped signed URL on demand (billing.invoice_url keeps the
--      long-lived signed URL for email/deeplink use — that's unchanged).
--
--   2. invoice_tracking_client_select — until now invoice_tracking was
--      staff/admin + service_role only (it backs the admin Invoice Review
--      tab). The portal needs client roles to read their OWN tenant's rows.
--      Scoped via public.user_has_tenant_access(tenant_id), the same helper
--      every other client-facing table uses (multi-tenant safe — a client
--      mapped to several sister-firm tenants sees all of them).
--
-- The `invoices` storage bucket already grants clients read on their own
-- tenant's objects (20260503180000_invoices_bucket.sql +
-- 20260504210000_multi_tenant_rls_access.sql invoices_read_own_tenant), so
-- no storage policy change is required here.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + DROP/CREATE POLICY. Safe to re-run.

-- 1. PDF storage path on the per-invoice row.
ALTER TABLE public.invoice_tracking
  ADD COLUMN IF NOT EXISTS pdf_path text;

COMMENT ON COLUMN public.invoice_tracking.pdf_path IS
  'Storage object path of the archived invoice PDF in the `invoices` bucket: {tenant_id}/{invoice_no}.pdf. NULL = PDF not yet generated. Written by lib/invoicePdf.ts (post-create) + lib/invoiceBackfill.ts (historical). Viewers mint their own RLS-scoped signed URL from this path.';

-- 2. Data API grant (idempotent — staff already read this table, so the
--    grant exists today; included so this migration is self-contained per
--    the CLAUDE.md new-table contract).
GRANT SELECT ON public.invoice_tracking TO authenticated;

-- 3. Client read policy — own tenant(s) only. RLS is already ENABLED on the
--    table; this ADDS a client-scoped SELECT alongside the existing
--    invoice_tracking_staff (admin/staff FOR ALL) + invoice_tracking_service
--    (service_role FOR ALL) policies. Policies are OR-combined, so staff/
--    admin reads are unaffected.
DROP POLICY IF EXISTS invoice_tracking_client_select ON public.invoice_tracking;
CREATE POLICY invoice_tracking_client_select ON public.invoice_tracking
  FOR SELECT TO authenticated
  USING (
    ((auth.jwt() -> 'user_metadata' ->> 'role') = 'client')
    AND public.user_has_tenant_access(tenant_id)
  );

-- 4. REPLICA IDENTITY FULL — required for the client invoice portal's realtime
--    subscriber (useInvoices). The client RLS policy above keys on tenant_id;
--    for UPDATE/DELETE postgres_changes events, Supabase evaluates that policy
--    against the OLD row image, which under default (PK-only) replica identity
--    carries only invoice_no — not tenant_id — so a client would silently never
--    receive update events (e.g. a paid-status flip). FULL puts the whole old
--    row in the WAL so the per-subscriber RLS check can pass. Matches the
--    convention on every other client-visible realtime table (clients, claims,
--    stax_invoices, billing). Idempotent.
ALTER TABLE public.invoice_tracking REPLICA IDENTITY FULL;
