/**
 * void-manual-charge-sb — SB-primary handler for `voidManualCharge`.
 *
 * Mirrors GAS handleVoidManualCharge_ (StrideAPI.gs:14382). Soft-voids a
 * MANUAL-* billing row. Hard requirements:
 *   • ledger_row_id MUST start with "MANUAL-" so a system-generated row
 *     can't be voided through this endpoint.
 *   • current status MUST be 'Unbilled'.
 *
 * Payload:  { tenantId, ledgerRowId, reason?, callerEmail?, requestId? }
 * Response: { success, ledgerRowId, newStatus, message }
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
  const ledgerRowId = String(body.ledgerRowId ?? '').trim();
  const reason      = String(body.reason      ?? '').trim();
  const callerEmail = String(body.callerEmail ?? '').trim();
  const requestId   = String(body.requestId   ?? '').trim() || crypto.randomUUID();

  if (!tenantId) return json({ success: false, error: 'tenantId is required' }, 400);
  if (!ledgerRowId) return json({ success: false, error: 'ledgerRowId is required', code: 'INVALID_PARAMS' }, 400);
  if (!ledgerRowId.startsWith('MANUAL-')) {
    return json({ success: false, error: 'voidManualCharge only accepts MANUAL- ledger IDs', code: 'INVALID_PARAMS' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) return json({ error: 'Server misconfigured' }, 500);
  const sb = createClient(supabaseUrl, serviceKey);

  const { data: existing, error: prevErr } = await sb
    .from('billing')
    .select('ledger_row_id, status, item_notes')
    .eq('tenant_id', tenantId)
    .eq('ledger_row_id', ledgerRowId)
    .maybeSingle();
  if (prevErr) return json({ success: false, error: `Read failed: ${prevErr.message}` }, 500);
  if (!existing) return json({ success: false, error: `Manual charge not found: ${ledgerRowId}`, code: 'NOT_FOUND' }, 404);

  const currentStatus = String((existing as { status?: string }).status ?? '').trim();
  if (currentStatus !== 'Unbilled') {
    return json({ success: false, error: `Cannot void — status is ${currentStatus}`, code: 'INVALID_STATUS' }, 400);
  }

  const nowIso = new Date().toISOString();
  const prevNotes = String((existing as { item_notes?: string }).item_notes ?? '').trim();
  const noteSuffix = reason
    ? `Voided: ${reason}`
    : `Voided ${nowIso.slice(0, 10)}`;
  const combinedNotes = prevNotes ? `${prevNotes} | ${noteSuffix}` : noteSuffix;

  const { error: upErr } = await sb
    .from('billing')
    .update({ status: 'Void', item_notes: combinedNotes, updated_at: nowIso })
    .eq('tenant_id', tenantId)
    .eq('ledger_row_id', ledgerRowId);
  if (upErr) return json({ success: false, error: `Update failed: ${upErr.message}` }, 500);

  await sb.from('entity_audit_log').insert({
    entity_type:  'billing',
    entity_id:    ledgerRowId,
    tenant_id:    tenantId,
    action:       'void',
    changes:      { status: { new: 'Void' }, reason: reason.slice(0, 200) },
    performed_by: callerEmail || 'void-manual-charge-sb',
    source:       'supabase',
  }).then(() => {}, () => {});

  void mirror(tenantId, ledgerRowId, { status: 'Void', item_notes: combinedNotes }, requestId, callerEmail, sb);

  return json({ success: true, ledgerRowId, newStatus: 'Void', message: 'Manual charge voided' });
});

async function mirror(
  tenantId: string, ledgerRowId: string, row: Record<string, unknown>,
  requestId: string, callerEmail: string, sb: ReturnType<typeof createClient>,
): Promise<void> {
  const gasUrl   = Deno.env.get('GAS_API_URL');
  const gasToken = Deno.env.get('GAS_API_TOKEN');
  if (!gasUrl || !gasToken) return;
  try {
    const payload = { tenantId, table: 'billing', op: 'update', rowId: ledgerRowId, row, requestId };
    const res = await fetch(`${gasUrl}?action=writeThroughReverse&token=${encodeURIComponent(gasToken)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      await sb.from('gs_sync_events').insert({
        tenant_id: tenantId, entity_type: 'billing', entity_id: ledgerRowId,
        action_type: 'writethrough_reverse', sync_status: 'sync_failed',
        requested_by: callerEmail || 'void-manual-charge-sb', request_id: requestId,
        payload, error_message: `HTTP ${res.status}`,
      }).then(() => {}, () => {});
    }
  } catch (e) { console.warn('[void-manual-charge-sb] mirror threw:', e); }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
