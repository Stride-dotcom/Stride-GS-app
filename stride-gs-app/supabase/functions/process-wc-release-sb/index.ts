/**
 * process-wc-release-sb — SB-primary handler for `processWcRelease`.
 *
 * Replaces GAS `handleProcessWcRelease_` (StrideAPI.gs:20788).
 *
 * Flow:
 *   1. Validate inputs (wcNumber, releaseItemIds).
 *   2. Load parent WC row + unreleased WC items from Supabase.
 *   3. Reject if WC is already Released/Cancelled, or no releasing
 *      items match the unreleased set.
 *   4. Update will_call_items.status='Released' for releasing items.
 *   5. Update public.inventory: status='Released', release_date=today
 *      for each releasing item.
 *   6. Insert WC billing rows (Unbilled) for each releasing item if
 *      NOT COD (mirrors GAS isCod skip — COD WCs don't go to billing
 *      because the customer pays at pickup).
 *   7. Update parent will_calls.status:
 *      - All released  → Released
 *      - Subset       → Partial
 *
 * Scope gaps (canary-acceptable per MIG-016):
 *   - Partial release does NOT create a child WC for the remaining
 *     items. GAS handler does; for the SB MVP the operator can create
 *     a new WC manually if the partial-release leaves significant
 *     remaining items. Future work: add the child-WC creation path.
 *   - Addons flush is skipped — addons live at the WC level and the
 *     addons-write helper hasn't been ported. Operator should fire
 *     legacy GAS for any WC with attached addons until that ports.
 *   - WC release email is NOT sent here. Operator can resend from the
 *     React WillCallDetailPanel via the legacy GAS path. Future work:
 *     wire send-email EF with WILL_CALL_RELEASED template.
 *
 * Response shape mirrors GAS:
 *   { success, releasedCount, isPartial, newWcNumber?, emailSent: false,
 *     warnings? }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ProcessWcBody {
  tenantId?: string;
  callerEmail?: string;
  requestId?: string;
  wcNumber?: string;
  releaseItemIds?: string[];
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);

  let body: ProcessWcBody;
  try { body = await req.json(); }
  catch (e) { return json({ error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` }, 400); }

  const tenantId        = String(body.tenantId        ?? '').trim();
  const callerEmail     = String(body.callerEmail     ?? '').trim();
  const requestId       = String(body.requestId       ?? '').trim() || crypto.randomUUID();
  const wcNumber        = String(body.wcNumber        ?? '').trim();
  const releaseItemIds  = (body.releaseItemIds ?? []).map(s => String(s).trim()).filter(Boolean);

  if (!tenantId)       return json({ success: false, error: 'tenantId is required' }, 400);
  if (!wcNumber)       return json({ success: false, error: 'wcNumber is required' }, 400);
  if (releaseItemIds.length === 0) {
    return json({ success: false, error: 'releaseItemIds array is required and must be non-empty' }, 400);
  }
  const releaseSet = new Set(releaseItemIds);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) return json({ error: 'Server misconfigured' }, 500);
  const sb = createClient(supabaseUrl, serviceKey);

  const warnings: string[] = [];

  // 1. Load WC row
  const { data: wcRow, error: wcErr } = await sb
    .from('will_calls')
    .select('wc_number, status, cod, cod_amount, item_count, pickup_party')
    .eq('tenant_id', tenantId)
    .eq('wc_number', wcNumber)
    .maybeSingle();
  if (wcErr)  return json({ success: false, error: `WC lookup failed: ${wcErr.message}` }, 500);
  if (!wcRow) return json({ success: false, error: `Will call not found: ${wcNumber}` }, 404);

  const currentStatus = String((wcRow as { status?: string }).status ?? '').trim();
  if (currentStatus === 'Released')  return json({ success: false, error: 'This will call is already fully released', skipped: true }, 400);
  if (currentStatus === 'Cancelled') return json({ success: false, error: 'This will call has been cancelled' }, 400);

  const isCod = !!(wcRow as { cod?: boolean }).cod;

  // 2. Load unreleased WC items
  const { data: wciRowsRaw, error: wciErr } = await sb
    .from('will_call_items')
    .select('item_id, status, qty, sidemark, wc_fee, item_class, description, location, vendor')
    .eq('tenant_id', tenantId)
    .eq('wc_number', wcNumber);
  if (wciErr) return json({ success: false, error: `WC items lookup failed: ${wciErr.message}` }, 500);

  type WciRow = { item_id: string; status: string | null; qty: number | null; sidemark: string | null; wc_fee: number | null; item_class: string | null; description: string | null; location: string | null; vendor: string | null };
  const wciRows = ((wciRowsRaw ?? []) as WciRow[]);
  const unreleased = wciRows.filter(r => String(r.status ?? '').trim() !== 'Released');
  if (unreleased.length === 0) {
    return json({ success: false, error: `No unreleased items found for ${wcNumber}`, skipped: true }, 400);
  }

  const releasing = unreleased.filter(r => releaseSet.has(String(r.item_id)));
  if (releasing.length === 0) {
    return json({ success: false, error: 'None of the specified releaseItemIds match unreleased items on this will call' }, 400);
  }
  const remaining = unreleased.length - releasing.length;
  const isPartial = remaining > 0;

  const nowIso = new Date().toISOString();
  const todayDate = nowIso.slice(0, 10);

  // 3. UPDATE will_call_items.status='Released' for each releasing item
  let releasedCount = 0;
  for (const r of releasing) {
    const { error: upErr } = await sb
      .from('will_call_items')
      .update({ status: 'Released', updated_at: nowIso })
      .eq('tenant_id', tenantId)
      .eq('wc_number', wcNumber)
      .eq('item_id', r.item_id);
    if (upErr) {
      warnings.push(`WCI update ${r.item_id}: ${upErr.message}`);
      continue;
    }
    releasedCount++;
  }

  // 4. UPDATE inventory: status='Released', release_date=today
  const releasingItemIds = releasing.map(r => String(r.item_id));
  if (releasingItemIds.length > 0) {
    const { error: invErr } = await sb
      .from('inventory')
      .update({ status: 'Released', release_date: todayDate, updated_at: nowIso })
      .eq('tenant_id', tenantId)
      .in('item_id', releasingItemIds);
    if (invErr) warnings.push(`Inventory release update: ${invErr.message}`);
  }

  // 5. Insert WC billing rows (if NOT COD)
  if (!isCod && releasing.length > 0) {
    const { data: clientRow } = await sb
      .from('clients')
      .select('name')
      .eq('spreadsheet_id', tenantId)
      .maybeSingle();
    const clientName = (clientRow as { name?: string } | null)?.name ?? 'Client';

    const billingRows = releasing.map(r => ({
      tenant_id:       tenantId,
      ledger_row_id:   `WC-${r.item_id}-${wcNumber}`,
      status:          'Unbilled',
      invoice_no:      '',
      client_name:     clientName,
      date:            todayDate,
      svc_code:        'WC',
      svc_name:        'Will Call',
      category:        'Whse Services',
      item_id:         String(r.item_id),
      description:     String(r.description ?? ''),
      item_class:      String(r.item_class ?? ''),
      qty:             1,
      rate:            Number(r.wc_fee ?? 0),
      total:           Number(r.wc_fee ?? 0),
      shipment_number: wcNumber,
      sidemark:        String(r.sidemark ?? ''),
      updated_at:      nowIso,
    }));

    // Idempotency: upsert on ledger_row_id (re-release after cancel
    // must not produce dupes; if a row with status='Invoiced' or 'Void'
    // already exists for this ledger_row_id, the upsert path overwrites
    // it which would CORRUPT history. Mirror GAS's "skipped_invoiced"
    // by selecting first + filtering.
    const ledgerIds = billingRows.map(r => r.ledger_row_id);
    const { data: existing } = await sb
      .from('billing')
      .select('ledger_row_id, status')
      .eq('tenant_id', tenantId)
      .in('ledger_row_id', ledgerIds);
    const existingMap = new Map<string, string>();
    for (const e of (existing ?? []) as Array<{ ledger_row_id: string; status: string }>) {
      existingMap.set(e.ledger_row_id, e.status);
    }
    const toInsert: typeof billingRows = [];
    const toUpsertExistingUnbilled: typeof billingRows = [];
    for (const row of billingRows) {
      const prev = existingMap.get(row.ledger_row_id);
      if (!prev) {
        toInsert.push(row);
      } else if (prev === 'Unbilled') {
        toUpsertExistingUnbilled.push(row);
      } else {
        warnings.push(`WC billing row ${row.ledger_row_id} already Status=${prev} — not overwritten. Void the invoice first if you need to re-bill.`);
      }
    }
    if (toInsert.length > 0) {
      const { error: bInsErr } = await sb.from('billing').insert(toInsert);
      if (bInsErr) warnings.push(`Billing insert: ${bInsErr.message}`);
    }
    for (const row of toUpsertExistingUnbilled) {
      const { error: bUpErr } = await sb.from('billing')
        .update(row)
        .eq('tenant_id', tenantId)
        .eq('ledger_row_id', row.ledger_row_id);
      if (bUpErr) warnings.push(`Billing update ${row.ledger_row_id}: ${bUpErr.message}`);
    }
  }

  // 6. Update parent WC status
  const newWcStatus = isPartial ? 'Partial' : 'Released';
  const { error: wcUpErr } = await sb
    .from('will_calls')
    .update({ status: newWcStatus, updated_at: nowIso })
    .eq('tenant_id', tenantId)
    .eq('wc_number', wcNumber);
  if (wcUpErr) warnings.push(`WC status update: ${wcUpErr.message}`);

  if (isPartial) {
    warnings.push(`Partial release — ${remaining} item(s) remain on ${wcNumber}. Child WC for remaining items NOT created (SB MVP gap, MIG-016); create manually if needed.`);
  }

  // 7. Reverse-writethrough — inventory writer handles release flow;
  //    will_calls writer COD-only. Fire what we can.
  await Promise.all(releasing.map(r => mirrorInventoryRelease(String(r.item_id), todayDate, tenantId, requestId, callerEmail, sb)));

  // 8. Audit log
  await sb.from('entity_audit_log').insert({
    entity_type:   'will_call',
    entity_id:     wcNumber,
    tenant_id:     tenantId,
    action:        'release',
    changes:       {
      status: { old: currentStatus, new: newWcStatus },
      releasedItemIds: releasingItemIds,
      releasedCount,
      isPartial,
    },
    performed_by:  callerEmail || 'process-wc-release-sb',
    source:        'supabase',
  }).then(() => {}, () => {});

  return json({
    success:       true,
    releasedCount,
    isPartial,
    emailSent:     false, // Operator: resend via legacy GAS path if needed
    warnings:      warnings.length > 0 ? warnings : undefined,
  });
});

async function mirrorInventoryRelease(
  itemId: string, releaseDateIso: string, tenantId: string, requestId: string, callerEmail: string,
  sb: ReturnType<typeof createClient>,
): Promise<void> {
  try {
    const gasUrl   = Deno.env.get('GAS_API_URL');
    const gasToken = Deno.env.get('GAS_API_TOKEN');
    if (!gasUrl || !gasToken) return;
    const payload = {
      tenantId, table: 'inventory', op: 'update', rowId: itemId,
      row: { status: 'Released', release_date: releaseDateIso },
      requestId: `${requestId}:${itemId}`,
    };
    const res = await fetch(`${gasUrl}?action=writeThroughReverse&token=${encodeURIComponent(gasToken)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text();
      await sb.from('gs_sync_events').insert({
        tenant_id: tenantId, entity_type: 'inventory', entity_id: itemId,
        action_type: 'writethrough_reverse', sync_status: 'sync_failed',
        requested_by: callerEmail || 'process-wc-release-sb', request_id: `${requestId}:${itemId}`,
        payload, error_message: `HTTP ${res.status} ${text.slice(0, 200)}`,
      }).then(() => {}, () => {});
    }
  } catch (e) {
    console.warn('[process-wc-release-sb] mirror threw:', e);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
