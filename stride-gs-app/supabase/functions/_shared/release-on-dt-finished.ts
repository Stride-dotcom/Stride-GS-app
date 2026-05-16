/**
 * release-on-dt-finished — shared helper for the going-forward
 * auto-release path. Imported by both `dt-webhook-ingest` (real-time
 * trigger) and `dt-sync-statuses` (safety-net poll trigger) so the
 * same logic fires regardless of how DT's status transition reaches
 * us. Idempotent on Supabase via `.neq('status','Released')` so
 * double-fires (webhook + sync racing) are clean no-ops.
 *
 * Sibling to the PR #1 manual flow (`DtOrderReleasePanel`) and the
 * PR #2-companion backfill (`backfill-dt-finished-releases`). Same
 * write path, different entry point — the audit-log entry's
 * `source` field carries 'dt_finished' (vs 'manual' / 'backfill_dt_finished')
 * so the order's Activity tab distinguishes them.
 *
 * Contract:
 *   • Caller has already updated the order's status_id to 3 (Completed).
 *   • Helper validates eligibility (status, order_type, tenant_id,
 *     local_service_date, items) and silently no-ops on ineligible.
 *   • Helper does NOT throw; it returns a structured result so the
 *     caller can log + continue. A release failure here must not
 *     unwind the caller's status update.
 *
 * Release-date stamp: `local_service_date` (the scheduled service
 * date) — same as the manual + backfill paths. `finished_at` is
 * unreliable historically (the column has been NULL on every order
 * to date because of a missing DT-side tag in the export.xml).
 * Storage billing reads release_date over a date range so the
 * scheduled date is the cleanest proxy.
 *
 * Pickup-leg orders never release. `order_type === 'pickup'` means
 * items came TO our warehouse, not from it. Service-only orders
 * have no inventory-linked items, so they fall through naturally.
 *
 * Per-item filter: `dt_order_items.delivered = true`. Items where
 * the driver marked refused / short / damaged stay Active; the
 * helper posts an `entity_notes` row on the order summarizing them
 * so staff can review and decide whether to release manually.
 */

import type { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type SBClient = ReturnType<typeof createClient>;

const DT_COMPLETED_STATUS_ID = 3;

export interface ReleaseOnFinishedOptions {
  supabase:   SBClient;
  gasUrl:     string | null | undefined;
  gasToken:   string | null | undefined;
  dtOrderId:  string;
  /** Distinguishes the trigger source on entity_audit_log. */
  source:     'dt_webhook' | 'dt_sync' | 'manual_replay';
}

export interface ReleaseOnFinishedResult {
  /** True when the helper did real work (released ≥1 item). */
  fired: boolean;
  /** Set when the helper bailed early. Caller logs this for telemetry. */
  skippedReason?: string;
  /** Counts. items_released is the actually-flipped set, not the candidate set. */
  itemsReleased:           number;
  itemsAlreadyReleased:    number;
  itemsSkippedNotDelivered: number;
  itemsSkippedNoInventory:  number;
  /** True when the GAS sheet mirror succeeded (or wasn't attempted). */
  mirrorOk: boolean;
  mirrorError?: string;
}

export async function releaseInventoryOnDtFinished(
  opts: ReleaseOnFinishedOptions,
): Promise<ReleaseOnFinishedResult> {
  const { supabase, gasUrl, gasToken, dtOrderId, source } = opts;

  const skip = (reason: string): ReleaseOnFinishedResult => ({
    fired: false,
    skippedReason: reason,
    itemsReleased: 0,
    itemsAlreadyReleased: 0,
    itemsSkippedNotDelivered: 0,
    itemsSkippedNoInventory: 0,
    mirrorOk: true,
  });

  // ── 1. Load + validate the order ─────────────────────────────────
  const { data: order, error: orderErr } = await supabase
    .from('dt_orders')
    .select('id, tenant_id, dt_identifier, order_type, status_id, local_service_date')
    .eq('id', dtOrderId)
    .maybeSingle();
  if (orderErr || !order) {
    return skip(`order_lookup_failed:${orderErr?.message ?? 'not_found'}`);
  }
  const o = order as {
    id: string; tenant_id: string | null; dt_identifier: string | null;
    order_type: string | null; status_id: number | null; local_service_date: string | null;
  };

  if (o.status_id !== DT_COMPLETED_STATUS_ID) {
    return skip(`status_not_completed:${o.status_id}`);
  }
  if (!o.tenant_id) {
    return skip('tenant_id_missing');  // public-form orphans, never auto-release
  }
  if (o.order_type === 'pickup') {
    return skip('order_type_pickup');  // inbound — items came TO us
  }
  if (!o.local_service_date) {
    return skip('local_service_date_missing');
  }

  const releaseDate = String(o.local_service_date).slice(0, 10);

  // ── 2. Load items + classify ─────────────────────────────────────
  const { data: items } = await supabase
    .from('dt_order_items')
    .select('inventory_id, dt_item_code, delivered, delivered_quantity')
    .eq('dt_order_id', o.id);

  type ItemRow = {
    inventory_id: string | null;
    dt_item_code: string | null;
    delivered: boolean | null;
    delivered_quantity: number | null;
  };
  const rows = (items ?? []) as ItemRow[];
  if (rows.length === 0) return skip('no_items');

  const eligibleInvIds: string[] = [];
  const skippedNotDeliveredItemIds: string[] = [];
  let skippedNoInventoryCount = 0;
  for (const r of rows) {
    if (!r.inventory_id) {
      if (r.dt_item_code) skippedNoInventoryCount += 1;
      continue;
    }
    // An item counts as delivered when the driver flipped the
    // boolean OR recorded a positive delivered_quantity. Some DT
    // workflows stamp the quantity without the boolean (partial /
    // qty-based completion), so the boolean-only check stranded
    // those as never-released.
    const isDelivered = r.delivered === true || (r.delivered_quantity ?? 0) > 0;
    if (isDelivered) {
      eligibleInvIds.push(r.inventory_id);
    } else {
      skippedNotDeliveredItemIds.push(r.dt_item_code ?? r.inventory_id);
    }
  }

  if (eligibleInvIds.length === 0) {
    // Still post a note for skipped-not-delivered so staff sees the
    // exception even when the order has zero auto-releasable items.
    if (skippedNotDeliveredItemIds.length > 0) {
      await postSkippedNote(
        supabase, o.id, o.tenant_id,
        skippedNotDeliveredItemIds, source,
      );
    }
    return skip('no_eligible_items');
  }

  // ── 3. Resolve current inventory status for the candidates ────────
  const { data: invRows } = await supabase
    .from('inventory')
    .select('id, item_id, status')
    .in('id', eligibleInvIds);

  const invByUuid = new Map(
    ((invRows ?? []) as Array<{ id: string; item_id: string; status: string | null }>)
      .map(r => [r.id, r])
  );

  const toReleaseInvIds: string[] = [];
  const toReleaseItemIds: string[] = [];
  let alreadyReleasedCount = 0;
  for (const invId of eligibleInvIds) {
    const inv = invByUuid.get(invId);
    if (!inv) continue;  // FK pointed at a deleted/transferred row
    const status = (inv.status ?? 'Active').trim();
    if (status === 'Released') { alreadyReleasedCount += 1; continue; }
    if (status !== 'Active')   continue;  // On Hold / Transferred — not eligible
    toReleaseInvIds.push(inv.id);
    toReleaseItemIds.push(inv.item_id);
  }

  // ── 4. Idempotent Supabase update ────────────────────────────────
  if (toReleaseInvIds.length === 0) {
    // Nothing to flip but maybe still a skipped-items note to post.
    if (skippedNotDeliveredItemIds.length > 0) {
      await postSkippedNote(
        supabase, o.id, o.tenant_id,
        skippedNotDeliveredItemIds, source,
      );
    }
    return {
      fired: false,
      skippedReason: 'all_items_already_released_or_ineligible',
      itemsReleased: 0,
      itemsAlreadyReleased: alreadyReleasedCount,
      itemsSkippedNotDelivered: skippedNotDeliveredItemIds.length,
      itemsSkippedNoInventory: skippedNoInventoryCount,
      mirrorOk: true,
    };
  }

  const { data: updatedRows, error: updErr } = await supabase
    .from('inventory')
    .update({ status: 'Released', release_date: releaseDate })
    .eq('tenant_id', o.tenant_id)
    .in('id', toReleaseInvIds)
    .neq('status', 'Released')
    .select('id, item_id');
  if (updErr) {
    return {
      fired: false,
      skippedReason: `inventory_update_failed:${updErr.message}`,
      itemsReleased: 0,
      itemsAlreadyReleased: alreadyReleasedCount,
      itemsSkippedNotDelivered: skippedNotDeliveredItemIds.length,
      itemsSkippedNoInventory: skippedNoInventoryCount,
      mirrorOk: true,
    };
  }

  const flipped = ((updatedRows ?? []) as Array<{ id: string; item_id: string }>);
  const flippedInvIds   = flipped.map(r => r.id);
  const flippedItemIds  = flipped.map(r => r.item_id);

  // ── 5. entity_audit_log — one row per release event ──────────────
  if (flipped.length > 0) {
    await supabase.from('entity_audit_log').insert({
      entity_type:  'dt_order',
      entity_id:    o.id,
      tenant_id:    o.tenant_id,
      action:       'release_items',
      changes: {
        itemIds:       flippedItemIds,
        inventoryIds:  flippedInvIds,
        releaseDate,
        releasedCount: flipped.length,
        source:        source === 'dt_webhook' ? 'dt_finished_webhook'
                     : source === 'dt_sync'    ? 'dt_finished_sync'
                     : 'dt_finished_manual_replay',
        dtIdentifier:  o.dt_identifier,
      },
      performed_by: `auto:${source}`,
      source:       'edge',
    });
  }

  // ── 6. entity_notes for skipped-not-delivered items ──────────────
  // Only when there are actually skipped items — keeps the order's
  // Notes tab clean on the happy path.
  if (skippedNotDeliveredItemIds.length > 0) {
    await postSkippedNote(
      supabase, o.id, o.tenant_id,
      skippedNotDeliveredItemIds, source,
    );
  }

  // ── 7. GAS bulk sheet mirror (one tenant, one call) ──────────────
  let mirrorOk = true;
  let mirrorError: string | undefined;
  if (gasUrl && gasToken && flipped.length > 0) {
    try {
      const url = `${gasUrl}?action=mirrorInventoryReleaseBulk&token=${encodeURIComponent(gasToken)}`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: o.tenant_id,
          items: flippedItemIds.map(itemId => ({ itemId, releaseDate })),
        }),
      });
      const txt = await resp.text();
      let parsed: { success?: boolean; error?: string } = {};
      try { parsed = JSON.parse(txt); }
      catch { parsed = { success: false, error: `non-JSON: ${txt.slice(0, 300)}` }; }
      if (!resp.ok || !parsed.success) {
        mirrorOk = false;
        mirrorError = parsed.error ?? `HTTP ${resp.status}`;
        await logSyncFailed(supabase, o.tenant_id, flippedItemIds[0] ?? '', mirrorError, {
          tenantId: o.tenant_id,
          items: flippedItemIds.map(itemId => ({ itemId, releaseDate })),
        }, source);
      }
    } catch (e) {
      mirrorOk = false;
      mirrorError = e instanceof Error ? e.message : String(e);
      await logSyncFailed(supabase, o.tenant_id, flippedItemIds[0] ?? '', mirrorError, {
        tenantId: o.tenant_id,
        items: flippedItemIds.map(itemId => ({ itemId, releaseDate })),
      }, source);
    }
  } else if (flipped.length > 0 && (!gasUrl || !gasToken)) {
    // Caller didn't provide GAS creds — Supabase write succeeded but
    // the sheet won't be mirrored. Log to gs_sync_events so
    // FailedOperationsDrawer surfaces it for manual retry.
    mirrorOk = false;
    mirrorError = 'GAS_API_URL or GAS_API_TOKEN missing on caller';
    await logSyncFailed(supabase, o.tenant_id, flippedItemIds[0] ?? '', mirrorError, {
      tenantId: o.tenant_id,
      items: flippedItemIds.map(itemId => ({ itemId, releaseDate })),
    }, source);
  }

  return {
    fired: true,
    itemsReleased:           flipped.length,
    itemsAlreadyReleased:    alreadyReleasedCount,
    itemsSkippedNotDelivered: skippedNotDeliveredItemIds.length,
    itemsSkippedNoInventory:  skippedNoInventoryCount,
    mirrorOk,
    mirrorError,
  };
}

async function postSkippedNote(
  supabase: SBClient,
  orderId: string,
  tenantId: string,
  skippedItemIds: string[],
  source: ReleaseOnFinishedOptions['source'],
): Promise<void> {
  // Idempotency: don't duplicate the note if a previous webhook/sync
  // already posted one for this same set. The dedup key is order +
  // sorted item ids. Skip when an identical note already exists.
  const sortedIds = [...skippedItemIds].sort();
  const noteKey = `auto_release_skipped:${sortedIds.join(',')}`;
  const { data: existing } = await supabase
    .from('entity_notes')
    .select('id')
    .eq('entity_type', 'dt_order')
    .eq('entity_id', orderId)
    .eq('note_type', noteKey)
    .limit(1)
    .maybeSingle();
  if (existing) return;

  const body = [
    `Auto-release skipped ${skippedItemIds.length} item${skippedItemIds.length === 1 ? '' : 's'} because driver did not mark them delivered:`,
    '',
    ...sortedIds.map(id => `  • ${id}`),
    '',
    'These items remain Active. If the recipient accepted them after all, use the manual Release Items button.',
  ].join('\n');

  await supabase.from('entity_notes').insert({
    entity_type: 'dt_order',
    entity_id:   orderId,
    tenant_id:   tenantId,
    body,
    note_type:   noteKey,
    visibility:  'internal',
    author_role: 'system',
    author_name: `auto:${source}`,
    is_system:   true,
  });
}

async function logSyncFailed(
  supabase: SBClient,
  tenantId: string,
  entityId: string,
  errorMessage: string,
  payload: Record<string, unknown>,
  source: ReleaseOnFinishedOptions['source'],
): Promise<void> {
  await supabase.from('gs_sync_events').insert({
    tenant_id:     tenantId,
    entity_type:   'inventory',
    entity_id:     entityId,
    action_type:   'mirror_inventory_release_bulk',
    sync_status:   'sync_failed',
    requested_by:  `auto-release:${source}`,
    request_id:    crypto.randomUUID(),
    payload,
    error_message: errorMessage.slice(0, 1000),
  });
}
