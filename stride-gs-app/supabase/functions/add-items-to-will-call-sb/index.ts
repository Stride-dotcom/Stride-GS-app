/**
 * add-items-to-will-call-sb — SB-primary handler for `addItemsToWillCall`.
 *
 * Mirrors GAS handleAddItemsToWillCall_ (StrideAPI.gs:21977). Adds inventory
 * items to an existing Pending/Scheduled WC. Looks up each item, rejects if
 * any is Released or already on another active WC, computes WC fees per item
 * using service_catalog.WC + client discount_services_pct, inserts
 * will_call_items rows, updates parent will_calls.item_count + item_ids.
 *
 * Payload:  { tenantId, wcNumber, items: string[], callerEmail?, requestId? }
 * Response: { success, addedCount, totalItems, totalFee, warnings? }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface InventoryRow {
  item_id:     string;
  status:      string;
  qty:         number | null;
  vendor:      string | null;
  description: string | null;
  item_class:  string | null;
  location:    string | null;
  sidemark:    string | null;
  room:        string | null;
}
interface ServiceCatalogRow {
  code: string;
  category: string | null;
  billing: string | null;
  rates: Record<string, number> | null;
  flat_rate: number | null;
  xxl_rate: number | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);

  const body = await req.json().catch(() => ({}));
  const tenantId    = String(body.tenantId    ?? '').trim();
  const wcNumber    = String(body.wcNumber    ?? '').trim();
  const callerEmail = String(body.callerEmail ?? '').trim();
  const requestId   = String(body.requestId   ?? '').trim() || crypto.randomUUID();
  const itemIds = (Array.isArray(body.items) ? body.items : [])
    .map((s: unknown) => String(s ?? '').trim())
    .filter((s: string) => s.length > 0);

  if (!tenantId) return json({ success: false, error: 'tenantId is required' }, 400);
  if (!wcNumber) return json({ success: false, error: 'wcNumber is required' }, 400);
  if (itemIds.length === 0) return json({ success: false, error: 'items array is required and must be non-empty' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) return json({ error: 'Server misconfigured' }, 500);
  const sb = createClient(supabaseUrl, serviceKey);

  const warnings: string[] = [];

  const { data: wc, error: wcErr } = await sb
    .from('will_calls')
    .select('wc_number, status, item_count, total_wc_fee, item_ids')
    .eq('tenant_id', tenantId)
    .eq('wc_number', wcNumber)
    .maybeSingle();
  if (wcErr) return json({ success: false, error: `WC read failed: ${wcErr.message}` }, 500);
  if (!wc) return json({ success: false, error: `Will call not found: ${wcNumber}`, code: 'NOT_FOUND' }, 404);
  const wcStatus = String((wc as { status?: string }).status ?? '').trim();
  if (wcStatus !== 'Pending' && wcStatus !== 'Scheduled') {
    return json({ success: false, error: `Cannot add items — will call status is ${wcStatus}` }, 400);
  }

  const { data: invRowsRaw, error: invErr } = await sb
    .from('inventory')
    .select('item_id, status, qty, vendor, description, item_class, location, sidemark, room')
    .eq('tenant_id', tenantId)
    .in('item_id', itemIds);
  if (invErr) return json({ success: false, error: `Inventory lookup failed: ${invErr.message}` }, 500);
  const invByItem = new Map<string, InventoryRow>(((invRowsRaw ?? []) as InventoryRow[]).map(r => [r.item_id, r]));
  for (const id of itemIds) {
    const row = invByItem.get(id);
    if (!row) return json({ success: false, error: `Item not found in Inventory: ${id}` }, 400);
    if (row.status === 'Released') return json({ success: false, error: `Item ${id} is already Released` }, 400);
  }

  // Dedup vs other active WCs (Pending/Scheduled/Partial), including THIS WC.
  const { data: activeWcs } = await sb
    .from('will_calls')
    .select('wc_number, item_ids')
    .eq('tenant_id', tenantId)
    .not('status', 'in', '(Released,Cancelled,Completed)');
  for (const otherWc of (activeWcs ?? []) as Array<{ wc_number: string; item_ids: unknown }>) {
    const list = Array.isArray(otherWc.item_ids) ? (otherWc.item_ids as string[]) : [];
    for (const id of itemIds) {
      if (list.includes(id)) {
        return json({ success: false, error: `Item ${id} is already on active will call ${otherWc.wc_number}` }, 400);
      }
    }
  }

  // Client discount.
  const { data: clientRow } = await sb
    .from('clients')
    .select('discount_services_pct')
    .eq('spreadsheet_id', tenantId)
    .maybeSingle();
  const discountPct = clientRow && typeof (clientRow as { discount_services_pct?: number }).discount_services_pct === 'number'
    ? (clientRow as { discount_services_pct: number }).discount_services_pct : 0;

  const { data: wcSvcRows } = await sb
    .from('service_catalog')
    .select('code, category, billing, rates, flat_rate, xxl_rate')
    .eq('code', 'WC')
    .limit(1);
  const wcSvc = ((wcSvcRows ?? [])[0] as ServiceCatalogRow | undefined);

  let addedFee = 0;
  const nowIso = new Date().toISOString();
  const wciRows = itemIds.map(id => {
    const inv = invByItem.get(id)!;
    const cls = (inv.item_class ?? '').trim().toUpperCase();
    const fee = applyDiscount(lookupWcRate(wcSvc, cls), discountPct);
    addedFee += fee;
    if (wcSvc && fee === 0) warnings.push(`WC rate not found for class ${cls || '(unknown)'} — item ${id} fee set to 0`);
    return {
      tenant_id:  tenantId,
      wc_number:  wcNumber,
      item_id:    id,
      qty:        Number(inv.qty ?? 1) || 1,
      wc_fee:     fee,
      status:     'Pending',
      updated_at: nowIso,
    };
  });

  const { error: wciInsErr } = await sb.from('will_call_items').insert(wciRows);
  if (wciInsErr) return json({ success: false, error: `WC items insert failed: ${wciInsErr.message}` }, 500);

  // Update parent WC totals + item_ids array.
  const prevCount = Number((wc as { item_count?: number }).item_count ?? 0) || 0;
  const prevFee   = Number((wc as { total_wc_fee?: number }).total_wc_fee ?? 0) || 0;
  const prevIds   = Array.isArray((wc as { item_ids?: unknown }).item_ids) ? ((wc as { item_ids: string[] }).item_ids) : [];
  const newCount  = prevCount + itemIds.length;
  const newFee    = Math.round((prevFee + addedFee) * 100) / 100;
  const newIds    = [...prevIds, ...itemIds];

  const { error: wcUpErr } = await sb
    .from('will_calls')
    .update({ item_count: newCount, total_wc_fee: newFee, item_ids: newIds, updated_at: nowIso })
    .eq('tenant_id', tenantId)
    .eq('wc_number', wcNumber);
  if (wcUpErr) {
    warnings.push(`Parent WC update failed: ${wcUpErr.message}`);
  }

  // Audit: one row on the WC (with the item IDs) + one per item so each
  // item's ActivityTimeline shows "Added to Will Call: WC-x".
  await sb.from('entity_audit_log').insert([
    {
      entity_type:  'will_call',
      entity_id:    wcNumber,
      tenant_id:    tenantId,
      action:       'update',
      changes:      { summary: `${itemIds.length} item(s) added to will call`, itemIds },
      performed_by: callerEmail || 'add-items-to-will-call-sb',
      source:       'supabase',
    },
    ...itemIds.map(id => ({
      entity_type:  'inventory',
      entity_id:    id,
      tenant_id:    tenantId,
      action:       'added_to_will_call',
      changes:      { wcNumber },
      performed_by: callerEmail || 'add-items-to-will-call-sb',
      source:       'supabase',
    })),
  ]).then(() => {}, () => {});

  void mirror(tenantId, wcNumber, { item_count: newCount, total_wc_fee: newFee, item_ids: newIds }, requestId, callerEmail, sb);

  return json({
    success: true,
    addedCount: itemIds.length,
    totalItems: newCount,
    totalFee:   newFee,
    skipped:    [],
    warnings:   warnings.length > 0 ? warnings : undefined,
  });
});

function lookupWcRate(svc: ServiceCatalogRow | undefined, klass: string): number {
  if (!svc) return 0;
  if (svc.billing === 'class_based') {
    if (klass === 'XXL') return Number(svc.xxl_rate) || 0;
    if (klass && svc.rates) {
      const r = (svc.rates as Record<string, unknown>)[klass];
      return Number(r) || 0;
    }
    return 0;
  }
  return Number(svc.flat_rate) || 0;
}

function applyDiscount(rate: number, pct: number): number {
  if (rate <= 0) return rate;
  if (!Number.isFinite(pct) || pct === 0 || pct < -100 || pct > 100) return rate;
  return Math.round(rate * (1 + pct / 100) * 100) / 100;
}

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
        requested_by: callerEmail || 'add-items-to-will-call-sb', request_id: requestId,
        payload, error_message: `HTTP ${res.status}`,
      }).then(() => {}, () => {});
    }
  } catch (e) { console.warn('[add-items-to-will-call-sb] mirror threw:', e); }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
