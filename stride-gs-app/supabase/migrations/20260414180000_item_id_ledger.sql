-- =========================================================================
-- item_id_ledger — Authoritative registry of every Item ID ever issued
-- =========================================================================
-- Purpose: enforce cross-client uniqueness on Item ID allocation. Unlike the
-- other Supabase tables (read cache mirrors), this table is the AUTHORITY
-- for "has this ID ever been issued?" — it is its own write path, not a
-- mirror of a sheet. See CLAUDE.md invariant #20 note.
--
-- Write path: StrideAPI.gs is the only writer. React calls the GAS endpoint
-- checkItemIdsAvailable() which queries this table; it does not write.
--
-- Append-only-ish: rows are inserted at allocation, status is updated as
-- items move through lifecycle (active → released / transferred / voided),
-- but an item_id is NEVER deleted and NEVER reassignable. Once burned,
-- always burned.
-- =========================================================================

create table if not exists public.item_id_ledger (
  item_id      text primary key,
  tenant_id    text not null,
  created_at   timestamptz not null default now(),
  created_by   text,
  source       text not null default 'manual'
    check (source in ('auto', 'manual', 'import', 'reassign', 'backfill')),
  status       text not null default 'active'
    check (status in ('active', 'released', 'transferred', 'voided')),
  voided_at    timestamptz,
  void_reason  text,
  updated_at   timestamptz not null default now()
);

comment on table public.item_id_ledger is
  'Authoritative cross-tenant registry of every Item ID ever issued. item_id is globally unique. Rows are inserted at allocation by StrideAPI.gs and never deleted. Status evolves with item lifecycle but the slot is permanently burned.';

create index if not exists idx_item_id_ledger_tenant on public.item_id_ledger (tenant_id);
create index if not exists idx_item_id_ledger_status on public.item_id_ledger (status);
create index if not exists idx_item_id_ledger_created on public.item_id_ledger (created_at);

-- Auto-update updated_at on row modification
create or replace function public.touch_item_id_ledger_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_item_id_ledger_touch on public.item_id_ledger;
create trigger trg_item_id_ledger_touch
  before update on public.item_id_ledger
  for each row execute function public.touch_item_id_ledger_updated_at();

-- =========================================================================
-- Row Level Security
-- =========================================================================
-- Only service_role (StrideAPI.gs) writes. Authenticated React users can
-- read for UI dashboards if we need them later; default-deny until opened.
-- =========================================================================

alter table public.item_id_ledger enable row level security;

-- service_role bypasses RLS automatically, so no policy needed for writes.
-- Add a read policy for authenticated users (future-proofing the maintenance
-- page); no write policies for anon/authenticated — writes must go via GAS.
drop policy if exists "authenticated read item_id_ledger" on public.item_id_ledger;
create policy "authenticated read item_id_ledger"
  on public.item_id_ledger
  for select
  to authenticated
  using (true);

-- =========================================================================
-- Backfill from existing inventory table
-- =========================================================================
-- First-seen-wins on duplicates (ON CONFLICT DO NOTHING). The 22 cross-tenant
-- duplicate IDs in current data will have one row in the ledger (earliest
-- created_at) and the other tenant's collision is surfaced via the
-- item_id_ledger_conflicts view below. Future allocations of any of those
-- IDs are correctly blocked since the slot is already taken.
-- =========================================================================

insert into public.item_id_ledger (item_id, tenant_id, created_at, source, status)
select distinct on (inv.item_id)
  trim(inv.item_id)                          as item_id,
  inv.tenant_id                              as tenant_id,
  coalesce(inv.created_at, now())            as created_at,
  'backfill'                                 as source,
  case lower(coalesce(inv.status, 'active'))
    when 'released'    then 'released'
    when 'transferred' then 'transferred'
    else 'active'
  end                                        as status
from public.inventory inv
where inv.item_id is not null
  and trim(inv.item_id) <> ''
order by inv.item_id, inv.created_at asc nulls last
on conflict (item_id) do nothing;

-- =========================================================================
-- View: surface pre-existing cross-tenant collisions for later resolution.
-- These are Item IDs that were historically used by 2+ clients. The ledger
-- owns the earliest one; the others appear here so an admin can reconcile.
-- =========================================================================

create or replace view public.item_id_ledger_conflicts as
select
  inv.item_id,
  inv.tenant_id                               as inventory_tenant_id,
  inv.status                                  as inventory_status,
  inv.created_at                              as inventory_created_at,
  ledger.tenant_id                            as ledger_tenant_id,
  ledger.status                               as ledger_status,
  ledger.created_at                           as ledger_created_at,
  case when inv.tenant_id = ledger.tenant_id
       then 'owned'
       else 'collision'
  end                                         as relationship
from public.inventory inv
join public.item_id_ledger ledger
  on trim(inv.item_id) = ledger.item_id
where inv.tenant_id <> ledger.tenant_id
order by inv.item_id;

comment on view public.item_id_ledger_conflicts is
  'Pre-existing cross-tenant Item ID collisions: rows where an inventory row exists on one tenant but the ledger slot is owned by a different tenant. Used to reconcile the 22 historical collisions surfaced by the 2026-04-14 backfill.';
