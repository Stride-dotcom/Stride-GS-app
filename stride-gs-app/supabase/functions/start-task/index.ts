/**
 * start-task — SB-primary handler for `startTask`, with best-effort
 * GAS write-back to keep the per-tenant Tasks sheet in sync.
 *
 * Renamed from start-task-sb to match Justin's canonical spec (the
 * old function slug stays deployed until manually retired; nothing
 * references it after this PR).
 *
 * ── Why GAS write-back ─────────────────────────────────────────────
 * `api_fullClientSync_` (the periodic GAS→SB sync that backs the React
 * read cache) calls `supabaseDeleteStaleRows_`, which truncates SB
 * rows the sheet doesn't carry. An SB-only write to `public.tasks`
 * would survive only until the next sync, then revert (column writes
 * overwritten by sheet values; missing-from-sheet rows would even get
 * deleted).
 *
 * Until the legacy sheet readers (CB invoice generation, full client
 * sync) migrate to SB as their source of truth — or until we add a
 * `tasks` writer to the `writeThroughReverse` framework so the sheet
 * mirror only updates the touched cells — the pragmatic bridge is:
 * write SB first (instant for the user, idempotent counter bumps,
 * audit row in entity_audit_log), then fire the legacy GAS startTask
 * endpoint in background so the sheet catches up.
 *
 * Side-effect duplication during the transition: the GAS endpoint
 * fires its own api_auditLog_ and api_notifySupabase_ calls. So the
 * audit log gains a second row for each click while parity_enabled is
 * on; the SB notify is a duplicate of the GAS notify. Both are
 * additive (no deletes / mutations) so the audit trail remains
 * readable. Acceptable for the transition window. When we flip to
 * `active_backend='supabase'` AND retire the GAS write-back (after
 * adding a tasks writer to writeThroughReverse), the duplication
 * goes away.
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
    const { data: existing, error: existingErr } = await supabase
      .from('tasks')
      .select('task_id, status, started_at, assigned_to')
      .eq('tenant_id', tenantId)
      .eq('task_id', taskId)
      .maybeSingle();
    if (existingErr) return json({ ok: false, error: `Task lookup failed: ${existingErr.message}` }, 500);
    if (!existing)   return json({ ok: false, error: `Task ${taskId} not found`, errorCode: 'NOT_FOUND' }, 404);

    const previousStatus   = String(existing.status ?? '').trim();
    const previousStarted  = (existing.started_at ?? '').toString().trim();
    const existingAssignee = String(existing.assigned_to ?? '').trim();

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

    // ── 6. Best-effort GAS write-back ─────────────────────────────────
    // Non-blocking from the user's perspective: we fire the GAS call
    // but don't await it. Returning the SB result is what the React
    // caller actually needs for the UI; the GAS call just keeps the
    // sheet in sync for the next fullClientSync pass.
    //
    // Why action=startTask (the full handler) rather than a sheet-
    // only writer: tasks aren't yet in the writeThroughReverse
    // framework (P1.4 only covers inventory / will_calls / repairs /
    // billing). Adding a tasks writer would mean a GAS-side StrideAPI
    // bump + redeploy in the same PR. For the transition window the
    // full handler is acceptable — the audit duplicate is documented
    // in the file header.
    const gasUrl   = Deno.env.get('GAS_API_URL')   ?? '';
    const gasToken = Deno.env.get('GAS_API_TOKEN') ?? '';
    let gasWriteBack: 'fired' | 'skipped' | 'failed' = 'skipped';
    if (gasUrl && gasToken) {
      gasWriteBack = 'fired';
      // Fire-and-forget. Wrapped in a void IIFE so the awaited
      // chain runs detached from the response path. Any failure is
      // logged to gs_sync_events for monitoring without blocking
      // the SB-side result.
      void (async () => {
        try {
          const res = await fetch(
            `${gasUrl}?action=startTask&token=${encodeURIComponent(gasToken)}&clientSheetId=${encodeURIComponent(tenantId)}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                taskId,
                assignedTo: assignedTo || undefined,
                forceOverride: forceOverride || undefined,
                requestId,
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
              payload:       { taskId, assignedTo: assignedTo || null, forceOverride },
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
            payload:       { taskId, assignedTo: assignedTo || null, forceOverride },
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
