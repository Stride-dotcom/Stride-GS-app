-- impersonation_log — audit trail for admin "view-as" sessions.
--
-- Piece #3 of the impersonation-fidelity series swaps the React-state-only
-- "fake impersonation" (admin user + admin JWT, just swap user.email in
-- context) for a REAL Supabase session as the target user, minted via an
-- admin-only edge function that calls supabase.auth.admin.generateLink.
--
-- Once the admin holds a real client JWT, RLS / auth.email() / edge
-- functions all see the client. That is the whole point — full parity
-- with what the client actually sees. But it also means that, from the
-- DB's perspective, every action during the session looks like the
-- client took it. Without this audit log, there's no way to distinguish
-- admin-as-client from real-client actions after the fact.
--
-- One row per impersonation session: inserted at start (ended_at NULL
-- means "still active"), updated at end. The edge function also reads
-- the most-recent open row when "exit" is called, so a refresh-in-the-
-- middle situation still ends cleanly.

create table if not exists public.impersonation_log (
  id            uuid primary key default gen_random_uuid(),
  admin_email   text not null,
  target_email  text not null,
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  user_agent    text,
  ip            text,
  reason        text,
  created_at    timestamptz not null default now()
);

create index if not exists impersonation_log_admin_email_idx
  on public.impersonation_log (admin_email, started_at desc);
create index if not exists impersonation_log_target_email_idx
  on public.impersonation_log (target_email, started_at desc);
-- Partial index so the "find my active session for this admin" lookup the
-- edge function does on Exit is a constant-time hit even with years of
-- historical rows.
create index if not exists impersonation_log_active_idx
  on public.impersonation_log (admin_email, started_at desc)
  where ended_at is null;

alter table public.impersonation_log enable row level security;

-- Admins read everything (for the eventual Settings → Audit page).
-- Staff also read everything because they often help with audits but
-- can never impersonate themselves (admin-gated in the UI).
drop policy if exists impersonation_log_admin_staff_read on public.impersonation_log;
create policy impersonation_log_admin_staff_read
  on public.impersonation_log for select to authenticated
  using ((auth.jwt()->'user_metadata'->>'role') in ('admin', 'staff'));

-- Users can see who impersonated them. Builds trust ("here's exactly
-- when Stride staff logged in as me, and for how long"). Read-only —
-- the user has no business modifying their own audit record.
drop policy if exists impersonation_log_target_self_read on public.impersonation_log;
create policy impersonation_log_target_self_read
  on public.impersonation_log for select to authenticated
  using (target_email = auth.email());

-- NO authenticated write policy. All writes happen via the
-- impersonate-mint-session edge function using the service role, which
-- bypasses RLS. This is deliberate — the audit row must be tamper-proof
-- from the React app's perspective (an admin holding a real client JWT
-- mid-impersonation must not be able to DELETE or UPDATE their own
-- audit row from the browser).

-- Data API grants — service_role gets full access (edge function path),
-- authenticated gets SELECT only (audit-page reads). No INSERT / UPDATE
-- / DELETE for authenticated, on purpose; the absence of a grant is
-- the second layer of defense behind "no policy".
grant select on public.impersonation_log to authenticated;
grant all    on public.impersonation_log to service_role;
