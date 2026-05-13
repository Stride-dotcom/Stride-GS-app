-- Public service-request form: allow anon to SELECT the row they just
-- inserted, so `INSERT ... RETURNING id, dt_identifier` succeeds.
--
-- Background: src/pages/PublicServiceRequest.tsx submits via
--   supabase.from('dt_orders').insert(payload).select('id, dt_identifier').single()
-- The .select(...) causes supabase-js to add `Prefer: return=representation`,
-- which makes PostgREST emit `INSERT ... RETURNING id, dt_identifier`. The
-- RETURNING clause requires SELECT permission via RLS on the just-inserted
-- row. anon already has the INSERT policy `dt_orders_insert_public_form_anon`
-- but no SELECT policy on dt_orders, so the implicit RETURNING/SELECT after
-- INSERT was failing with the misleading error
--   42501: new row violates row-level security policy for table "dt_orders"
-- which surfaced to the customer as the form's generic
--   "We could not submit your request. Please try again..."
-- Pre-fix repro: a curl POST without `Prefer: return=representation` returns
-- HTTP 201 (insert succeeds); the same POST with the header returns 401
-- with code 42501.
--
-- Fix: a tightly-scoped SELECT policy that only matches anon-owned, just-
-- inserted public_form rows. Conditions:
--   • source = 'public_form'           → only anon-owned rows
--   • review_status = 'pending_review' → only unreviewed (staff hasn't
--                                         touched them yet)
--   • tenant_id IS NULL                → only unassigned
--   • created_at > now() - 30s         → only rows created in the last 30s,
--                                         which prevents enumeration of
--                                         older submissions while leaving
--                                         plenty of headroom for the immediate
--                                         post-INSERT RETURNING roundtrip
-- Information-disclosure surface: an anon caller could probe within the
-- 30s window and see other public_form submissions in flight. Acceptable
-- because the rows contain only what the submitter themselves provided
-- and the window is too short for meaningful enumeration. The eventual
-- proper fix is a SECURITY DEFINER RPC that handles INSERT+items in one
-- transaction and never exposes RLS-readable rows to anon at all — see
-- followups in BUILD_STATUS.md.

CREATE POLICY "dt_orders_select_just_inserted_public_anon"
ON public.dt_orders
FOR SELECT
TO anon
USING (
  source = 'public_form'
  AND review_status = 'pending_review'
  AND tenant_id IS NULL
  AND created_at > now() - interval '30 seconds'
);

COMMENT ON POLICY "dt_orders_select_just_inserted_public_anon" ON public.dt_orders IS
  'Lets the anonymous public-service-request form read back the row it just inserted (so INSERT ... RETURNING id, dt_identifier succeeds). Scoped to source=public_form + pending_review + tenant_id NULL + created_at within 30s to prevent enumeration of older submissions.';
