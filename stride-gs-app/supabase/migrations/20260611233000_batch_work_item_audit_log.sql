-- ============================================================================
-- BatchWorkItems — Activity-log per-item work (D2 final, BATCH_WORK_ITEMS_QA.md)
-- (feat/repairs/batch-complete-button)
--
-- Justin (2026-06-11): per-item notes behave exactly like single-item notes —
-- update in place, and the history/Activity log records the changes. The
-- update_batch_work_item RPC therefore now writes an entity_audit_log row
-- (action='item_work', changes.summary human-readable) whenever a call
-- actually changes an item's status or notes, so the parent repair/task's
-- Activity tab shows "Item 63333: In Progress → Pass" / "Item 63333 notes
-- updated" entries with who + when. No-op calls (same status, same notes)
-- log nothing. Audit insert is best-effort — a failure never blocks the
-- work write itself.
--
-- 2026-06-11 PST
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_batch_work_item(
  p_entity_type text,
  p_tenant_id   text,
  p_entity_id   text,
  p_item_id     text,
  p_status      text    DEFAULT NULL,
  p_notes       text    DEFAULT NULL,
  p_qty         numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role       text;
  v_result     text;
  v_row        jsonb;
  v_old_status text;
  v_old_notes  text;
  v_actor      text;
  v_parts      text[] := ARRAY[]::text[];
BEGIN
  -- Admin/staff gate (service_role bypasses).
  IF auth.role() = 'service_role' THEN
    NULL;
  ELSE
    v_role := LOWER(COALESCE(auth.jwt() -> 'user_metadata' ->> 'role', ''));
    IF v_role NOT IN ('admin', 'staff') THEN
      RAISE EXCEPTION 'update_batch_work_item requires admin/staff role (got %)', v_role
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_entity_type NOT IN ('repair', 'task') THEN
    RAISE EXCEPTION 'unknown entity_type % (expected repair|task)', p_entity_type
      USING ERRCODE = '22023';
  END IF;
  IF p_status IS NOT NULL
     AND p_status NOT IN ('Pending', 'In Progress', 'Pass', 'Fail') THEN
    RAISE EXCEPTION 'invalid item status %', p_status USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_tenant_id, '') = '' OR COALESCE(p_entity_id, '') = ''
     OR COALESCE(p_item_id, '') = '' THEN
    RAISE EXCEPTION 'tenant_id, entity_id and item_id are required'
      USING ERRCODE = '22023';
  END IF;

  -- Legacy item_result mirror: lowercase passed/failed, NULL when unresolved.
  v_result := CASE p_status
                WHEN 'Pass' THEN 'passed'
                WHEN 'Fail' THEN 'failed'
                ELSE NULL
              END;

  IF p_entity_type = 'repair' THEN
    -- Guard: never mint membership rows for a repair that doesn't exist.
    IF NOT EXISTS (SELECT 1 FROM public.repairs
                    WHERE tenant_id = p_tenant_id AND repair_id = p_entity_id) THEN
      RAISE EXCEPTION 'repair % not found for tenant', p_entity_id USING ERRCODE = '23503';
    END IF;

    -- Prior values — drive the changed-only audit entry below.
    SELECT item_status, item_notes INTO v_old_status, v_old_notes
      FROM public.repair_items
     WHERE tenant_id = p_tenant_id AND repair_id = p_entity_id AND item_id = p_item_id;

    INSERT INTO public.repair_items
      (tenant_id, repair_id, item_id, qty, item_status, item_result, item_notes,
       started_at, completed_at)
    VALUES
      (p_tenant_id, p_entity_id, p_item_id, COALESCE(p_qty, 1),
       COALESCE(p_status, 'Pending'), v_result, p_notes,
       CASE WHEN p_status = 'In Progress' THEN now() END,
       CASE WHEN p_status IN ('Pass', 'Fail') THEN now() END)
    ON CONFLICT (tenant_id, repair_id, item_id) DO UPDATE SET
      -- NOT COALESCE(EXCLUDED...): EXCLUDED.item_status is never NULL (the
      -- VALUES default is 'Pending'), which would reset status on a
      -- notes-only call. Branch on p_status itself.
      item_status  = CASE WHEN p_status IS NULL THEN repair_items.item_status
                          ELSE p_status END,
      item_result  = CASE WHEN p_status IS NULL THEN repair_items.item_result
                          ELSE v_result END,
      item_notes   = COALESCE(p_notes, repair_items.item_notes),
      qty          = COALESCE(p_qty, repair_items.qty),
      started_at   = CASE WHEN p_status = 'In Progress'
                          THEN COALESCE(repair_items.started_at, now())
                          ELSE repair_items.started_at END,
      completed_at = CASE WHEN p_status IN ('Pass', 'Fail')
                            THEN COALESCE(repair_items.completed_at, now())
                          WHEN p_status IN ('Pending', 'In Progress')
                            THEN NULL
                          ELSE repair_items.completed_at END,
      updated_at   = now()
    RETURNING to_jsonb(repair_items.*) INTO v_row;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.tasks
                    WHERE tenant_id = p_tenant_id AND task_id = p_entity_id) THEN
      RAISE EXCEPTION 'task % not found for tenant', p_entity_id USING ERRCODE = '23503';
    END IF;

    SELECT item_status, item_notes INTO v_old_status, v_old_notes
      FROM public.task_items
     WHERE tenant_id = p_tenant_id AND task_id = p_entity_id AND item_id = p_item_id;

    INSERT INTO public.task_items
      (tenant_id, task_id, item_id, qty, item_status, item_result, item_notes,
       started_at, completed_at)
    VALUES
      (p_tenant_id, p_entity_id, p_item_id, COALESCE(p_qty, 1),
       COALESCE(p_status, 'Pending'), v_result, p_notes,
       CASE WHEN p_status = 'In Progress' THEN now() END,
       CASE WHEN p_status IN ('Pass', 'Fail') THEN now() END)
    ON CONFLICT (tenant_id, task_id, item_id) DO UPDATE SET
      item_status  = CASE WHEN p_status IS NULL THEN task_items.item_status
                          ELSE p_status END,
      item_result  = CASE WHEN p_status IS NULL THEN task_items.item_result
                          ELSE v_result END,
      item_notes   = COALESCE(p_notes, task_items.item_notes),
      qty          = COALESCE(p_qty, task_items.qty),
      started_at   = CASE WHEN p_status = 'In Progress'
                          THEN COALESCE(task_items.started_at, now())
                          ELSE task_items.started_at END,
      completed_at = CASE WHEN p_status IN ('Pass', 'Fail')
                            THEN COALESCE(task_items.completed_at, now())
                          WHEN p_status IN ('Pending', 'In Progress')
                            THEN NULL
                          ELSE task_items.completed_at END,
      updated_at   = now()
    RETURNING to_jsonb(task_items.*) INTO v_row;
  END IF;

  -- D2: Activity-log actual changes (changed-only; best-effort — an audit
  -- failure must never roll back the work write). changes.summary is what
  -- EntityHistory renders verbatim.
  BEGIN
    IF p_status IS NOT NULL AND p_status IS DISTINCT FROM COALESCE(v_old_status, 'Pending') THEN
      v_parts := v_parts || format('Item %s: %s → %s',
                                   p_item_id, COALESCE(v_old_status, 'Pending'), p_status);
    END IF;
    IF p_notes IS NOT NULL AND p_notes IS DISTINCT FROM COALESCE(v_old_notes, '') THEN
      v_parts := v_parts || format('Item %s notes updated', p_item_id);
    END IF;
    IF array_length(v_parts, 1) > 0 THEN
      v_actor := COALESCE(NULLIF(auth.jwt() ->> 'email', ''), 'staff');
      INSERT INTO public.entity_audit_log
        (entity_type, entity_id, tenant_id, action, changes, performed_by, source)
      VALUES
        (p_entity_type, p_entity_id, p_tenant_id, 'item_work',
         jsonb_build_object(
           'summary', array_to_string(v_parts, ' · '),
           'itemId',  p_item_id,
           'notes',   CASE WHEN p_notes IS NOT NULL AND p_notes IS DISTINCT FROM COALESCE(v_old_notes, '')
                           THEN LEFT(p_notes, 500) END),
         v_actor, 'supabase');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL; -- audit is best-effort
  END;

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.update_batch_work_item(text, text, text, text, text, text, numeric) IS
  'BatchWorkItems write path: upsert per-item status/notes on repair_items / '
  'task_items. Admin/staff gated SECURITY DEFINER (neither table has '
  'authenticated write policies). Stamps started_at on first In Progress, '
  'completed_at on Pass/Fail; mirrors item_result as lowercase passed/failed '
  'for legacy readers; logs changed-only entity_audit_log rows '
  '(action=item_work) so the parent Activity tab shows per-item work. '
  'Supabase-only — no sheet writethrough.';
