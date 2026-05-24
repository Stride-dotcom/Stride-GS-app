/**
 * update-will-call-sb — SB-primary handler for `updateWillCall`.
 *
 * Mirrors GAS handleUpdateWillCall_ (StrideAPI.gs:21574). Updates an
 * editable subset of fields on a will_calls row, with two side effects:
 *   • Auto-promote Status from 'Pending' → 'Scheduled' when an
 *     estimated_pickup_date is supplied.
 *   • Cascade Status changes (including the auto-promotion) to all
 *     will_call_items rows on the same WC.
 *
 * Editable fields (any subset, at least one required):
 *   estimatedPickupDate, pickupParty, pickupPhone, requestedBy, notes,
 *   cod, codAmount, status
 *
 * Payload:  { tenantId, wcNumber, callerEmail?, requestId?, <fields...> }
 * Response: { success, wcNumber, updated, statusPromoted }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FIELD_MAP: Record<string, string> = {
  estimatedPickupDate: 'estimated_pickup_date',
  pickupParty:         'pickup_party',
  pickupPhone:         'pickup_phone',
  requestedBy:         'requested_by',
  notes:               'notes',
  cod:                 'cod',
  codAmount:           'cod_amount',
  status:              'status',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);

  const body = await req.json().catch(() => ({}));
  const tenantId    = String(body.tenantId    ?? '').trim();
  const wcNumber    = String(body.wcNumber    ?? '').trim();
  const callerEmail = String(body.callerEmail ?? '').trim();
  const requestId   = String(body.requestId   ?? '').trim() || crypto.randomUUID();

  if (!tenantId) return json({ success: false, error: 'tenantId is required' }, 400);
  if (!wcNumber) return json({ success: false, error: 'wcNumber is required' }, 400);

  const updates: Record<string, unknown> = {};
  const echoUpdated: Record<string, unknown> = {};
  for (const [key, col] of Object.entries(FIELD_MAP)) {
    if (Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined) {
      let val = body[key];
      if (key === 'cod') val = val === true || val === 'true';
      if (key === 'codAmount') val = val === null || val === '' ? null : Number(val);
      if (key === 'estimatedPickupDate') {
        const s = String(val ?? '').trim();
        val = s || null;
      }
      updates[col] = val;
      echoUpdated[key] = val;
    }
  }
  if (Object.keys(updates).length === 0) {
    return json({ success: false, error: 'No editable fields provided', code: 'INVALID_PARAMS' }, 400);
  }

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
  if (!existing) return json({ success: false, error: `Will Call not found: ${wcNumber}`, code: 'NOT_FOUND' }, 404);

  // Auto-promote: estimated_pickup_date filled + current status === 'Pending' → 'Scheduled'
  let statusPromoted = false;
  const currentStatus = String((existing as { status?: string }).status ?? '').trim();
  if ('estimated_pickup_date' in updates && updates.estimated_pickup_date && currentStatus === 'Pending'
      && !('status' in updates)) {
    updates.status = 'Scheduled';
    statusPromoted = true;
  }

  updates.updated_at = new Date().toISOString();

  const { error: upErr } = await sb
    .from('will_calls')
    .update(updates)
    .eq('tenant_id', tenantId)
    .eq('wc_number', wcNumber);
  if (upErr) return json({ success: false, error: `Update failed: ${upErr.message}` }, 500);

  // Cascade Status to will_call_items.
  const newStatus = (updates.status as string | undefined) ?? null;
  if (newStatus) {
    await sb.from('will_call_items')
      .update({ status: newStatus, updated_at: updates.updated_at })
      .eq('tenant_id', tenantId)
      .eq('wc_number', wcNumber)
      .then(() => {}, () => {});
  }

  await sb.from('entity_audit_log').insert({
    entity_type:  'will_call',
    entity_id:    wcNumber,
    tenant_id:    tenantId,
    action:       'update',
    changes:      { summary: 'Will call fields updated', fields: Object.keys(echoUpdated).join(',') },
    performed_by: callerEmail || 'update-will-call-sb',
    source:       'supabase',
  }).then(() => {}, () => {});

  void mirror(tenantId, wcNumber, updates, requestId, callerEmail, sb);

  if (statusPromoted) echoUpdated.status = 'Scheduled';

  return json({ success: true, wcNumber, updated: echoUpdated, statusPromoted });
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
        requested_by: callerEmail || 'update-will-call-sb', request_id: requestId,
        payload, error_message: `HTTP ${res.status}`,
      }).then(() => {}, () => {});
    }
  } catch (e) { console.warn('[update-will-call-sb] mirror threw:', e); }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
