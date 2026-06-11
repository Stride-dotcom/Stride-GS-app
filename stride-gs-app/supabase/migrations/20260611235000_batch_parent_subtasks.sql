-- ============================================================================
-- Batch parent + REAL sub-tasks (D11, BATCH_WORK_ITEMS_QA.md)
-- (feat/tasks/batch-parent-subtasks)
--
-- Justin's architecture (2026-06-11): a batch is a parent ORDER NUMBER that
-- houses real single-item tasks as subs. Each sub rides the existing
-- single-task rails (per-item class-based billing via complete_task_atomic,
-- badges, notes, photos, SLA, dedup) — no join-table, no parent row.
--
--   1. tasks.batch_no — the parent batch number stamped on every sub
--      (JUS-BATCH-12). Sub task_id = {batch_no}-{item_id}
--      (JUS-BATCH-12-63333). Grouping reads the COLUMN, never parses ids.
--      SB-only: sbTaskRow_ has no batch_no key, so every GAS sheet→SB
--      upsert simply omits the column and PostgREST merge-duplicates
--      preserves it (same survival mechanism as tasks.qty — see
--      feedback_sbtaskrow_field_gap_wipes).
--   2. next_order_id learns order_type 'batch' → token BATCH (own
--      per-tenant sequence row in order_sequences, auto-minted on first
--      use by next_order_number's INSERT..ON CONFLICT).
--   3. batchWorkItemsTasks flag seeded (demo scope) — under D11 it gates
--      ONLY the CreateTaskModal "batch" toggle (the per-item module on
--      TaskDetailPanel is removed for tasks; subs are real tasks).
--   4. BATCH_COMPLETE email template — option B: subs complete silently;
--      when the LAST sub goes terminal, complete-task sends ONE summary
--      with the per-item Result + Notes table.
--
-- The earlier task_items table + update_batch_work_item task branch stay in
-- place (repairs still use the RPC; task_items is simply unused) — no
-- destructive cleanup while the demo canary may hold rows.
--
-- 2026-06-11 PST
-- ============================================================================

-- ── 1. tasks.batch_no ────────────────────────────────────────────────────────

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS batch_no text;

COMMENT ON COLUMN public.tasks.batch_no IS
  'Batch parent order number (JUS-BATCH-N) when this task is a sub-task of '
  'a batch creation (D11). NULL for standalone tasks. SB-only — the '
  'per-tenant Tasks sheet has no Batch column and sbTaskRow_ never projects '
  'this key, so sheet->SB upserts preserve it.';

CREATE INDEX IF NOT EXISTS idx_tasks_batch_no
  ON public.tasks (tenant_id, batch_no)
  WHERE batch_no IS NOT NULL;

-- ── 2. next_order_id: 'batch' order type ────────────────────────────────────
-- Byte-identical to the 20260609120000 definition except the BATCH token.

CREATE OR REPLACE FUNCTION public.next_order_id(p_tenant_id text, p_order_type text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_token  text;
  v_prefix text;
  v_n      bigint;
BEGIN
  IF NOT public.order_numbering_enabled(p_tenant_id) THEN
    RETURN NULL;
  END IF;

  v_token := CASE p_order_type
    WHEN 'repair'    THEN 'RPR'
    WHEN 'will_call' THEN 'WC'
    WHEN 'task'      THEN 'TSK'
    WHEN 'batch'     THEN 'BATCH'  -- D11 batch parent order numbers
    ELSE NULL                      -- delivery / unknown: no type token
  END;

  v_prefix := public.order_client_prefix(p_tenant_id);
  v_n      := public.next_order_number(p_tenant_id, p_order_type);

  IF v_token IS NULL THEN
    RETURN v_prefix || '-' || v_n::text;
  END IF;
  RETURN v_prefix || '-' || v_token || '-' || v_n::text;
END;
$$;

-- ── 3. Flag: batchWorkItemsTasks (demo canary; gates the modal toggle) ──────

INSERT INTO public.feature_flags (function_key, active_backend, tenant_scope, parity_enabled, notes)
VALUES (
  'batchWorkItemsTasks',
  'supabase',
  ARRAY['1-nF3CgQBcfCncqW6u3d4jilsZzjqR1RO6y_f4OD-O2A']::text[],
  false,
  'D11 batch parent + real sub-tasks: gates ONLY the CreateTaskModal batch '
  'toggle (one BATCH order number, one real task per item). UI-only behavior '
  'gate resolved against the DATA tenant. Justin Demo canary.'
)
ON CONFLICT (function_key) DO UPDATE
  SET active_backend = EXCLUDED.active_backend,
      tenant_scope   = EXCLUDED.tenant_scope,
      notes          = EXCLUDED.notes;

-- ── 4. BATCH_COMPLETE email template (option B summary) ─────────────────────
-- Operator-editable afterwards in Settings → Templates. Tokens supplied by
-- complete-task: CLIENT_NAME, BATCH_NO, SVC_NAME, COMPLETED_DATE, TASK_COUNT,
-- PASS_COUNT, FAIL_COUNT, ITEM_TABLE_HTML, APP_URL, APP_DEEP_LINK.

INSERT INTO public.email_templates (template_key, subject, body, recipients, category, active, notes)
VALUES (
  'BATCH_COMPLETE',
  '{{CLIENT_NAME}} — {{SVC_NAME}} Batch {{BATCH_NO}} Complete ({{TASK_COUNT}} items)',
  '<div style="background:#F5F2EE;padding:32px 16px 48px;font-family:''Inter'',Arial,sans-serif"><table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:660px;margin:0 auto"><tr><td><table width="100%" cellpadding="0" cellspacing="0" border="0" style="padding:0 8px 24px"><tr><td valign="middle"><table cellpadding="0" cellspacing="0" border="0"><tr><td valign="middle" style="padding-right:10px"><img src="https://static.wixstatic.com/media/a38fbc_e4bdb945b21f4b9f8b10873799e8f8f1~mv2.png" alt="Stride" width="40" height="40" style="display:block" /></td><td valign="middle"><div style="font-family:''Oswald'',Arial,sans-serif;font-size:24px;font-weight:600;letter-spacing:2px;color:#1C1C1C;text-transform:uppercase;line-height:1;margin-bottom:3px">STRIDE</div><div style="font-family:''Oswald'',Arial,sans-serif;font-size:10px;font-weight:400;letter-spacing:5px;color:#888888;text-transform:uppercase;line-height:1">LOGISTICS</div></td></tr></table></td><td align="right" valign="middle"><span style="font-size:11px;color:#999999;letter-spacing:1px">Batch Complete</span></td></tr></table><div style="background:#1C1C1C;border-radius:20px;padding:48px 40px;margin-bottom:16px;color:#fff"><div style="font-size:10px;font-weight:500;letter-spacing:4px;color:#E8692A;text-transform:uppercase;margin-bottom:16px">Batch {{BATCH_NO}}</div><div style="font-size:32px;font-weight:300;color:#fff;line-height:1.2;margin-bottom:12px">{{SVC_NAME}} Batch Complete</div><div style="font-size:14px;font-weight:300;line-height:1.8;color:rgba(255,255,255,0.7)">All {{TASK_COUNT}} items for {{CLIENT_NAME}} have been worked — results for each item are below.</div><table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:32px;border-top:1px solid rgba(255,255,255,0.1);padding-top:24px"><tr><td style="padding-right:16px;vertical-align:top"><div style="font-size:10px;font-weight:500;letter-spacing:2px;color:rgba(255,255,255,0.45);text-transform:uppercase;margin-bottom:6px">Completed</div><div style="font-size:16px;font-weight:500;color:#fff;word-break:break-word">{{COMPLETED_DATE}}</div></td><td style="padding-right:16px;vertical-align:top"><div style="font-size:10px;font-weight:500;letter-spacing:2px;color:rgba(255,255,255,0.45);text-transform:uppercase;margin-bottom:6px">Items</div><div style="font-size:16px;font-weight:500;color:#fff;word-break:break-word">{{TASK_COUNT}}</div></td><td style="padding-right:16px;vertical-align:top"><div style="font-size:10px;font-weight:500;letter-spacing:2px;color:rgba(255,255,255,0.45);text-transform:uppercase;margin-bottom:6px">Passed</div><div style="font-size:16px;font-weight:500;color:#4ADE80;word-break:break-word">{{PASS_COUNT}}</div></td><td style="padding-right:16px;vertical-align:top"><div style="font-size:10px;font-weight:500;letter-spacing:2px;color:rgba(255,255,255,0.45);text-transform:uppercase;margin-bottom:6px">Failed</div><div style="font-size:16px;font-weight:500;color:#F87171;word-break:break-word">{{FAIL_COUNT}}</div></td></tr></table></div><div style="background:#FFFFFF;border-radius:20px;padding:40px;margin-bottom:16px"><div style="font-size:10px;font-weight:500;letter-spacing:4px;color:#E8692A;text-transform:uppercase;margin-bottom:12px">Item Results</div><div style="font-size:14px;font-weight:300;line-height:1.8;color:#666666">{{ITEM_TABLE_HTML}}</div></div><table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 16px"><tr><td align="center" style="padding:0 8px"><a href="{{APP_DEEP_LINK}}" style="display:inline-block;background:#E8692A;color:#fff;font-weight:600;font-size:11px;letter-spacing:2px;text-transform:uppercase;text-decoration:none;padding:16px 32px;border-radius:100px;margin:4px">View in Stride Hub</a></td></tr></table><div style="font-size:11px;font-weight:300;color:#BBBBBB;line-height:2.4;padding:24px 8px 0;text-align:center">Stride Logistics · Kent, WA · whse@stridenw.com</div></td></tr></table></div>',
  '{{STAFF_EMAILS}},{{CLIENT_EMAIL}}',
  'Tasks',
  true,
  'D11 option B: ONE summary email when the LAST sub-task of a batch goes '
  'terminal (complete-task EF; idempotency batch-complete:{tenant}:{batchNo}). '
  'Per-sub completion emails are suppressed for batched tasks.'
)
ON CONFLICT (template_key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
