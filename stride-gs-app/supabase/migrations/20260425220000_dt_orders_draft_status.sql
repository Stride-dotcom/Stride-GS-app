-- Drafts on the New Delivery Order modal — store as full dt_orders rows
-- with review_status='draft' so they show in the same Orders list (with
-- a filter), are searchable through the same RLS-scoped query, and
-- promote to a real order by flipping the status + replacing the
-- DRAFT-xxx placeholder identifier with a real generated number.
--
-- The existing CHECK constraint on review_status is tight; add 'draft'
-- as a sixth valid value.
--
-- dt_identifier stays NOT NULL — drafts use a "DRAFT-<short-id>"
-- placeholder. The UNIQUE(tenant_id, dt_identifier) constraint is fine
-- with that since the short-id is random enough to avoid collisions.

ALTER TABLE public.dt_orders
  DROP CONSTRAINT IF EXISTS dt_orders_review_status_check;

ALTER TABLE public.dt_orders
  ADD CONSTRAINT dt_orders_review_status_check
  CHECK (review_status IN (
    'draft',              -- NEW: in-progress order, not yet submitted
    'not_required',
    'pending_review',
    'approved',
    'rejected',
    'revision_requested'
  ));

COMMENT ON CONSTRAINT dt_orders_review_status_check ON public.dt_orders IS
  'Draft = saved-in-progress (operator can return to it). pending_review = submitted, awaiting staff approval. approved = staff approved, ready to push. rejected/revision_requested = bounced back. not_required = legacy backfilled rows.';
