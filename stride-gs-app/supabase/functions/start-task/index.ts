/**
 * start-task — SB-primary handler for `startTask`, with best-effort
 * GAS write-back to keep the per-tenant Tasks sheet in sync.
 *
 * Renamed from start-task-sb to match Justin's canonical spec (the
 * old function slug stays deployed until manually retired; nothing
 * references it after this PR).
 *
 * ── Why a GAS sheet write-back ─────────────────────────────────────
 * `api_fullClientSync_` (the periodic GAS→SB sync that backs the React
 * read cache) calls `supabaseDeleteStaleRows_`, which truncates SB
 * rows the sheet doesn't carry. An SB-only write to `public.tasks`
 * would survive only until the next sync, then revert (column writes
 * overwritten by sheet values).
 *
 * So after writing SB we mirror the touched cells to the sheet via the
 * cell-level `writeThroughReverse` `tasks` writer
 * (__writeThroughReverseTasks_, StrideAPI.gs). We deliberately do NOT
 * call the full `action=startTask` handler: that re-runs the start flow
 * and calls api_notifySupabase_, which re-asserts status='In Progress'
 * back onto public.tasks. Being fire-and-forget + Drive-heavy (several
 * seconds), that re-assert could land AFTER a quick subsequent
 * complete-task and stamp the row back to In Progress — the 2026-06-02
 * completion-revert incident. writeThroughReverse only sets the
 * Status / Started At / Assigned To cells on the sheet and never writes
 * back to public.tasks, so it cannot clobber a later completion. Mirror
 * of complete-task step 3.
 *
 * ── Behavior (mirror of handleStartTask_ at StrideAPI.gs:28439) ──
 *   • Idempotency: `started_at` already populated → noOp:true
 *   • Conflict: status='In Progress' + different assignee +
 *     !forceOverride → ok:false, conflict:true
 *   • First start (status='Open'): flip to 'In Progress' + stamp
 *     started_at = now() (ISO 8601)
 *   • Re-claim (status='In Progress', no assignee or forceOverride):
 *     write assigned_to only
 *
 * Audit shape: `{status:{new:'In Progress'}}` — matches GAS:8630.
 *
 * Request:  POST { tenantId, taskId, assignedTo?, forceOverride?, requestId? }
 * Response: { ok, noOp?, conflict?, taskId, previousStatus, startedAt?, assignedTo?, gasWriteBack? }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const tenantId: string       = String(body.tenantId ?? '').trim();
    const taskId: string         = String(body.taskId ?? '').trim();
    const assignedTo: string     = String(body.assignedTo ?? '').trim();
    const forceOverride: boolean = body.forceOverride === true;
    const requestId: string      = String(body.requestId ?? '').trim() || crypto.randomUUID();

    if (!tenantId) return json({ ok: false, error: 'tenantId is required' }, 400);
    if (!taskId)   return json({ ok: false, error: 'taskId is required' },   400);

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const anonKey     = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    if (!supabaseUrl || !serviceKey || !anonKey) {
      return json({ ok: false, error: 'Server misconfigured' }, 500);
    }

    // Verified caller email — same pattern as start-repair-sb.
    const authHeader = req.headers.get('Authorization');
    let callerEmail = 'system';
    if (authHeader) {
      const token = authHeader.replace(/^Bearer\s+/i, '');
      const authClient = createClient(supabaseUrl, anonKey);
      const { data: { user }, error: authErr } = await authClient.auth.getUser(token);
      if (!authErr && user?.email) callerEmail = user.email;
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    // ── 1. Load current task state ─────────────────────────────────────
    // task_folder_url passed through to the response so the React caller's
    // "Open Folder" affordance doesn't regress when cutover flips
    // active_backend to supabase (handleStartTask_'s response includes
    // folderUrl, which TaskDetailPanel renders via activeFolderUrl).
    const { data: existing, error: existingErr } = await supabase
      .from('tasks')
      .select('task_id, status, started_at, assigned_to, task_folder_url')
      .eq('tenant_id', tenantId)
      .eq('task_id', taskId)
      .maybeSingle();
    if (existingErr) return json({ ok: false, error: `Task lookup failed: ${existingErr.message}` }, 500);
    if (!existing)   return json({ ok: false, error: `Task ${taskId} not found`, errorCode: 'NOT_FOUND' }, 404);

    const previousStatus   = String(existing.status ?? '').trim();
    const previousStarted  = (existing.started_at ?? '').toString().trim();
    const existingAssignee = String(existing.assigned_to ?? '').trim();
    const taskFolderUrl    = String(existing.task_folder_url ?? '').trim();

    // ── 2. Idempotency — already started ──────────────────────────────
    if (previousStarted) {
      await insertAuditLog(supabase, { taskId, tenantId, callerEmail });
      // No GAS write-back on noOp — sheet is already in sync (the
      // previous start call put it there) and we have nothing new
      // to mirror.
      return json({
        ok: true, noOp: true,
        taskId, previousStatus,
        startedAt: previousStarted,
        assignedTo: existingAssignee,
        folderUrl: taskFolderUrl,
        message: 'Task already started',
      });
    }

    // ── 3. Conflict guard ─────────────────────────────────────────────
    if (previousStatus === 'In Progress'
        && existingAssignee
        && assignedTo
        && existingAssignee.toLowerCase() !== assignedTo.toLowerCase()
        && !forceOverride) {
      return json({
        ok: false, conflict: true,
        taskId, assignedTo: existingAssignee,
        message: `Task is already assigned to ${existingAssignee}. Use forceOverride to reassign.`,
      });
    }

    // ── 4. UPDATE public.tasks ────────────────────────────────────────
    const startedAtNow = new Date().toISOString();
    const updateRow: Record<string, unknown> = {
      started_at: startedAtNow,
      updated_at: startedAtNow,
    };
    if (previousStatus === 'Open') updateRow.status = 'In Progress';
    if (assignedTo && (!existingAssignee || forceOverride)) {
      updateRow.assigned_to = assignedTo;
    }
    const { error: updErr } = await supabase
      .from('tasks')
      .update(updateRow)
      .eq('tenant_id', tenantId)
      .eq('task_id', taskId);
    if (updErr) return json({ ok: false, error: `Update failed: ${updErr.message}` }, 500);

    // ── 5. Audit log ──────────────────────────────────────────────────
    await insertAuditLog(supabase, { taskId, tenantId, callerEmail });

    // ── 6. Best-effort GAS sheet sync via writeThroughReverse ─────────
    // Non-blocking: fire-and-forget so the React caller gets the SB
    // result instantly. This only keeps the per-tenant Tasks sheet in
    // step so the next api_fullClientSync_ doesn't revert the SB write.
    //
    // Cell-level writeThroughReverse (NOT action=startTask): the full
    // start handler calls api_notifySupabase_, which would re-assert
    // status='In Progress' back onto public.tasks and — landing late,
    // after a quick complete-task — revert the completion (see header +
    // the 2026-06-02 incident). __writeThroughReverseTasks_ only writes
    // the Status / Started At / Assigned To sheet cells; it never writes
    // back to public.tasks, so it cannot clobber a later completion.
    const gasUrl   = Deno.env.get('GAS_API_URL')   ?? '';
    const gasToken = Deno.env.get('GAS_API_TOKEN') ?? '';
    let gasWriteBack: 'fired' | 'skipped' | 'failed' = 'skipped';
    if (gasUrl && gasToken) {
      gasWriteBack = 'fired';
      // Mirror exactly the fields we wrote to public.tasks in §4 so the
      // sheet matches: started_at always; status only on first start
      // (Open → In Progress); assigned_to only when we (re)assigned it.
      const sheetRow: Record<string, unknown> = { started_at: startedAtNow };
      if (previousStatus === 'Open') sheetRow.status = 'In Progress';
      if (assignedTo && (!existingAssignee || forceOverride)) sheetRow.assigned_to = assignedTo;
      // Fire-and-forget. Failures land in gs_sync_events for monitoring
      // without blocking the SB-side result.
      void (async () => {
        try {
          const res = await fetch(
            `${gasUrl}?action=writeThroughReverse&token=${encodeURIComponent(gasToken)}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                tenantId, table: 'tasks', op: 'update',
                rowId: taskId, row: sheetRow, requestId,
              }),
            },
          );
          const text = await res.text();
          let parsed: { success?: boolean; error?: string } = {};
          try { parsed = JSON.parse(text); } catch { parsed = { error: `non-JSON: ${text.slice(0, 200)}` }; }
          if (!res.ok || parsed.success === false) {
            await supabase.from('gs_sync_events').insert({
              tenant_id:     tenantId,
              entity_type:   'task',
              entity_id:     taskId,
              action_type:   'start_task_gas_writeback',
              sync_status:   'sync_failed',
              requested_by:  `start-task:${callerEmail}`,
              request_id:    requestId,
              payload:       { table: 'tasks', op: 'update', rowId: taskId, row: sheetRow },
              error_message: (parsed.error ?? `HTTP ${res.status}`).slice(0, 1000),
            }).then(() => {}, () => {});
          }
        } catch (err) {
          await supabase.from('gs_sync_events').insert({
            tenant_id:     tenantId,
            entity_type:   'task',
            entity_id:     taskId,
            action_type:   'start_task_gas_writeback',
            sync_status:   'sync_failed',
            requested_by:  `start-task:${callerEmail}`,
            request_id:    requestId,
            payload:       { table: 'tasks', op: 'update', rowId: taskId },
            error_message: (err instanceof Error ? err.message : String(err)).slice(0, 1000),
          }).then(() => {}, () => {});
        }
      })();
    }

    return json({
      ok: true,
      taskId, previousStatus,
      startedAt: startedAtNow,
      assignedTo: (assignedTo && (!existingAssignee || forceOverride)) ? assignedTo : existingAssignee,
      folderUrl: taskFolderUrl,  // pre-existing (per-task folder no longer auto-created since v38.141.0)
      gasWriteBack,
      requestId,
    });

  } catch (err) {
    console.error('[start-task] Unexpected error:', err);
    return json({ ok: false, error: String(err) }, 500);
  }
});

interface AuditOpts { taskId: string; tenantId: string; callerEmail: string }
// deno-lint-ignore no-explicit-any
async function insertAuditLog(supabase: any, opts: AuditOpts): Promise<void> {
  await supabase.from('entity_audit_log').insert({
    entity_type:  'task',
    entity_id:    opts.taskId,
    tenant_id:    opts.tenantId,
    action:       'start',
    changes:      { status: { new: 'In Progress' } },
    performed_by: opts.callerEmail,
    source:       'edge',
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
