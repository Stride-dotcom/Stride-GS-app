/**
 * backfill-dt-finished-releases — one-shot admin backfill.
 *
 * Releases inventory items for every DT order that is already
 * Finished in our system but whose linked inventory rows are still
 * Active. Mirrors the manual-release flow shipped in PR #1 but
 * processes many orders / many tenants in one invocation.
 *
 * Mode:
 *   • dryRun=true (default) → returns a per-order preview; no writes.
 *   • dryRun=false → applies the Supabase writes, posts an
 *     entity_audit_log row per order, then mirrors all released
 *     items into the per-tenant Inventory sheets via the new
 *     mirrorInventoryReleaseBulk GAS endpoint (one call per
 *     tenant; ~150 items/tenant in <2s vs N reverse-writethrough
 *     round-trips).
 *
 * Eligibility (matches the design we locked in 2026-05-12):
 *   • dt_orders.status_id = 3 (Finished/Completed)
 *   • dt_orders.is_pickup = false
 *   • dt_orders.local_service_date IS NOT NULL (used as release_date —
 *     finished_at is not populated on production data, so we use
 *     the scheduled service date as the cleanest proxy)
 *   • dt_orders.tenant_id IS NOT NULL
 *   • dt_order_items.inventory_id IS NOT NULL (post-migration this
 *     is auto-populated from dt_item_code where possible)
 *   • dt_order_items.delivered = true (strict — per-item driver
 *     confirmation. Items where delivered is null/false are skipped
 *     and surfaced in the response for manual review.)
 *   • inventory.status != 'Released' (Postgres-side filter on the
 *     UPDATE — already-Released rows skip silently, making re-runs
 *     a clean no-op.)
 *
 * Body: { dryRun?: boolean, tenantId?: string, orderIds?: string[] }
 *   • tenantId / orderIds are optional filters for testing.
 *
 * Auth: verify_jwt=false; callable from an admin's curl or the
 * Stride app's hidden admin panel. The function uses the service
 * role for Supabase writes — caller can't escalate beyond what
 * we control here.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface BackfillBody {
  dryRun?:    boolean;
  tenantId?:  string;
  orderIds?:  string[];
}

interface OrderResult {
  orderId:                  string;
  dtIdentifier:             string;
  tenantId:                 string;
  releaseDate:              string;
  itemsToRelease:           Array<{ itemId: string; inventoryId: string }>;
  itemsAlreadyReleased:     string[];   // Item IDs
  itemsSkippedNotDelivered: string[];   // Item IDs
  itemsSkippedNoInventory:  string[];   // dt_item_codes that didn't resolve
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST')    return json({ ok: false, error: 'Method not allowed' }, 405);

  let body: BackfillBody;
  try { body = await req.json(); }
  catch { return json({ ok: false, error: 'Invalid JSON body' }, 400); }

  const dryRun     = body.dryRun !== false;  // default true
  const tenantId   = body.tenantId  ? String(body.tenantId).trim()  : null;
  const orderIds   = Array.isArray(body.orderIds) ? body.orderIds.map(String) : null;

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const gasUrl      = Deno.env.get('GAS_API_URL') ?? '';
  const gasToken    = Deno.env.get('GAS_API_TOKEN') ?? '';
  if (!supabaseUrl || !serviceKey) {
    return json({ ok: false, error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' }, 500);
  }
  if (!dryRun && (!gasUrl || !gasToken)) {
    return json({ ok: false, error: 'Missing GAS_API_URL / GAS_API_TOKEN — required for real run (dry-run does not need them)' }, 500);
  }

  // Belt-and-braces: verify_jwt=false makes the function URL-callable
  // by anyone who knows the URL. Lock the destructive (non-dry-run)
  // path behind a shared secret stored as a Supabase secret. Dry-run
  // stays open since it's read-only. If the env var isn't set the
  // function refuses real runs entirely — operator must configure
  // BACKFILL_ADMIN_TOKEN in the Supabase dashboard before first apply.
  if (!dryRun) {
    const adminTokenExpected = Deno.env.get('BACKFILL_ADMIN_TOKEN') ?? '';
    const adminTokenProvided = String((body as unknown as { adminToken?: string }).adminToken ?? '').trim();
    if (!adminTokenExpected) {
      return json({ ok: false, error: 'BACKFILL_ADMIN_TOKEN env var not configured — set it on the edge function before running with dryRun=false' }, 500);
    }
    if (adminTokenProvided !== adminTokenExpected) {
      return json({ ok: false, error: 'adminToken required and must match BACKFILL_ADMIN_TOKEN. Pass it in the JSON body.' }, 401);
    }
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // ── 1. Find eligible orders ────────────────────────────────────────
  let ordersQuery = supabase
    .from('dt_orders')
    .select('id, tenant_id, dt_identifier, local_service_date')
    .eq('status_id', 3)
    .eq('is_pickup', false)
    .not('tenant_id', 'is', null)
    .not('local_service_date', 'is', null);
  if (tenantId) ordersQuery = ordersQuery.eq('tenant_id', tenantId);
  if (orderIds && orderIds.length > 0) ordersQuery = ordersQuery.in('id', orderIds);

  const { data: orders, error: ordersErr } = await ordersQuery;
  if (ordersErr) return json({ ok: false, error: `orders query failed: ${ordersErr.message}` }, 500);
  if (!orders || orders.length === 0) {
    return json({
      ok:      true,
      dryRun,
      summary: { orders_processed: 0, items_would_release: 0 },
      per_order: [],
    });
  }

  // ── 2. Per-order: find items, resolve inventory status, classify ───
  const perOrder: OrderResult[] = [];
  type ReleaseTuple = { tenantId: string; orderId: string; dtIdentifier: string; releaseDate: string; inventoryId: string; itemId: string };
  const allReleaseTuples: ReleaseTuple[] = [];

  for (const order of orders as Array<{ id: string; tenant_id: string; dt_identifier: string; local_service_date: string }>) {
    // Items on this order that have a resolved inventory FK + delivered=true.
    const { data: items } = await supabase
      .from('dt_order_items')
      .select('id, inventory_id, dt_item_code, delivered')
      .eq('dt_order_id', order.id);

    if (!items || items.length === 0) continue;

    type Item = { id: string; inventory_id: string | null; dt_item_code: string | null; delivered: boolean | null };
    const rows = items as Item[];

    // Bucket by delivery + inventory linkage. Inventory status comes
    // from a single batch lookup keyed by the linked UUIDs.
    const eligibleInvIds = rows
      .filter(r => r.inventory_id != null && r.delivered === true)
      .map(r => r.inventory_id!) as string[];

    const itemsSkippedNotDelivered = rows
      .filter(r => r.inventory_id != null && r.delivered !== true)
      .map(r => r.dt_item_code ?? r.inventory_id!) as string[];
    const itemsSkippedNoInventory = rows
      .filter(r => r.inventory_id == null && r.dt_item_code)
      .map(r => r.dt_item_code!) as string[];

    if (eligibleInvIds.length === 0) {
      perOrder.push({
        orderId:                  order.id,
        dtIdentifier:             order.dt_identifier,
        tenantId:                 order.tenant_id,
        releaseDate:              order.local_service_date,
        itemsToRelease:           [],
        itemsAlreadyReleased:     [],
        itemsSkippedNotDelivered,
        itemsSkippedNoInventory,
      });
      continue;
    }

    const { data: invRows } = await supabase
      .from('inventory')
      .select('id, item_id, status')
      .in('id', eligibleInvIds);

    const invByUuid = new Map(
      ((invRows ?? []) as Array<{ id: string; item_id: string; status: string | null }>)
        .map(r => [r.id, r])
    );

    const itemsToRelease: Array<{ itemId: string; inventoryId: string }> = [];
    const itemsAlreadyReleased: string[] = [];

    for (const invId of eligibleInvIds) {
      const inv = invByUuid.get(invId);
      if (!inv) continue;  // FK pointed at deleted row — drop silently
      const status = (inv.status ?? 'Active').trim();
      if (status === 'Released') {
        itemsAlreadyReleased.push(inv.item_id);
      } else if (status === 'Active') {
        itemsToRelease.push({ itemId: inv.item_id, inventoryId: inv.id });
        allReleaseTuples.push({
          tenantId:     order.tenant_id,
          orderId:      order.id,
          dtIdentifier: order.dt_identifier,
          releaseDate:  order.local_service_date,
          inventoryId:  inv.id,
          itemId:       inv.item_id,
        });
      }
      // 'On Hold' / 'Transferred' / other — skip silently, not eligible.
    }

    perOrder.push({
      orderId:                  order.id,
      dtIdentifier:             order.dt_identifier,
      tenantId:                 order.tenant_id,
      releaseDate:              order.local_service_date,
      itemsToRelease,
      itemsAlreadyReleased,
      itemsSkippedNotDelivered,
      itemsSkippedNoInventory,
    });
  }

  const summary = {
    orders_processed:             orders.length,
    orders_with_releases:         perOrder.filter(p => p.itemsToRelease.length > 0).length,
    items_would_release:          allReleaseTuples.length,
    items_already_released:       perOrder.reduce((s, p) => s + p.itemsAlreadyReleased.length, 0),
    items_skipped_not_delivered:  perOrder.reduce((s, p) => s + p.itemsSkippedNotDelivered.length, 0),
    items_skipped_no_inventory:   perOrder.reduce((s, p) => s + p.itemsSkippedNoInventory.length, 0),
    tenants_affected:             new Set(allReleaseTuples.map(t => t.tenantId)).size,
  };

  // ── 3. Dry-run? Return preview. ────────────────────────────────────
  if (dryRun) {
    return json({ ok: true, dryRun: true, summary, per_order: perOrder });
  }

  // ── 4. Real run — Supabase writes first ────────────────────────────
  // Group by (tenant_id, release_date) so each UPDATE writes a
  // consistent release_date. The .neq('status', 'Released') clause
  // is the server-side idempotency guard — re-running this function
  // on the same data is a clean no-op.
  type GroupKey = string;
  const groups = new Map<GroupKey, ReleaseTuple[]>();
  for (const t of allReleaseTuples) {
    const key: GroupKey = `${t.tenantId}::${t.releaseDate}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }

  const updateSucceeded: ReleaseTuple[] = [];
  const updateFailed:    Array<{ tenantId: string; releaseDate: string; error: string; itemIds: string[] }> = [];

  for (const [, group] of groups) {
    const { tenantId: gTenant, releaseDate: gDate } = group[0];
    const invIds = group.map(g => g.inventoryId);
    // .select('id') returns only the rows that actually flipped — the
    // .neq('status', 'Released') filter excludes rows that were
    // already Released, so the returned set is the true set of
    // writes. Counting `group` directly would inflate
    // items_supabase_updated by phantom "already Released" rows that
    // the server-side filter dropped.
    const { data: updatedRows, error: updErr } = await supabase
      .from('inventory')
      .update({ status: 'Released', release_date: gDate })
      .eq('tenant_id', gTenant)
      .in('id', invIds)
      .neq('status', 'Released')
      .select('id');
    if (updErr) {
      updateFailed.push({ tenantId: gTenant, releaseDate: gDate, error: updErr.message, itemIds: group.map(g => g.itemId) });
      continue;
    }
    const flippedIds = new Set(((updatedRows ?? []) as Array<{ id: string }>).map(r => r.id));
    for (const t of group) {
      if (flippedIds.has(t.inventoryId)) updateSucceeded.push(t);
    }
  }

  // ── 5. entity_audit_log — one row per order whose Supabase UPDATE
  //      actually flipped at least one row. Sourcing this from
  //      updateSucceeded (vs. perOrder) avoids audit-logging a
  //      release that the database refused.
  const succeededByOrder = new Map<string, ReleaseTuple[]>();
  for (const t of updateSucceeded) {
    if (!succeededByOrder.has(t.orderId)) succeededByOrder.set(t.orderId, []);
    succeededByOrder.get(t.orderId)!.push(t);
  }
  for (const [orderId, tuples] of succeededByOrder) {
    if (tuples.length === 0) continue;
    const first = tuples[0];
    await supabase.from('entity_audit_log').insert({
      entity_type:  'dt_order',
      entity_id:    orderId,
      tenant_id:    first.tenantId,
      action:       'release_items',
      changes: {
        itemIds:       tuples.map(t => t.itemId),
        inventoryIds:  tuples.map(t => t.inventoryId),
        releaseDate:   first.releaseDate,
        releasedCount: tuples.length,
        source:        'backfill_dt_finished',
      },
      performed_by: 'backfill-dt-finished-releases',
      source:       'edge',
    });
  }

  // ── 6. GAS bulk mirror — one call per tenant ───────────────────────
  // Group succeeded tuples by tenant; one HTTP POST per tenant
  // mirrors all that tenant's items into the per-tenant Inventory
  // sheet via handleMirrorInventoryReleaseBulk_.
  const perTenant = new Map<string, ReleaseTuple[]>();
  for (const t of updateSucceeded) {
    if (!perTenant.has(t.tenantId)) perTenant.set(t.tenantId, []);
    perTenant.get(t.tenantId)!.push(t);
  }

  const mirrorResults: Array<{ tenantId: string; ok: boolean; updated?: number; alreadyReleased?: string[]; notFound?: string[]; error?: string }> = [];
  for (const [tId, tuples] of perTenant) {
    const items = tuples.map(t => ({ itemId: t.itemId, releaseDate: t.releaseDate }));
    try {
      const url = `${gasUrl}?action=mirrorInventoryReleaseBulk&token=${encodeURIComponent(gasToken)}`;
      const resp = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ tenantId: tId, items }),
      });
      const txt = await resp.text();
      let parsed: { success?: boolean; updatedCount?: number; alreadyReleased?: string[]; notFound?: string[]; error?: string };
      try { parsed = JSON.parse(txt); }
      catch { parsed = { success: false, error: `non-JSON response: ${txt.slice(0, 300)}` }; }

      if (!resp.ok || !parsed.success) {
        const errMsg = parsed.error ?? `HTTP ${resp.status}`;
        mirrorResults.push({ tenantId: tId, ok: false, error: errMsg });
        // Land in gs_sync_events so the FailedOperationsDrawer surfaces it.
        await supabase.from('gs_sync_events').insert({
          tenant_id:     tId,
          entity_type:   'inventory',
          entity_id:     items[0]?.itemId ?? '',
          action_type:   'mirror_inventory_release_bulk',
          sync_status:   'sync_failed',
          requested_by:  'backfill-dt-finished-releases',
          request_id:    crypto.randomUUID(),
          payload:       { tenantId: tId, items },
          error_message: errMsg.slice(0, 1000),
        });
      } else {
        mirrorResults.push({
          tenantId:        tId,
          ok:              true,
          updated:         parsed.updatedCount ?? 0,
          alreadyReleased: parsed.alreadyReleased ?? [],
          notFound:        parsed.notFound ?? [],
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      mirrorResults.push({ tenantId: tId, ok: false, error: msg });
      await supabase.from('gs_sync_events').insert({
        tenant_id:     tId,
        entity_type:   'inventory',
        entity_id:     items[0]?.itemId ?? '',
        action_type:   'mirror_inventory_release_bulk',
        sync_status:   'sync_failed',
        requested_by:  'backfill-dt-finished-releases',
        request_id:    crypto.randomUUID(),
        payload:       { tenantId: tId, items },
        error_message: msg.slice(0, 1000),
      });
    }
  }

  // Top-level `ok` reflects whether EVERY step succeeded — Supabase
  // writes AND every per-tenant sheet mirror. A partial failure
  // (e.g. one tenant's GAS sync timed out) returns `ok: false` even
  // though most of the work landed; the `summary` + `mirror_results`
  // arrays carry the breakdown so callers branching on `ok` get a
  // signal that matches reality. Sheet-mirror failures also have a
  // gs_sync_events row for the FailedOperationsDrawer to retry.
  const anyFailure = updateFailed.length > 0 || mirrorResults.some(r => !r.ok);
  return json({
    ok: !anyFailure,
    dryRun: false,
    summary: {
      ...summary,
      items_supabase_updated: updateSucceeded.length,
      supabase_update_failures: updateFailed,
      tenants_mirrored:       mirrorResults.filter(r => r.ok).length,
      tenants_mirror_failed:  mirrorResults.filter(r => !r.ok).length,
    },
    mirror_results: mirrorResults,
    per_order: perOrder,
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
