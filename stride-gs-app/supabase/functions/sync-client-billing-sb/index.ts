/**
 * sync-client-billing-sb — SB-primary handler for `syncClientBilling`.
 *
 * The GAS handler (StrideAPI.gs:9122) calls api_fullClientSync_(clientSheetId,
 * ['billing']) to re-read the per-tenant Billing_Ledger sheet and upsert all
 * rows into public.billing. In the SB-authoritative path, public.billing IS
 * already the canonical store, so the equivalent operation is a delegation
 * back to GAS via the existing writeThroughReverse channel — pulling the
 * sheet snapshot forward into Supabase. This keeps the GAS-flag/SB-flag
 * cutover transparent: same action name, same response shape, same effect.
 *
 * Implementation: forward to GAS's fullClientSync via writeThroughReverse
 * (op='resync') so the legacy `billing` table reflects the current sheet
 * state. Once P4a fully flips public.billing handlers to SB-primary, this
 * handler becomes a no-op (the data is already authoritative on Supabase).
 *
 * Payload:  { tenantId | clientSheetId | sourceSheetId, callerEmail?, requestId? }
 * Response: { success, clientSheetId, mirrorOk }
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
  const tenantId    = String(body.tenantId ?? body.clientSheetId ?? body.sourceSheetId ?? '').trim();
  const callerEmail = String(body.callerEmail ?? '').trim();
  const requestId   = String(body.requestId   ?? '').trim() || crypto.randomUUID();

  if (!tenantId) return json({ success: false, error: 'clientSheetId required' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) return json({ error: 'Server misconfigured' }, 500);
  const sb = createClient(supabaseUrl, serviceKey);

  const gasUrl   = Deno.env.get('GAS_API_URL');
  const gasToken = Deno.env.get('GAS_API_TOKEN');
  let mirrorOk = false;
  let mirrorError: string | undefined;
  if (gasUrl && gasToken) {
    try {
      const payload = { tenantId, table: 'billing', op: 'resync', requestId };
      const res = await fetch(`${gasUrl}?action=writeThroughReverse&token=${encodeURIComponent(gasToken)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      let parsed: { success?: boolean; error?: string } = {};
      try { parsed = JSON.parse(text); } catch { parsed = { error: `non-JSON: ${text.slice(0, 200)}` }; }
      if (res.ok && parsed.success) {
        mirrorOk = true;
      } else {
        mirrorError = parsed.error ?? `HTTP ${res.status}`;
        await sb.from('gs_sync_events').insert({
          tenant_id: tenantId, entity_type: 'billing', entity_id: tenantId,
          action_type: 'writethrough_reverse', sync_status: 'sync_failed',
          requested_by: callerEmail || 'sync-client-billing-sb', request_id: requestId,
          payload, error_message: mirrorError.slice(0, 1000),
        }).then(() => {}, () => {});
      }
    } catch (e) {
      mirrorError = e instanceof Error ? e.message : String(e);
    }
  } else {
    mirrorError = 'GAS_API_URL or GAS_API_TOKEN not configured';
  }

  await sb.from('entity_audit_log').insert({
    entity_type:  'billing',
    entity_id:    tenantId,
    tenant_id:    tenantId,
    action:       'resync',
    changes:      { mirrorOk, mirrorError: mirrorError ?? null },
    performed_by: callerEmail || 'sync-client-billing-sb',
    source:       'supabase',
  }).then(() => {}, () => {});

  return json({ success: mirrorOk || !mirrorError, clientSheetId: tenantId, mirrorOk, mirrorError });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
