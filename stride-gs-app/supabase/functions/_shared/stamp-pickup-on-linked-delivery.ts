/**
 * stamp-pickup-on-linked-delivery — shared helper that propagates a
 * completed pickup leg's metadata onto the linked delivery order.
 *
 * Two propagation tiers (controlled by `propagateItemFields`):
 *
 *   • Tier A — order-level + picked_up_at stamps (cheap, idempotent).
 *     Fired by both the webhook path (notify-pickup-completed) and
 *     the sync path (dt-sync-statuses).
 *
 *   • Tier B — per-item field propagation (qty / item_note / return_codes
 *     from PU → Delivery item). Fired ONLY by the sync path because the
 *     PU items must already have export.xml-fresh values, which the
 *     webhook payload doesn't carry. Returns the list of changed
 *     delivery item IDs so the caller can fire a dt-push-order delta
 *     back to DT.
 *
 * Per-item matching: prefers `parent_pickup_item_id` FK set on the
 * delivery item by CreateDeliveryOrderModal (forward path) or the
 * description-match backfill (historical). Falls back to `dt_item_code`
 * for picked_up_at ONLY — never for Tier-B field writes, since
 * dt_item_code is unreliable across orders (DT regenerates UUIDs).
 *
 * Blanket pass (2026-05-29): when the pickup order completes, any
 * remaining delivery items still unstamped after the FK + code passes
 * receive picked_up_at + a default pickup_delivered_quantity (= item
 * quantity) + pickup_return_codes = ['Pick Up']. Closes the silent-skip
 * class for delivery items created without a pickup-side counterpart.
 *
 * Leg-aware (2026-05-30): when the linked delivery has more than one
 * pickup leg (dt_pickup_links rows), the blanket pass scopes its
 * writes to items belonging to THIS leg only — items with
 * `pickup_leg_id` matching the completing leg's link id, OR whose
 * `parent_pickup_item_id` points at a pickup item from this pickup
 * order. Items without either marker stay untouched so the next
 * leg's completion can stamp them when its turn comes. If NO items
 * on the delivery have pickup_leg_id set (legacy orders pre-
 * migration 20260530140000), the blanket pass falls back to the
 * original "stamp every unstamped item" behaviour — same as
 * single-pickup orders before the multi-leg work.
 *
 * Order-level merge rules (so the poll path can correct the webhook
 * path without overwriting good data with NULL):
 *   linked_pickup_finished_at = COALESCE(pickup.finished_at, now())
 *   linked_pickup_driver_name = pickup.driver_name when not null,
 *     else preserve existing.
 *
 * Idempotency:
 *   • picked_up_at — WHERE picked_up_at IS NULL (first write wins).
 *   • quantity — overwrite each run (safe; pickup.delivered_quantity
 *     is the post-PU reality and converges).
 *   • item_note — sentinel-marker strip-then-prepend (so re-runs
 *     don't accumulate "[FROM PICKUP] …" blocks).
 *
 * Helper never throws. Returns structured result for telemetry.
 */

import type { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type SBClient = ReturnType<typeof createClient>;

const DT_COMPLETED_STATUS_ID = 3;

export interface StampPickupOptions {
  supabase: SBClient;
  /** UUID of the *pickup* dt_orders row that just completed. */
  pickupOrderId: string;
  /** Telemetry tag for which entry point fired. */
  source: 'webhook' | 'sync' | 'manual_replay';
  /**
   * Tier B switch. When true, propagate per-item field values from
   * PU items → Delivery items (quantity, item_note, return_codes).
   * Should only be true when caller has fresh DT data on the PU
   * items (i.e. dt-sync-statuses has just upserted them). Webhook
   * callers should pass false.
   */
  propagateItemFields?: boolean;
}

export interface StampPickupResult {
  fired: boolean;
  skippedReason?: string;
  linkedDeliveryId?: string;
  itemsStamped: number;
  itemsEligibleOnPickup: number;
  orderLevelStamped: boolean;
  /** Delivery item IDs whose quantity / item_note changed in Tier B.
   *  Caller uses these to decide whether to fire a delivery push-back. */
  itemsPropagated: string[];
}

interface PickupItemRow {
  id: string;
  dt_item_code: string | null;
  delivered: boolean | null;
  delivered_quantity: number | null;
  item_note: string | null;
  return_codes: unknown;
  removed_at: string | null;
}

interface DeliveryItemRow {
  id: string;
  parent_pickup_item_id: string | null;
  pickup_leg_id: string | null;
  /** Warehouse-origin marker. When set, this delivery item resolved to
   *  an inventory row — either selected from inventory in
   *  CreateDeliveryOrderModal (`inventory_id: i.inventoryRowId`) or
   *  auto-stamped by the dt_order_items_resolve_inventory_id_trg
   *  BEFORE-INSERT/UPDATE trigger when dt_item_code matches an inventory
   *  item_id (migration 20260512230000). Either way it is warehouse
   *  stock, not a picked-up piece, so it was NOT picked up on any leg.
   *  Picked-up items round-trip through DT with a hex-UUID-prefix code
   *  that never resolves to inventory, so they leave this NULL. */
  inventory_id: string | null;
  dt_item_code: string | null;
  quantity: number | null;
  original_quantity: number | null;
  item_note: string | null;
  picked_up_at: string | null;
  pickup_item_note: string | null;
  pickup_return_codes: unknown;
  pickup_delivered_quantity: number | null;
}

export async function stampPickupOnLinkedDelivery(
  opts: StampPickupOptions,
): Promise<StampPickupResult> {
  const { supabase, pickupOrderId, propagateItemFields = false } = opts;

  const skip = (reason: string): StampPickupResult => ({
    fired: false,
    skippedReason: reason,
    itemsStamped: 0,
    itemsEligibleOnPickup: 0,
    orderLevelStamped: false,
    itemsPropagated: [],
  });

  // ── 1. Load + validate the PICKUP order ───────────────────────────
  const { data: pickup, error: pickupErr } = await supabase
    .from('dt_orders')
    .select('id, tenant_id, dt_identifier, order_type, status_id, linked_order_id, finished_at, driver_name')
    .eq('id', pickupOrderId)
    .maybeSingle();
  if (pickupErr || !pickup) {
    return skip(`pickup_lookup_failed:${pickupErr?.message ?? 'not_found'}`);
  }
  const p = pickup as {
    id: string; tenant_id: string | null; dt_identifier: string | null;
    order_type: string | null; status_id: number | null;
    linked_order_id: string | null;
    finished_at: string | null; driver_name: string | null;
  };

  if (p.order_type !== 'pickup') return skip(`order_type_not_pickup:${p.order_type}`);
  if (p.status_id !== DT_COMPLETED_STATUS_ID) return skip(`status_not_completed:${p.status_id}`);
  if (!p.tenant_id) return skip('tenant_id_missing');
  if (!p.linked_order_id) return skip('no_linked_delivery');

  // ── 2. Confirm the linked delivery exists in the same tenant ─────
  const { data: delivery, error: deliveryErr } = await supabase
    .from('dt_orders')
    .select('id, tenant_id, order_type, linked_pickup_finished_at, linked_pickup_driver_name')
    .eq('id', p.linked_order_id)
    .maybeSingle();
  if (deliveryErr || !delivery) {
    return skip(`linked_delivery_lookup_failed:${deliveryErr?.message ?? 'not_found'}`);
  }
  const d = delivery as {
    id: string; tenant_id: string | null; order_type: string | null;
    linked_pickup_finished_at: string | null; linked_pickup_driver_name: string | null;
  };
  if (d.tenant_id !== p.tenant_id) return skip('tenant_mismatch');
  if (d.order_type === 'pickup') return skip('linked_row_also_pickup');

  // ── 3. Order-level stamp ─────────────────────────────────────────
  const finishedAt = p.finished_at ?? new Date().toISOString();
  const driverName = p.driver_name && p.driver_name.trim() ? p.driver_name.trim() : null;

  const orderPatch: Record<string, string> = { linked_pickup_finished_at: finishedAt };
  if (driverName) orderPatch.linked_pickup_driver_name = driverName;

  const { error: orderErr } = await supabase
    .from('dt_orders')
    .update(orderPatch)
    .eq('id', d.id)
    .eq('tenant_id', p.tenant_id);
  const orderLevelStamped = !orderErr;

  // ── 4. Load PU items + Delivery items + this pickup's link row ───
  // The link row is needed to scope the blanket pass to items
  // belonging to THIS leg only (multi-pickup orders). Loaded in
  // parallel with items so the round-trip cost is one RTT.
  const [pickupItemsRes, deliveryItemsRes, linkRowRes] = await Promise.all([
    supabase
      .from('dt_order_items')
      .select('id, dt_item_code, delivered, delivered_quantity, item_note, return_codes, removed_at')
      .eq('dt_order_id', p.id)
      .is('removed_at', null),
    supabase
      .from('dt_order_items')
      .select('id, parent_pickup_item_id, pickup_leg_id, inventory_id, dt_item_code, quantity, original_quantity, item_note, picked_up_at, pickup_item_note, pickup_return_codes, pickup_delivered_quantity')
      .eq('dt_order_id', d.id)
      .is('removed_at', null),
    supabase
      .from('dt_pickup_links')
      .select('id')
      .eq('pickup_order_id', p.id)
      .maybeSingle(),
  ]);

  const pickupItems   = (pickupItemsRes.data   ?? []) as PickupItemRow[];
  const deliveryItems = (deliveryItemsRes.data ?? []) as DeliveryItemRow[];
  const thisLegId     = (linkRowRes.data as { id: string } | null)?.id ?? null;

  // Eligible PU items = delivered=true with non-empty content key
  const eligiblePickup = pickupItems.filter(r => r.delivered === true);
  const eligibleCount = eligiblePickup.length;

  // Build a lookup: pickup.id → pickup row
  const pickupById = new Map(pickupItems.map(r => [r.id, r]));

  // ── 5. picked_up_at — primary path via parent_pickup_item_id ─────
  // For delivery items linked via FK to a PU item that's delivered=true,
  // stamp picked_up_at. Fallback to dt_item_code for delivery items
  // whose FK is NULL (legacy/unbackfilled rows).
  const stampByFKIds: string[] = [];
  const stampByCodeCodes: string[] = [];
  for (const dit of deliveryItems) {
    if (dit.picked_up_at) continue;  // already stamped
    if (dit.parent_pickup_item_id) {
      const pu = pickupById.get(dit.parent_pickup_item_id);
      if (pu && pu.delivered === true) stampByFKIds.push(dit.id);
    } else if (dit.dt_item_code) {
      // Legacy match-by-code (less reliable; kept for unbackfilled rows)
      const code = dit.dt_item_code;
      if (eligiblePickup.some(pu => pu.dt_item_code === code)) {
        stampByCodeCodes.push(dit.id);
      }
    }
  }

  let itemsStamped = 0;
  if (stampByFKIds.length > 0) {
    const { data } = await supabase
      .from('dt_order_items')
      .update({ picked_up_at: finishedAt })
      .in('id', stampByFKIds)
      .is('picked_up_at', null)
      .select('id');
    itemsStamped += (data ?? []).length;
  }
  if (stampByCodeCodes.length > 0) {
    const { data } = await supabase
      .from('dt_order_items')
      .update({ picked_up_at: finishedAt })
      .in('id', stampByCodeCodes)
      .is('picked_up_at', null)
      .select('id');
    itemsStamped += (data ?? []).length;
  }

  // ── 5b. Blanket stamp — leg-aware (2026-05-30) ───────────────────
  //
  // When the pickup order reaches Completed, items on the linked
  // delivery that still have picked_up_at=NULL after the FK + code
  // passes get stamped — same defaults as before (picked_up_at,
  // pickup_delivered_quantity = dit.quantity, pickup_return_codes =
  // ['Pick Up']). The original blanket pass landed pre-multi-pickup
  // to fix JAS-00096-ROZE (1 of 9 items stamped). The leg-aware
  // refinement is necessary because the same blanket pass on a
  // multi-pickup order would stamp items belonging to a DIFFERENT
  // pickup leg that hasn't completed yet — falsely showing them as
  // picked up.
  //
  // Eligibility rule for the blanket pass:
  //   • If this delivery has a leg-tagged item population (any item
  //     with pickup_leg_id != NULL), only items where either:
  //       (a) pickup_leg_id === this leg's link id, OR
  //       (b) parent_pickup_item_id points at a pickup item from
  //           this pickup order (covers items that were tagged via
  //           the FK forward path before pickup_leg_id was wired in)
  //     are eligible. Items belonging to a different leg (or warehouse
  //     items with no leg tag) stay untouched until their leg fires.
  //   • If NO item on the delivery has pickup_leg_id set (legacy
  //     orders predating migration 20260530140000), the blanket pass
  //     falls back to the original "every unstamped item" behaviour —
  //     same coverage as today on single-pickup orders, since legacy
  //     orders are effectively single-pickup.
  //
  // Idempotent via `.is('picked_up_at', null)` — never overwrites a
  // prior stamp, and itemsStamped only counts rows where the WHERE
  // clause matched (rows already stamped this run don't double-count).
  //
  // Warehouse guard (2026-06-11): the blanket pass NEVER stamps an item
  // with `inventory_id` set. Such items resolved to warehouse inventory
  // (set in CreateDeliveryOrderModal or by the resolve_inventory_id
  // trigger when dt_item_code matches an inventory item_id) and were not picked up
  // on any leg, so the `!anyLegTagged → stamp all` legacy fallback must
  // not touch them. Without this guard a pickup_and_delivery order that
  // mixes a few picked-up items with many warehouse items stamps EVERY
  // warehouse item as "picked up by <driver>" the moment the pickup leg
  // completes (JOD-00168-D: 1 item picked up, but all 23 stamped — the
  // 20 warehouse items wrongly so). Picked-up items leave inventory_id
  // NULL, so the genuine-pickup population the blanket pass exists to
  // catch (JAS-00096-ROZE: FK/code matching missed real pickup items)
  // is unaffected.
  const matchedStampIds = new Set([...stampByFKIds, ...stampByCodeCodes]);
  const anyLegTagged = deliveryItems.some(dit => dit.pickup_leg_id != null);
  const pickupItemIdSet = new Set(pickupItems.map(pi => pi.id));
  const blanketCandidates = deliveryItems.filter(dit => {
    if (dit.picked_up_at) return false;
    if (matchedStampIds.has(dit.id)) return false;
    if (dit.inventory_id) return false;  // warehouse item — never picked up on a leg
    if (!anyLegTagged) return true;  // legacy fallback — stamp remaining pickup items
    // Leg-aware mode: item must belong to THIS leg.
    if (thisLegId && dit.pickup_leg_id === thisLegId) return true;
    if (dit.parent_pickup_item_id && pickupItemIdSet.has(dit.parent_pickup_item_id)) return true;
    return false;
  });
  for (const dit of blanketCandidates) {
    const { data } = await supabase
      .from('dt_order_items')
      .update({
        picked_up_at:              finishedAt,
        pickup_delivered_quantity: dit.quantity,
        pickup_return_codes:       ['Pick Up'],
      })
      .eq('id', dit.id)
      .is('picked_up_at', null)
      .select('id');
    if ((data ?? []).length > 0) itemsStamped += 1;
  }

  // ── 6. Tier B — per-item field propagation (sync path only) ──────
  const itemsPropagated: string[] = [];
  if (propagateItemFields) {
    for (const dit of deliveryItems) {
      if (!dit.parent_pickup_item_id) continue;  // no link → can't safely propagate
      const pu = pickupById.get(dit.parent_pickup_item_id);
      if (!pu || pu.delivered !== true) continue;  // PU not yet picked up
      const patch = buildItemPropagationPatch(pu, dit);
      if (!patch) continue;  // nothing changed
      const { error } = await supabase
        .from('dt_order_items')
        .update(patch)
        .eq('id', dit.id);
      if (!error) itemsPropagated.push(dit.id);
    }
  }

  return {
    fired: orderLevelStamped || itemsStamped > 0 || itemsPropagated.length > 0,
    linkedDeliveryId: d.id,
    itemsStamped,
    itemsEligibleOnPickup: eligibleCount,
    orderLevelStamped,
    itemsPropagated,
  };
}

/**
 * Compute the per-item patch when propagating PU → Delivery. Returns
 * null when nothing actually changed (skip the no-op write).
 *
 * Three independent fields are propagated. The delivery's own
 * `item_note` and `return_codes` are NEVER touched — those belong
 * to the delivery leg driver, and the merged-via-sentinel approach
 * in the first cut was brittle against user edits. Instead, the PU
 * values land in dedicated audit columns the UI can render as a
 * "From pickup" sub-row.
 *
 *   1. pickup_delivered_quantity ← pu.delivered_quantity
 *      (always overwrite; converges and is audit-only).
 *
 *   2. pickup_item_note          ← pu.item_note
 *      pickup_return_codes       ← pu.return_codes
 *      (always overwrite; mirror columns, no user edits expected).
 *
 *   3. quantity                  ← pu.delivered_quantity, but ONLY
 *      when the delivery item has not been manually edited. Heuristic:
 *      dit.quantity === dit.original_quantity. If staff has changed
 *      quantity post-creation, we leave it alone (their value wins)
 *      and only record the PU count in the audit column above. This
 *      prevents the "staff corrects qty, next sync silently reverts"
 *      footgun the code review flagged.
 */
function buildItemPropagationPatch(
  pu: PickupItemRow,
  dit: DeliveryItemRow,
): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};
  let dirty = false;

  // (1) audit-column quantity mirror
  if (pu.delivered_quantity != null) {
    const puQty = Number(pu.delivered_quantity);
    if (puQty !== Number(dit.pickup_delivered_quantity ?? -1)) {
      patch.pickup_delivered_quantity = puQty;
      dirty = true;
    }
  }

  // (2) audit-column notes + return codes mirror
  const puNoteRaw = (pu.item_note ?? '').trim() || null;
  if (puNoteRaw !== (dit.pickup_item_note ?? '').trim() && (puNoteRaw || dit.pickup_item_note)) {
    patch.pickup_item_note = puNoteRaw;
    dirty = true;
  }
  const puCodes = normalizeReturnCodes(pu.return_codes);
  const ditCodes = normalizeReturnCodes(dit.pickup_return_codes);
  if (codesDiffer(puCodes, ditCodes)) {
    patch.pickup_return_codes = puCodes.length > 0 ? puCodes : null;
    dirty = true;
  }

  // (3) authoritative quantity overwrite — only when unedited.
  // Compare against original_quantity which is set at row creation
  // (CreateDeliveryOrderModal at L1485 / L1499) and never mutated by
  // staff edits. delivery.quantity === original_quantity ⇒ staff has
  // not touched it ⇒ safe to update to PU reality.
  if (pu.delivered_quantity != null && dit.quantity != null && dit.original_quantity != null) {
    const puQty = Number(pu.delivered_quantity);
    const curQty = Number(dit.quantity);
    const origQty = Number(dit.original_quantity);
    if (curQty === origQty && puQty !== curQty) {
      patch.quantity = puQty;
      dirty = true;
    }
  }

  return dirty ? patch : null;
}

function codesDiffer(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return true;
  const aSorted = [...a].sort();
  const bSorted = [...b].sort();
  for (let i = 0; i < aSorted.length; i++) if (aSorted[i] !== bSorted[i]) return true;
  return false;
}

function normalizeReturnCodes(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter(x => typeof x === 'string' && x.trim()).map(x => (x as string).trim());
  if (typeof raw === 'string' && raw.trim()) return [raw.trim()];
  return [];
}
