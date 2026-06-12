/**
 * remove-items-from-will-call-sb — SB-primary handler for `removeItemsFromWillCall`.
 *
 * Mirrors GAS handleRemoveItemsFromWillCall_ (StrideAPI.gs:22151). Deletes
 * matching will_call_items rows (skipping any in Released status), updates
 * parent will_calls.item_count + total_wc_fee + item_ids, and auto-cancels
 * the WC if zero items remain.
 *
 * Payload:  { tenantId, wcNumber, itemIds: string[], callerEmail?, requestId? }
 * Response: { success, removedCount, remainingItems, totalFee, cancelled,
 *             skippedReleased }
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
  const wcNumber    = String(body.wcNumber    ?? '').trim();
  const callerEmail = String(body.callerEmail ?? '').trim();
  const requestId   = String(body.requestId   ?? '').trim() || crypto.randomUUID();
  const targetIds = (Array.isArray(body.itemIds) ? body.itemIds : [])
    .map((s: unknown) => String(s ?? '').trim())
    .filter((s: string) => s.length > 0);

  if (!tenantId) return json({ success: false, error: 'tenantId is required' }, 400);
  if (!wcNumber) return json({ success: false, error: 'wcNumber is required' }, 400);
  if (targetIds.length === 0) return json({ success: false, error: 'itemIds array is required and must be non-empty' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) return json({ error: 'Server misconfigured' }, 500);
  const sb = createClient(supabaseUrl, serviceKey);

  const { data: wc, error: wcErr } = await sb
    .from('will_calls')
    .select('wc_number, status, item_count, total_wc_fee, item_ids')
    .eq('tenant_id', tenantId)
    .eq('wc_number', wcNumber)
    .maybeSingle();
  if (wcErr) return json({ success: false, error: `WC read failed: ${wcErr.message}` }, 500);
  if (!wc) return json({ success: false, error: `Will call not found: ${wcNumber}`, code: 'NOT_FOUND' }, 404);
  const wcStatus = String((wc as { status?: string }).status ?? '').trim();
  if (!['Pending', 'Scheduled', 'Partial'].includes(wcStatus)) {
    return json({ success: false, error: `Cannot remove items — will call status is ${wcStatus}` }, 400);
  }

  const { data: wciAll } = await sb
    .from('will_call_items')
    .select('item_id, status, wc_fee')
    .eq('tenant_id', tenantId)
    .eq('wc_number', wcNumber);
  const rows = (wciAll ?? []) as Array<{ item_id: string; status: string | null; wc_fee: number | null }>;

  const targetSet = new Set(targetIds);
  const skippedReleased: string[] = [];
  const removeIds: string[] = [];
  let feeToSubtract = 0;
  let remainingItems = 0;
  for (const r of rows) {
    if (targetSet.has(r.item_id)) {
      if (String(r.status ?? '').trim() === 'Released') {
        skippedReleased.push(r.item_id);
        remainingItems++;
      } else {
        removeIds.push(r.item_id);
        feeToSubtract += Number(r.wc_fee ?? 0) || 0;
      }
    } else {
      remainingItems++;
    }
  }

  if (removeIds.length === 0) {
    if (skippedReleased.length > 0) {
      return json({ success: false, error: 'Cannot remove released items', skippedReleased });
    }
    return json({ success: false, error: 'No matching items found on this will call' });
  }

  const { error: delErr } = await sb
    .from('will_call_items')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('wc_number', wcNumber)
    .in('item_id', removeIds);
  if (delErr) return json({ success: false, error: `Delete failed: ${delErr.message}` }, 500);

  const nowIso = new Date().toISOString();
  const prevCount = Number((wc as { item_count?: number }).item_count ?? 0) || 0;
  const prevFee   = Number((wc as { total_wc_fee?: number }).total_wc_fee ?? 0) || 0;
  const prevIds   = Array.isArray((wc as { item_ids?: unknown }).item_ids) ? ((wc as { item_ids: string[] }).item_ids) : [];
  const newCount  = Math.max(0, prevCount - removeIds.length);
  const newFee    = Math.max(0, Math.round((prevFee - feeToSubtract) * 100) / 100);
  const removeSet = new Set(removeIds);
  const newIds    = prevIds.filter(id => !removeSet.has(id));
  const cancelled = remainingItems === 0;

  const wcUpdate: Record<string, unknown> = {
    item_count: newCount,
    total_wc_fee: newFee,
    item_ids: newIds,
    updated_at: nowIso,
  };
  if (cancelled) wcUpdate.status = 'Cancelled';

  await sb.from('will_calls').update(wcUpdate)
    .eq('tenant_id', tenantId).eq('wc_number', wcNumber)
    .then(() => {}, () => {});

  // Audit: one row on the WC (with the item IDs) + one per item so each
  // item's ActivityTimeline shows "Removed from Will Call: WC-x".
  await sb.from('entity_audit_log').insert([
    {
      entity_type:  'will_call',
      entity_id:    wcNumber,
      tenant_id:    tenantId,
      action:       'update',
      changes:      { summary: `${removeIds.length} item(s) removed from will call`, itemIds: removeIds, cancelled },
      performed_by: callerEmail || 'remove-items-from-will-call-sb',
      source:       'supabase',
    },
    ...removeIds.map((id: string) => ({
      entity_type:  'inventory',
      entity_id:    id,
      tenant_id:    tenantId,
      action:       'removed_from_will_call',
      changes:      { wcNumber },
      performed_by: callerEmail || 'remove-items-from-will-call-sb',
      source:       'supabase',
    })),
  ]).then(() => {}, () => {});

  void mirror(tenantId, wcNumber, wcUpdate, requestId, callerEmail, sb);

  return json({
    success: true,
    removedCount: removeIds.length,
    remainingItems,
    totalFee: newFee,
    cancelled,
    skippedReleased,
  });
});

async function mirror(
  tenantId: string, wcNumber: string, row: Record<string, unknown>,
  requestId: string, callerEmail: string, sb: ReturnType<typeof createClient>,
): Promise<void> {
  const gasUrl   = Deno.env.get('GAS_API_URL');
  const gasToken = Deno.env.get('GAS_API_TOKEN');
  if (!gasUrl || !gasToken) return;
  try {
    const payload = { tenantId, table: 'will_calls', op: 'update', rowId: wcNumber, row, requestId };
    const res = await fetch(`${gasUrl}?action=writeThroughReverse&token=${encodeURIComponent(gasToken)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      await sb.from('gs_sync_events').insert({
        tenant_id: tenantId, entity_type: 'will_call', entity_id: wcNumber,
        action_type: 'writethrough_reverse', sync_status: 'sync_failed',
        requested_by: callerEmail || 'remove-items-from-will-call-sb', request_id: requestId,
        payload, error_message: `HTTP ${res.status}`,
      }).then(() => {}, () => {});
    }
  } catch (e) { console.warn('[remove-items-from-will-call-sb] mirror threw:', e); }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
