-- 20260609170000_app_config_server_secrets.sql
--
-- Tiny key/value table for SERVER-SIDE-ONLY config + secrets that Edge
-- Functions need (first use: the Cloudflare Browser Rendering API token read
-- by the `render-doc-pdf` function). RLS is enabled with NO policies, so the
-- browser (anon / authenticated) can neither read nor write it; only the
-- service_role (which BYPASSes RLS, used by Edge Functions via
-- SUPABASE_SERVICE_ROLE_KEY) can. The DB is encrypted at rest.
--
-- The secret VALUES are inserted out-of-band (not in this committed migration)
-- so tokens never land in git. See the render-doc-pdf rollout notes.

create table if not exists public.app_config (
  key         text primary key,
  value       text not null,
  description text,
  updated_at  timestamptz not null default now()
);

alter table public.app_config enable row level security;

-- Belt-and-suspenders: ensure the browser roles have no table privileges.
-- (No RLS policies exist, so even with table grants they'd be blocked, but
-- revoking makes the server-only intent explicit and audit-clean.)
revoke all on public.app_config from anon, authenticated;
