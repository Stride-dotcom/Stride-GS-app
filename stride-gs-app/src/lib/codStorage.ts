/**
 * COD Storage — shared client helpers.
 *
 * "End customers pay storage": items flagged cod_storage=true stop billing
 * the designer from cod_storage_start_date onward (the Postgres storage calc
 * caps the billable window) and instead surface a "COD Storage" collection
 * line on the delivery order, collected from the end customer at delivery.
 *
 * Feature-gated to the Justin Demo tenant via useFeatureFlag('codStorageBilling').
 *
 * All writes go through SECURITY DEFINER RPCs (admin/staff gated) because
 * public.inventory has no browser UPDATE policy:
 *   • set_cod_storage            — set/clear the flag on inventory items
 *   • mark_cod_storage_collected — Phase 6 collection record
 */
import { supabase } from './supabase';

/** Default COD storage rate: $/cubic-foot/day. Operator-editable per order. */
export const COD_STORAGE_DEFAULT_RATE = 0.05;

/** Today as YYYY-MM-DD in local time. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Inclusive day count between two ISO dates (YYYY-MM-DD). A single day
 * (start === end) counts as 1. Returns 0 when end is before start or either
 * date is missing/unparseable.
 */
export function daysInclusive(startIso?: string | null, endIso?: string | null): number {
  if (!startIso || !endIso) return 0;
  const s = Date.parse(startIso + 'T00:00:00Z');
  const e = Date.parse(endIso + 'T00:00:00Z');
  if (!Number.isFinite(s) || !Number.isFinite(e)) return 0;
  const diff = Math.round((e - s) / 86400000) + 1;
  return diff > 0 ? diff : 0;
}

export interface CodStorageInputItem {
  itemId: string;
  inventoryId?: string | null;
  sidemark?: string | null;
  description?: string | null;
  itemClass?: string | null;
  /** Per-unit cubic feet, if already known (e.g. from the dt_order_items row). */
  cubicFeet?: number | null;
  codStorage?: boolean;
  codStorageStartDate?: string | null;
}

export interface CodStorageLineItem {
  itemId: string;
  inventoryId: string | null;
  sidemark: string;
  description: string;
  itemClass: string;
  cubicFeet: number;
  startDate: string;       // YYYY-MM-DD
  endDate: string;         // = cutoff (YYYY-MM-DD)
  days: number;            // inclusive
  amount: number;          // cubicFeet * rate * days, rounded to cents
}

export interface CodStorageLine {
  items: CodStorageLineItem[];
  itemCount: number;
  total: number;
  /** Earliest cod_storage_start_date across the items (period start). */
  periodStart: string | null;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Compute the COD Storage collection line for a delivery order.
 *
 * Per item: cubicFeet × rate × eligibleDays, where eligibleDays spans
 * cod_storage_start_date → cutoff (inclusive). Cubic feet are taken from the
 * item's own cubicFeet when present, else from the class→storageSize map
 * (item_classes.storage_size), matching the designer-side storage calc.
 *
 * Only items with cod_storage=true AND a start date contribute. Items whose
 * window is empty (cutoff before start) contribute 0.
 */
export function computeCodStorageLine(
  items: CodStorageInputItem[],
  cutoffIso: string,
  rate: number,
  classSizeById: Record<string, number>,
): CodStorageLine {
  const lineItems: CodStorageLineItem[] = [];
  let total = 0;
  let periodStart: string | null = null;

  for (const it of items) {
    if (!it.codStorage || !it.codStorageStartDate) continue;
    const start = it.codStorageStartDate;
    const cls = String(it.itemClass || '').toUpperCase();
    const cubicFeet =
      it.cubicFeet != null && it.cubicFeet > 0
        ? it.cubicFeet
        : (classSizeById[cls] ?? 0);
    const days = daysInclusive(start, cutoffIso);
    const amount = round2(cubicFeet * (rate || 0) * days);

    lineItems.push({
      itemId: it.itemId,
      inventoryId: it.inventoryId ?? null,
      sidemark: String(it.sidemark || ''),
      description: String(it.description || ''),
      itemClass: cls,
      cubicFeet,
      startDate: start,
      endDate: cutoffIso,
      days,
      amount,
    });
    total += amount;
    if (!periodStart || start < periodStart) periodStart = start;
  }

  return {
    items: lineItems,
    itemCount: lineItems.length,
    total: round2(total),
    periodStart,
  };
}

/** Build a class-id → storage_size (cubic feet) map from useItemClasses output. */
export function classSizeMap(classes: { id: string; storageSize: number }[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const c of classes) m[String(c.id).toUpperCase()] = c.storageSize;
  return m;
}

/**
 * Set or clear the COD flag on inventory items (Inventory batch action +
 * Item Detail toggle). Returns the number of rows updated.
 */
export async function setCodStorage(
  tenantId: string,
  itemIds: string[],
  enabled: boolean,
  startDate?: string | null,
): Promise<number> {
  const { data, error } = await supabase.rpc('set_cod_storage', {
    p_tenant_id: tenantId,
    p_item_ids: itemIds,
    p_enabled: enabled,
    p_start_date: enabled ? (startDate || null) : null,
  });
  if (error) throw new Error(error.message);
  return typeof data === 'number' ? data : (itemIds.length);
}

export interface MarkCollectedResult {
  collected_at: string;
  items_recorded: number;
  total_recorded: number;
}

/** Phase 6: mark a delivery order's COD storage as collected. */
export async function markCodStorageCollected(
  orderId: string,
  notes: string | null,
  collectedBy: string | null,
): Promise<MarkCollectedResult> {
  const { data, error } = await supabase.rpc('mark_cod_storage_collected', {
    p_order_id: orderId,
    p_notes: notes || null,
    p_collected_by: collectedBy || null,
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  return row as MarkCollectedResult;
}
