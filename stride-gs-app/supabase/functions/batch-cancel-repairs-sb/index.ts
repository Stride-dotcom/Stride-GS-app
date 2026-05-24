/**
 * batch-cancel-repairs-sb — SB-primary handler for `batchCancelRepairs`.
 *
 * Mirrors GAS handleBatchCancelRepairs_ (StrideAPI.gs:31034). Sets
 * status='Cancelled' on each eligible repair. Skips Completed/Complete,
 * Cancelled, Invoiced, not found.
 *
 * Payload:  { tenantId, repairIds: string[], callerEmail?, requestId? }
 * Response: BatchMutationResult
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
  const repairIds = (Array.isArray(body.repairIds) ? body.repairIds : [])
    .map((s: unknown) => String(s ?? '').trim())
    .filter((s: string) => s.length > 0);

  if (!tenantId) return json({ success: false, error: 'tenantId is required' }, 400);
  if (repairIds.length === 0) return json({ success: false, error: 'repairIds array is required and must be non-empty' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) return json({ error: 'Server misconfigured' }, 500);
  const sb = createClient(supabaseUrl, serviceKey);

  const result = {
    success: true,
    processed: repairIds.length,
    succeeded: 0,
    failed: 0,
    skipped: [] as Array<{ id: string; reason: string }>,
    errors:  [] as Array<{ id: string; reason: string }>,
    message: '',
  };

  const { data: existing, error: readErr } = await sb
    .from('repairs')
    .select('repair_id, status')
    .eq('tenant_id', tenantId)
    .in('repair_id', repairIds);
  if (readErr) {
    result.success = false;
    result.message = `Read failed: ${readErr.message}`;
    return json(result);
  }
  const statusById = new Map<string, string>();
  for (const r of (existing ?? []) as Array<{ repair_id: string; status: string | null }>) {
    statusById.set(r.repair_id, String(r.status ?? '').trim());
  }

  const toCancel: string[] = [];
  for (const id of repairIds) {
    const st = statusById.get(id);
    if (st === undefined) { result.skipped.push({ id, reason: 'Not found' }); continue; }
    const lower = st.toLowerCase();
    if (lower === 'cancelled') { result.skipped.push({ id, reason: 'Cannot cancel — status is Cancelled' }); continue; }
    if (lower === 'complete' || lower === 'completed') {
      result.skipped.push({ id, reason: `Cannot cancel — status is ${st}` }); continue;
    }
    if (lower === 'invoiced') { result.skipped.push({ id, reason: 'Cannot cancel — status is Invoiced' }); continue; }
    toCancel.push(id);
  }

  if (toCancel.length > 0) {
    const nowIso = new Date().toISOString();
    const { error: upErr } = await sb
      .from('repairs')
      .update({ status: 'Cancelled', updated_at: nowIso })
      .eq('tenant_id', tenantId)
      .in('repair_id', toCancel);
    if (upErr) {
      for (const id of toCancel) result.errors.push({ id, reason: upErr.message });
      result.failed = toCancel.length;
    } else {
      result.succeeded = toCancel.length;
      for (const id of toCancel) {
        sb.from('entity_audit_log').insert({
          entity_type: 'repair', entity_id: id, tenant_id: tenantId,
          action: 'cancel', changes: { status: { new: 'Cancelled' } },
          performed_by: callerEmail || 'batch-cancel-repairs-sb', source: 'supabase',
        }).then(() => {}, () => {});
        void mirror(tenantId, id, { status: 'Cancelled' }, requestId, callerEmail, sb);
      }
    }
  }

  result.message = `Cancelled ${result.succeeded} repair(s)` +
                   (result.skipped.length ? `, skipped ${result.skipped.length}` : '') +
                   (result.failed ? `, failed ${result.failed}` : '');
  return json(result);
});

async function mirror(
  tenantId: string, repairId: string, row: Record<string, unknown>,
  requestId: string, callerEmail: string, sb: ReturnType<typeof createClient>,
): Promise<void> {
  const gasUrl   = Deno.env.get('GAS_API_URL');
  const gasToken = Deno.env.get('GAS_API_TOKEN');
  if (!gasUrl || !gasToken) return;
  try {
    const payload = { tenantId, table: 'repairs', op: 'update', rowId: repairId, row, requestId };
    const res = await fetch(`${gasUrl}?action=writeThroughReverse&token=${encodeURIComponent(gasToken)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      await sb.from('gs_sync_events').insert({
        tenant_id: tenantId, entity_type: 'repair', entity_id: repairId,
        action_type: 'writethrough_reverse', sync_status: 'sync_failed',
        requested_by: callerEmail || 'batch-cancel-repairs-sb', request_id: requestId,
        payload, error_message: `HTTP ${res.status}`,
      }).then(() => {}, () => {});
    }
  } catch (e) { console.warn('[batch-cancel-repairs-sb] mirror threw:', e); }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
