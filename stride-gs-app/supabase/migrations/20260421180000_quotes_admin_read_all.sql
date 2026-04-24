-- Admin visibility over all quotes.
--
-- Before: `quotes_owner_read` only let users read rows where
-- owner_email = auth.email(). Admins on the Quote Tool page saw only
-- their own drafts/sends/accepts, which is wrong for the role — Justin
-- needs the full list so he can review / follow up on other users'
-- quotes.
--
-- After: additional SELECT policy grants admins read access to every
-- row. INSERT / UPDATE / DELETE stay owner-scoped: an admin reviewing a
-- junior's quote shouldn't be able to silently edit or delete it from
-- under them. If admins need to void a stale quote belonging to someone
-- else, they can duplicate it (which creates their own row) or mark it
-- out of band.
--
-- Staff is intentionally NOT included — the Quote Tool is currently an
-- admin-curation feature and expanding scope can wait until we have a
-- concrete use case.
DROP POLICY IF EXISTS quotes_admin_read_all ON public.quotes;
CREATE POLICY quotes_admin_read_all ON public.quotes
  FOR SELECT
  USING ((auth.jwt()->'user_metadata'->>'role') = 'admin');
