-- user_view_prefs — server-side persistence for table view preferences.
--
-- Stores per-(user, page) UI state (column visibility, sort, column order,
-- status-chip filter) as opaque jsonb so it follows the user across devices
-- and other tabs.
--
-- Why this table exists:
--   Previously `useTablePreferences` persisted only to localStorage keyed
--   by `user.email`. Two problems:
--     1. No cross-device sync — change your sort on your laptop, log in
--        from your phone, see the old default.
--     2. Impersonation broken — when an admin impersonates a client,
--        AuthContext swaps user.email to the client's, so the hook reads
--        from the client-keyed localStorage entry. But that entry lives
--        on the admin's machine and is empty (the admin has never seen
--        the client's actual view). Admin sees defaults, not "what the
--        client actually sees on their device".
--
-- After this table + a hook refactor, both surfaces fix themselves: prefs
-- live in Supabase, RLS gates read/write to the row owner, admins can
-- read any (so impersonation shows the client's real view), and
-- localStorage continues to serve as an offline write-cache + first-paint
-- fallback so the table never flashes empty.
--
-- One row per (user_email, page_key). All writes are upserts; the hook
-- debounces them 250ms to avoid hammering the DB on column drag.

create table if not exists public.user_view_prefs (
  id          uuid primary key default gen_random_uuid(),
  user_email  text not null,
  page_key    text not null,
  prefs       jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_email, page_key)
);

-- Index supports the hook's primary access pattern: "load every page's
-- prefs for this user on session start" (still rowcount-light per user
-- but worth the index since user_email is the join key on every read).
create index if not exists user_view_prefs_user_email_idx
  on public.user_view_prefs (user_email);

alter table public.user_view_prefs enable row level security;

-- Self read/write: a user owns the row keyed by their own email. Covers
-- both reads and upserts for the React app's normal logged-in case.
drop policy if exists user_view_prefs_self on public.user_view_prefs;
create policy user_view_prefs_self
  on public.user_view_prefs for all to authenticated
  using (user_email = auth.email())
  with check (user_email = auth.email());

-- Admin/staff read-any: lets the admin's impersonation view load the
-- impersonated user's saved prefs. Required because the current
-- impersonation implementation keeps the admin's JWT live (see
-- AuthContext.impersonateUser + setSupabaseImpersonating); without
-- this policy the admin's RLS check fails on the client's row.
--
-- Once piece #3 (true Supabase-session impersonation) lands, the admin
-- will hold a real session as the target user and the self policy will
-- cover them. This admin policy can then be dropped — but it's
-- read-only by design so leaving it in place is safe regardless.
--
-- Role is synced into user_metadata.role by AuthContext.handleSession.
drop policy if exists user_view_prefs_admin_read on public.user_view_prefs;
create policy user_view_prefs_admin_read
  on public.user_view_prefs for select to authenticated
  using ((auth.jwt()->'user_metadata'->>'role') in ('admin', 'staff'));

-- Data API grants — required by Supabase's 2026-10-30 PostgREST
-- enforcement. RLS still gates which rows the role sees; the grant
-- only gates whether the role can attempt the verb at all.
grant select, insert, update, delete on public.user_view_prefs to authenticated;
grant all on public.user_view_prefs to service_role;

-- Auto-touch updated_at on every modification so the hook can observe
-- "newer than mine" deltas if it ever needs to (and so audit queries
-- have a reliable last-changed timestamp).
create or replace function public.user_view_prefs_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists user_view_prefs_touch on public.user_view_prefs;
create trigger user_view_prefs_touch
  before update on public.user_view_prefs
  for each row execute function public.user_view_prefs_touch_updated_at();
