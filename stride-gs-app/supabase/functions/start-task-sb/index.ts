/**
 * start-task-sb — [MIGRATION-P3] SB-primary handler for `startTask`.
 *
 * Project context: stride-gs-app/MIGRATION_STATUS.md.
 * Decisions: MIG-007 (three-layer verification, Path-C variant per MIG-013).
 *
 * Behavior mirrors GAS handleStartTask_ at StrideAPI.gs:28439, minus the
 * Drive folder / PDF generation (retired in v38.141.0 / v29.6.0 — those
 * paths no longer fire on the GAS side either):
 *
 *   • Idempotency: if `started_at` is already populated → return
 *     `{ ok:true, noOp:true }` without touching the row.
 *   • Conflict guard: if `status='In Progress'` AND `assigned_to`
 *     differs from the caller-supplied value AND `forceOverride` is
 *     not set → return `{ ok:true, conflict:true, assignedTo }`.
 *   • First legitimate start (current status='Open'): flip to
 *     'In Progress' AND stamp `started_at = now()` (ISO 8601 — the
 *     column is text, downstream readers handle either ISO or the
 *     legacy "MM/dd/yyyy HH:mm:ss" the sheet produces).
 *   • Re-claim (current status='In Progress', no existing assignee or
 *     forceOverride): write `assigned_to` only, leave `started_at`
 *     and `status` untouched.
 *
 * Audit log shape: `{ status: { new: 'In Progress' } }` — matches
 * StrideAPI.gs:8630 exactly so the shadow comparison stays 1:1. GAS
 * writes the audit row even on noOp re-clicks; this function mirrors
 * that.
 *
 * Reverse writethrough (sheet mirror) is INTENTIONALLY OMITTED per the
 * P1-build directive ("DO NOT call GAS at all — pure Supabase").
 * Operationally that means the per-tenant Tasks sheet will go stale
 * the moment this function takes over as active_backend. A follow-up
 * before the cutover flag-flip should either add a reverse-writethrough
 * call here or migrate the legacy sheet readers (CB invoice generation,
 * full client sync) to the SB mirror. Tracked in MIGRATION_STATUS.md.
 *
 * Auth: verified caller email via supabase.auth.getUser(token) on an
 * anon-keyed client — same shape cancel-repair-sb / start-repair-sb use.
 * Falls back to 'system' on service_role JWTs (replay-harness path).
 *
 * Request:  POST { tenantId, taskId, assignedTo?, forceOverride?, requestId? }
 * Response: { ok, noOp?, conflict?, taskId, previousStatus, startedAt?, assignedTo? }
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
    const tenantId: string      = String(body.tenantId ?? '').trim();
    const taskId: string        = String(body.taskId ?? '').trim();
    const assignedTo: string    = String(body.assignedTo ?? '').trim();
    const forceOverride: boolean = body.forceOverride === true;
    const requestId: string     = String(body.requestId ?? '').trim() || crypto.randomUUID();

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

    const previousStatus  = String(existing.status ?? '').trim();
    const previousStarted = (existing.started_at ?? '').toString().trim();
    const existingAssignee = String(existing.assigned_to ?? '').trim();

    // ── 2. Idempotency — already started ──────────────────────────────
    // GAS checks Started At + Task ID folder hyperlink. We have no
    // folder concept here, so started_at populated is sufficient.
    if (previousStarted) {
      // Write audit row anyway — GAS does. Mirrors the shadow.
      await insertAuditLog(supabase, { taskId, tenantId, callerEmail });
      return json({
        ok: true, noOp: true,
        taskId, previousStatus,
        startedAt: previousStarted,
        assignedTo: existingAssignee,
        message: 'Task already started',
      });
    }

    // ── 3. Conflict guard — different assignee on In Progress task ────
    if (previousStatus === 'In Progress'
        && existingAssignee
        && assignedTo
        && existingAssignee.toLowerCase() !== assignedTo.toLowerCase()
        && !forceOverride) {
      // GAS returns success:false + conflict:true here. We mirror that
      // shape; the React caller's confirmation dialog re-fires with
      // forceOverride=true.
      return json({
        ok: false, conflict: true,
        taskId, assignedTo: existingAssignee,
        message: `Task is already assigned to ${existingAssignee}. Use forceOverride to reassign.`,
      });
    }

    // ── 4. UPDATE the task ────────────────────────────────────────────
    // status flips only if currently 'Open' (GAS line 28552 condition).
    // started_at always set on the first start.
    // assigned_to set when supplied AND (no existing assignee OR
    // forceOverride). Match GAS line 28561.
    //
    // started_at: ISO 8601. The column is text; existing sync from the
    // sheet produces "MM/dd/yyyy HH:mm:ss" PST. Future cutover may
    // need to switch this if downstream readers depend on the exact
    // sheet format. Audit-log shape is what shadow-compares, and
    // that's a fixed dict — format here doesn't affect parity.
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

    // ── 5. Audit log ───────────────────────────────────────────────────
    await insertAuditLog(supabase, { taskId, tenantId, callerEmail });

    return json({
      ok: true,
      taskId, previousStatus,
      startedAt: startedAtNow,
      assignedTo: (assignedTo && (!existingAssignee || forceOverride)) ? assignedTo : existingAssignee,
      requestId,
    });

  } catch (err) {
    console.error('[start-task-sb] Unexpected error:', err);
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
