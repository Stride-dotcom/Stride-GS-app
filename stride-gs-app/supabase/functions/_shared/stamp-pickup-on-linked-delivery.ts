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
const PU_NOTE_MARKER_RE = /^\[FROM PICKUP\][\s\S]*?\n---\n/;

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
  dt_item_code: string | null;
  quantity: number | null;
  item_note: string | null;
  picked_up_at: string | null;
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

  // ── 4. Load PU items + Delivery items in parallel ────────────────
  const [pickupItemsRes, deliveryItemsRes] = await Promise.all([
    supabase
      .from('dt_order_items')
      .select('id, dt_item_code, delivered, delivered_quantity, item_note, return_codes, removed_at')
      .eq('dt_order_id', p.id)
      .is('removed_at', null),
    supabase
      .from('dt_order_items')
      .select('id, parent_pickup_item_id, dt_item_code, quantity, item_note, picked_up_at')
      .eq('dt_order_id', d.id)
      .is('removed_at', null),
  ]);

  const pickupItems   = (pickupItemsRes.data   ?? []) as PickupItemRow[];
  const deliveryItems = (deliveryItemsRes.data ?? []) as DeliveryItemRow[];

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
 * null when no field needs updating (skip the write). Three rules:
 *
 *   1. quantity ← pickup.delivered_quantity (when non-null and different)
 *   2. item_note: strip any prior "[FROM PICKUP] …\n---\n" sentinel
 *      block, then prepend a fresh one if the PU has note or return
 *      codes. If PU has neither, just strip (heals stale markers).
 *   3. Only return a patch when at least one of (1) or (2) changes the
 *      stored value — otherwise we'd write a no-op every sync cycle.
 */
function buildItemPropagationPatch(
  pu: PickupItemRow,
  dit: DeliveryItemRow,
): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};
  let dirty = false;

  // Rule 1 — quantity reflects PU reality
  if (pu.delivered_quantity != null && Number(pu.delivered_quantity) !== Number(dit.quantity ?? -1)) {
    patch.quantity = pu.delivered_quantity;
    dirty = true;
  }

  // Rule 2 — sentinel-marker item_note merge
  const existing = dit.item_note ?? '';
  const stripped = existing.replace(PU_NOTE_MARKER_RE, '');
  const puReturnCodes = normalizeReturnCodes(pu.return_codes);
  const puNoteRaw = (pu.item_note ?? '').trim();
  let newNote = stripped;
  if (puNoteRaw || puReturnCodes.length > 0) {
    const parts: string[] = [];
    if (puNoteRaw) parts.push(puNoteRaw);
    if (puReturnCodes.length > 0) parts.push(`Return codes: ${puReturnCodes.join(', ')}`);
    newNote = `[FROM PICKUP] ${parts.join(' | ')}\n---\n${stripped}`;
  }
  if (newNote !== existing) {
    patch.item_note = newNote;
    dirty = true;
  }

  return dirty ? patch : null;
}

function normalizeReturnCodes(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter(x => typeof x === 'string' && x.trim()).map(x => (x as string).trim());
  if (typeof raw === 'string' && raw.trim()) return [raw.trim()];
  return [];
}
