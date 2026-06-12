/**
 * stamp-pickup-on-linked-delivery — propagates a completed pickup leg's
 * per-item result onto the linked delivery order via STRICT FK matching.
 *
 * ── Model (2026-06-11 rewrite — per-item FK, no blanket pass) ─────────
 *
 * Each delivery item that was picked up carries `parent_pickup_item_id`
 * (FK → the pickup `dt_order_items` row) set by CreateDeliveryOrderModal's
 * forward path. When the pickup leg completes we walk the delivery items
 * and, for each one FK-linked to a pickup item, write that pickup item's
 * ACTUAL result from DT:
 *
 *   • picked_up_at              ← finishedAt — ONLY when the linked
 *       pickup item is delivered=true (the driver actually collected it),
 *       and only on the first write (idempotent first-write-wins).
 *   • pickup_delivered_quantity ← pu.delivered_quantity — what the driver
 *       actually picked up (may be < ordered quantity, or 0 if missed).
 *   • pickup_item_note          ← pu.item_note — driver notes from DT.
 *   • pickup_return_codes       ← pu.return_codes — DT exceptions.
 *
 * Delivery items WITHOUT an FK match are NEVER stamped. A warehouse item
 * riding from stock, or a piece the driver could not collect, stays
 * unstamped — so the delivery shows EXACTLY what was and wasn't picked
 * up, with the driver's notes/return-codes explaining any shortfall.
 *
 * A linked pickup item that is delivered=false (driver could not collect)
 * does NOT set picked_up_at on its delivery counterpart, but DOES mirror
 * the audit columns (quantity=0 + the return code/note explaining why),
 * so the unstamped item carries the reason it wasn't picked up.
 *
 * ── Why no blanket pass / no dt_item_code fallback ───────────────────
 *
 * The previous helper had a "blanket pass" that stamped EVERY unstamped
 * delivery item once the pickup completed, plus a dt_item_code fallback.
 * On pickup_and_delivery orders that mix picked-up items with warehouse
 * inventory this repeatedly mis-stamped warehouse stock as picked up
 * (JOD-00168-D: 1 item picked up, all 23 stamped; 20 of them warehouse).
 * PR #741 band-aided it with an inventory_id guard; this rewrite removes
 * the unsound heuristic entirely. `parent_pickup_item_id` is the only
 * sound per-item signal, so it is the only one we match on.
 *
 * ── Order-level stamp (independent of items) ─────────────────────────
 *   linked_pickup_finished_at = pickup.finished_at ?? now()
 *   linked_pickup_driver_name = pickup.driver_name when non-empty,
 *     else preserve existing (poll path must not null out good data).
 *
 * ── Idempotency ──────────────────────────────────────────────────────
 *   • picked_up_at — first write wins, enforced ATOMICALLY at the DB via
 *     `.is('picked_up_at', null)` on its own dedicated update, so a
 *     concurrent webhook+sync race can't overwrite a real timestamp with
 *     a placeholder. Counted from the returned rows, so itemsStamped only
 *     reflects the run that actually won the write.
 *   • audit columns (pickup_delivered_quantity / pickup_item_note /
 *     pickup_return_codes) — change-detected overwrite each run; they
 *     mirror the pickup item and converge as DT data refreshes.
 *   • delivery `quantity` (the real ordered qty) — overwritten to the
 *     PU reality ONLY on the sync path (propagateItemFields) and ONLY
 *     when staff hasn't manually edited it (quantity === original_quantity).
 *
 * On the webhook path the pickup items may not yet carry fresh export.xml
 * values (delivered/quantity/notes still null). The change-detect guards
 * below skip any write whose source value is null/unchanged, so a
 * pre-sync webhook writes nothing stale; picked_up_at additionally needs
 * delivered=true (only the sync sets that from export.xml), so in
 * practice the sync path (dt-sync-statuses, which upserts pickup items
 * first) does the real per-item stamp moments later. When the pickup
 * item already carries values at webhook time the audit mirror does
 * write them — safe, because it's change-detected and the next sync
 * re-mirrors against fresh data, so it converges.
 *
 * Helper never throws. Returns a structured result for telemetry.
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
   * Sync-path switch. When true, also overwrite the delivery item's real
   * `quantity` column to the picked-up quantity (when staff hasn't edited
   * it) and return the changed delivery item IDs so the caller can push
   * the delta back to DT. Should only be true when the caller has fresh
   * DT data on the pickup items (dt-sync-statuses has just upserted them).
   * The picked_up_at + audit-column mirrors below happen regardless; this
   * flag only gates the authoritative `quantity` overwrite + push-back.
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
  /** Delivery item IDs whose real `quantity` changed (sync path only).
   *  Caller uses these to decide whether to fire a delivery push-back. */
  itemsPropagated: string[];
}

interface PickupItemRow {
  id: string;
  delivered: boolean | null;
  delivered_quantity: number | null;
  item_note: string | null;
  return_codes: unknown;
  removed_at: string | null;
}

interface DeliveryItemRow {
  id: string;
  /** Stride inventory row UUID, when the item maps. Used to resolve the
   *  inventory item_id for per-item pickup_completed audit rows. */
  inventory_id: string | null;
  /** FK → the pickup dt_order_items row this delivery item was picked up
   *  from. Set by CreateDeliveryOrderModal's forward path. NULL for
   *  warehouse stock and any item with no pickup counterpart — those are
   *  never stamped. */
  parent_pickup_item_id: string | null;
  quantity: number | null;
  original_quantity: number | null;
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

  // ── 4. Load PU items + Delivery items ────────────────────────────
  const [pickupItemsRes, deliveryItemsRes] = await Promise.all([
    supabase
      .from('dt_order_items')
      .select('id, delivered, delivered_quantity, item_note, return_codes, removed_at')
      .eq('dt_order_id', p.id)
      .is('removed_at', null),
    supabase
      .from('dt_order_items')
      .select('id, inventory_id, parent_pickup_item_id, quantity, original_quantity, picked_up_at, pickup_item_note, pickup_return_codes, pickup_delivered_quantity')
      .eq('dt_order_id', d.id)
      .is('removed_at', null),
  ]);

  const pickupItems   = (pickupItemsRes.data   ?? []) as PickupItemRow[];
  const deliveryItems = (deliveryItemsRes.data ?? []) as DeliveryItemRow[];

  // Telemetry: how many pickup items the driver actually collected.
  const eligibleCount = pickupItems.filter(r => r.delivered === true).length;

  // Lookup: pickup item id → pickup row.
  const pickupById = new Map(pickupItems.map(r => [r.id, r]));

  // ── 5. Per-item FK stamp ─────────────────────────────────────────
  // For every delivery item FK-linked to a pickup item, mirror that
  // pickup item's actual result. No FK ⇒ never touched.
  let itemsStamped = 0;
  const itemsPropagated: string[] = [];
  /** inventory_id UUIDs of delivery items whose picked_up_at write won —
   *  resolved to item_ids below for per-item pickup_completed audit rows. */
  const stampedInventoryIds: string[] = [];

  for (const dit of deliveryItems) {
    if (!dit.parent_pickup_item_id) continue;          // not from a pickup
    const pu = pickupById.get(dit.parent_pickup_item_id);
    if (!pu) continue;                                  // FK dangling (pickup row gone)

    // (A) audit-column + quantity mirror — change-detected, converges
    //     each run. Always-overwrite is safe (these mirror the pickup
    //     item), so no DB-level guard is needed here.
    const audit = buildAuditPatch(pu, dit, propagateItemFields);
    if (audit) {
      const { error } = await supabase
        .from('dt_order_items')
        .update(audit.fields)
        .eq('id', dit.id);
      if (error) {
        console.warn(`[stamp-pickup] audit update failed item=${dit.id}: ${error.message}`);
      } else if (audit.quantityChanged) {
        itemsPropagated.push(dit.id);
      }
    }

    // (B) picked_up_at — first-write-wins, enforced ATOMICALLY at the DB.
    //     Only when the pickup item was actually collected (delivered=
    //     true). The in-memory `!dit.picked_up_at` short-circuits an
    //     unnecessary write; the `.is('picked_up_at', null)` clause is
    //     what guarantees a concurrent run can't overwrite a real
    //     timestamp with a placeholder, and itemsStamped counts only the
    //     row that actually won the write.
    if (pu.delivered === true && !dit.picked_up_at) {
      const { data, error } = await supabase
        .from('dt_order_items')
        .update({ picked_up_at: finishedAt })
        .eq('id', dit.id)
        .is('picked_up_at', null)
        .select('id');
      if (error) {
        console.warn(`[stamp-pickup] picked_up_at update failed item=${dit.id}: ${error.message}`);
      } else if ((data ?? []).length > 0) {
        itemsStamped += 1;
        if (dit.inventory_id) stampedInventoryIds.push(dit.inventory_id);
      }
    }
  }

  // ── 6. Audit log (best-effort) ───────────────────────────────────
  // One pickup_completed row on the DELIVERY order + one per stamped
  // inventory item, so both the OrderPage and each Item's ActivityTimeline
  // show the completed pickup. Only the run that won the atomic
  // picked_up_at write inserts, so re-runs / webhook+sync races don't
  // duplicate rows.
  if (itemsStamped > 0) {
    try {
      const auditRows: Record<string, unknown>[] = [{
        entity_type:  'dt_order',
        entity_id:    d.id,
        tenant_id:    p.tenant_id,
        action:       'pickup_completed',
        changes: {
          summary: `${itemsStamped} item(s) picked up`,
          itemsStamped,
          dtIdentifier: p.dt_identifier ?? undefined,
          driverName: driverName ?? undefined,
        },
        performed_by: driverName || 'system',
        source:       'supabase',
      }];
      if (stampedInventoryIds.length > 0) {
        const { data: invRows } = await supabase
          .from('inventory')
          .select('id, item_id')
          .in('id', stampedInventoryIds);
        for (const inv of (invRows ?? []) as Array<{ id: string; item_id: string | null }>) {
          if (!inv.item_id) continue;
          auditRows.push({
            entity_type:  'inventory',
            entity_id:    inv.item_id,
            tenant_id:    p.tenant_id,
            action:       'pickup_completed',
            changes:      { dtIdentifier: p.dt_identifier ?? undefined, driverName: driverName ?? undefined },
            performed_by: driverName || 'system',
            source:       'supabase',
          });
        }
      }
      const { error: auditErr } = await supabase.from('entity_audit_log').insert(auditRows);
      if (auditErr) console.warn(`[stamp-pickup] audit insert failed: ${auditErr.message}`);
    } catch (e) {
      console.warn('[stamp-pickup] audit insert threw:', e);
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

interface AuditPatch {
  fields: Record<string, unknown>;
  /** True when this patch overwrites the delivery item's real quantity. */
  quantityChanged: boolean;
}

/**
 * Build the audit-column (+ optional quantity) update for a delivery item
 * FK-linked to pickup item `pu`. Returns null when nothing changed (skip
 * the no-op write). `picked_up_at` is NOT handled here — the caller writes
 * it separately under an atomic first-write-wins DB guard.
 *
 * Always (change-detected, mirrors the pickup item's actual result, so a
 * missed pickup records qty 0 + the reason without setting picked_up_at):
 *   • pickup_delivered_quantity ← pu.delivered_quantity
 *   • pickup_item_note          ← pu.item_note
 *   • pickup_return_codes       ← pu.return_codes
 *
 * quantity ← pu.delivered_quantity — sync path only, and only when staff
 *   hasn't edited it (quantity === original_quantity). Mirrors the PU
 *   reality into the real ordered quantity so the delivery + DT push-back
 *   reflect what's actually coming. Drives `quantityChanged` for the
 *   caller's push-back decision.
 */
function buildAuditPatch(
  pu: PickupItemRow,
  dit: DeliveryItemRow,
  propagateQuantity: boolean,
): AuditPatch | null {
  const fields: Record<string, unknown> = {};
  let dirty = false;
  let quantityChanged = false;

  // (1) audit-column quantity mirror
  if (pu.delivered_quantity != null) {
    const puQty = Number(pu.delivered_quantity);
    if (puQty !== Number(dit.pickup_delivered_quantity ?? -1)) {
      fields.pickup_delivered_quantity = puQty;
      dirty = true;
    }
  }

  // (2) audit-column notes mirror
  const puNoteRaw = (pu.item_note ?? '').trim() || null;
  if (puNoteRaw !== ((dit.pickup_item_note ?? '').trim() || null)) {
    fields.pickup_item_note = puNoteRaw;
    dirty = true;
  }

  // (3) audit-column return-codes mirror
  const puCodes = normalizeReturnCodes(pu.return_codes);
  const ditCodes = normalizeReturnCodes(dit.pickup_return_codes);
  if (codesDiffer(puCodes, ditCodes)) {
    fields.pickup_return_codes = puCodes.length > 0 ? puCodes : null;
    dirty = true;
  }

  // (4) authoritative quantity overwrite — sync path, unedited only.
  if (propagateQuantity
      && pu.delivered_quantity != null
      && dit.quantity != null
      && dit.original_quantity != null) {
    const puQty = Number(pu.delivered_quantity);
    const curQty = Number(dit.quantity);
    const origQty = Number(dit.original_quantity);
    if (curQty === origQty && puQty !== curQty) {
      fields.quantity = puQty;
      quantityChanged = true;
      dirty = true;
    }
  }

  if (!dirty) return null;
  return { fields, quantityChanged };
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
