-- tax_jurisdictions — RLS + integrity guards.
--
-- The table, get_default_tax_rate() and the Kent 10.4% default row were
-- created out-of-band by the operator. This migration is the git source
-- of truth for the access policies the React app depends on, and is
-- written idempotently so it is safe whether or not the objects already
-- exist when it is applied.
--
-- Why these policies:
--   * anon SELECT  — PublicServiceRequest.tsx is an unauthenticated page
--                     and must read the default rate. (It already falls
--                     back to 10.4 on failure, but the policy makes the
--                     live rate authoritative there too.)
--   * authenticated SELECT — every logged-in surface reads the default.
--   * authenticated write  — Settings → Pricing → Tax Rates (admin-gated
--                     in the UI; RLS only needs the authenticated check).

create table if not exists public.tax_jurisdictions (
  id             uuid primary key default gen_random_uuid(),
  city           text not null,
  state          text not null,
  rate_pct       numeric not null,
  is_default     boolean not null default false,
  effective_date date,
  source         text,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Exactly one default jurisdiction. Partial unique index so only the
-- single is_default=true row is constrained; the UI relies on this to
-- enforce "only one default at a time".
create unique index if not exists tax_jurisdictions_single_default
  on public.tax_jurisdictions (is_default)
  where is_default = true;

alter table public.tax_jurisdictions enable row level security;

drop policy if exists tax_jurisdictions_anon_select on public.tax_jurisdictions;
create policy tax_jurisdictions_anon_select
  on public.tax_jurisdictions for select to anon
  using (true);

drop policy if exists tax_jurisdictions_auth_select on public.tax_jurisdictions;
create policy tax_jurisdictions_auth_select
  on public.tax_jurisdictions for select to authenticated
  using (true);

drop policy if exists tax_jurisdictions_auth_write on public.tax_jurisdictions;
create policy tax_jurisdictions_auth_write
  on public.tax_jurisdictions for all to authenticated
  using (true) with check (true);

-- Returns the rate of the default jurisdiction, or 10.4 if none flagged.
create or replace function public.get_default_tax_rate()
returns numeric
language sql
stable
as $$
  select coalesce(
    (select rate_pct from public.tax_jurisdictions where is_default = true limit 1),
    10.4
  );
$$;
