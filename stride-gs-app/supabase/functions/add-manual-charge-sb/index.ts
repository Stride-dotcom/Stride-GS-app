/**
 * add-manual-charge-sb — SB-primary handler for `addManualCharge`.
 *
 * Mirrors GAS handleAddManualCharge_ (StrideAPI.gs:14252). Inserts a
 * Billing_Ledger row (Status=Unbilled) with a server-generated ledger_row_id
 * of the form `MANUAL-{ms}-{random6}`. Total is server-computed (rate × qty)
 * so the client can't cook the books by sending a mismatched total.
 *
 * Payload:  { tenantId, serviceCode|svcCode, serviceName|svcName, qty?,
 *             rate?, classCode|itemClass?, sidemark?, notes?, description?,
 *             callerEmail?, requestId? }
 * Response: { success, ledgerRowId, total, message }
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

  if (!tenantId) return json({ success: false, error: 'tenantId is required' }, 400);

  const svcCode = String(body.serviceCode ?? body.svcCode ?? '').trim();
  const svcName = String(body.serviceName ?? body.svcName ?? '').trim();
  if (!svcCode) return json({ success: false, error: 'serviceCode is required', code: 'INVALID_PARAMS' }, 400);
  if (!svcName) return json({ success: false, error: 'serviceName is required', code: 'INVALID_PARAMS' }, 400);

  let qty = Number(body.quantity ?? body.qty);
  if (!qty || qty <= 0) qty = 1;
  let rate = Number(body.rate);
  if (!Number.isFinite(rate)) rate = 0;
  const total = Math.round(rate * qty * 100) / 100;

  const itemClass   = String(body.classCode ?? body.itemClass ?? '').trim();
  const notes       = String(body.notes ?? '').trim();
  const sidemark    = String(body.sidemark ?? '').trim();
  const description = String(body.description ?? svcName).trim();
  const createdBy   = String(body.createdBy ?? callerEmail ?? '').trim();

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) return json({ error: 'Server misconfigured' }, 500);
  const sb = createClient(supabaseUrl, serviceKey);

  // Resolve client_name (for the billing.client_name mirror column).
  const { data: clientRow } = await sb
    .from('clients')
    .select('name')
    .eq('spreadsheet_id', tenantId)
    .maybeSingle();
  const clientName = clientRow ? String((clientRow as { name?: string }).name ?? '') : '';

  const ledgerRowId = newManualLedgerId();
  const dateStr = new Date().toISOString().slice(0, 10);
  const nowIso  = new Date().toISOString();

  // NOTE: public.billing has no `source` or `created_by` columns. Manual
  // origin is encoded in the ledger_row_id prefix ("MANUAL-"), and the
  // creator email goes into entity_audit_log only.
  void createdBy; // intentional — surfaced via the audit log below
  const row = {
    tenant_id:       tenantId,
    ledger_row_id:   ledgerRowId,
    status:          'Unbilled',
    invoice_no:      '',
    client_name:     clientName,
    date:            dateStr,
    svc_code:        svcCode,
    svc_name:        svcName,
    category:        '',
    item_id:         '',
    description,
    item_class:      itemClass,
    qty,
    rate,
    total,
    task_id:         '',
    repair_id:       '',
    shipment_number: '',
    item_notes:      notes,
    sidemark,
    reference:       '',
    created_at:      nowIso,
    updated_at:      nowIso,
  };

  const { error: insErr } = await sb.from('billing').insert(row);
  if (insErr) return json({ success: false, error: `Insert failed: ${insErr.message}` }, 500);

  await sb.from('entity_audit_log').insert({
    entity_type:  'billing',
    entity_id:    ledgerRowId,
    tenant_id:    tenantId,
    action:       'create',
    changes:      { summary: 'Manual charge added', svcCode, total: String(total) },
    performed_by: callerEmail || 'add-manual-charge-sb',
    source:       'supabase',
  }).then(() => {}, () => {});

  void mirror(tenantId, ledgerRowId, row, 'insert', requestId, callerEmail, sb);

  return json({ success: true, ledgerRowId, total, message: 'Manual charge added' });
});

function newManualLedgerId(): string {
  const ms = Date.now();
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `MANUAL-${ms}-${rand}`;
}

async function mirror(
  tenantId: string, ledgerRowId: string, row: Record<string, unknown>, op: 'insert' | 'update',
  requestId: string, callerEmail: string, sb: ReturnType<typeof createClient>,
): Promise<void> {
  const gasUrl   = Deno.env.get('GAS_API_URL');
  const gasToken = Deno.env.get('GAS_API_TOKEN');
  if (!gasUrl || !gasToken) return;
  try {
    const payload = { tenantId, table: 'billing', op, rowId: ledgerRowId, row, requestId };
    const res = await fetch(`${gasUrl}?action=writeThroughReverse&token=${encodeURIComponent(gasToken)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      await sb.from('gs_sync_events').insert({
        tenant_id: tenantId, entity_type: 'billing', entity_id: ledgerRowId,
        action_type: 'writethrough_reverse', sync_status: 'sync_failed',
        requested_by: callerEmail || 'add-manual-charge-sb', request_id: requestId,
        payload, error_message: `HTTP ${res.status}`,
      }).then(() => {}, () => {});
    }
  } catch (e) { console.warn('[add-manual-charge-sb] mirror threw:', e); }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
