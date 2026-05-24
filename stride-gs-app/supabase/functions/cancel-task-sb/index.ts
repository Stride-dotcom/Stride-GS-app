/**
 * cancel-task-sb — SB-primary handler for `cancelTask`.
 *
 * Mirrors GAS handleCancelTask_ (StrideAPI.gs:30457): sets status='Cancelled'
 * and stamps cancelled_at. Rejects when current status is 'Completed';
 * idempotent when already 'Cancelled'.
 *
 * Payload:  { tenantId, taskId, callerEmail?, requestId? }
 * Response: { success, taskId, skipped?, message }
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
  const taskId      = String(body.taskId      ?? '').trim();
  const callerEmail = String(body.callerEmail ?? '').trim();
  const requestId   = String(body.requestId   ?? '').trim() || crypto.randomUUID();

  if (!tenantId) return json({ success: false, error: 'tenantId is required', code: 'INVALID_PARAMS' }, 400);
  if (!taskId)   return json({ success: false, error: 'taskId is required',   code: 'INVALID_PARAMS' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) return json({ error: 'Server misconfigured' }, 500);
  const sb = createClient(supabaseUrl, serviceKey);

  const { data: prev, error: prevErr } = await sb
    .from('tasks')
    .select('task_id, status')
    .eq('tenant_id', tenantId)
    .eq('task_id', taskId)
    .maybeSingle();
  if (prevErr) return json({ success: false, error: `Read failed: ${prevErr.message}` }, 500);
  if (!prev)   return json({ success: false, error: `Task not found: ${taskId}`, code: 'NOT_FOUND' }, 404);

  const currentStatus = String((prev as { status?: string }).status ?? '').trim();
  if (currentStatus === 'Completed') {
    return json({ success: false, error: 'Cannot cancel a completed task', code: 'INVALID_STATUS' }, 400);
  }
  if (currentStatus === 'Cancelled') {
    return json({ success: true, taskId, skipped: true, message: 'Task already cancelled' });
  }

  const nowIso = new Date().toISOString();
  const { error: upErr } = await sb
    .from('tasks')
    .update({ status: 'Cancelled', cancelled_at: nowIso, updated_at: nowIso })
    .eq('tenant_id', tenantId)
    .eq('task_id', taskId);
  if (upErr) return json({ success: false, error: `Update failed: ${upErr.message}` }, 500);

  await sb.from('entity_audit_log').insert({
    entity_type:  'task',
    entity_id:    taskId,
    tenant_id:    tenantId,
    action:       'cancel',
    changes:      { status: { new: 'Cancelled' } },
    performed_by: callerEmail || 'cancel-task-sb',
    source:       'supabase',
  }).then(() => {}, () => {});

  void mirror(tenantId, taskId, { status: 'Cancelled', cancelled_at: nowIso }, requestId, callerEmail, sb);

  return json({ success: true, taskId, message: 'Task cancelled' });
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
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      await sb.from('gs_sync_events').insert({
        tenant_id: tenantId, entity_type: 'task', entity_id: taskId,
        action_type: 'writethrough_reverse', sync_status: 'sync_failed',
        requested_by: callerEmail || 'cancel-task-sb', request_id: requestId,
        payload, error_message: `HTTP ${res.status}`,
      }).then(() => {}, () => {});
    }
  } catch (e) { console.warn('[cancel-task-sb] mirror threw:', e); }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
