/**
 * create-will-call-sb — SB-primary handler for `createWillCall`.
 *
 * Replaces GAS `handleCreateWillCall_` (StrideAPI.gs:20344). Creates a
 * WC row + N WC items rows in Supabase. Computes per-item WC fees
 * server-side (rate lookup + per-client discount) so billing stays
 * authoritative.
 *
 * Flow:
 *   1. Validate inputs (itemIds, pickupParty).
 *   2. Look up client settings (discount_services_pct, etc.) from public.clients.
 *   3. Look up inventory rows for each item; reject if any is Released.
 *   4. Look up WC rate from public.service_catalog for each item's class.
 *      Apply client discount on rate.
 *   5. Dedup check: reject if any item is on an active WC (status IN
 *      'Pending'/'Scheduled'/'Partial').
 *   6. INSERT public.will_calls + INSERT public.will_call_items.
 *   7. Reverse-writethrough for the WC row (best-effort; sheet writers
 *      may not cover insert path yet — gs_sync_events backstop).
 *   8. Audit log.
 *
 * Response shape mirrors GAS handleCreateWillCall_:
 *   { success, wcNumber, items, totalWcFee, warnings? }
 *
 * Canary-acceptable gap: will_calls + will_call_items sheet rows mirror
 * via stub writer until those writers ship (per MIG-016).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ACTIVE_WC_STATUSES = ['Pending', 'Scheduled', 'Partial'] as const;
const ACTIVE_WC_LIST = `(${ACTIVE_WC_STATUSES.join(',')})`;

interface CreateWcBody {
  tenantId?: string;
  callerEmail?: string;
  requestId?: string;
  items?: string[];               // itemIds — matches GAS shape
  pickupParty?: string;
  pickupPhone?: string;
  requestedBy?: string;
  estDate?: string;               // YYYY-MM-DD
  notes?: string;
  cod?: boolean | string;
  codAmount?: number | string;
  createdBy?: string;
}

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
  code:       string;
  name:       string;
  category:   string | null;
  billing:    string | null;
  rates:      Record<string, number> | null;
  flat_rate:  number | null;
  xxl_rate:   number | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);

  let body: CreateWcBody;
  try { body = await req.json(); }
  catch (e) { return json({ error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` }, 400); }

  const tenantId    = String(body.tenantId    ?? '').trim();
  const callerEmail = String(body.callerEmail ?? '').trim();
  const requestId   = String(body.requestId   ?? '').trim() || crypto.randomUUID();
  const itemIds     = (body.items ?? []).map(s => String(s).trim()).filter(Boolean);
  const pickupParty = String(body.pickupParty ?? '').trim();
  const isCod       = body.cod === true || body.cod === 'true';

  if (!tenantId)    return json({ success: false, error: 'tenantId is required' }, 400);
  if (itemIds.length === 0) return json({ success: false, error: 'items array is required and must be non-empty' }, 400);
  if (!pickupParty) return json({ success: false, error: 'pickupParty is required' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) return json({ error: 'Server misconfigured' }, 500);
  const sb = createClient(supabaseUrl, serviceKey);

  const warnings: string[] = [];

  // 1. Look up inventory rows
  const { data: invRowsRaw, error: invErr } = await sb
    .from('inventory')
    .select('item_id, status, qty, vendor, description, item_class, location, sidemark, room')
    .eq('tenant_id', tenantId)
    .in('item_id', itemIds);
  if (invErr) return json({ success: false, error: `Inventory lookup failed: ${invErr.message}` }, 500);
  const invRows = (invRowsRaw ?? []) as InventoryRow[];
  const invByItemId = new Map<string, InventoryRow>(invRows.map(r => [r.item_id, r]));

  for (const id of itemIds) {
    const row = invByItemId.get(id);
    if (!row) return json({ success: false, error: `Item not found in Inventory: ${id}` }, 400);
    if (row.status === 'Released') return json({ success: false, error: `Item ${id} is already Released` }, 400);
  }

  // 2. Look up client discount
  const { data: clientRow } = await sb
    .from('clients')
    .select('discount_services_pct')
    .eq('spreadsheet_id', tenantId)
    .maybeSingle();
  const discountPct = clientRow && typeof (clientRow as { discount_services_pct?: number }).discount_services_pct === 'number'
    ? (clientRow as { discount_services_pct: number }).discount_services_pct
    : 0;

  // 3. Look up WC service rate config (one row in service_catalog)
  const { data: wcSvcRows, error: svcErr } = await sb
    .from('service_catalog')
    .select('code, name, category, billing, rates, flat_rate, xxl_rate')
    .eq('code', 'WC')
    .limit(1);
  if (svcErr) return json({ success: false, error: `Rate lookup failed: ${svcErr.message}` }, 500);
  const wcSvc = (wcSvcRows ?? [])[0] as ServiceCatalogRow | undefined;
  if (!wcSvc) warnings.push('WC rate not configured in service_catalog — fees set to 0');

  // 4. Active-WC dedup check
  const { data: activeWcs, error: wcErr } = await sb
    .from('will_calls')
    .select('wc_number, item_ids')
    .eq('tenant_id', tenantId)
    .not('status', 'in', `(Released,Cancelled,Completed)`);
  if (wcErr) {
    warnings.push(`Active-WC dedup lookup failed (proceeding anyway): ${wcErr.message}`);
  } else {
    for (const wc of (activeWcs ?? []) as Array<{ wc_number: string; item_ids: unknown }>) {
      const list = Array.isArray(wc.item_ids) ? (wc.item_ids as string[]) : [];
      for (const id of itemIds) {
        if (list.includes(id)) {
          return json({ success: false, error: `Item ${id} is already on active will call ${wc.wc_number}` }, 400);
        }
      }
    }
  }

  // 5. Generate WC number + compute per-item fees
  const now = new Date();
  const wcNumber = await mintWcNumber(sb, tenantId, now);
  const status   = body.estDate ? 'Scheduled' : 'Pending';

  let totalFee = 0;
  const enriched = itemIds.map(id => {
    const inv = invByItemId.get(id)!;
    const cls = (inv.item_class ?? '').trim().toUpperCase();
    const fee = applyDiscount(lookupWcRate(wcSvc, cls), discountPct, wcSvc?.category ?? 'Whse Services');
    totalFee += fee;
    if (wcSvc && fee === 0) {
      warnings.push(`WC rate not found for class ${cls || '(unknown)'} — item ${id} fee set to 0`);
    }
    return {
      itemId:      id,
      qty:         Number(inv.qty ?? 1) || 1,
      vendor:      String(inv.vendor ?? ''),
      description: String(inv.description ?? ''),
      itemClass:   cls,
      location:    String(inv.location ?? ''),
      sidemark:    String(inv.sidemark ?? ''),
      room:        String(inv.room ?? ''),
      wcFee:       fee,
    };
  });

  // COD handling
  const codAmtRaw = body.codAmount;
  const codAmount = isCod
    ? (codAmtRaw != null && codAmtRaw !== '' ? Number(codAmtRaw) : totalFee)
    : 0;
  const totalWcFee = isCod && codAmount !== totalFee ? codAmount : totalFee;

  // 6. INSERT will_calls + will_call_items
  const nowIso = now.toISOString();
  const wcInsert = {
    tenant_id:             tenantId,
    wc_number:             wcNumber,
    status,
    carrier:               pickupParty,
    pickup_party:          pickupParty,
    pickup_phone:          String(body.pickupPhone ?? '').trim(),
    requested_by:          String(body.requestedBy ?? '').trim(),
    created_date:          nowIso,
    estimated_pickup_date: String(body.estDate ?? '').trim() || null,
    notes:                 String(body.notes ?? '').trim(),
    item_count:            enriched.length,
    cod:                   isCod,
    cod_amount:            isCod ? codAmount : null,
    item_ids:              itemIds,
    updated_at:            nowIso,
  };
  const { error: wcInsErr } = await sb.from('will_calls').insert(wcInsert);
  if (wcInsErr) return json({ success: false, error: `WC insert failed: ${wcInsErr.message}` }, 500);

  // 2026-05-24 — public.will_call_items only has these columns:
  //   tenant_id, wc_number, item_id, qty, wc_fee, status, released,
  //   created_at, updated_at.
  // The prior shape added vendor/description/item_class/location/sidemark/
  // room — all non-existent — and PostgREST rejected the INSERT with
  // PGRST204 "column not found in schema cache". WC item denormalized data
  // already lives in public.inventory (joined via item_id); the React UI
  // reads it from there, not from will_call_items.
  const wciRows = enriched.map(e => ({
    tenant_id:  tenantId,
    wc_number:  wcNumber,
    item_id:    e.itemId,
    qty:        e.qty,
    wc_fee:     e.wcFee,
    status:     'Pending',
    updated_at: nowIso,
  }));
  const { error: wciInsErr } = await sb.from('will_call_items').insert(wciRows);
  if (wciInsErr) {
    warnings.push(`WC items insert failed: ${wciInsErr.message} (parent WC row remains; review will_call_items manually)`);
  }

  // 7. Sheet mirror — best-effort. The existing __writeThroughReverseWillCalls_
  // is COD-only-update; insert+full-field support hasn't shipped yet. Fire
  // and let gs_sync_events absorb the failure for canary.
  void mirrorWillCall(wcInsert, tenantId, requestId, callerEmail, sb);

  // 8. Audit log
  await sb.from('entity_audit_log').insert({
    entity_type:   'will_call',
    entity_id:     wcNumber,
    tenant_id:     tenantId,
    action:        'create',
    changes:       { itemCount: enriched.length, totalWcFee, status, cod: isCod },
    performed_by:  callerEmail || 'create-will-call-sb',
    source:        'supabase',
  }).then(() => {}, () => {});

  return json({
    success:    true,
    wcNumber,
    items:      enriched,
    totalWcFee,
    status,
    warnings:   warnings.length > 0 ? warnings : undefined,
  });
});

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Mint the WC number. When the `orderNumbering` feature is on for this tenant
 * (Justin Demo canary), the SECURITY DEFINER `next_order_id` RPC returns a
 * clean client-scoped number (PREFIX-WC-N, no leading zeros). When off it
 * returns null and we fall back to the legacy WC-MMddyyHHmmss timestamp id.
 * The reverse-writethrough below pushes whichever id we pick to the sheet.
 */
async function mintWcNumber(
  sb: ReturnType<typeof createClient>,
  tenantId: string,
  now: Date,
): Promise<string> {
  try {
    const { data, error } = await sb.rpc('next_order_id', {
      p_tenant_id: tenantId,
      p_order_type: 'will_call',
    });
    if (error) console.warn('[create-will-call-sb] next_order_id failed, using legacy id:', error.message);
    else if (typeof data === 'string' && data) return data;
  } catch (e) {
    console.warn('[create-will-call-sb] next_order_id threw, using legacy id:', e);
  }
  return generateWcNumber(now);
}

function generateWcNumber(d: Date): string {
  // Mirrors GAS: "WC-MMddyyHHmmss" in script TZ. We use UTC for
  // determinism (the canary tenant operator is in PT but the wc_number
  // is just an identifier, not a timestamp display).
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const yy = String(d.getUTCFullYear()).slice(2);
  const HH = String(d.getUTCHours()).padStart(2, '0');
  const MM = String(d.getUTCMinutes()).padStart(2, '0');
  const SS = String(d.getUTCSeconds()).padStart(2, '0');
  return `WC-${mm}${dd}${yy}${HH}${MM}${SS}`;
}

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

function applyDiscount(rate: number, pct: number, _category: string): number {
  // Mirrors api_applyDiscount_ at StrideAPI.gs:16724. Storage uses a
  // different pct key on GAS (DISCOUNT_STORAGE_PCT) but WC is a Whse
  // Service so it always uses DISCOUNT_SERVICES_PCT. The Supabase
  // clients table column name `discount_services_pct` is what we
  // already pulled. Out-of-range typos (±100+) are no-op safety rails.
  if (rate <= 0) return rate;
  if (!Number.isFinite(pct) || pct === 0 || pct < -100 || pct > 100) return rate;
  return Math.round(rate * (1 + pct / 100) * 100) / 100;
}

async function mirrorWillCall(
  wcRow: Record<string, unknown>,
  tenantId: string,
  requestId: string,
  callerEmail: string,
  sb: ReturnType<typeof createClient>,
): Promise<void> {
  const gasUrl   = Deno.env.get('GAS_API_URL');
  const gasToken = Deno.env.get('GAS_API_TOKEN');
  if (!gasUrl || !gasToken) return;
  const wcNumber = String(wcRow.wc_number);
  try {
    const res = await fetch(`${gasUrl}?action=writeThroughReverse&token=${encodeURIComponent(gasToken)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId,
        table: 'will_calls',
        op:    'insert',
        rowId: wcNumber,
        row:   wcRow,
        requestId,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      await sb.from('gs_sync_events').insert({
        tenant_id:     tenantId,
        entity_type:   'will_call',
        entity_id:     wcNumber,
        action_type:   'writethrough_reverse',
        sync_status:   'sync_failed',
        requested_by:  callerEmail || 'create-will-call-sb',
        request_id:    requestId,
        payload:       { table: 'will_calls', op: 'insert', rowId: wcNumber },
        error_message: `HTTP ${res.status} ${text.slice(0, 200)}`,
      }).then(() => {}, () => {});
    }
  } catch (e) {
    console.warn('[create-will-call-sb] mirror threw:', e);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
