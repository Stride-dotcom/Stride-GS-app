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
 * Flag writes go through the set_cod_storage SECURITY DEFINER RPC (admin/staff
 * gated) because public.inventory has no browser UPDATE policy. The actual
 * collection/billing — for BOTH the standalone Inventory "Collect COD" action
 * and the delivery-order COD line — goes through the collect-cod-storage-sb
 * Edge Function (previewCodCollection / collectCodStorage below), the single
 * authoritative compute path (React never computes billing).
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

/** Add N days to an ISO date (YYYY-MM-DD), returning ISO. Blank/unparseable
 *  input falls back to today (mirrors the set_cod_storage_from_receipt RPC,
 *  which COALESCEs a missing receive_date to CURRENT_DATE). */
export function addDaysIso(iso: string | null | undefined, n: number): string {
  const base = iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : todayIso();
  const t = Date.parse(base + 'T00:00:00Z');
  if (!Number.isFinite(t)) return todayIso();
  return new Date(t + n * 86400000).toISOString().slice(0, 10);
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

/**
 * Flag items COD with a per-item start date of (receive_date + N days) — so a
 * client's free-storage period is honored individually when items were received
 * on different dates. Server-side per-item compute (authoritative on
 * receive_date) + per-item audit. Returns rows updated.
 */
export async function setCodStorageFromReceipt(
  tenantId: string,
  itemIds: string[],
  days: number,
): Promise<number> {
  const { data, error } = await supabase.rpc('set_cod_storage_from_receipt', {
    p_tenant_id: tenantId,
    p_item_ids: itemIds,
    p_days: Math.max(0, Math.floor(days) || 0),
  });
  if (error) throw new Error(error.message);
  return typeof data === 'number' ? data : itemIds.length;
}

// ────────────────────────────────────────────────────────────────────────
// Delivery-order COD Storage — MARK PAID (collect-on-delivery model).
//
// Unlike the standalone Inventory "Collect COD" path (which invoices via the
// collect-cod-storage-sb EF → QBO), the delivery-order line is collected from
// the end customer AT DELIVERY, like a will-call COD amount. Marking it paid
// records the durable storage_billing_items dedup ledger + stamps the order's
// cod_storage_collected_* (and an item activity row), but creates NO billing
// row / no QBO invoice. The mark_cod_storage_collected RPC is SECURITY DEFINER
// (admin/staff) because the dedup write + inventory reads bypass browser RLS.
// ────────────────────────────────────────────────────────────────────────

export interface MarkCollectedResult {
  collected_at: string;
  items_recorded: number;
  total_recorded: number;
}

/** Mark a delivery order's COD storage as collected/paid (no billing row). */
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

// Delivery-order dedup against already-collected days is now handled
// server-side by collect-cod-storage-sb (subtractCollected) — both the
// standalone Collect COD and the delivery-order COD line go through the same
// EF dry-run, so the day-set subtraction lives in one place.
