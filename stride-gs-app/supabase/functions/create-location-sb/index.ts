/**
 * create-location-sb — SB-primary handler for `createLocation`.
 *
 * Mirrors GAS handleCreateLocation_ (StrideAPI.gs:12408). Inserts a row into
 * public.locations (tenant_id='stride' is the warehouse-global default).
 * Idempotent on (tenant_id, code): if a row exists, updates notes when
 * provided and returns existed=true.
 *
 * Payload:  { code, notes?, callerEmail?, requestId? }
 * Response: { success, code, existed }
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
  const code        = String(body.code        ?? '').trim();
  const notes       = String(body.notes       ?? '').trim();
  const callerEmail = String(body.callerEmail ?? '').trim();
  const requestId   = String(body.requestId   ?? '').trim() || crypto.randomUUID();
  const tenantId    = String(body.tenantId    ?? 'stride').trim() || 'stride';

  if (!code) return json({ success: false, error: 'code is required', code: 'MISSING_PARAM' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) return json({ error: 'Server misconfigured' }, 500);
  const sb = createClient(supabaseUrl, serviceKey);

  // Look up existing row.
  const { data: existing, error: lookupErr } = await sb
    .from('locations')
    .select('id, code, notes')
    .eq('tenant_id', tenantId)
    .eq('code', code)
    .maybeSingle();
  if (lookupErr) return json({ success: false, error: `Lookup failed: ${lookupErr.message}` }, 500);

  const nowIso = new Date().toISOString();

  if (existing) {
    if (notes) {
      const { error: upErr } = await sb
        .from('locations')
        .update({ notes, active: true, updated_by: callerEmail || null, updated_at: nowIso })
        .eq('id', (existing as { id: string }).id);
      if (upErr) return json({ success: false, error: `Update failed: ${upErr.message}` }, 500);
    } else {
      // Reactivate if previously disabled.
      await sb.from('locations')
        .update({ active: true, updated_by: callerEmail || null, updated_at: nowIso })
        .eq('id', (existing as { id: string }).id);
    }
    void mirrorLocation(tenantId, code, notes, requestId, callerEmail, sb);
    return json({ success: true, code, existed: true });
  }

  const { error: insErr } = await sb
    .from('locations')
    .insert({
      tenant_id:  tenantId,
      code,
      notes:      notes || null,
      active:     true,
      created_by: callerEmail || null,
      updated_by: callerEmail || null,
    });
  if (insErr) return json({ success: false, error: `Insert failed: ${insErr.message}` }, 500);

  void mirrorLocation(tenantId, code, notes, requestId, callerEmail, sb);

  await sb.from('entity_audit_log').insert({
    entity_type:  'location',
    entity_id:    code,
    tenant_id:    tenantId,
    action:       'create',
    changes:      { code, notes },
    performed_by: callerEmail || 'create-location-sb',
    source:       'supabase',
  }).then(() => {}, () => {});

  return json({ success: true, code, existed: false });
});

async function mirrorLocation(
  tenantId: string, code: string, notes: string,
  requestId: string, callerEmail: string, sb: ReturnType<typeof createClient>,
): Promise<void> {
  const gasUrl   = Deno.env.get('GAS_API_URL');
  const gasToken = Deno.env.get('GAS_API_TOKEN');
  if (!gasUrl || !gasToken) return;
  try {
    const payload = { tenantId, table: 'locations', op: 'upsert', rowId: code, row: { code, notes, active: true }, requestId };
    const res = await fetch(`${gasUrl}?action=writeThroughReverse&token=${encodeURIComponent(gasToken)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      await sb.from('gs_sync_events').insert({
        tenant_id: tenantId, entity_type: 'location', entity_id: code,
        action_type: 'writethrough_reverse', sync_status: 'sync_failed',
        requested_by: callerEmail || 'create-location-sb', request_id: requestId,
        payload, error_message: `HTTP ${res.status}`,
      }).then(() => {}, () => {});
    }
  } catch (e) { console.warn('[create-location-sb] mirror threw:', e); }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
