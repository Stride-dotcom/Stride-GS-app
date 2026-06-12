/**
 * add-manual-charge-sb — SB-primary handler for `addManualCharge`.
 *
 * Mirrors GAS handleAddManualCharge_. Inserts a Billing_Ledger row
 * (Status=Unbilled). Total is server-computed (rate × qty) so the client
 * can't cook the books by sending a mismatched total.
 *
 * Ledger id: when an anchor (itemId, else entityId) is supplied — i.e. the
 * charge was added from an entity detail page via the universal "Add Charge"
 * button — the id is DETERMINISTIC and human-readable:
 * `MANUAL-<SVC>-<ANCHOR>-<YYYYMMDD>`. A genuine second identical charge the
 * same day is a real workflow, so a `-2`, `-3`… suffix is appended on a
 * (tenant_id, ledger_row_id) unique collision rather than rejecting it.
 * (Accidental double-submits are prevented UI-side: the modal's button is
 * disabled while saving and the modal closes on success.) With no anchor
 * (standalone Billing-page charge) it falls back to the legacy random
 * `MANUAL-<ms>-<random6>`. Either way the `MANUAL-` prefix is preserved so
 * void/update handlers keep recognising it.
 *
 * Payload:  { tenantId, serviceCode|svcCode, serviceName|svcName, qty?,
 *             rate?, classCode|itemClass?, sidemark?, notes?, description?,
 *             category?, reference?, itemId?, taskId?, repairId?,
 *             shipmentNumber?, entityType?, entityId?, callerEmail?, requestId? }
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

  // ── Entity linkage (universal "Add Charge") ───────────────────────────
  const itemId         = String(body.itemId ?? '').trim();
  const taskId         = String(body.taskId ?? '').trim();
  const repairId       = String(body.repairId ?? '').trim();
  const shipmentNumber = String(body.shipmentNumber ?? '').trim();
  const category       = String(body.category ?? '').trim();
  const reference      = String(body.reference ?? '').trim();
  const entityType     = String(body.entityType ?? '').trim();
  const entityId       = String(body.entityId ?? '').trim();

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

  const dateStr = new Date().toISOString().slice(0, 10);
  const nowIso  = new Date().toISOString();

  // NOTE: public.billing has no `source` or `created_by` columns. Manual
  // origin is encoded in the ledger_row_id prefix ("MANUAL-"); the creator
  // email surfaces via entity_audit_log (performed_by) below.

  // Deterministic id when anchored to an entity; legacy random otherwise.
  const anchor = itemId || entityId;
  const baseLedgerId = anchor
    ? `MANUAL-${slug(svcCode)}-${slug(anchor)}-${dateStr.replace(/-/g, '')}`
    : newManualLedgerId();

  const buildRow = (ledgerRowId: string) => ({
    tenant_id:       tenantId,
    ledger_row_id:   ledgerRowId,
    status:          'Unbilled',
    invoice_no:      '',
    client_name:     clientName,
    date:            dateStr,
    svc_code:        svcCode,
    svc_name:        svcName,
    category,
    item_id:         itemId,
    description,
    item_class:      itemClass,
    qty,
    rate,
    total,
    task_id:         taskId,
    repair_id:       repairId,
    shipment_number: shipmentNumber,
    item_notes:      notes,
    sidemark,
    reference,
    created_at:      nowIso,
    updated_at:      nowIso,
  });

  // Insert, suffixing on a (tenant_id, ledger_row_id) unique violation so a
  // legitimate repeat charge the same day still lands as its own row.
  let ledgerRowId = baseLedgerId;
  let row = buildRow(ledgerRowId);
  let inserted = false;
  for (let attempt = 1; attempt <= 25; attempt++) {
    const { error: insErr } = await sb.from('billing').insert(row);
    if (!insErr) { inserted = true; break; }
    if (insErr.code !== '23505') {
      return json({ success: false, error: `Insert failed: ${insErr.message}` }, 500);
    }
    // Random ids should never collide; only the deterministic path retries.
    if (!anchor) ledgerRowId = newManualLedgerId();
    else ledgerRowId = `${baseLedgerId}-${attempt + 1}`;
    row = buildRow(ledgerRowId);
  }
  if (!inserted) return json({ success: false, error: 'Could not allocate a unique ledger id' }, 500);

  // Internal billing audit row. The entity-facing "charge_added" timeline
  // entry is written client-side by AddChargeModal so it is uniform across
  // the GAS and SB backends (and not duplicated here on the SB path).
  await sb.from('entity_audit_log').insert({
    entity_type:  'billing',
    entity_id:    ledgerRowId,
    tenant_id:    tenantId,
    action:       'create',
    changes:      { summary: `Manual charge added: ${svcName} $${total.toFixed(2)}`, svcCode, total: String(total), entityType, entityId },
    performed_by: callerEmail || createdBy || 'add-manual-charge-sb',
    source:       'supabase',
  }).then(() => {}, () => {});

  // AWAIT the reverse-writethrough so "success" means the Billing_Ledger sheet
  // already has the row — closing the window where a sheet-driven billing sync
  // could treat the just-inserted SB row as orphaned. A failed/slow mirror
  // does NOT fail the charge (SB is authority + the row is logged to
  // gs_sync_events for retry, and the GAS sync now protects rows <30 min old),
  // but it IS surfaced via `mirrored: false` instead of being silent.
  const mirrored = await mirror(tenantId, ledgerRowId, row, 'insert', requestId, callerEmail, sb);

  return json({
    success: true, ledgerRowId, total, mirrored,
    message: mirrored ? 'Manual charge added' : 'Manual charge added (sheet sync pending)',
  });
});

function newManualLedgerId(): string {
  const ms = Date.now();
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `MANUAL-${ms}-${rand}`;
}

/** Uppercase, keep A-Z0-9, collapse runs of other chars to a single dash. */
function slug(s: string): string {
  return String(s).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Reverse-writethrough: append/refresh the row on the GAS Billing_Ledger sheet.
 * Returns true when the sheet write succeeded. A failure is logged to
 * gs_sync_events (for retry) and returns false — the caller keeps the SB row
 * (authority) and surfaces `mirrored: false`. Bounded by a timeout so a slow
 * GAS can't hang the Edge Function.
 */
async function mirror(
  tenantId: string, ledgerRowId: string, row: Record<string, unknown>, op: 'insert' | 'update',
  requestId: string, callerEmail: string, sb: ReturnType<typeof createClient>,
): Promise<boolean> {
  const gasUrl   = Deno.env.get('GAS_API_URL');
  const gasToken = Deno.env.get('GAS_API_TOKEN');
  if (!gasUrl || !gasToken) return false;
  const payload = { tenantId, table: 'billing', op, rowId: ledgerRowId, row, requestId };
  const logFailed = (error_message: string) =>
    sb.from('gs_sync_events').insert({
      tenant_id: tenantId, entity_type: 'billing', entity_id: ledgerRowId,
      action_type: 'writethrough_reverse', sync_status: 'sync_failed',
      requested_by: callerEmail || 'add-manual-charge-sb', request_id: requestId,
      payload, error_message,
    }).then(() => {}, () => {});
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(`${gasUrl}?action=writeThroughReverse&token=${encodeURIComponent(gasToken)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: ctrl.signal,
    });
    if (res.ok) return true;
    await logFailed(`HTTP ${res.status}`);
    return false;
  } catch (e) {
    console.warn('[add-manual-charge-sb] mirror threw:', e);
    await logFailed(String((e as Error)?.message ?? e));
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
