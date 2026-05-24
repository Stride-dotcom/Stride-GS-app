/**
 * cancel-will-call-sb — SB-primary handler for `cancelWillCall`.
 *
 * Mirrors GAS handleCancelWillCall_ (StrideAPI.gs:21816). Sets WC status to
 * 'Cancelled' and cascades all linked will_call_items to 'Cancelled'.
 * Rejects when status is already 'Released' (fully released). Idempotent on
 * already-Cancelled (returns skipped=true).
 *
 * NOTE: Cancellation email is NOT sent by this handler. GAS sends one via
 * api_sendTemplateEmail_; the SB-primary path leaves email orchestration to
 * the React UI or a follow-up email EF when needed.
 *
 * Payload:  { tenantId, wcNumber, reason?, callerEmail?, requestId? }
 * Response: { success, wcNumber, itemsCancelled, skipped? }
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
  const reason      = String(body.reason      ?? '').trim();
  const callerEmail = String(body.callerEmail ?? '').trim();
  const requestId   = String(body.requestId   ?? '').trim() || crypto.randomUUID();

  if (!tenantId) return json({ success: false, error: 'tenantId is required' }, 400);
  if (!wcNumber) return json({ success: false, error: 'wcNumber is required' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) return json({ error: 'Server misconfigured' }, 500);
  const sb = createClient(supabaseUrl, serviceKey);

  const { data: existing, error: prevErr } = await sb
    .from('will_calls')
    .select('wc_number, status')
    .eq('tenant_id', tenantId)
    .eq('wc_number', wcNumber)
    .maybeSingle();
  if (prevErr) return json({ success: false, error: `Read failed: ${prevErr.message}` }, 500);
  if (!existing) return json({ success: false, error: `Will call not found: ${wcNumber}`, code: 'NOT_FOUND' }, 404);

  const currentStatus = String((existing as { status?: string }).status ?? '').trim();
  if (currentStatus === 'Cancelled') {
    return json({ success: true, wcNumber, skipped: true, itemsCancelled: 0, message: 'Already cancelled' });
  }
  if (currentStatus === 'Released') {
    return json({ success: false, error: 'Cannot cancel a fully released will call', code: 'INVALID_STATUS' }, 400);
  }

  const nowIso = new Date().toISOString();

  const { error: wcErr } = await sb
    .from('will_calls')
    .update({ status: 'Cancelled', updated_at: nowIso })
    .eq('tenant_id', tenantId)
    .eq('wc_number', wcNumber);
  if (wcErr) return json({ success: false, error: `Update failed: ${wcErr.message}` }, 500);

  // Cascade non-terminal items to Cancelled. Leave Released / already-Cancelled alone.
  const { data: itemRows } = await sb
    .from('will_call_items')
    .select('item_id, status')
    .eq('tenant_id', tenantId)
    .eq('wc_number', wcNumber);
  const cascadeItems = ((itemRows ?? []) as Array<{ item_id: string; status: string | null }>)
    .filter(r => {
      const s = String(r.status ?? '').trim();
      return s !== 'Released' && s !== 'Cancelled';
    })
    .map(r => r.item_id);

  let itemsCancelled = 0;
  if (cascadeItems.length > 0) {
    const { error: wciErr } = await sb
      .from('will_call_items')
      .update({ status: 'Cancelled', updated_at: nowIso })
      .eq('tenant_id', tenantId)
      .eq('wc_number', wcNumber)
      .in('item_id', cascadeItems);
    if (wciErr) {
      console.warn('[cancel-will-call-sb] will_call_items cascade failed:', wciErr.message);
    } else {
      itemsCancelled = cascadeItems.length;
    }
  }

  await sb.from('entity_audit_log').insert({
    entity_type:  'will_call',
    entity_id:    wcNumber,
    tenant_id:    tenantId,
    action:       'cancel',
    changes:      { status: { new: 'Cancelled' }, reason: reason.slice(0, 200), itemsCancelled },
    performed_by: callerEmail || 'cancel-will-call-sb',
    source:       'supabase',
  }).then(() => {}, () => {});

  void mirror(tenantId, wcNumber, { status: 'Cancelled' }, requestId, callerEmail, sb);

  return json({ success: true, wcNumber, itemsCancelled, emailSent: false });
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
        requested_by: callerEmail || 'cancel-will-call-sb', request_id: requestId,
        payload, error_message: `HTTP ${res.status}`,
      }).then(() => {}, () => {});
    }
  } catch (e) { console.warn('[cancel-will-call-sb] mirror threw:', e); }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
