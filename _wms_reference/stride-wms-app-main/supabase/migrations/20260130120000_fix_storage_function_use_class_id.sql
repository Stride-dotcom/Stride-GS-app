-- Fix generate_storage_for_date function to use class_id instead of item_type_id
-- and look up rates from service_events (Price List) instead of deprecated service_rates

-- Replace the function with corrected logic
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
  -- Use class_id (references classes table) for pricing tier lookup
  insert into public.storage_daily_rollup(tenant_id, item_id, account_id, sidemark_id, rollup_date, class_id, daily_rate)
  select
    i.tenant_id,
    i.id as item_id,
    i.account_id,
    i.sidemark_id,
    p_date as rollup_date,
    i.class_id,  -- Correctly use class_id (references classes table)
    -- daily_rate from service_events Price List
    -- Lookup: service_code='STORAGE', class_code matches classes.code
    round(
      coalesce(
        (
          select se.rate / 30.0
          from public.service_events se
          join public.classes c on c.id = i.class_id and c.tenant_id = i.tenant_id
          where se.tenant_id = i.tenant_id
            and se.service_code = 'STORAGE'
            and se.class_code = c.code
            and se.is_active = true
          limit 1
        ),
        (
          -- Fallback to base rate (no class_code) if class-specific rate not found
          select se.rate / 30.0
          from public.service_events se
          where se.tenant_id = i.tenant_id
            and se.service_code = 'STORAGE'
            and se.class_code is null
            and se.is_active = true
          limit 1
        ),
        0
      ) * (1 + (coalesce(a.global_rate_adjust_pct, 0) / 100.0))
    , 4) as daily_rate
  from public.items i
  join public.accounts a on a.id = i.account_id and a.tenant_id = i.tenant_id
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

-- Add comment for documentation
COMMENT ON FUNCTION public.generate_storage_for_date(date) IS 'Generate daily storage charges using class_id for pricing tier lookup from service_events (Price List)';
