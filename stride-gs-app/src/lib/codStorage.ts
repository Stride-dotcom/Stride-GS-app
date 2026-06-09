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

/** Today as YYYY-MM-DD in local time (not UTC — avoids an evening-Pacific
 *  off-by-one vs the operator's calendar day). */
export function todayIso(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
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
 * Persisted per-item shape stored in dt_orders.cod_storage_details (JSONB).
 * snake_case so the mark_cod_storage_collected SQL RPC reads it directly.
 */
export interface CodStorageDetail {
  item_id: string;
  inventory_id: string | null;
  sidemark: string;
  description: string;
  item_class: string;
  cubic_feet: number;
  start_date: string;
  end_date: string;
  days: number;
  rate: number;
  amount: number;
}

/** Serialize computed line items to the persisted snake_case detail rows. */
export function serializeCodDetails(items: CodStorageLineItem[], rate: number): CodStorageDetail[] {
  return items.map(it => ({
    item_id: it.itemId,
    inventory_id: it.inventoryId,
    sidemark: it.sidemark,
    description: it.description,
    item_class: it.itemClass,
    cubic_feet: it.cubicFeet,
    start_date: it.startDate,
    end_date: it.endDate,
    days: it.days,
    rate,
    amount: it.amount,
  }));
}

export interface RecomputedCodLine {
  details: CodStorageDetail[];
  itemCount: number;
  total: number;
  periodStart: string | null;
}

/**
 * Recompute a COD line from its persisted detail rows when the cutoff or rate
 * changes (OrderPage editing). Self-contained — each detail row already carries
 * cubic_feet + start_date, so no inventory re-fetch is needed.
 */
export function recomputeCodLineFromDetails(
  details: CodStorageDetail[],
  cutoffIso: string,
  rate: number,
): RecomputedCodLine {
  let total = 0;
  let periodStart: string | null = null;
  const out = details.map(d => {
    const days = daysInclusive(d.start_date, cutoffIso);
    const amount = round2((d.cubic_feet || 0) * (rate || 0) * days);
    total += amount;
    if (!periodStart || (d.start_date && d.start_date < periodStart)) periodStart = d.start_date;
    return { ...d, end_date: cutoffIso, days, rate, amount };
  });
  return { details: out, itemCount: out.length, total: round2(total), periodStart };
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

// ────────────────────────────────────────────────────────────────────────
// Standalone COD Storage invoicing (independent of delivery orders).
//
// Backed by the collect-cod-storage-sb Edge Function, which is the
// authoritative compute path (React never computes billing — it only renders
// the EF's dry-run preview). See supabase/functions/collect-cod-storage-sb.
// ────────────────────────────────────────────────────────────────────────

/** One item's line in a standalone COD collection (mirrors the EF's ItemResult). */
export interface CodCollectionItem {
  itemId: string;
  inventoryId: string | null;
  itemClass: string;
  sidemark: string;
  description: string;
  cubicFeet: number;
  codStartDate: string | null;
  periodStart: string | null;
  periodEnd: string;
  eligibleDays: number;
  alreadyCollectedDays: number;
  billableDays: number;
  amount: number;
  ledgerRowId: string | null;
  status: 'billable' | 'fully_collected' | 'already_invoiced' | 'no_cod' | 'no_cubic';
}

export interface CodCollectionResult {
  success: boolean;
  dryRun: boolean;
  periodEnd: string;
  rate: number;
  items: CodCollectionItem[];
  summary: {
    itemsBillable: number;
    itemsTotal: number;
    total: number;
    daysAlreadyCollected: number;
    created?: number;
    skipped?: number;
    errors?: { itemId: string; error: string }[];
  };
  error?: string;
}

async function invokeCollect(body: Record<string, unknown>): Promise<CodCollectionResult> {
  const { data, error } = await supabase.functions.invoke<CodCollectionResult>(
    'collect-cod-storage-sb',
    { body },
  );
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Empty response from collect-cod-storage-sb');
  if (data.success === false && data.error) throw new Error(data.error);
  return data;
}

/** Dry-run preview: compute the per-item breakdown + dedup without writing. */
export function previewCodCollection(
  tenantId: string, itemIds: string[], cutoffDate: string, rate: number,
): Promise<CodCollectionResult> {
  return invokeCollect({ tenantId, itemIds, cutoffDate, rate, dryRun: true });
}

/** Commit: create the Unbilled COD_STOR billing rows + record + advance dates. */
export function collectCodStorage(
  tenantId: string, itemIds: string[], cutoffDate: string, rate: number,
  notes: string | null, callerEmail: string | null,
): Promise<CodCollectionResult> {
  return invokeCollect({
    tenantId, itemIds, cutoffDate, rate,
    notes: notes || '', callerEmail: callerEmail || '', dryRun: false,
  });
}

// ── Delivery-order add-on dedup ─────────────────────────────────────────
// The delivery-order COD line (OrderCodStorageCard) must not re-collect days
// a standalone collection already invoiced. These helpers read the durable
// storage_billing_items ledger and subtract already-collected days.

export interface CollectedRange { itemId: string; start: string; end: string }

/** Fetch already-recorded (non-Void) COD/storage day-ranges for these items. */
export async function fetchCollectedCodRanges(
  tenantId: string, itemIds: string[],
): Promise<CollectedRange[]> {
  const ids = itemIds.filter(Boolean);
  if (!tenantId || ids.length === 0) return [];
  const { data, error } = await supabase
    .from('storage_billing_items')
    .select('item_id, period_start, period_end, status')
    .eq('tenant_id', tenantId)
    .in('item_id', ids)
    .neq('status', 'Void');
  if (error) return [];
  return (data ?? []).map((r) => ({
    itemId: String((r as { item_id: string }).item_id),
    start: String((r as { period_start: string }).period_start),
    end: String((r as { period_end: string }).period_end),
  }));
}

/**
 * Count days in [startIso, cutoffIso] already covered by one of `ranges`
 * (day-set subtraction), and the first uncollected day. Mirrors the EF's
 * subtractCollected so the delivery preview matches the standalone math.
 */
export function uncollectedInWindow(
  startIso: string, cutoffIso: string, ranges: { start: string; end: string }[],
): { uncollectedDays: number; alreadyCollectedDays: number; firstUncollected: string | null } {
  const eligible = daysInclusive(startIso, cutoffIso);
  const s = Date.parse(startIso + 'T00:00:00Z');
  const e = Date.parse(cutoffIso + 'T00:00:00Z');
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) {
    return { uncollectedDays: 0, alreadyCollectedDays: eligible, firstUncollected: null };
  }
  const spans = ranges
    .map((r) => ({ s: Date.parse(r.start + 'T00:00:00Z'), e: Date.parse(r.end + 'T00:00:00Z') }))
    .filter((sp) => Number.isFinite(sp.s) && Number.isFinite(sp.e));
  let uncollected = 0;
  let first: string | null = null;
  for (let d = s; d <= e; d += 86400000) {
    if (!spans.some((sp) => d >= sp.s && d <= sp.e)) {
      uncollected++;
      if (!first) first = new Date(d).toISOString().slice(0, 10);
    }
  }
  return { uncollectedDays: uncollected, alreadyCollectedDays: eligible - uncollected, firstUncollected: first };
}
