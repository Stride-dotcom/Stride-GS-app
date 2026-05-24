/**
 * batch-cancel-tasks-sb — SB-primary handler for `batchCancelTasks`.
 *
 * Mirrors GAS handleBatchCancelTasks_ (StrideAPI.gs:30951). Loops taskIds,
 * skips Completed/Cancelled, sets status='Cancelled' + cancelled_at.
 *
 * Payload:  { tenantId, taskIds: string[], callerEmail?, requestId? }
 * Response: BatchMutationResult { success, processed, succeeded, failed,
 *           skipped, errors, message }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);

  const body = await req.json().catch(() => ({}));
  const tenantId    = String(body.tenantId    ?? '').trim();
  const callerEmail = String(body.callerEmail ?? '').trim();
  const requestId   = String(body.requestId   ?? '').trim() || crypto.randomUUID();
  const taskIds = (Array.isArray(body.taskIds) ? body.taskIds : [])
    .map((s: unknown) => String(s ?? '').trim())
    .filter((s: string) => s.length > 0);

  if (!tenantId) return json({ success: false, error: 'tenantId is required' }, 400);
  if (taskIds.length === 0) return json({ success: false, error: 'taskIds array is required and must be non-empty' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) return json({ error: 'Server misconfigured' }, 500);
  const sb = createClient(supabaseUrl, serviceKey);

  const result = {
    success: true,
    processed: taskIds.length,
    succeeded: 0,
    failed: 0,
    skipped: [] as Array<{ id: string; reason: string }>,
    errors:  [] as Array<{ id: string; reason: string }>,
    message: '',
  };

  // Single SELECT to grab current statuses for all ids.
  const { data: existing, error: readErr } = await sb
    .from('tasks')
    .select('task_id, status')
    .eq('tenant_id', tenantId)
    .in('task_id', taskIds);
  if (readErr) {
    result.success = false;
    result.message = `Read failed: ${readErr.message}`;
    return json(result);
  }
  const statusById = new Map<string, string>();
  for (const r of (existing ?? []) as Array<{ task_id: string; status: string | null }>) {
    statusById.set(r.task_id, String(r.status ?? '').trim());
  }

  const toCancel: string[] = [];
  for (const id of taskIds) {
    const st = statusById.get(id);
    if (st === undefined) { result.skipped.push({ id, reason: 'Not found' }); continue; }
    if (st === 'Cancelled') { result.skipped.push({ id, reason: 'Cannot cancel — status is Cancelled' }); continue; }
    if (st === 'Completed') { result.skipped.push({ id, reason: 'Cannot cancel — status is Completed' }); continue; }
    toCancel.push(id);
  }

  if (toCancel.length > 0) {
    const nowIso = new Date().toISOString();
    const { error: upErr } = await sb
      .from('tasks')
      .update({ status: 'Cancelled', cancelled_at: nowIso, updated_at: nowIso })
      .eq('tenant_id', tenantId)
      .in('task_id', toCancel);
    if (upErr) {
      for (const id of toCancel) result.errors.push({ id, reason: upErr.message });
      result.failed = toCancel.length;
    } else {
      result.succeeded = toCancel.length;
      // Audit + mirror best-effort per id.
      for (const id of toCancel) {
        sb.from('entity_audit_log').insert({
          entity_type: 'task', entity_id: id, tenant_id: tenantId,
          action: 'cancel', changes: { status: { new: 'Cancelled' } },
          performed_by: callerEmail || 'batch-cancel-tasks-sb', source: 'supabase',
        }).then(() => {}, () => {});
        void mirror(tenantId, id, { status: 'Cancelled', cancelled_at: nowIso }, requestId, callerEmail, sb);
      }
    }
  }

  result.message = `Cancelled ${result.succeeded} task(s)` +
                   (result.skipped.length ? `, skipped ${result.skipped.length}` : '') +
                   (result.failed ? `, failed ${result.failed}` : '');
  return json(result);
});

async function mirror(
  tenantId: string, taskId: string, row: Record<string, unknown>,
  requestId: string, callerEmail: string, sb: ReturnType<typeof createClient>,
): Promise<void> {
  const gasUrl   = Deno.env.get('GAS_API_URL');
  const gasToken = Deno.env.get('GAS_API_TOKEN');
  if (!gasUrl || !gasToken) return;
  try {
    const payload = { tenantId, table: 'tasks', op: 'update', rowId: taskId, row, requestId };
    const res = await fetch(`${gasUrl}?action=writeThroughReverse&token=${encodeURIComponent(gasToken)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      await sb.from('gs_sync_events').insert({
        tenant_id: tenantId, entity_type: 'task', entity_id: taskId,
        action_type: 'writethrough_reverse', sync_status: 'sync_failed',
        requested_by: callerEmail || 'batch-cancel-tasks-sb', request_id: requestId,
        payload, error_message: `HTTP ${res.status}`,
      }).then(() => {}, () => {});
    }
  } catch (e) { console.warn('[batch-cancel-tasks-sb] mirror threw:', e); }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
