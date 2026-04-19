-- ============================================================
-- Stride GS App — Price List Shares
--
-- price_list_shares: admin-created shareable links to a public
-- read-only view of selected service catalog categories.
-- Public read policy allows unauthenticated (anon) access so
-- share links work without login.
--
-- Also adds anon-read policy on service_catalog so PublicRates
-- can fetch service data without authentication.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.price_list_shares (
  id          uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id    text    UNIQUE NOT NULL DEFAULT substr(md5(random()::text), 1, 10),
  tabs        text[]  NOT NULL,
  title       text    NOT NULL DEFAULT 'Stride Logistics — Price List',
  created_by  uuid    REFERENCES auth.users(id),
  created_at  timestamptz DEFAULT now(),
  expires_at  timestamptz,
  active      boolean DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_price_list_shares_share_id ON public.price_list_shares(share_id);
CREATE INDEX IF NOT EXISTS idx_price_list_shares_active   ON public.price_list_shares(active);

ALTER TABLE public.price_list_shares ENABLE ROW LEVEL SECURITY;

-- Public (anon) can read active, non-expired shares
DROP POLICY IF EXISTS "price_list_shares_public_read" ON public.price_list_shares;
CREATE POLICY "price_list_shares_public_read" ON public.price_list_shares
  FOR SELECT
  USING (active = true AND (expires_at IS NULL OR expires_at > now()));

-- Admins can manage all shares (including deactivating others')
DROP POLICY IF EXISTS "price_list_shares_admin_write" ON public.price_list_shares;
CREATE POLICY "price_list_shares_admin_write" ON public.price_list_shares
  FOR ALL TO authenticated
  USING     ((auth.jwt()->'user_metadata'->>'role') = 'admin')
  WITH CHECK ((auth.jwt()->'user_metadata'->>'role') = 'admin');

-- service_role full access
DROP POLICY IF EXISTS "price_list_shares_service_all" ON public.price_list_shares;
CREATE POLICY "price_list_shares_service_all" ON public.price_list_shares
  FOR ALL TO service_role USING (true) WITH CHECK (true);


-- ── Public (anon) read on service_catalog ────────────────────
-- Allows PublicRates page to fetch services without authentication.
-- Only active services visible to anon.

DROP POLICY IF EXISTS "service_catalog_anon_read" ON public.service_catalog;
CREATE POLICY "service_catalog_anon_read" ON public.service_catalog
  FOR SELECT TO anon
  USING (active = true);
