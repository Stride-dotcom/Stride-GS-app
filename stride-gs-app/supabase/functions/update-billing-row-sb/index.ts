/**
 * update-billing-row-sb — SB-primary handler for `updateBillingRow`.
 *
 * Mirrors GAS handleUpdateBillingRow_ (StrideAPI.gs:13921). Updates an
 * editable subset of fields on a single Unbilled billing row.
 *
 * Editable always: sidemark, reference, description, notes (→ item_notes)
 * Editable only on MANUAL- rows: svcCode, svcName, itemClass
 * Editable always: rate, qty, total (server recomputes Total = rate × qty
 *   when total is not explicitly supplied)
 *
 * For non-MANUAL rows that supply item-level fields (sidemark/reference/
 * description), the same fields also propagate to the linked inventory row
 * so Tasks/Repairs/WC/entity panels see the change.
 *
 * Payload:  { tenantId, ledgerRowId, ...fields, callerEmail?, requestId? }
 * Response: { success, ledgerRowId, updatedRow }
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
  const callerEmail = String(body.callerEmail ?? '').trim();
  const requestId   = String(body.requestId   ?? '').trim() || crypto.randomUUID();

  if (!tenantId) return json({ success: false, error: 'tenantId is required' }, 400);
  if (!ledgerRowId) return json({ success: false, error: 'ledgerRowId is required', code: 'INVALID_PARAMS' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) return json({ error: 'Server misconfigured' }, 500);
  const sb = createClient(supabaseUrl, serviceKey);

  const { data: existing, error: prevErr } = await sb
    .from('billing')
    .select('ledger_row_id, status, rate, qty, item_id')
    .eq('tenant_id', tenantId)
    .eq('ledger_row_id', ledgerRowId)
    .maybeSingle();
  if (prevErr) return json({ success: false, error: `Read failed: ${prevErr.message}` }, 500);
  if (!existing) return json({ success: false, error: `Billing row not found: ${ledgerRowId}`, code: 'NOT_FOUND' }, 404);
  const ex = existing as { status?: string; rate?: number | null; qty?: number | null; item_id?: string | null };
  if ((ex.status ?? '').trim() !== 'Unbilled') {
    return json({ success: false, error: `Cannot edit — row status is ${ex.status} (only Unbilled rows are editable)`, code: 'INVALID_STATUS' }, 400);
  }
  const isManual = ledgerRowId.startsWith('MANUAL-');

  const updates: Record<string, unknown> = {};
  const echoUpdated: Record<string, unknown> = {};

  if (body.sidemark    !== undefined) { updates.sidemark    = String(body.sidemark);    echoUpdated.sidemark    = updates.sidemark; }
  if (body.reference   !== undefined) { updates.reference   = String(body.reference);   echoUpdated.reference   = updates.reference; }
  if (body.description !== undefined) { updates.description = String(body.description); echoUpdated.description = updates.description; }
  if (body.notes       !== undefined) { updates.item_notes  = String(body.notes);       echoUpdated.notes       = updates.item_notes; }
  if (isManual) {
    if (body.svcCode   !== undefined) { updates.svc_code    = String(body.svcCode);    echoUpdated.svcCode    = updates.svc_code; }
    if (body.svcName   !== undefined) { updates.svc_name    = String(body.svcName);    echoUpdated.svcName    = updates.svc_name; }
    if (body.itemClass !== undefined) { updates.item_class  = String(body.itemClass);  echoUpdated.itemClass  = updates.item_class; }
  }

  const rateChanged = body.rate !== undefined;
  const qtyChanged  = body.qty  !== undefined;
  const totalChanged = body.total !== undefined;
  if (rateChanged || qtyChanged || totalChanged) {
    let currentRate = Number(ex.rate ?? 0) || 0;
    let currentQty  = Number(ex.qty  ?? 1) || 1;
    if (rateChanged) { currentRate = Number(body.rate) || 0; updates.rate = currentRate; echoUpdated.rate = currentRate; }
    if (qtyChanged)  { currentQty  = Number(body.qty)  || 1; updates.qty  = currentQty;  echoUpdated.qty  = currentQty; }
    let newTotal: number;
    if (totalChanged) {
      newTotal = Math.round((Number(body.total) || 0) * 100) / 100;
    } else {
      newTotal = Math.round(currentRate * currentQty * 100) / 100;
    }
    updates.total = newTotal;
    echoUpdated.total = newTotal;
  }

  if (Object.keys(updates).length === 0) {
    return json({ success: false, error: 'No editable fields provided', code: 'INVALID_PARAMS' }, 400);
  }
  updates.updated_at = new Date().toISOString();

  const { error: upErr } = await sb
    .from('billing')
    .update(updates)
    .eq('tenant_id', tenantId)
    .eq('ledger_row_id', ledgerRowId);
  if (upErr) return json({ success: false, error: `Update failed: ${upErr.message}` }, 500);

  // Item-level field propagation back to inventory (non-manual rows only).
  if (!isManual && ex.item_id) {
    const invUpdate: Record<string, unknown> = {};
    if (body.sidemark    !== undefined) invUpdate.sidemark    = String(body.sidemark);
    if (body.reference   !== undefined) invUpdate.reference   = String(body.reference);
    if (body.description !== undefined) invUpdate.description = String(body.description);
    if (Object.keys(invUpdate).length > 0) {
      invUpdate.updated_at = updates.updated_at;
      await sb.from('inventory').update(invUpdate)
        .eq('tenant_id', tenantId).eq('item_id', ex.item_id)
        .then(() => {}, () => {});
    }
  }

  await sb.from('entity_audit_log').insert({
    entity_type:  'billing',
    entity_id:    ledgerRowId,
    tenant_id:    tenantId,
    action:       'update',
    changes:      { summary: 'Billing row updated', fields: Object.keys(echoUpdated).join(',') },
    performed_by: callerEmail || 'update-billing-row-sb',
    source:       'supabase',
  }).then(() => {}, () => {});

  void mirror(tenantId, ledgerRowId, updates, requestId, callerEmail, sb);

  return json({ success: true, ledgerRowId, updatedRow: echoUpdated, message: 'Billing row updated' });
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
        requested_by: callerEmail || 'update-billing-row-sb', request_id: requestId,
        payload, error_message: `HTTP ${res.status}`,
      }).then(() => {}, () => {});
    }
  } catch (e) { console.warn('[update-billing-row-sb] mirror threw:', e); }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
