/**
 * stamp-pickup-on-linked-delivery — shared helper that propagates a
 * completed pickup leg's metadata onto the linked delivery order.
 *
 * Sibling to `release-on-dt-finished.ts` — same shape, different
 * fields. Fires whenever a pickup-type DT order reaches status_id=3
 * (Completed). Invoked from two places:
 *
 *   1. `notify-pickup-completed` (webhook path) — runs within seconds
 *      of the driver tapping "Finish" in the DT driver app. At this
 *      point dt_orders.finished_at + driver_name are typically NULL
 *      (DT's export.xml lags the webhook). Helper stamps
 *      linked_pickup_finished_at = now() as a placeholder and leaves
 *      driver_name NULL.
 *
 *   2. `dt-sync-statuses` (poll path) — runs ~5 min later when the
 *      periodic DT export.xml pull finishes. By then finished_at +
 *      driver_name are populated. Helper overwrites the
 *      now() placeholder with the real DT timestamp and fills in
 *      the driver name.
 *
 * Per-item idempotency: `picked_up_at` is stamped only on rows where
 * it is currently NULL. A second helper run won't reset an existing
 * timestamp.
 *
 * Order-level merge rules (so the poll path can correct the webhook
 * path without overwriting good data with NULL):
 *   linked_pickup_finished_at = COALESCE(pickup.finished_at, now())
 *     — always overwrite; the poll's real timestamp beats the
 *       webhook's placeholder.
 *   linked_pickup_driver_name = pickup.driver_name when not null,
 *     else leave existing value alone (don't overwrite real name
 *     with NULL).
 *
 * Helper never throws. Returns a structured result so the caller can
 * log to telemetry + continue. A propagation failure here must not
 * unwind the caller's status flip / email send.
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
}

export interface StampPickupResult {
  /** True when at least one row was written. */
  fired: boolean;
  /** Reason the helper bailed early (when fired === false). */
  skippedReason?: string;
  /** UUID of the linked delivery row we stamped (when fired). */
  linkedDeliveryId?: string;
  /** Per-item rows stamped (NEW picked_up_at writes; idempotent skips not counted). */
  itemsStamped: number;
  /** Per-item rows on the pickup leg that were *eligible* (delivered=true + dt_item_code present). */
  itemsEligibleOnPickup: number;
  /** True when the order-level UPDATE on the delivery row succeeded. */
  orderLevelStamped: boolean;
}

export async function stampPickupOnLinkedDelivery(
  opts: StampPickupOptions,
): Promise<StampPickupResult> {
  const { supabase, pickupOrderId, source: _source } = opts;

  const skip = (reason: string): StampPickupResult => ({
    fired: false,
    skippedReason: reason,
    itemsStamped: 0,
    itemsEligibleOnPickup: 0,
    orderLevelStamped: false,
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
  if (d.order_type === 'pickup') return skip('linked_row_also_pickup');  // shouldn't happen, but defensive

  // ── 3. Compute order-level stamp values ──────────────────────────
  // pickup.finished_at trumps the existing placeholder (the webhook
  // path stamps now() as a fallback; the sync path then corrects
  // with the real DT timestamp).
  const finishedAt = p.finished_at ?? new Date().toISOString();
  const driverName = p.driver_name && p.driver_name.trim() ? p.driver_name.trim() : null;

  // Build the patch object — only include driver_name when we have
  // a real value, so the COALESCE-equivalent (don't overwrite real
  // name with null) works at the SQL level.
  const patch: Record<string, string> = { linked_pickup_finished_at: finishedAt };
  if (driverName) patch.linked_pickup_driver_name = driverName;

  const { error: updErr } = await supabase
    .from('dt_orders')
    .update(patch)
    .eq('id', d.id);
  const orderLevelStamped = !updErr;

  // ── 4. Per-item stamp on the linked delivery's items ─────────────
  // Match by (linked_delivery_id, dt_item_code) and only stamp where
  // picked_up_at is still NULL. The eligible set on the pickup is
  // items with delivered=true + non-blank dt_item_code.
  const { data: pickupItems } = await supabase
    .from('dt_order_items')
    .select('dt_item_code, delivered')
    .eq('dt_order_id', p.id);

  type ItemRow = { dt_item_code: string | null; delivered: boolean | null };
  const eligibleCodes = ((pickupItems ?? []) as ItemRow[])
    .filter(r => r.delivered === true && r.dt_item_code && r.dt_item_code.trim())
    .map(r => r.dt_item_code as string);

  let itemsStamped = 0;
  if (eligibleCodes.length > 0) {
    const { data: stampedRows } = await supabase
      .from('dt_order_items')
      .update({ picked_up_at: finishedAt })
      .eq('dt_order_id', d.id)
      .is('picked_up_at', null)
      .in('dt_item_code', eligibleCodes)
      .select('id');
    itemsStamped = (stampedRows ?? []).length;
  }

  return {
    fired: orderLevelStamped || itemsStamped > 0,
    linkedDeliveryId: d.id,
    itemsStamped,
    itemsEligibleOnPickup: eligibleCodes.length,
    orderLevelStamped,
  };
}
