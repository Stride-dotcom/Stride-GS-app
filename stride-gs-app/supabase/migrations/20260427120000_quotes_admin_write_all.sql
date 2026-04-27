-- Admins can write quotes for any owner.
--
-- Background: a previous migration (20260421180000) added a SELECT
-- policy so admins could see every quote, but explicitly left
-- INSERT/UPDATE/DELETE owner-scoped on the theory that "an admin
-- reviewing a junior's quote shouldn't be able to silently edit it."
--
-- That theory broke admin impersonation. When an admin uses the
-- "View as <user>" feature, the frontend sets `owner_email` to the
-- impersonated user (e.g. ken@stridenw.com), but the underlying
-- Supabase session is still the real admin (justin@stridenw.com).
-- RLS check `owner_email = auth.email()` rejects every write with
-- 403, so saves silently fail. The screenshot showed:
--   "[useQuoteStore] Supabase upsert FAILED for EST-1000 — new
--    row violates row-level security policy for table 'quotes'"
--
-- Fix: extend the admin-read-all pattern to writes. Admins can now
-- INSERT, UPDATE, and DELETE any quote regardless of owner_email.
-- The audit trail (created_at, updated_at, owner_email) still tells
-- you who originally owned the row, so an admin editing someone
-- else's quote is visible after the fact.
--
-- Staff/client roles remain owner-scoped by the existing policies
-- — only admin gets the bypass.

DROP POLICY IF EXISTS quotes_admin_insert_all ON public.quotes;
CREATE POLICY quotes_admin_insert_all ON public.quotes
  FOR INSERT
  WITH CHECK ((auth.jwt()->'user_metadata'->>'role') = 'admin');

DROP POLICY IF EXISTS quotes_admin_update_all ON public.quotes;
CREATE POLICY quotes_admin_update_all ON public.quotes
  FOR UPDATE
  USING ((auth.jwt()->'user_metadata'->>'role') = 'admin')
  WITH CHECK ((auth.jwt()->'user_metadata'->>'role') = 'admin');

DROP POLICY IF EXISTS quotes_admin_delete_all ON public.quotes;
CREATE POLICY quotes_admin_delete_all ON public.quotes
  FOR DELETE
  USING ((auth.jwt()->'user_metadata'->>'role') = 'admin');
