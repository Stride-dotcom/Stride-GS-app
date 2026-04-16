-- =========================
-- Phase 5: Invoices + Storage Automation
-- =========================

-- 1) Invoice tables
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  account_id uuid not null,
  sidemark text null,
  invoice_number text not null,
  invoice_type text not null check (invoice_type in ('weekly_services','monthly_storage','closeout','manual')),
  period_start date not null,
  period_end date not null,
  status text not null check (status in ('draft','sent','void')),
  subtotal numeric(12,2) not null default 0,
  tax_total numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  notes text null,
  created_by uuid null,
  created_at timestamptz not null default now(),
  sent_at timestamptz null
);

create unique index if not exists invoices_tenant_invoice_number_unique
  on public.invoices(tenant_id, invoice_number);

create index if not exists invoices_tenant_account_idx
  on public.invoices(tenant_id, account_id, period_start, period_end);

create table if not exists public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  billing_event_id uuid null,
  item_id uuid null,
  service_code text not null,
  description text null,
  quantity numeric(12,2) not null default 1,
  unit_rate numeric(12,2) not null default 0,
  line_total numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists invoice_lines_invoice_idx
  on public.invoice_lines(invoice_id);

-- 2) Add invoice linkage to billing_events for "unbilled → invoiced" tracking
alter table public.billing_events
  add column if not exists invoice_id uuid null references public.invoices(id) on delete set null;

alter table public.billing_events
  add column if not exists invoiced_at timestamptz null;

-- Ensure status supports these values (keep existing if already)
do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'billing_events_status_check'
  ) then
    alter table public.billing_events drop constraint billing_events_status_check;
  end if;
exception when others then
  -- ignore if constraint not found or drop fails
end $$;

alter table public.billing_events
  add constraint billing_events_status_check check (status in ('unbilled','invoiced','void'));

-- 3) Account storage settings (free days, daily rate multiplier, storage billing cycle)
alter table public.accounts
  add column if not exists free_storage_days integer not null default 0;

alter table public.accounts
  add column if not exists storage_billing_day integer not null default 1;

alter table public.accounts
  add column if not exists global_rate_adjust_pct numeric(6,3) not null default 0;

-- 4) Storage event helper table for idempotency (prevents double-charging per item per day)
create table if not exists public.storage_daily_rollup (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  item_id uuid not null,
  account_id uuid not null,
  sidemark_id uuid null,
  rollup_date date not null,
  class_id uuid null,
  daily_rate numeric(12,4) not null,
  created_at timestamptz not null default now(),
  unique(tenant_id, item_id, rollup_date)
);

-- 5) RLS (tenant isolation)
alter table public.invoices enable row level security;
alter table public.invoice_lines enable row level security;
alter table public.storage_daily_rollup enable row level security;

drop policy if exists invoices_tenant_select on public.invoices;
create policy invoices_tenant_select on public.invoices
for select using (tenant_id = public.user_tenant_id());

drop policy if exists invoices_tenant_write on public.invoices;
create policy invoices_tenant_write on public.invoices
for insert with check (tenant_id = public.user_tenant_id());

drop policy if exists invoices_tenant_update on public.invoices;
create policy invoices_tenant_update on public.invoices
for update using (tenant_id = public.user_tenant_id());

drop policy if exists invoice_lines_tenant_select on public.invoice_lines;
create policy invoice_lines_tenant_select on public.invoice_lines
for select using (tenant_id = public.user_tenant_id());

drop policy if exists invoice_lines_tenant_write on public.invoice_lines;
create policy invoice_lines_tenant_write on public.invoice_lines
for insert with check (tenant_id = public.user_tenant_id());

drop policy if exists invoice_lines_tenant_update on public.invoice_lines;
create policy invoice_lines_tenant_update on public.invoice_lines
for update using (tenant_id = public.user_tenant_id());

drop policy if exists storage_rollup_tenant_select on public.storage_daily_rollup;
create policy storage_rollup_tenant_select on public.storage_daily_rollup
for select using (tenant_id = public.user_tenant_id());

drop policy if exists storage_rollup_tenant_write on public.storage_daily_rollup;
create policy storage_rollup_tenant_write on public.storage_daily_rollup
for insert with check (tenant_id = public.user_tenant_id());

-- 6) Invoice numbering (tenant-scoped sequential)
create table if not exists public.invoice_counters (
  tenant_id uuid primary key,
  next_number bigint not null default 1,
  updated_at timestamptz not null default now()
);

alter table public.invoice_counters enable row level security;

drop policy if exists invoice_counters_tenant_select on public.invoice_counters;
create policy invoice_counters_tenant_select on public.invoice_counters
for select using (tenant_id = public.user_tenant_id());

drop policy if exists invoice_counters_tenant_write on public.invoice_counters;
create policy invoice_counters_tenant_write on public.invoice_counters
for insert with check (tenant_id = public.user_tenant_id());

drop policy if exists invoice_counters_tenant_update on public.invoice_counters;
create policy invoice_counters_tenant_update on public.invoice_counters
for update using (tenant_id = public.user_tenant_id());

-- 7) RPC: allocate next invoice number safely
create or replace function public.next_invoice_number()
returns text
language plpgsql
security definer
as $$
declare
  t uuid;
  n bigint;
begin
  t := public.user_tenant_id();

  insert into public.invoice_counters(tenant_id, next_number)
  values (t, 1)
  on conflict (tenant_id) do nothing;

  update public.invoice_counters
    set next_number = next_number + 1,
        updated_at = now()
  where tenant_id = t
  returning next_number - 1 into n;

  return 'INV-' || lpad(n::text, 6, '0');
end;
$$;

grant execute on function public.next_invoice_number() to authenticated;

-- 8) RPC: generate storage for a date (idempotent)
create or replace function public.generate_storage_for_date(p_date date)
returns void
language plpgsql
security definer
as $$
declare
  t uuid;
begin
  t := public.user_tenant_id();

  -- Insert rollup for every ACTIVE item stored that day.
  insert into public.storage_daily_rollup(tenant_id, item_id, account_id, sidemark_id, rollup_date, class_id, daily_rate)
  select
    i.tenant_id,
    i.id as item_id,
    i.account_id,
    i.sidemark_id,
    p_date as rollup_date,
    i.item_type_id as class_id,
    -- daily_rate = (storage monthly rate for class / 30) * (1 + account.global_rate_adjust_pct/100)
    round(
      (
        coalesce(sr.rate, 0) / 30.0
      ) * (1 + (coalesce(a.global_rate_adjust_pct, 0) / 100.0))
    , 4) as daily_rate
  from public.items i
  join public.accounts a on a.id = i.account_id and a.tenant_id = i.tenant_id
  left join public.service_rates sr
    on sr.rate_card_id = a.rate_card_id
   and sr.class_id = i.item_type_id
   and sr.service_id in (select id from public.billable_services where code = 'STORAGE' and tenant_id = i.tenant_id)
  where i.tenant_id = t
    and i.status = 'active'
    and i.received_date is not null
    and i.received_date <= p_date
    and (i.released_date is null or i.released_date > p_date)
  on conflict (tenant_id, item_id, rollup_date) do nothing;

  -- Apply free days: do NOT create billing_events until item has exceeded account.free_storage_days.
  insert into public.billing_events(
    tenant_id, account_id, item_id, sidemark_id, class_id,
    event_type, charge_type, description,
    quantity, unit_rate, total_amount,
    status, occurred_at, created_by, metadata
  )
  select
    r.tenant_id,
    r.account_id,
    r.item_id,
    r.sidemark_id,
    r.class_id,
    'storage' as event_type,
    'STORAGE_DAILY' as charge_type,
    'Daily storage charge' as description,
    1 as quantity,
    r.daily_rate as unit_rate,
    r.daily_rate as total_amount,
    'unbilled' as status,
    (r.rollup_date::timestamptz) as occurred_at,
    null as created_by,
    jsonb_build_object('rollup_date', r.rollup_date)
  from public.storage_daily_rollup r
  join public.items i on i.id = r.item_id and i.tenant_id = r.tenant_id
  join public.accounts a on a.id = r.account_id and a.tenant_id = r.tenant_id
  where r.tenant_id = t
    and r.rollup_date = p_date
    and ((p_date - i.received_date) + 1) > a.free_storage_days
    and not exists (
      select 1 from public.billing_events be
      where be.tenant_id = r.tenant_id
        and be.item_id = r.item_id
        and be.event_type = 'storage'
        and (be.metadata->>'rollup_date')::date = r.rollup_date
        and be.status <> 'void'
    );

end;
$$;

grant execute on function public.generate_storage_for_date(date) to authenticated;