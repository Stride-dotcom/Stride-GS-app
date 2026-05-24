/**
 * batch-update-item-locations-sb — SB-primary handler for `batchUpdateItemLocations`.
 *
 * Highest-traffic action without a SB handler per gas_call_log (52 calls / 7d).
 * Mirrors GAS handleBatchUpdateItemLocations_ (StrideAPI.gs:12561). Groups
 * itemIds by tenant via item_id_ledger / inventory, then updates inventory.location
 * in batches and writes move_history rows.
 *
 * Payload:  { itemIds: string[], location: string, notes?: string,
 *             tenantMap?: { [itemId]: tenantId }, callerEmail? }
 * Response: { success, results: { updated: string[], notFound: string[],
 *             errors: { id, reason }[] }, message }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface BatchMoveBody {
  itemIds?: unknown;
  location?: unknown;
  notes?: unknown;
  tenantMap?: Record<string, string> | null;
  callerEmail?: string;
  tenantId?: string;
  requestId?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);

  let body: BatchMoveBody;
  try { body = await req.json(); }
  catch (e) { return json({ error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` }, 400); }

  const rawIds   = Array.isArray(body.itemIds) ? body.itemIds : [];
  const location = String(body.location ?? '').trim();
  const notes    = String(body.notes ?? '').trim();
  const callerEmail = String(body.callerEmail ?? '').trim();
  const requestId   = String(body.requestId ?? '').trim() || crypto.randomUUID();

  if (rawIds.length === 0) return json({ success: false, error: 'itemIds is required', code: 'MISSING_PARAM' }, 400);
  if (!location)            return json({ success: false, error: 'location is required', code: 'MISSING_PARAM' }, 400);

  // Normalize: trim, strip "ITEM:" prefix, dedup preserving order. Mirrors GAS.
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of rawIds) {
    const id = String(raw ?? '').trim().replace(/^ITEM:\s*/i, '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    normalized.push(id);
  }
  if (normalized.length === 0) {
    return json({ success: false, error: 'No valid item IDs after normalization', code: 'MISSING_PARAM' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) return json({ error: 'Server misconfigured' }, 500);
  const sb = createClient(supabaseUrl, serviceKey);

  // Resolve item → tenant. Use pre-resolved tenantMap from React first; fall
  // back to item_id_ledger and then inventory for any unresolved ids.
  const tenantByItem = new Map<string, string>();
  if (body.tenantMap && typeof body.tenantMap === 'object') {
    for (const [k, v] of Object.entries(body.tenantMap)) {
      if (v) tenantByItem.set(String(k).trim().toUpperCase(), String(v).trim());
    }
  }
  let unresolved = normalized.filter(id => !tenantByItem.has(id));
  if (unresolved.length > 0) {
    const { data: ledgerRows } = await sb
      .from('item_id_ledger')
      .select('item_id, tenant_id')
      .in('item_id', unresolved);
    for (const row of (ledgerRows ?? []) as Array<{ item_id: string; tenant_id: string }>) {
      if (row.tenant_id) tenantByItem.set(row.item_id, row.tenant_id);
    }
    unresolved = normalized.filter(id => !tenantByItem.has(id));
  }
  if (unresolved.length > 0) {
    const { data: invRows } = await sb
      .from('inventory')
      .select('item_id, tenant_id')
      .in('item_id', unresolved)
      .eq('status', 'Active');
    for (const row of (invRows ?? []) as Array<{ item_id: string; tenant_id: string }>) {
      if (!tenantByItem.has(row.item_id) && row.tenant_id) tenantByItem.set(row.item_id, row.tenant_id);
    }
  }

  // Group ids by tenant
  const byTenant = new Map<string, string[]>();
  const notFound: string[] = [];
  for (const id of normalized) {
    const t = tenantByItem.get(id);
    if (!t) { notFound.push(id); continue; }
    const arr = byTenant.get(t) ?? [];
    arr.push(id);
    byTenant.set(t, arr);
  }

  const nowIso = new Date().toISOString();
  const updated: string[] = [];
  const errors: Array<{ id: string; reason: string }> = [];

  // Per-tenant: read existing locations, update inventory.location, insert
  // move_history rows. Best-effort per tenant — a failure on one tenant
  // doesn't abort the whole batch.
  for (const [tenant, ids] of byTenant.entries()) {
    try {
      const { data: prevRows, error: prevErr } = await sb
        .from('inventory')
        .select('item_id, location')
        .eq('tenant_id', tenant)
        .in('item_id', ids);
      if (prevErr) {
        for (const id of ids) errors.push({ id, reason: `Read failed: ${prevErr.message}` });
        continue;
      }
      const prevByItem = new Map<string, string>();
      for (const r of (prevRows ?? []) as Array<{ item_id: string; location: string | null }>) {
        prevByItem.set(r.item_id, String(r.location ?? ''));
      }

      const { error: upErr } = await sb
        .from('inventory')
        .update({ location, updated_at: nowIso })
        .eq('tenant_id', tenant)
        .in('item_id', ids);
      if (upErr) {
        for (const id of ids) errors.push({ id, reason: `Update failed: ${upErr.message}` });
        continue;
      }

      const moves = ids.map(id => ({
        tenant_id:     tenant,
        item_id:       id,
        from_location: prevByItem.get(id) ?? '',
        to_location:   location,
        moved_by:      callerEmail || 'batch-update-item-locations-sb',
        source:        'bulk_api',
        notes:         notes || null,
      }));
      const { error: mhErr } = await sb.from('move_history').insert(moves);
      if (mhErr) {
        console.warn('[batch-update-item-locations-sb] move_history insert failed:', mhErr.message);
      }

      for (const id of ids) {
        updated.push(id);
        // Reverse-writethrough best-effort per row (preserves legacy sheet location column).
        void mirrorInventoryLocation(tenant, id, location, requestId, callerEmail, sb);
        // Audit log per item.
        await sb.from('entity_audit_log').insert({
          entity_type:   'inventory',
          entity_id:     id,
          tenant_id:     tenant,
          action:        'update',
          changes:       { location: { new: location } },
          performed_by:  callerEmail || 'batch-update-item-locations-sb',
          source:        'supabase',
        }).then(() => {}, () => {});
      }
    } catch (e) {
      for (const id of ids) errors.push({ id, reason: e instanceof Error ? e.message : String(e) });
    }
  }

  return json({
    success: errors.length === 0,
    results: { updated, notFound, errors },
    message: `Updated ${updated.length} item(s)` +
             (notFound.length ? `, ${notFound.length} not found` : '') +
             (errors.length ? `, ${errors.length} errored` : ''),
  });
});

async function mirrorInventoryLocation(
  tenantId: string,
  itemId: string,
  location: string,
  requestId: string,
  callerEmail: string,
  sb: ReturnType<typeof createClient>,
): Promise<void> {
  const gasUrl   = Deno.env.get('GAS_API_URL');
  const gasToken = Deno.env.get('GAS_API_TOKEN');
  if (!gasUrl || !gasToken) return;
  try {
    const payload = { tenantId, table: 'inventory', op: 'update', rowId: itemId, row: { location }, requestId };
    const res = await fetch(`${gasUrl}?action=writeThroughReverse&token=${encodeURIComponent(gasToken)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      await sb.from('gs_sync_events').insert({
        tenant_id:     tenantId,
        entity_type:   'inventory',
        entity_id:     itemId,
        action_type:   'writethrough_reverse',
        sync_status:   'sync_failed',
        requested_by:  callerEmail || 'batch-update-item-locations-sb',
        request_id:    requestId,
        payload,
        error_message: `HTTP ${res.status}`.slice(0, 1000),
      }).then(() => {}, () => {});
    }
  } catch (e) {
    console.warn('[batch-update-item-locations-sb] mirror threw:', e);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
