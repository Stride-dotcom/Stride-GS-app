create or replace function public.rpc_complete_split_task(p_split_task_id uuid)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant_id uuid;
  v_user_id uuid;

  v_task record;
  v_meta jsonb;
  v_sw jsonb;

  v_origin_type text;
  v_origin_id uuid;

  v_parent_item_id uuid;
  v_parent_code_expected text;
  v_keep_qty int;
  v_leftover_qty int;

  v_parent record;

  v_child_total_qty int;
  v_child_count int;
  v_child_non_unit_count int;
  v_child_wrong_parent_count int;
  v_child_has_parent_code boolean;
  v_child_codes text[];

  v_origin_meta jsonb;
  v_task_ids text[];
  v_next_ids text[];
  v_pruned_items jsonb;

  v_requester_email text;
  v_requester_name text;
begin
  v_tenant_id := public.user_tenant_id();
  v_user_id := auth.uid();

  if p_split_task_id is null then
    raise exception 'INVALID_INPUT: split_task_id is required';
  end if;

  -- Lock split task row.
  select *
    into v_task
  from public.tasks
  where id = p_split_task_id
    and tenant_id = v_tenant_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'NOT_FOUND: Split task not found for tenant';
  end if;

  if v_task.task_type <> 'Split' then
    raise exception 'INVALID_TASK: Task is not type Split';
  end if;

  v_meta := coalesce(v_task.metadata, '{}'::jsonb);
  v_sw := coalesce(v_meta->'split_workflow', '{}'::jsonb);

  v_requester_email := coalesce(nullif(v_meta->>'requested_by_email', ''), nullif(v_sw->>'requested_by_email', ''));
  v_requester_name := coalesce(nullif(v_meta->>'requested_by_name', ''), nullif(v_sw->>'requested_by_name', ''));

  if v_task.status = 'completed' then
    return json_build_object(
      'ok', true,
      'already_completed', true,
      'task_id', p_split_task_id,
      'parent_item_code', coalesce(v_sw->>'parent_item_code', 'Item'),
      'child_item_codes', coalesce(v_sw->'child_item_codes', '[]'::jsonb),
      'requester_email', v_requester_email,
      'requester_name', v_requester_name
    );
  end if;

  v_origin_type := nullif(v_sw->>'origin_entity_type', '');
  if nullif(v_sw->>'origin_entity_id', '') is not null then
    begin
      v_origin_id := (v_sw->>'origin_entity_id')::uuid;
    exception when others then
      raise exception 'INVALID_META: split_workflow.origin_entity_id invalid uuid';
    end;
  else
    v_origin_id := null;
  end if;

  if nullif(v_sw->>'parent_item_id', '') is not null then
    begin
      v_parent_item_id := (v_sw->>'parent_item_id')::uuid;
    exception when others then
      raise exception 'INVALID_META: split_workflow.parent_item_id invalid uuid';
    end;
  else
    v_parent_item_id := null;
  end if;

  v_parent_code_expected := nullif(v_sw->>'parent_item_code', '');
  v_keep_qty := nullif(v_sw->>'keep_qty', '')::int;
  v_leftover_qty := nullif(v_sw->>'leftover_qty', '')::int;

  if v_parent_item_id is null then
    raise exception 'INVALID_META: split_workflow.parent_item_id missing';
  end if;
  if v_parent_code_expected is null then
    raise exception 'INVALID_META: split_workflow.parent_item_code missing';
  end if;
  if v_keep_qty is null or v_keep_qty < 1 then
    raise exception 'INVALID_META: split_workflow.keep_qty missing/invalid';
  end if;
  if v_leftover_qty is null or v_leftover_qty < 1 then
    raise exception 'INVALID_META: split_workflow.leftover_qty missing/invalid';
  end if;

  -- Lock parent item row and verify core invariants.
  select *
    into v_parent
  from public.items
  where id = v_parent_item_id
    and tenant_id = v_tenant_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'VERIFY_FAIL: Parent item not found';
  end if;

  if v_parent.item_code <> v_parent_code_expected then
    raise exception 'VERIFY_FAIL: Parent item_code changed (expected %, got %)',
      v_parent_code_expected, v_parent.item_code;
  end if;

  if coalesce(v_parent.quantity, 1) <> v_keep_qty then
    raise exception 'VERIFY_FAIL: Parent qty mismatch (expected keep_qty %, got %)',
      v_keep_qty, coalesce(v_parent.quantity, 1);
  end if;

  -- Verify children by DB truth (split_task_id + parent linkage).
  select
    count(*)::int as child_count,
    coalesce(sum(coalesce(i.quantity, 1)), 0)::int as total_qty,
    count(*) filter (where coalesce(i.quantity, 1) <> 1)::int as non_unit_count,
    count(*) filter (where coalesce(i.metadata->>'split_parent_item_id', '') <> v_parent_item_id::text)::int as wrong_parent_count,
    bool_or(i.item_code = v_parent.item_code) as has_parent_code,
    array_agg(i.item_code order by i.item_code) as child_codes
  into
    v_child_count,
    v_child_total_qty,
    v_child_non_unit_count,
    v_child_wrong_parent_count,
    v_child_has_parent_code,
    v_child_codes
  from public.items i
  where i.tenant_id = v_tenant_id
    and i.deleted_at is null
    and i.metadata @> jsonb_build_object('split_task_id', p_split_task_id);

  if coalesce(v_child_count, 0) = 0 then
    raise exception 'VERIFY_FAIL: No child items found for split_task_id';
  end if;

  if coalesce(v_child_wrong_parent_count, 0) > 0 then
    raise exception 'VERIFY_FAIL: Found child items with mismatched split_parent_item_id';
  end if;

  if coalesce(v_child_non_unit_count, 0) > 0 then
    raise exception 'VERIFY_FAIL: Child items must be qty=1';
  end if;

  if coalesce(v_child_count, 0) <> v_leftover_qty then
    raise exception 'VERIFY_FAIL: Child row count mismatch (expected leftover_qty %, got %)',
      v_leftover_qty, coalesce(v_child_count, 0);
  end if;

  if coalesce(v_child_total_qty, 0) <> v_leftover_qty then
    raise exception 'VERIFY_FAIL: Child qty mismatch (expected leftover_qty %, got %)',
      v_leftover_qty, coalesce(v_child_total_qty, 0);
  end if;

  if coalesce(v_child_has_parent_code, false) then
    raise exception 'VERIFY_FAIL: A child item_code matches the parent item_code';
  end if;

  -- Unblock origin shipment/task using split_required_task_ids if present.
  if v_origin_type is not null and v_origin_id is not null then
    if v_origin_type = 'shipment' then
      select coalesce(metadata, '{}'::jsonb)
        into v_origin_meta
      from public.shipments
      where id = v_origin_id
        and tenant_id = v_tenant_id
        and deleted_at is null
      for update;

      if not found then
        raise exception 'ORIGIN_NOT_FOUND: shipment % not found', v_origin_id;
      end if;

      v_task_ids := coalesce(
        array(select jsonb_array_elements_text(coalesce(v_origin_meta->'split_required_task_ids', '[]'::jsonb))),
        array[]::text[]
      );
      v_next_ids := array(select x from unnest(v_task_ids) x where x <> p_split_task_id::text);

      if array_length(v_next_ids, 1) is null then
        v_origin_meta := v_origin_meta
          - 'split_required'
          - 'split_required_task_ids'
          - 'split_required_items'
          - 'split_required_created_at';
      else
        v_origin_meta := jsonb_set(v_origin_meta, '{split_required}', 'true'::jsonb, true);
        v_origin_meta := jsonb_set(v_origin_meta, '{split_required_task_ids}', to_jsonb(v_next_ids), true);

        v_pruned_items := (
          select coalesce(jsonb_agg(elem), '[]'::jsonb)
          from jsonb_array_elements(coalesce(v_origin_meta->'split_required_items', '[]'::jsonb)) elem
          where coalesce(elem->>'split_task_id', '') <> p_split_task_id::text
        );
        v_origin_meta := jsonb_set(v_origin_meta, '{split_required_items}', coalesce(v_pruned_items, '[]'::jsonb), true);
      end if;

      update public.shipments
      set metadata = v_origin_meta,
          updated_at = now()
      where id = v_origin_id
        and tenant_id = v_tenant_id;
    elsif v_origin_type = 'task' then
      select coalesce(metadata, '{}'::jsonb)
        into v_origin_meta
      from public.tasks
      where id = v_origin_id
        and tenant_id = v_tenant_id
        and deleted_at is null
      for update;

      if not found then
        raise exception 'ORIGIN_NOT_FOUND: task % not found', v_origin_id;
      end if;

      v_task_ids := coalesce(
        array(select jsonb_array_elements_text(coalesce(v_origin_meta->'split_required_task_ids', '[]'::jsonb))),
        array[]::text[]
      );
      v_next_ids := array(select x from unnest(v_task_ids) x where x <> p_split_task_id::text);

      if array_length(v_next_ids, 1) is null then
        v_origin_meta := v_origin_meta
          - 'split_required'
          - 'split_required_task_ids'
          - 'split_required_items'
          - 'split_required_created_at';
      else
        v_origin_meta := jsonb_set(v_origin_meta, '{split_required}', 'true'::jsonb, true);
        v_origin_meta := jsonb_set(v_origin_meta, '{split_required_task_ids}', to_jsonb(v_next_ids), true);

        v_pruned_items := (
          select coalesce(jsonb_agg(elem), '[]'::jsonb)
          from jsonb_array_elements(coalesce(v_origin_meta->'split_required_items', '[]'::jsonb)) elem
          where coalesce(elem->>'split_task_id', '') <> p_split_task_id::text
        );
        v_origin_meta := jsonb_set(v_origin_meta, '{split_required_items}', coalesce(v_pruned_items, '[]'::jsonb), true);
      end if;

      update public.tasks
      set metadata = v_origin_meta,
          updated_at = now()
      where id = v_origin_id
        and tenant_id = v_tenant_id;
    else
      raise exception 'INVALID_META: origin_entity_type must be shipment|task';
    end if;
  end if;

  -- Persist DB-derived child codes for visibility/downstream templates.
  v_meta := jsonb_set(
    v_meta,
    '{split_workflow,child_item_codes}',
    to_jsonb(coalesce(v_child_codes, array[]::text[])),
    true
  );

  update public.tasks
  set status = 'completed',
      completed_at = now(),
      completed_by = v_user_id,
      ended_at = now(),
      ended_by = v_user_id,
      metadata = v_meta,
      updated_at = now()
  where id = p_split_task_id
    and tenant_id = v_tenant_id;

  return json_build_object(
    'ok', true,
    'already_completed', false,
    'task_id', p_split_task_id,
    'origin_entity_type', v_origin_type,
    'origin_entity_id', v_origin_id,
    'parent_item_id', v_parent_item_id,
    'parent_item_code', v_parent.item_code,
    'keep_qty', v_keep_qty,
    'leftover_qty', v_leftover_qty,
    'child_item_codes', coalesce(v_child_codes, array[]::text[]),
    'requester_email', v_requester_email,
    'requester_name', v_requester_name
  );
end;
$$;

revoke all on function public.rpc_complete_split_task(uuid) from public;
grant execute on function public.rpc_complete_split_task(uuid) to authenticated;
