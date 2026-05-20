-- Drop the admin-read-any policy on user_view_prefs.
--
-- The original migration 20260520180000 added an admin/staff SELECT-any
-- policy because impersonation (at that time) kept the admin's JWT
-- live, so RLS would have blocked the admin from reading the
-- impersonated user's saved view. Piece #3 of the impersonation series
-- (this migration's sibling) swaps to a real Supabase session as the
-- target user — the admin literally holds the client's JWT during
-- impersonation, so the `user_view_prefs_self` policy already covers
-- the read. The admin-read-any policy is no longer needed.
--
-- Drop is safe and idempotent: the self policy is unchanged.

drop policy if exists user_view_prefs_admin_read on public.user_view_prefs;
