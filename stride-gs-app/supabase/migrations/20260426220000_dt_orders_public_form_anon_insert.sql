-- Public service-request form: allow anonymous (logged-out) users to
-- create dt_orders + dt_order_items rows for a *new* form submission.
--
-- Scope is deliberately tight — the anon role can only:
--   • INSERT a dt_orders row when source='public_form' AND
--     review_status='pending_review' (so a public submission lands as
--     a pending request that staff must review before promotion).
--   • INSERT dt_order_items whose parent dt_orders row has
--     source='public_form' (limits items to public-form orders only).
--
-- The anon role has NO read, update, or delete privileges on these
-- tables; staff/admin still review submissions through the existing
-- authenticated paths. Submissions are tenant-less (tenant_id = NULL)
-- until staff maps them to an account during review.

-- ── 1. Extend `source` CHECK constraint to allow 'public_form' ─────────
ALTER TABLE public.dt_orders
  DROP CONSTRAINT IF EXISTS dt_orders_source_check;

ALTER TABLE public.dt_orders
  ADD CONSTRAINT dt_orders_source_check
  CHECK (source IN ('app','dt_ui','webhook_backfill','reconcile','public_form'));

-- ── 2. Anon INSERT policy on dt_orders ─────────────────────────────────
-- Locked to public_form + pending_review so a malicious anon cannot
-- create approved/in-progress orders, impersonate auth'd flows, or set
-- arbitrary review_status values.
CREATE POLICY "dt_orders_insert_public_form_anon"
ON public.dt_orders
FOR INSERT
TO anon
WITH CHECK (
  source = 'public_form'
  AND review_status = 'pending_review'
  AND tenant_id IS NULL
  AND created_by_user IS NULL
);

-- ── 3. Anon INSERT policy on dt_order_items ────────────────────────────
-- Items can only be added to orders that the anon role itself created
-- (i.e. parent order has source='public_form').
CREATE POLICY "dt_order_items_insert_public_form_anon"
ON public.dt_order_items
FOR INSERT
TO anon
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.dt_orders o
    WHERE o.id = dt_order_items.dt_order_id
      AND o.source = 'public_form'
  )
);

COMMENT ON POLICY "dt_orders_insert_public_form_anon" ON public.dt_orders IS
  'Lets the anonymous /public/service-request form create a pending request. Locked to source=public_form + review_status=pending_review.';

COMMENT ON POLICY "dt_order_items_insert_public_form_anon" ON public.dt_order_items IS
  'Anonymous form submissions can only attach items to public_form-sourced orders.';
