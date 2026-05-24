/**
 * void-unbilled-rows-sb — SB-primary handler for `voidUnbilledRows`.
 *
 * Mirrors GAS handleVoidUnbilledRows_ (StrideAPI.gs:14717). Bulk-flips a set
 * of billing rows from 'Unbilled' to 'Void'. Differs from voidInvoice in
 * that it's keyed by ledger_row_id (not invoice_no) and ONLY touches rows
 * currently at status='Unbilled' — rows at any other status are rejected
 * so the caller knows to use voidInvoice instead.
 *
 * Payload:  { tenantId, ledgerRowIds: string[], reason?, callerEmail?, requestId? }
 * Response: { success, voided, skippedAlreadyVoid, skippedNotFound, rejected }
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
  const reason      = String(body.reason      ?? '').trim();
  const ids = (Array.isArray(body.ledgerRowIds) ? body.ledgerRowIds : [])
    .map((s: unknown) => String(s ?? '').trim())
    .filter((s: string) => s.length > 0);

  if (!tenantId) return json({ success: false, error: 'tenantId is required' }, 400);
  if (ids.length === 0) return json({ success: false, error: 'ledgerRowIds is required (non-empty array)', code: 'INVALID_PARAMS' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) return json({ error: 'Server misconfigured' }, 500);
  const sb = createClient(supabaseUrl, serviceKey);

  const { data: rows, error: readErr } = await sb
    .from('billing')
    .select('ledger_row_id, status, item_notes')
    .eq('tenant_id', tenantId)
    .in('ledger_row_id', ids);
  if (readErr) return json({ success: false, error: `Read failed: ${readErr.message}` }, 500);

  const byId = new Map<string, { status: string; item_notes: string }>();
  for (const r of (rows ?? []) as Array<{ ledger_row_id: string; status: string | null; item_notes: string | null }>) {
    byId.set(r.ledger_row_id, { status: String(r.status ?? '').trim(), item_notes: String(r.item_notes ?? '') });
  }

  let voided = 0;
  let skippedAlreadyVoid = 0;
  let skippedNotFound = 0;
  const rejected: Array<{ ledgerRowId: string; currentStatus: string }> = [];
  const nowIso = new Date().toISOString();
  const noteSuffix = reason ? `Voided: ${reason}` : `Voided ${nowIso.slice(0, 10)}`;

  // Process per-id to keep noteSuffix appended per-row.
  for (const id of ids) {
    const r = byId.get(id);
    if (!r) { skippedNotFound++; continue; }
    if (r.status === 'Void') { skippedAlreadyVoid++; continue; }
    if (r.status !== 'Unbilled') {
      rejected.push({ ledgerRowId: id, currentStatus: r.status || '(blank)' });
      continue;
    }
    const combined = r.item_notes ? `${r.item_notes} | ${noteSuffix}` : noteSuffix;
    const { error: upErr } = await sb
      .from('billing')
      .update({ status: 'Void', item_notes: combined, updated_at: nowIso })
      .eq('tenant_id', tenantId)
      .eq('ledger_row_id', id);
    if (upErr) {
      rejected.push({ ledgerRowId: id, currentStatus: `update_failed:${upErr.message}` });
      continue;
    }
    voided++;
    sb.from('entity_audit_log').insert({
      entity_type: 'billing', entity_id: id, tenant_id: tenantId,
      action: 'void', changes: { status: { new: 'Void' }, reason: reason.slice(0, 200) },
      performed_by: callerEmail || 'void-unbilled-rows-sb', source: 'supabase',
    }).then(() => {}, () => {});
    void mirror(tenantId, id, { status: 'Void', item_notes: combined }, requestId, callerEmail, sb);
  }

  return json({
    success: true,
    voided,
    skippedAlreadyVoid,
    skippedNotFound,
    rejected,
    message: `${voided} of ${ids.length} row(s) voided`,
  });
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
        requested_by: callerEmail || 'void-unbilled-rows-sb', request_id: requestId,
        payload, error_message: `HTTP ${res.status}`,
      }).then(() => {}, () => {});
    }
  } catch (e) { console.warn('[void-unbilled-rows-sb] mirror threw:', e); }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
