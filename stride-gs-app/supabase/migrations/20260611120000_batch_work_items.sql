-- ============================================================================
-- BatchWorkItems — shared per-item work tracking for batch jobs
-- (feat/warehouse/batch-work-items)
--
-- A reusable module repairs and tasks (and future entity types) plug into:
-- each item in a batch job can be independently started, passed/failed,
-- photographed and annotated. This migration ships the data model:
--
--   1. repair_items gains item_status / started_at / completed_at
--      (item_result stays as the legacy lowercase 'passed'/'failed' mirror —
--      complete-repair-sb's email renderer and RepairDetailPanel's read-only
--      Result column still read it).
--   2. NEW public.task_items — same shape as repair_items. Tasks are
--      single-item today (tasks.item_id); rows here are created lazily by
--      the update_batch_work_item RPC the first time staff act on an item,
--      so there is NO bulk backfill of the ~thousands of existing tasks.
--      The React hook synthesizes a display row from tasks.item_id when no
--      task_items rows exist yet.
--   3. update_batch_work_item RPC — SECURITY DEFINER (admin/staff gated)
--      upsert for both tables. Browser writes go through this because
--      neither table has (or should have) authenticated write policies.
--   4. batchWorkItems feature flag — UI behavior gate (NOT apiRouter
--      routing; no GAS_TO_SB_MAP entry), scoped to the Justin Demo Account
--      per MIG-010 canary semantics.
--
-- Both tables are Supabase-authoritative: the per-tenant sheets have no
-- per-item columns, and the full-client-sync intentionally does not sweep
-- repair_items (see StrideAPI.gs v38.220.0 note) — so no reverse
-- writethrough is needed and nothing NULLs these columns back.
--
-- 2026-06-11 PST
-- ============================================================================

-- ── 1. repair_items: per-item work status ───────────────────────────────────

ALTER TABLE public.repair_items
  ADD COLUMN IF NOT EXISTS item_status  text NOT NULL DEFAULT 'Pending',
  ADD COLUMN IF NOT EXISTS started_at   timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

-- Backfill: derive item_status from the legacy item_result on rows that
-- already carry a result (read-only display shipped in PR #397; nothing
-- ever wrote it from the UI, but be defensive about any rows that have it).
UPDATE public.repair_items
   SET item_status  = CASE LOWER(COALESCE(item_result, ''))
                        WHEN 'passed' THEN 'Pass'
                        WHEN 'failed' THEN 'Fail'
                        ELSE item_status
                      END,
       completed_at = COALESCE(completed_at, updated_at)
 WHERE LOWER(COALESCE(item_result, '')) IN ('passed', 'failed');

DO $$
BEGIN
  ALTER TABLE public.repair_items
    ADD CONSTRAINT repair_items_item_status_check
      CHECK (item_status IN ('Pending', 'In Progress', 'Pass', 'Fail'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.repair_items.item_status IS
  'BatchWorkItems per-item work status: Pending -> In Progress -> Pass|Fail. '
  'Canonical going forward; item_result mirrors it as lowercase passed/failed '
  'for legacy readers. Informational — does not affect billing.';

-- ── 2. task_items — same shape as repair_items ──────────────────────────────

CREATE TABLE IF NOT EXISTS public.task_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    text NOT NULL,
  task_id      text NOT NULL,
  item_id      text NOT NULL,
  qty          numeric NOT NULL DEFAULT 1,
  item_status  text NOT NULL DEFAULT 'Pending'
                 CHECK (item_status IN ('Pending', 'In Progress', 'Pass', 'Fail')),
  item_result  text,
  item_notes   text,
  started_at   timestamptz,
  completed_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, task_id, item_id)
);

COMMENT ON TABLE public.task_items IS
  'Join table — items belonging to a task (BatchWorkItems module). Same '
  'shape as repair_items. Rows are created lazily by update_batch_work_item '
  'the first time staff act on an item; legacy single-item tasks without '
  'rows here render a synthetic row from tasks.item_id. Per-item status is '
  'informational — task billing stays at the parent level.';

CREATE INDEX IF NOT EXISTS idx_task_items_task_id
  ON public.task_items (tenant_id, task_id);

CREATE INDEX IF NOT EXISTS idx_task_items_item_id
  ON public.task_items (tenant_id, item_id);

-- Required 4-step Data API template (grants + RLS) — see CLAUDE.md.
GRANT SELECT ON public.task_items TO authenticated;
GRANT ALL    ON public.task_items TO service_role;
-- repair_items predates the explicit-grants rule; assert its grant too
-- (idempotent — also covered by 20260520120000_backfill_data_api_grants).
GRANT SELECT ON public.repair_items TO authenticated;
GRANT ALL    ON public.repair_items TO service_role;

ALTER TABLE public.task_items ENABLE ROW LEVEL SECURITY;

-- Mirror repair_items policies: staff/admin read everywhere, clients read
-- their own tenant, service_role everything. No authenticated write
-- policies — browser writes go through the update_batch_work_item RPC.
CREATE POLICY task_items_select_client
  ON public.task_items
  FOR SELECT
  USING (user_has_tenant_access(tenant_id));

CREATE POLICY task_items_select_staff
  ON public.task_items
  FOR SELECT
  USING (
    ((auth.jwt() -> 'user_metadata'::text) ->> 'role'::text) = ANY
    (ARRAY['admin'::text, 'staff'::text])
  );

CREATE POLICY task_items_service_all
  ON public.task_items
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Realtime — live per-item updates across tabs (repair_items already added).
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.task_items;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 3. update_batch_work_item RPC ────────────────────────────────────────────
-- Single browser write path for both tables (same shape as set_cod_storage:
-- SECURITY DEFINER, role-gated to admin/staff, service_role bypasses).
-- Upserts the row so legacy tasks without task_items rows get one the first
-- time staff act on the item. p_status / p_notes / p_qty are independently
-- optional — NULL means "leave unchanged".
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
  v_role   text;
  v_result text;
  v_row    jsonb;
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

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.update_batch_work_item(text, text, text, text, text, text, numeric) IS
  'BatchWorkItems write path: upsert per-item status/notes on repair_items / '
  'task_items. Admin/staff gated SECURITY DEFINER (neither table has '
  'authenticated write policies). Stamps started_at on first In Progress, '
  'completed_at on Pass/Fail; mirrors item_result as lowercase passed/failed '
  'for legacy readers. Supabase-only — no sheet writethrough.';

GRANT EXECUTE ON FUNCTION public.update_batch_work_item(text, text, text, text, text, text, numeric)
  TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.update_batch_work_item(text, text, text, text, text, text, numeric)
  FROM PUBLIC, anon;

-- ── 4. Feature flag — UI behavior gate, Justin Demo canary ──────────────────
-- MIG-010 per-tenant scope semantics: active_backend='supabase' +
-- tenant_scope=[demo] means the module renders ONLY for the demo tenant's
-- data; everyone else resolves to 'gas' (= existing UI). No apiRouter entry —
-- this gates rendering + auto-complete behavior, not request routing.
INSERT INTO public.feature_flags (function_key, active_backend, tenant_scope, parity_enabled, notes)
VALUES (
  'batchWorkItems',
  'supabase',
  ARRAY['1-nF3CgQBcfCncqW6u3d4jilsZzjqR1RO6y_f4OD-O2A']::text[],
  false,
  'BatchWorkItems module (per-item start/pass/fail + photos on repair/task '
  'detail). UI-only behavior gate resolved against the DATA tenant — not an '
  'apiRouter routing flag. Scoped to Justin Demo Account for canary.'
)
ON CONFLICT (function_key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
