/**
 * supabaseQueries.ts — Supabase read cache queries for Phase 3.
 *
 * Each function queries the Supabase read cache tables and transforms rows
 * into the same API response shapes that the GAS endpoints return.
 * This gives 50-100ms reads instead of 3-44s from Apps Script.
 *
 * All functions return null if Supabase is unavailable or the query fails,
 * allowing the caller to fall back to the GAS API.
 */
import { supabase } from './supabase';
import type {
  ApiInventoryItem,
  InventoryResponse,
  ApiTask,
  TasksResponse,
  ApiRepair,
  RepairsResponse,
  ApiWillCall,
  WillCallsResponse,
  ApiShipment,
  ApiShipmentItem,
  ShipmentsResponse,
  ApiBillingRow,
  BillingResponse,
  BillingSummary,
  BillingFilterParams,
  ApiClient,
  ClientsResponse,
  ApiClaim,
  ClaimsResponse,
  ApiUser,
  UsersResponse,
  MarketingContact,
  MarketingCampaign,
  MarketingTemplate,
  MarketingSettings,
  DashboardStats,
  DashboardCampaignRow,
  CampaignType,
  CampaignStatus,
  ApiLocation,
  LocationsResponse,
  StaxInvoicesResponse,
  StaxChargeLogResponse,
  StaxExceptionsResponse,
  StaxCustomersResponse,
  StaxRunLogResponse,
  ApiRepairQuoteLine,
} from './api';

/** Map of clientSheetId → clientName for enriching Supabase rows */
export type ClientNameMap = Record<string, string>;

/**
 * Check if Supabase read cache is available (tables exist and have data).
 * Cached for the session to avoid repeated checks.
 *
 * Historical note: this used to carry an `_impersonating` cache-bypass
 * because pre-piece-#3 impersonation kept the admin's Supabase session
 * live, so the read cache returned admin-scoped rows that didn't match
 * the impersonated identity. As of piece #3 the live session IS the
 * target user's during impersonation, so RLS scopes the cache reads
 * correctly and the bypass is no longer needed. `setSupabaseImpersonating`
 * was removed; AuthContext no longer calls anything here on
 * impersonate/exit.
 */
let _cacheAvailable: boolean | null = null;
let _skipNextSupabase = false;

// Session 72 dedup: N concurrent consumers race on cold load — without
// dedup we saw 4x identical HEAD probes in the Network tab.
let _availabilityInflight: Promise<boolean> | null = null;

export async function isSupabaseCacheAvailable(): Promise<boolean> {
  if (_skipNextSupabase) {
    _skipNextSupabase = false;
    return false;
  }
  if (_cacheAvailable !== null) return _cacheAvailable;
  if (_availabilityInflight) return _availabilityInflight;
  _availabilityInflight = (async () => {
    try {
      const { count, error } = await supabase
        .from('inventory')
        .select('id', { count: 'exact', head: true })
        .limit(1);
      if (error) {
        // Transient: don't cache false — a one-time network/auth blip would
        // otherwise permanently disable Supabase for the session and force
        // every consumer to the slow GAS fallback. Surface the actual error
        // so devtools immediately reveals RLS/auth/network failures.
        console.warn('[supabaseQueries] isSupabaseCacheAvailable: error from inventory probe — leaving availability uncached so we retry on next call', error);
        _cacheAvailable = null;
        return false;
      }
      if ((count ?? 0) === 0) {
        // Likely RLS hiding rows from the current user, or a brand-new
        // tenant. We still want SB-first for OTHER tables (e.g. billing),
        // but the current probe couldn't confirm. Leave uncached and warn.
        console.warn('[supabaseQueries] isSupabaseCacheAvailable: inventory probe returned 0 rows (RLS scope or empty tenant?) — leaving availability uncached');
        _cacheAvailable = null;
        return false;
      }
      _cacheAvailable = true;
      return true;
    } catch (e) {
      console.warn('[supabaseQueries] isSupabaseCacheAvailable: probe threw — leaving availability uncached', e);
      _cacheAvailable = null;
      return false;
    }
  })();
  try {
    return await _availabilityInflight;
  } finally {
    _availabilityInflight = null;
  }
}

/** Reset the cache availability check (call after bulk sync) */
export function resetCacheAvailability(): void {
  _cacheAvailable = null;
}

/** Skip Supabase cache for the next fetch (force GAS fallback). One-shot flag. */
export function skipSupabaseCacheOnce(): void {
  _skipNextSupabase = true;
}

// Normalize any plausible date string to YYYY-MM-DD. Handles legacy Stax
// rows where due_date / scheduled_date were written as "2026-05-10 00:00:00"
// (timestamp from older formatDate_) or "05/20/2026" (US format from
// api_qbFmtDate_). <input type="date"> strictly requires YYYY-MM-DD; any
// other shape silently renders empty and breaks the onBlur equality guard
// on the Charge Queue.
function isoDateOnly(s: string | null | undefined): string {
  if (!s) return '';
  const v = String(s).trim();
  if (!v) return '';
  // YYYY-MM-DD or YYYY-MM-DD HH:MM[:SS] / YYYY-MM-DDTHH:MM... → first 10
  const iso = v.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  // MM/DD/YYYY or M/D/YYYY (US)
  const us = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  return v;
}

// ─── Pagination helper ──────────────────────────────────────────────────────
//
// Supabase projects enforce a server-side `max_rows` cap (default: 1000) that
// silently clamps `.range()` requests from clients. A call like
// `query.range(0, 49999)` looks like it'll return up to 50k rows, but the
// response is capped at 1000. Symptom users see: "Select All clients only
// shows clients N-S" — the first 1000 rows (sorted by Postgres' default
// tenant_id hash order) happen to cover only a subset of tenants, so entire
// clients appear to be missing from the multi-tenant dataset.
//
// `paginateAll` works around this by issuing sequential `.range()` calls in
// 1000-row chunks until the server returns fewer than `PAGE_SIZE` rows.
// The `buildQuery` callback must rebuild the filtered query from scratch on
// each call — Supabase builders are stateful, so the query can't be reused.
const PAGE_SIZE = 1000;
const MAX_PAGES = 60; // Safety cap: 60k rows total. Raise if a table ever exceeds.

async function paginateAll<T>(
  buildQuery: () => { range: (from: number, to: number) => Promise<{ data: T[] | null; error: unknown }> },
  label?: string,
): Promise<T[] | null> {
  const all: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await buildQuery().range(from, to);
    if (error) {
      // Surface the actual Supabase error — callers historically swallowed
      // this and silently fell back to GAS, masking RLS/network/auth bugs.
      console.warn(`[supabaseQueries] paginateAll${label ? `(${label})` : ''}: page ${page} (range ${from}-${to}) errored — aborting and returning null`, error);
      return null;
    }
    if (!data || data.length === 0) break;
    for (let i = 0; i < data.length; i++) all.push(data[i]);
    if (data.length < PAGE_SIZE) break;
  }
  if (all.length >= PAGE_SIZE * MAX_PAGES) {
    console.warn(`[supabaseQueries] paginateAll${label ? `(${label})` : ''}: hit MAX_PAGES safety cap at ${all.length} rows — table may have more rows than expected`);
  }
  return all;
}

// ─── Inventory ───────────────────────────────────────────────────────────────

interface SupabaseInventoryRow {
  // Postgres UUID PK on the inventory row. Distinct from item_id (the
  // human-readable Stride code like "62216"); needed so dt_order_items
  // can be FK-linked back to the actual inventory row that supplied
  // the line. Populated for every row by the GAS sync paths.
  id: string;
  tenant_id: string;
  item_id: string;
  description: string | null;
  vendor: string | null;
  sidemark: string | null;
  room: string | null;
  item_class: string | null;
  qty: number | null;
  location: string | null;
  status: string | null;
  receive_date: string | null;
  release_date: string | null;
  shipment_number: string | null;
  carrier: string | null;
  tracking_number: string | null;
  item_notes: string | null;
  reference: string | null;
  task_notes: string | null;
  item_folder_url: string | null;
  shipment_folder_url: string | null;
  shipment_photos_url: string | null;
  inspection_photos_url: string | null;
  repair_photos_url: string | null;
  invoice_url: string | null;
  transfer_date: string | null;
  needs_inspection: boolean | null;
  needs_assembly: boolean | null;
  // Phase B (session 79): per-item coverage fields.
  declared_value: number | null;
  coverage_option_id: string | null;
  // COD Storage (end customers pay storage).
  cod_storage: boolean | null;
  cod_storage_start_date: string | null;
}

// Session 72 — shared raw inventory rows fetcher with scope-keyed dedup.
// Used by both fetchInventoryFromSupabase (useInventory) and _fetchInvFieldMap
// (the overlay called from tasks/repairs/will_calls). Previously each did its
// own full pagination, doubling network traffic for the same data.
const _inventoryRowsInflight = new Map<string, Promise<SupabaseInventoryRow[] | null>>();

function _inventoryScopeKey(clientSheetId?: string | string[]): string {
  if (!clientSheetId) return '__all__';
  if (Array.isArray(clientSheetId)) return clientSheetId.slice().sort().join(',');
  return clientSheetId;
}

export async function fetchRawInventoryRows(clientSheetId?: string | string[]): Promise<SupabaseInventoryRow[] | null> {
  const key = _inventoryScopeKey(clientSheetId);
  const existing = _inventoryRowsInflight.get(key);
  if (existing) return existing;
  // v38.65.0 — paginate instead of a single `.range(0, 49999)`. The previous
  // approach hit the Supabase project `max_rows` cap (1000) which silently
  // truncated the result, causing "Select All → only N-S clients showing"
  // because the first 1000 rows (by tenant_id hash order) covered only a
  // subset of tenants. Inventory currently has ~4.8k rows across 47 tenants;
  // pagination iterates in 1000-row chunks until the server returns <1000.
  const p = paginateAll<SupabaseInventoryRow>(() => {
    let query = supabase.from('inventory').select('*');
    if (clientSheetId) {
      if (Array.isArray(clientSheetId)) {
        if (clientSheetId.length > 0) query = query.in('tenant_id', clientSheetId);
      } else {
        query = query.eq('tenant_id', clientSheetId);
      }
    }
    return query as unknown as { range: (from: number, to: number) => Promise<{ data: SupabaseInventoryRow[] | null; error: unknown }> };
  });
  _inventoryRowsInflight.set(key, p);
  p.finally(() => { if (_inventoryRowsInflight.get(key) === p) _inventoryRowsInflight.delete(key); });
  return p;
}

export async function fetchInventoryFromSupabase(
  clientNameMap: ClientNameMap,
  clientSheetId?: string | string[]
): Promise<InventoryResponse | null> {
  try {
    const data = await fetchRawInventoryRows(clientSheetId);
    if (!data) return null;

    const items: ApiInventoryItem[] = data.map(row => ({
      // Inventory row UUID — surfaced so the Create Delivery Order modal
      // can populate dt_order_items.inventory_id (UUID FK) when items
      // are added from inventory. Without it, dt_order_items rows have
      // no link back to the source inventory row, which broke the
      // OrderPage Release Items button.
      inventoryRowId: row.id,
      itemId: row.item_id,
      clientName: clientNameMap[row.tenant_id] || '',
      clientSheetId: row.tenant_id,
      reference: row.reference || '',
      qty: row.qty ?? 1,
      vendor: row.vendor || '',
      description: row.description || '',
      itemClass: row.item_class || '',
      location: row.location || '',
      sidemark: row.sidemark || '',
      room: row.room || '',
      itemNotes: row.item_notes || '',
      taskNotes: row.task_notes || '',
      needsInspection: !!row.needs_inspection,
      needsAssembly: !!row.needs_assembly,
      carrier: row.carrier || '',
      trackingNumber: row.tracking_number || '',
      shipmentNumber: row.shipment_number || '',
      receiveDate: row.receive_date || '',
      releaseDate: row.release_date || '',
      status: row.status || 'Active',
      invoiceUrl: row.invoice_url || '',
      shipmentFolderUrl: row.shipment_folder_url || undefined,
      // Phase B (session 79): coverage fields.
      declaredValue: row.declared_value ?? 0,
      coverageOptionId: row.coverage_option_id ?? '',
      // COD Storage (end customers pay storage).
      codStorage: !!row.cod_storage,
      codStorageStartDate: row.cod_storage_start_date || '',
    }));

    return {
      items,
      count: items.length,
      clientsQueried: Array.isArray(clientSheetId) ? clientSheetId.length : (clientSheetId ? 1 : Object.keys(clientNameMap).length),
    };
  } catch {
    return null;
  }
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

interface SupabaseTaskRow {
  tenant_id: string;
  task_id: string;
  item_id: string | null;
  type: string | null;
  status: string | null;
  result: string | null;
  description: string | null;
  task_notes: string | null;
  item_notes: string | null;
  custom_price: number | null;
  created: string | null;
  completed_at: string | null;
  assigned_to: string | null;
  location: string | null;
  task_folder_url: string | null;
  shipment_folder_url: string | null;
  // Phase A — job detail fast-open columns
  vendor: string | null;
  sidemark: string | null;
  shipment_number: string | null;
  cancelled_at: string | null;
  started_at: string | null;
  billed: boolean | null;
  client_name: string | null;
  due_date: string | null;
  priority: string | null;
  qty: number | null;
}

/**
 * Session 69 Phase 4: Fetch ALL inventory fields per item from Supabase.
 * Used by fetchTasks/Repairs/WillCalls/DashboardFromSupabase to overlay
 * authoritative item-level fields on top of stale entity-table copies.
 * Every Inventory column is available so any page can use any field
 * without needing a code change here.
 */
interface InvFieldMapEntry {
  location: string; vendor: string; sidemark: string; description: string;
  room: string; reference: string; itemClass: string; qty: number;
  status: string; itemNotes: string; taskNotes: string;
  receiveDate: string; releaseDate: string; carrier: string;
  trackingNumber: string; shipmentNumber: string;
  itemFolderUrl: string; shipmentFolderUrl: string;
  shipmentPhotosUrl: string; inspectionPhotosUrl: string;
  repairPhotosUrl: string; invoiceUrl: string; transferDate: string;
}

async function _fetchInvFieldMap(clientSheetId?: string | string[]): Promise<Record<string, InvFieldMapEntry>> {
  const map: Record<string, InvFieldMapEntry> = {};
  try {
    // Session 72: share raw rows fetch with fetchInventoryFromSupabase.
    // Previously each did its own paginateAll, producing 2× pagination on
    // pages that touch both (Dashboard, Inventory+tasks overlay, etc.).
    const data = await fetchRawInventoryRows(clientSheetId);
    if (data) {
      for (const row of data as SupabaseInventoryRow[]) {
        if (row.item_id) {
          map[row.item_id] = {
            location: row.location ?? '',
            vendor: row.vendor ?? '',
            sidemark: row.sidemark ?? '',
            description: row.description ?? '',
            room: row.room ?? '',
            reference: row.reference ?? '',
            itemClass: row.item_class ?? '',
            qty: row.qty ?? 1,
            status: row.status ?? '',
            itemNotes: row.item_notes ?? '',
            taskNotes: row.task_notes ?? '',
            receiveDate: row.receive_date ?? '',
            releaseDate: row.release_date ?? '',
            carrier: row.carrier ?? '',
            trackingNumber: row.tracking_number ?? '',
            shipmentNumber: row.shipment_number ?? '',
            itemFolderUrl: row.item_folder_url ?? '',
            shipmentFolderUrl: row.shipment_folder_url ?? '',
            shipmentPhotosUrl: row.shipment_photos_url ?? '',
            inspectionPhotosUrl: row.inspection_photos_url ?? '',
            repairPhotosUrl: row.repair_photos_url ?? '',
            invoiceUrl: row.invoice_url ?? '',
            transferDate: row.transfer_date ?? '',
          };
        }
      }
    }
  } catch { /* best-effort */ }
  return map;
}

export async function fetchTasksFromSupabase(
  clientNameMap: ClientNameMap,
  clientSheetId?: string | string[]
): Promise<TasksResponse | null> {
  try {
    let query = supabase.from('tasks').select('*');
    if (clientSheetId) {
      if (Array.isArray(clientSheetId)) {
        if (clientSheetId.length > 0) query = query.in('tenant_id', clientSheetId);
      } else {
        query = query.eq('tenant_id', clientSheetId);
      }
    }
    query = query.range(0, 49999); // override 1000-row cap
    const { data, error } = await query;
    if (error || !data) return null;

    const tasks: ApiTask[] = (data as SupabaseTaskRow[]).map(row => mapSupabaseTaskRow(row, clientNameMap));

    // Session 69 Phase 4: overlay inventory fields (authoritative source)
    const invMap = await _fetchInvFieldMap(clientSheetId);
    for (const task of tasks) {
      const inv = task.itemId ? invMap[task.itemId] : null;
      if (inv) {
        if (inv.location) task.location = inv.location;
        if (inv.vendor) task.vendor = inv.vendor;
        if (inv.sidemark) task.sidemark = inv.sidemark;
        if (inv.description) task.description = inv.description;
        if (inv.room) task.room = inv.room;
        if (inv.reference) task.reference = inv.reference;
        if (inv.itemClass) task.itemClass = inv.itemClass;
        if (inv.carrier) task.carrier = inv.carrier;
        if (inv.trackingNumber) task.trackingNumber = inv.trackingNumber;
        if (inv.shipmentNumber) task.shipmentNumber = inv.shipmentNumber;
        if (inv.itemNotes) task.itemNotes = inv.itemNotes;
        // taskNotes NOT overlaid — entity-specific
        if (inv.shipmentFolderUrl) task.shipmentFolderUrl = inv.shipmentFolderUrl;
        if (inv.shipmentPhotosUrl) task.shipmentPhotosUrl = inv.shipmentPhotosUrl;
        if (inv.inspectionPhotosUrl) task.inspectionPhotosUrl = inv.inspectionPhotosUrl;
        if (inv.repairPhotosUrl) task.repairPhotosUrl = inv.repairPhotosUrl;
      }
    }

    return {
      tasks,
      count: tasks.length,
      clientsQueried: Array.isArray(clientSheetId) ? clientSheetId.length : (clientSheetId ? 1 : Object.keys(clientNameMap).length),
    };
  } catch {
    return null;
  }
}

// ─── Repairs ─────────────────────────────────────────────────────────────────

interface SupabaseRepairRow {
  tenant_id: string;
  repair_id: string;
  item_id: string | null;
  status: string | null;
  repair_result: string | null;
  quote_amount: number | null;
  final_amount: number | null;
  repair_vendor: string | null;
  repair_notes: string | null;
  task_notes: string | null;
  item_notes: string | null;
  created_date: string | null;
  completed_date: string | null;
  quote_sent_date: string | null;
  scheduled_date: string | null;
  start_date: string | null;
  created_by: string | null;
  repair_folder_url: string | null;
  shipment_folder_url: string | null;
  task_folder_url: string | null;
  // Stage A mirror drift: repair-owned fields added to inventory table
  source_task_id: string | null;
  parts_cost: number | null;
  labor_hours: number | null;
  invoice_id: string | null;
  approved: boolean | null;
  billed: boolean | null;
  // v38.120.0 — multi-line repair quote columns. quote_lines_json is
  // jsonb on the server; arrives parsed.
  quote_lines_json: unknown | null;
  quote_subtotal: number | null;
  quote_taxable_subtotal: number | null;
  quote_tax_area_id: string | null;
  quote_tax_area_name: string | null;
  quote_tax_rate: number | null;
  quote_tax_amount: number | null;
  quote_grand_total: number | null;
}

export async function fetchRepairsFromSupabase(
  clientNameMap: ClientNameMap,
  clientSheetId?: string | string[]
): Promise<RepairsResponse | null> {
  try {
    let query = supabase.from('repairs').select('*');
    if (clientSheetId) {
      if (Array.isArray(clientSheetId)) {
        if (clientSheetId.length > 0) query = query.in('tenant_id', clientSheetId);
      } else {
        query = query.eq('tenant_id', clientSheetId);
      }
    }
    query = query.range(0, 49999); // override 1000-row cap
    const { data, error } = await query;
    if (error || !data) return null;

    const repairs: ApiRepair[] = (data as SupabaseRepairRow[]).map(row => ({
      repairId: row.repair_id,
      clientName: clientNameMap[row.tenant_id] || '',
      clientSheetId: row.tenant_id,
      sourceTaskId: row.source_task_id || '',
      itemId: row.item_id || '',
      description: '',
      itemClass: '',
      vendor: '',
      location: '',
      sidemark: '',
      taskNotes: row.task_notes || '',
      createdBy: row.created_by || '',
      createdDate: row.created_date || '',
      quoteAmount: row.quote_amount,
      quoteSentDate: row.quote_sent_date || '',
      status: row.status || '',
      approved: !!row.approved,
      scheduledDate: row.scheduled_date || '',
      startDate: row.start_date || '',
      repairVendor: row.repair_vendor || '',
      partsCost: row.parts_cost,
      laborHours: row.labor_hours,
      repairResult: row.repair_result || '',
      finalAmount: row.final_amount,
      invoiceId: row.invoice_id || '',
      itemNotes: row.item_notes || '',
      repairNotes: row.repair_notes || '',
      completedDate: row.completed_date || '',
      billed: !!row.billed,
      repairFolderUrl: row.repair_folder_url || '',
      shipmentFolderUrl: row.shipment_folder_url || '',
      taskFolderUrl: row.task_folder_url || '',
      // v38.120.0 — multi-line repair quote fields. quote_lines_json is
      // jsonb on the server, so it arrives as a parsed array. NULL on
      // legacy rows is the back-compat sentinel.
      quoteLines: Array.isArray(row.quote_lines_json)
        ? (row.quote_lines_json as ApiRepairQuoteLine[])
        : null,
      quoteSubtotal:        row.quote_subtotal != null ? Number(row.quote_subtotal) : null,
      quoteTaxableSubtotal: row.quote_taxable_subtotal != null ? Number(row.quote_taxable_subtotal) : null,
      quoteTaxAreaId:       row.quote_tax_area_id || null,
      quoteTaxAreaName:     row.quote_tax_area_name || null,
      quoteTaxRate:         row.quote_tax_rate != null ? Number(row.quote_tax_rate) : null,
      quoteTaxAmount:       row.quote_tax_amount != null ? Number(row.quote_tax_amount) : null,
      quoteGrandTotal:      row.quote_grand_total != null ? Number(row.quote_grand_total) : null,
    }));

    // Session 69 Phase 4: overlay inventory fields (authoritative source)
    const invMap = await _fetchInvFieldMap(clientSheetId);
    for (const repair of repairs) {
      const inv = repair.itemId ? invMap[repair.itemId] : null;
      if (inv) {
        if (inv.location) repair.location = inv.location;
        if (inv.vendor) repair.vendor = inv.vendor;
        if (inv.sidemark) repair.sidemark = inv.sidemark;
        if (inv.description) repair.description = inv.description;
        if (inv.room) repair.room = inv.room;
        if (inv.reference) repair.reference = inv.reference;
        if (inv.itemClass) repair.itemClass = inv.itemClass;
        if (inv.carrier) repair.carrier = inv.carrier;
        if (inv.trackingNumber) repair.trackingNumber = inv.trackingNumber;
        if (inv.itemNotes) repair.itemNotes = inv.itemNotes;
        if (inv.shipmentFolderUrl) repair.shipmentFolderUrl = inv.shipmentFolderUrl;
        if (inv.shipmentPhotosUrl) repair.shipmentPhotosUrl = inv.shipmentPhotosUrl;
        if (inv.inspectionPhotosUrl) repair.inspectionPhotosUrl = inv.inspectionPhotosUrl;
        if (inv.repairPhotosUrl) repair.repairPhotosUrl = inv.repairPhotosUrl;
      }
    }

    return {
      repairs,
      count: repairs.length,
      clientsQueried: Array.isArray(clientSheetId) ? clientSheetId.length : (clientSheetId ? 1 : Object.keys(clientNameMap).length),
    };
  } catch {
    return null;
  }
}

// ─── Will Calls ──────────────────────────────────────────────────────────────

interface SupabaseWillCallRow {
  tenant_id: string;
  wc_number: string;
  status: string | null;
  carrier: string | null;
  pickup_party: string | null;
  created_date: string | null;
  estimated_pickup_date: string | null;
  notes: string | null;
  item_count: number | null;
  wc_folder_url: string | null;
  shipment_folder_url: string | null;
  cod: boolean | null;
  cod_amount: number | null;
  item_ids: string[] | null;
  // Stage A mirror drift: WC-owned fields
  created_by: string | null;
  pickup_phone: string | null;
  requested_by: string | null;
  actual_pickup_date: string | null;
  total_wc_fee: number | null;
}

// Stage A new table mirror — WC line items (previously missing, forced GAS fallback).
interface SupabaseWillCallItemRow {
  tenant_id: string;
  wc_number: string;
  item_id: string;
  qty: number | null;
  wc_fee: number | null;
  status: string | null;
  released: boolean | null;
}

export async function fetchWillCallsFromSupabase(
  clientNameMap: ClientNameMap,
  clientSheetId?: string | string[]
): Promise<WillCallsResponse | null> {
  try {
    let query = supabase.from('will_calls').select('*');
    if (clientSheetId) {
      if (Array.isArray(clientSheetId)) {
        if (clientSheetId.length > 0) query = query.in('tenant_id', clientSheetId);
      } else {
        query = query.eq('tenant_id', clientSheetId);
      }
    }
    query = query.range(0, 49999); // override 1000-row cap
    const { data, error } = await query;
    if (error || !data) return null;

    const willCalls: ApiWillCall[] = (data as SupabaseWillCallRow[]).map(row => ({
      wcNumber: row.wc_number,
      clientName: clientNameMap[row.tenant_id] || '',
      clientSheetId: row.tenant_id,
      status: row.status || 'Pending',
      createdDate: row.created_date || '',
      createdBy: row.created_by || '',
      pickupParty: row.pickup_party || '',
      pickupPhone: row.pickup_phone || '',
      requestedBy: row.requested_by || '',
      estimatedPickupDate: row.estimated_pickup_date || '',
      actualPickupDate: row.actual_pickup_date || '',
      notes: row.notes || '',
      cod: row.cod ?? false,
      codAmount: row.cod_amount != null ? Number(row.cod_amount) : null,
      itemsCount: row.item_count ?? 0,
      totalWcFee: row.total_wc_fee,
      items: [], // populated below from will_call_items + inv overlay
      // v38.72.1 — item_ids was historically written double-encoded (JSON.stringify'd
      // array stored in a jsonb column, producing a jsonb string like "[\"60918\",…]").
      // StrideAPI now writes native arrays, but defensively handle both shapes
      // during rollout + for any stragglers.
      itemIds: (() => {
        const raw = row.item_ids as unknown;
        if (Array.isArray(raw)) return raw as string[];
        if (typeof raw === 'string') {
          try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed as string[] : [];
          } catch { return []; }
        }
        return [];
      })(),
      wcFolderUrl: row.wc_folder_url || '',
      shipmentFolderUrl: row.shipment_folder_url || '',
    }));

    // Stage A: load will_call_items rows for these WCs and fold them into
    // each WC's items[] array. Inv-overlay fields applied at read time per
    // Invariant #27 (Inventory is single source of truth).
    if (willCalls.length > 0) {
      try {
        const wcNumbers = willCalls.map(w => w.wcNumber);
        let itemsQuery = supabase.from('will_call_items').select('*').in('wc_number', wcNumbers);
        if (clientSheetId) {
          if (Array.isArray(clientSheetId)) {
            if (clientSheetId.length > 0) itemsQuery = itemsQuery.in('tenant_id', clientSheetId);
          } else {
            itemsQuery = itemsQuery.eq('tenant_id', clientSheetId);
          }
        }
        const { data: itemRows } = await itemsQuery;
        if (itemRows && itemRows.length > 0) {
          const invMap = await _fetchInvFieldMap(clientSheetId);
          const byWc: Record<string, ApiWillCall['items']> = {};
          for (const r of (itemRows as SupabaseWillCallItemRow[])) {
            const inv = r.item_id ? invMap[r.item_id] : null;
            if (!byWc[r.wc_number]) byWc[r.wc_number] = [];
            byWc[r.wc_number].push({
              wcNumber: r.wc_number,
              itemId: r.item_id,
              qty: Number(r.qty) || 1,
              vendor: inv?.vendor || '',
              description: inv?.description || '',
              itemClass: inv?.itemClass || '',
              location: inv?.location || '',
              sidemark: inv?.sidemark || '',
              room: inv?.room || '',
              wcFee: r.wc_fee != null ? Number(r.wc_fee) : null,
              released: !!r.released,
              status: r.status || '',
            });
          }
          for (const wc of willCalls) {
            wc.items = byWc[wc.wcNumber] || [];
            // Overlay shipmentFolderUrl from inventory if WC row has none
            if (!wc.shipmentFolderUrl) {
              const firstItemId = wc.itemIds?.[0];
              const inv = firstItemId ? invMap[firstItemId] : null;
              if (inv?.shipmentFolderUrl) wc.shipmentFolderUrl = inv.shipmentFolderUrl;
            }
          }
        }
      } catch {
        // non-fatal — WC list still works without items; detail panel will
        // either show empty items or React can re-fetch from GAS if needed.
      }

      // v2 — itemIds + inventory fallback for WCs whose will_call_items
      // rows aren't populated in Supabase. The will_call_items mirror
      // has gaps (no GAS write path populates that table consistently
      // for newly-released WCs), so without this fallback wc.items
      // stays empty and the detail panel shows a "loading items"
      // flash while enriching via a separate fetch. Mirrors the
      // single-WC fetcher's fallback at line ~1277. Per Invariant #27,
      // inventory is the source of truth for item-level fields; itemIds
      // is just the membership list.
      try {
        const wcsNeedingFallback = willCalls.filter(w => w.items.length === 0 && Array.isArray(w.itemIds) && w.itemIds.length > 0);
        if (wcsNeedingFallback.length > 0) {
          const invMap = await _fetchInvFieldMap(clientSheetId);
          for (const wc of wcsNeedingFallback) {
            const ids = wc.itemIds || [];
            wc.items = ids.map(id => {
              const inv = invMap[id];
              return {
                wcNumber: wc.wcNumber,
                itemId: id,
                qty: inv?.qty ?? 1,
                vendor: inv?.vendor || '',
                description: inv?.description || '',
                itemClass: inv?.itemClass || '',
                location: inv?.location || '',
                sidemark: inv?.sidemark || '',
                room: inv?.room || '',
                wcFee: null,
                released: false,
                status: inv?.status || '',
              };
            });
            if (!wc.shipmentFolderUrl && ids.length > 0) {
              const inv = invMap[ids[0]];
              if (inv?.shipmentFolderUrl) wc.shipmentFolderUrl = inv.shipmentFolderUrl;
            }
          }
        }
      } catch {
        // non-fatal — same downstream behavior as before this fallback ran
      }
    }

    return {
      willCalls,
      count: willCalls.length,
      clientsQueried: Array.isArray(clientSheetId) ? clientSheetId.length : (clientSheetId ? 1 : Object.keys(clientNameMap).length),
    };
  } catch {
    return null;
  }
}

// ─── Shipments ───────────────────────────────────────────────────────────────

interface SupabaseShipmentRow {
  tenant_id: string;
  shipment_number: string;
  receive_date: string | null;
  item_count: number | null;
  carrier: string | null;
  tracking_number: string | null;
  notes: string | null;
  folder_url: string | null;
  // Stage A mirror drift: shipment-owned URLs
  photos_url: string | null;
  invoice_url: string | null;
  // 2-stage receiving — columns added by 2026-05-21 migration. Pre-migration
  // rows return null/undefined and are treated as 'received' in the UI
  // (default to the legacy single-stage state).
  inbound_status?: string | null;
  dock_piece_count?: number | null;
  dock_completed_at?: string | null;
  dock_completed_by?: string | null;
}

export async function fetchShipmentsFromSupabase(
  clientNameMap: ClientNameMap,
  clientSheetId?: string | string[]
): Promise<ShipmentsResponse | null> {
  try {
    let query = supabase.from('shipments').select('*');
    if (clientSheetId) {
      if (Array.isArray(clientSheetId)) {
        if (clientSheetId.length > 0) query = query.in('tenant_id', clientSheetId);
      } else {
        query = query.eq('tenant_id', clientSheetId);
      }
    }
    query = query.range(0, 49999); // override 1000-row cap
    const { data, error } = await query;
    if (error || !data) return null;

    const shipments: ApiShipment[] = (data as SupabaseShipmentRow[]).map(row => ({
      shipmentNumber: row.shipment_number,
      clientName: clientNameMap[row.tenant_id] || '',
      clientSheetId: row.tenant_id,
      receiveDate: row.receive_date || '',
      itemCount: row.item_count ?? 0,
      carrier: row.carrier || '',
      trackingNumber: row.tracking_number || '',
      photosUrl: row.photos_url || '',
      notes: row.notes || '',
      invoiceUrl: row.invoice_url || '',
      folderUrl: row.folder_url || '',
      inboundStatus: row.inbound_status || '',
      dockPieceCount: row.dock_piece_count ?? null,
      dockCompletedAt: row.dock_completed_at ?? null,
      dockCompletedBy: row.dock_completed_by ?? null,
    }));

    return {
      shipments,
      count: shipments.length,
      clientsQueried: Array.isArray(clientSheetId) ? clientSheetId.length : (clientSheetId ? 1 : Object.keys(clientNameMap).length),
    };
  } catch {
    return null;
  }
}

export async function fetchShipmentByNoFromSupabase(
  shipmentNo: string
): Promise<ApiShipment | null> {
  try {
    const { data, error } = await supabase
      .from('shipments')
      .select('*')
      .eq('shipment_number', shipmentNo)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as SupabaseShipmentRow;
    return {
      shipmentNumber: row.shipment_number,
      clientName: '',
      clientSheetId: row.tenant_id,
      receiveDate: row.receive_date || '',
      itemCount: row.item_count ?? 0,
      carrier: row.carrier || '',
      trackingNumber: row.tracking_number || '',
      photosUrl: '',
      notes: row.notes || '',
      invoiceUrl: '',
      folderUrl: row.folder_url || '',
      inboundStatus: row.inbound_status || '',
      dockPieceCount: row.dock_piece_count ?? null,
      dockCompletedAt: row.dock_completed_at ?? null,
      dockCompletedBy: row.dock_completed_by ?? null,
    };
  } catch {
    return null;
  }
}

// ─── Shipment Items (from inventory table) ──────────────────────────────────

/**
 * Session 71: Fetch shipment items directly from Supabase inventory table.
 * Shipment items are just inventory rows filtered by shipment_number + tenant_id.
 * ~50ms vs 2-5s from GAS. No new table needed.
 */
export async function fetchShipmentItemsFromSupabase(
  clientSheetId: string,
  shipmentNo: string
): Promise<{ items: ApiShipmentItem[]; count: number } | null> {
  try {
    const { data, error } = await supabase
      .from('inventory')
      .select('item_id, description, item_class, qty, location, vendor, sidemark, room, reference, carrier, tracking_number, status, item_notes, receive_date, item_folder_url, shipment_photos_url, inspection_photos_url, repair_photos_url')
      .eq('tenant_id', clientSheetId)
      .eq('shipment_number', shipmentNo);
    if (error || !data) return null;
    const items: ApiShipmentItem[] = (data as SupabaseInventoryRow[]).map(row => ({
      itemId: row.item_id,
      description: row.description || '',
      itemClass: row.item_class || '',
      qty: row.qty ?? 1,
      location: row.location || '',
      vendor: row.vendor || '',
      sidemark: row.sidemark || '',
      room: row.room || '',
      reference: row.reference || '',
      carrier: row.carrier || '',
      trackingNumber: row.tracking_number || '',
      status: row.status || 'Active',
      itemNotes: row.item_notes || '',
      receiveDate: row.receive_date || '',
    }));
    return { items, count: items.length };
  } catch {
    return null;
  }
}

// ─── Will Call Items (from inventory table via item_id lookup) ───────────────

/**
 * Session 71: Fetch WC item details from Supabase inventory table.
 * The will_calls table doesn't store items. Given a list of item IDs
 * (from the WC header's known items), look up full item data from inventory.
 * This enables fast item display without hitting GAS.
 */
export async function fetchWcItemsFromSupabase(
  clientSheetId: string,
  itemIds: string[]
): Promise<Record<string, {
  vendor: string; description: string; location: string;
  sidemark: string; room: string; reference: string;
  itemClass: string; qty: number; status: string;
}> | null> {
  if (!itemIds.length) return {};
  try {
    const { data, error } = await supabase
      .from('inventory')
      .select('item_id, vendor, description, location, sidemark, room, reference, item_class, qty, status')
      .eq('tenant_id', clientSheetId)
      .in('item_id', itemIds);
    if (error || !data) return null;
    const map: Record<string, any> = {};
    for (const row of data as SupabaseInventoryRow[]) {
      if (row.item_id) {
        map[row.item_id] = {
          vendor: row.vendor || '',
          description: row.description || '',
          location: row.location || '',
          sidemark: row.sidemark || '',
          room: row.room || '',
          reference: row.reference || '',
          itemClass: row.item_class || '',
          qty: row.qty ?? 1,
          status: row.status || 'Active',
        };
      }
    }
    return map;
  } catch {
    return null;
  }
}

// ─── Billing ─────────────────────────────────────────────────────────────────

interface SupabaseBillingRow {
  tenant_id: string;
  ledger_row_id: string;
  status: string | null;
  invoice_no: string | null;
  client_name: string | null;
  date: string | null;
  svc_code: string | null;
  svc_name: string | null;
  category: string | null;
  item_id: string | null;
  description: string | null;
  item_class: string | null;
  qty: number | null;
  rate: number | null;
  total: number | null;
  task_id: string | null;
  repair_id: string | null;
  shipment_number: string | null;
  item_notes: string | null;
  invoice_date: string | null;
  invoice_url: string | null;
  sidemark: string | null;
  reference: string | null;
}

export async function fetchBillingFromSupabase(
  clientNameMap: ClientNameMap,
  clientSheetId?: string
): Promise<BillingResponse | null> {
  try {
    // Paginate via paginateAll — the Supabase project enforces a 1000-row
    // server-side cap that silently truncates `.range(0, 49999)` calls.
    // Without pagination, multi-tenant billing tables with >1000 rows lose
    // entire clients (the back half of the alphabet, by tenant_id hash
    // order). See pagination helper docstring above.
    const data = await paginateAll<SupabaseBillingRow>(() => {
      let query = supabase.from('billing').select('*');
      if (clientSheetId) {
        query = query.eq('tenant_id', clientSheetId);
      }
      return query as unknown as { range: (from: number, to: number) => Promise<{ data: SupabaseBillingRow[] | null; error: unknown }> };
    }, 'billing');
    if (!data) {
      console.warn('[supabaseQueries] fetchBillingFromSupabase: paginateAll returned null — caller will fall back to GAS');
      return null;
    }
    console.info(`[supabaseQueries] fetchBillingFromSupabase: returned ${data.length} rows (scope=${clientSheetId ?? 'all-tenants'})`);

    const summary: BillingSummary = { unbilled: 0, invoiced: 0, billed: 0, void_count: 0, totalUnbilled: 0 };

    const rows: ApiBillingRow[] = (data as SupabaseBillingRow[]).map(row => {
      const status = row.status || 'Unbilled';
      const total = row.total ?? 0;
      if (status === 'Unbilled') { summary.unbilled++; summary.totalUnbilled += total; }
      else if (status === 'Invoiced') { summary.invoiced++; }
      else if (status === 'Billed') { summary.billed++; }
      else if (status === 'Void') { summary.void_count++; }

      return {
        ledgerRowId: row.ledger_row_id,
        clientName: clientNameMap[row.tenant_id] || row.client_name || '',
        clientSheetId: row.tenant_id,
        status,
        invoiceNo: row.invoice_no || '',
        client: row.client_name || clientNameMap[row.tenant_id] || '',
        date: row.date || '',
        svcCode: row.svc_code || '',
        svcName: row.svc_name || '',
        category: row.category || '',
        itemId: row.item_id || '',
        description: row.description || '',
        itemClass: row.item_class || '',
        qty: row.qty ?? 0,
        rate: row.rate,
        total: row.total,
        taskId: row.task_id || '',
        repairId: row.repair_id || '',
        shipmentNo: row.shipment_number || '',
        itemNotes: row.item_notes || '',
        invoiceDate: row.invoice_date || '',
        invoiceUrl: row.invoice_url || '',
        sidemark: row.sidemark || '',
        reference: row.reference || '',
      };
    });

    return {
      rows,
      count: rows.length,
      clientsQueried: clientSheetId ? 1 : Object.keys(clientNameMap).length,
      summary,
    };
  } catch (e) {
    console.warn('[supabaseQueries] fetchBillingFromSupabase: threw — caller will fall back to GAS', e);
    return null;
  }
}

/**
 * Billing filter mirror — Supabase-first equivalent of GAS getBilling with
 * server-side filters. Returns null on any error so the caller can fall back
 * to the GAS API.
 *
 * Filter mapping:
 *   clientFilter (names)  → tenant_id IN (ids resolved via reverse-lookup)
 *   statusFilter          → status IN (...)
 *   svcFilter (codes)     → svc_code IN (...)
 *   sidemarkFilter        → sidemark IN (...)
 *   categoryFilter        → category IN (...)
 *   endDate               → date <= endDate
 */
export async function fetchBillingFromSupabaseFiltered(
  filters: BillingFilterParams,
  clientNameMap: ClientNameMap,
): Promise<BillingResponse | null> {
  try {
    // Build reverse name→id map so clientFilter (names) maps to tenant_ids
    const nameToId: Record<string, string> = {};
    for (const [id, name] of Object.entries(clientNameMap)) {
      nameToId[name] = id;
    }

    // Pre-resolve clientFilter before paginateAll's buildQuery callback runs
    // (the callback rebuilds the query on each page; resolving once avoids
    // re-doing the name→id lookup per page).
    let tenantIds: string[] | null = null;
    if (filters.clientFilter?.length) {
      tenantIds = filters.clientFilter.map(n => nameToId[n]).filter(Boolean);
      if (tenantIds.length === 0) {
        console.warn('[supabaseQueries] clientFilter provided but no tenant_ids resolved — falling back to GAS');
        return null;
      }
    }

    // Paginate via paginateAll — the Supabase project enforces a 1000-row
    // server-side cap that silently truncates `.range(0, 49999)` calls.
    // Without pagination, a filtered query like Invoiced status across all
    // tenants caps at 1000 rows and the back half of the alphabet drops out
    // (~3,493 invoiced rows shown as ~900). See pagination helper docstring.
    const data = await paginateAll<SupabaseBillingRow>(() => {
      let query = supabase.from('billing').select('*');
      if (tenantIds) {
        query = query.in('tenant_id', tenantIds);
      }
      if (filters.statusFilter?.length) {
        query = query.in('status', filters.statusFilter);
      }
      if (filters.svcFilter?.length) {
        query = query.in('svc_code', filters.svcFilter);
      }
      if (filters.sidemarkFilter?.length) {
        query = query.in('sidemark', filters.sidemarkFilter);
      }
      if (filters.categoryFilter?.length) {
        query = query.in('category', filters.categoryFilter);
      }
      if (filters.endDate) {
        query = query.lte('date', filters.endDate);
      }
      return query as unknown as { range: (from: number, to: number) => Promise<{ data: SupabaseBillingRow[] | null; error: unknown }> };
    }, 'billing-filtered');
    if (!data) {
      console.warn('[supabaseQueries] fetchBillingFromSupabaseFiltered: paginateAll returned null — caller will fall back to GAS', { filters });
      return null;
    }
    console.info(`[supabaseQueries] fetchBillingFromSupabaseFiltered: returned ${data.length} rows`, { filters });

    const summary: BillingSummary = { unbilled: 0, invoiced: 0, billed: 0, void_count: 0, totalUnbilled: 0 };

    const rows: ApiBillingRow[] = (data as SupabaseBillingRow[]).map(row => {
      const status = row.status || 'Unbilled';
      const total = row.total ?? 0;
      if (status === 'Unbilled') { summary.unbilled++; summary.totalUnbilled += total; }
      else if (status === 'Invoiced') { summary.invoiced++; }
      else if (status === 'Billed') { summary.billed++; }
      else if (status === 'Void') { summary.void_count++; }

      return {
        ledgerRowId: row.ledger_row_id,
        clientName: clientNameMap[row.tenant_id] || row.client_name || '',
        clientSheetId: row.tenant_id,
        status,
        invoiceNo: row.invoice_no || '',
        client: row.client_name || clientNameMap[row.tenant_id] || '',
        date: row.date || '',
        svcCode: row.svc_code || '',
        svcName: row.svc_name || '',
        category: row.category || '',
        itemId: row.item_id || '',
        description: row.description || '',
        itemClass: row.item_class || '',
        qty: row.qty ?? 0,
        rate: row.rate,
        total: row.total,
        taskId: row.task_id || '',
        repairId: row.repair_id || '',
        shipmentNo: row.shipment_number || '',
        itemNotes: row.item_notes || '',
        invoiceDate: row.invoice_date || '',
        invoiceUrl: row.invoice_url || '',
        sidemark: row.sidemark || '',
        reference: row.reference || '',
      };
    });

    return {
      rows,
      count: rows.length,
      clientsQueried: filters.clientFilter?.length ?? Object.keys(clientNameMap).length,
      summary,
    };
  } catch (e) {
    console.warn('[supabaseQueries] fetchBillingFromSupabaseFiltered: threw — caller will fall back to GAS', e);
    return null;
  }
}

/**
 * Fetch distinct non-empty sidemarks from the billing cache for the given
 * tenant_ids. Used to populate the Sidemark filter before a full report load.
 * Returns null on error (caller falls back to empty list).
 */
export async function fetchBillingSidemarksFromSupabase(
  tenantIds: string[],
): Promise<string[] | null> {
  try {
    let query = supabase
      .from('billing')
      .select('sidemark')
      .not('sidemark', 'is', null)
      .neq('sidemark', '');
    if (tenantIds.length) {
      query = query.in('tenant_id', tenantIds);
    }
    const { data, error } = await query;
    if (error || !data) return null;
    const sidemarks = [...new Set(
      (data as { sidemark: string | null }[]).map(r => r.sidemark).filter(Boolean) as string[]
    )].sort();
    return sidemarks;
  } catch {
    return null;
  }
}

// ─── Shared task row mapper ──────────────────────────────────────────────────

function mapSupabaseTaskRow(row: SupabaseTaskRow, clientNameMap?: ClientNameMap): ApiTask {
  return {
    taskId: row.task_id,
    clientName: row.client_name || (clientNameMap ? clientNameMap[row.tenant_id] || '' : ''),
    clientSheetId: row.tenant_id,
    type: row.type || '',
    status: row.status || 'Open',
    itemId: row.item_id || '',
    vendor: row.vendor || '',
    description: row.description || '',
    location: row.location || '',
    sidemark: row.sidemark || '',
    shipmentNumber: row.shipment_number || '',
    created: row.created || '',
    itemNotes: row.item_notes || '',
    completedAt: row.completed_at || '',
    cancelledAt: row.cancelled_at || '',
    result: row.result || '',
    taskNotes: row.task_notes || '',
    svcCode: row.type || '',
    billed: row.billed ?? false,
    assignedTo: row.assigned_to || '',
    startedAt: row.started_at || '',
    customPrice: row.custom_price ?? undefined,
    // tasks.qty — 2026-05-21, added so per-task quantities (inspection
    // finds extras in a box, etc.) bill as qty × rate. Default 1 mirrors
    // the column DEFAULT and the COALESCE in complete_task_atomic so
    // pre-migration tasks (where the row may not yet have qty) still
    // render as "1 × rate".
    qty: row.qty ?? 1,
    taskFolderUrl: row.task_folder_url || '',
    shipmentFolderUrl: row.shipment_folder_url || '',
    dueDate: row.due_date || undefined,
    priority: (row.priority === 'High' ? 'High' : 'Normal') as 'High' | 'Normal',
  };
}

// ─── Single-Record Queries (Job Detail Fast-Open) ───────────────────────────

/**
 * Fetch a single task by task_id from Supabase.
 * Returns null if not found or Supabase unavailable.
 * Session 70 fix #9: accept optional clientNameMap so deep-link opens of
 * detail pages can resolve the client name from tenant_id when the row's
 * client_name column is null (historical rows).
 */
export async function fetchTaskByIdFromSupabase(
  taskId: string,
  clientNameMap?: ClientNameMap,
  clientSheetId?: string
): Promise<ApiTask | null> {
  try {
    // Task IDs are unique per-client only — when an item is transferred
    // between auto-inspect clients, both sheets can hold the same INSP-<item>-1
    // ID. Scope by tenant_id when known so the right row resolves.
    // Try the scoped query first when we have a hint — it disambiguates duplicate
    // task_ids across tenants (transferred items, copied INSP counters).
    if (clientSheetId) {
      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .eq('task_id', taskId)
        .eq('tenant_id', clientSheetId)
        .limit(1)
        .maybeSingle();
      if (!error && data) return mapSupabaseTaskRow(data as SupabaseTaskRow, clientNameMap);
      // Scoped miss — fall through to unscoped lookup. Covers email links whose
      // &client= param was stale, missing, or pointing at the wrong tenant
      // (e.g. an item that was transferred between tenants after the email).
    }
    // Unscoped fetch: pull a few matches. If exactly one, use it. If multiple
    // and we had a tenant hint, prefer the row matching the hint; otherwise
    // bail so the caller's legacy fallback can disambiguate.
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('task_id', taskId)
      .limit(5);
    if (error || !data || data.length === 0) return null;
    if (data.length === 1) return mapSupabaseTaskRow(data[0] as SupabaseTaskRow, clientNameMap);
    if (clientSheetId) {
      const hit = data.find(r => (r as SupabaseTaskRow).tenant_id === clientSheetId);
      if (hit) return mapSupabaseTaskRow(hit as SupabaseTaskRow, clientNameMap);
    }
    return null; // ambiguous — caller falls back to legacy GAS scan
  } catch {
    return null;
  }
}

/**
 * Fetch a single will call by wc_number from Supabase.
 * Returns null if not found. Items are NOT included (Supabase doesn't store WC items).
 * Session 70 fix #9: accept optional clientNameMap for deep-link client resolution.
 */
export async function fetchWillCallByIdFromSupabase(
  wcNumber: string,
  clientNameMap?: ClientNameMap
): Promise<ApiWillCall | null> {
  try {
    const { data, error } = await supabase
      .from('will_calls')
      .select('*')
      .eq('wc_number', wcNumber)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as SupabaseWillCallRow;

    const itemIds = (() => {
      const raw = row.item_ids as unknown;
      if (Array.isArray(raw)) return raw as string[];
      if (typeof raw === 'string') {
        try {
          const parsed = JSON.parse(raw);
          return Array.isArray(parsed) ? parsed as string[] : [];
        } catch { return []; }
      }
      return [];
    })();

    const wc: ApiWillCall = {
      wcNumber: row.wc_number,
      clientName: clientNameMap ? (clientNameMap[row.tenant_id] || '') : '',
      clientSheetId: row.tenant_id,
      status: row.status || 'Pending',
      createdDate: row.created_date || '',
      createdBy: row.created_by || '',
      pickupParty: row.pickup_party || '',
      pickupPhone: row.pickup_phone || '',
      requestedBy: row.requested_by || '',
      estimatedPickupDate: row.estimated_pickup_date || '',
      actualPickupDate: row.actual_pickup_date || '',
      notes: row.notes || '',
      cod: row.cod ?? false,
      codAmount: row.cod_amount != null ? Number(row.cod_amount) : null,
      itemsCount: row.item_count ?? 0,
      totalWcFee: row.total_wc_fee,
      items: [],
      itemIds,
      wcFolderUrl: row.wc_folder_url || '',
      shipmentFolderUrl: row.shipment_folder_url || '',
    };

    // Eagerly load items from will_call_items + inventory overlay so the
    // detail page renders with items on first paint (no "Loading items…"
    // delay while GAS enriches). Per invariant #27, item-level fields
    // come from inventory at read time.
    //
    // 2026-05-06: switched from `_fetchInvFieldMap` (which paginates EVERY
    // inventory row for the tenant — multi-second on big tenants) to a
    // targeted `.in('item_id', itemIds)` query (~50ms). The full-tenant
    // paginate was the actual cause of the "items still load" flash
    // Justin reported even after the GAS roundtrip was removed.
    if (row.tenant_id) {
      try {
        const { data: itemRows } = await supabase
          .from('will_call_items')
          .select('*')
          .eq('wc_number', wcNumber)
          .eq('tenant_id', row.tenant_id);

        const haveItemRows = !!(itemRows && itemRows.length > 0);
        const idsToFetch = haveItemRows
          ? (itemRows as SupabaseWillCallItemRow[]).map(r => r.item_id).filter(Boolean) as string[]
          : itemIds;

        // Single targeted inventory fetch covering both branches below.
        type InvOverlay = {
          vendor: string; description: string; itemClass: string;
          location: string; sidemark: string; room: string;
          qty: number; status: string; shipmentFolderUrl: string;
        };
        const invMap: Record<string, InvOverlay> = {};
        if (idsToFetch.length > 0) {
          const { data: invRows } = await supabase
            .from('inventory')
            .select('item_id, vendor, description, item_class, location, sidemark, room, qty, status, shipment_folder_url')
            .eq('tenant_id', row.tenant_id)
            .in('item_id', idsToFetch);
          for (const r of (invRows ?? []) as Array<{
            item_id: string | null; vendor: string | null; description: string | null;
            item_class: string | null; location: string | null; sidemark: string | null;
            room: string | null; qty: number | null; status: string | null;
            shipment_folder_url: string | null;
          }>) {
            if (r.item_id) {
              invMap[r.item_id] = {
                vendor: r.vendor || '',
                description: r.description || '',
                itemClass: r.item_class || '',
                location: r.location || '',
                sidemark: r.sidemark || '',
                room: r.room || '',
                qty: r.qty ?? 1,
                status: r.status || '',
                shipmentFolderUrl: r.shipment_folder_url || '',
              };
            }
          }
        }

        if (haveItemRows) {
          wc.items = (itemRows as SupabaseWillCallItemRow[]).map(r => {
            const inv = r.item_id ? invMap[r.item_id] : null;
            return {
              wcNumber: r.wc_number,
              itemId: r.item_id,
              qty: Number(r.qty) || 1,
              vendor: inv?.vendor || '',
              description: inv?.description || '',
              itemClass: inv?.itemClass || '',
              location: inv?.location || '',
              sidemark: inv?.sidemark || '',
              room: inv?.room || '',
              wcFee: r.wc_fee != null ? Number(r.wc_fee) : null,
              released: !!r.released,
              status: r.status || '',
            };
          });
          // Overlay shipmentFolderUrl from inventory if WC row has none
          if (!wc.shipmentFolderUrl && itemIds.length > 0) {
            const inv = invMap[itemIds[0]];
            if (inv?.shipmentFolderUrl) wc.shipmentFolderUrl = inv.shipmentFolderUrl;
          }
        } else if (itemIds.length > 0) {
          // Legacy WC (pre-will_call_items table) — build items from itemIds + inv overlay.
          // This is the path 100% of recent WCs land on (will_call_items has been empty
          // since v38.103.0).
          wc.items = itemIds.map(id => {
            const inv = invMap[id];
            return {
              wcNumber: row.wc_number,
              itemId: id,
              qty: inv?.qty ?? 1,
              vendor: inv?.vendor || '',
              description: inv?.description || '',
              itemClass: inv?.itemClass || '',
              location: inv?.location || '',
              sidemark: inv?.sidemark || '',
              room: inv?.room || '',
              wcFee: null,
              released: false,
              status: inv?.status || '',
            };
          });
          if (!wc.shipmentFolderUrl) {
            const inv = invMap[itemIds[0]];
            if (inv?.shipmentFolderUrl) wc.shipmentFolderUrl = inv.shipmentFolderUrl;
          }
        }
      } catch {
        // non-fatal — GAS fallback in useWillCallDetail fills in later
      }
    }

    return wc;
  } catch {
    return null;
  }
}

/**
 * Fetch a single repair by repair_id from Supabase.
 * Returns null if not found.
 * Session 70 fix #9: accept optional clientNameMap for deep-link client resolution.
 */
export async function fetchRepairByIdFromSupabase(
  repairId: string,
  clientNameMap?: ClientNameMap
): Promise<ApiRepair | null> {
  try {
    const { data, error } = await supabase
      .from('repairs')
      .select('*')
      .eq('repair_id', repairId)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as SupabaseRepairRow;

    // Eagerly load repair_items + overlay inventory fields. Same
    // pattern as fetchWillCallByIdFromSupabase — keeps the detail
    // page rendering items on first paint without a second roundtrip.
    // Legacy single-item repairs have exactly one repair_items row
    // (created by the 20260513160000 backfill); new multi-item
    // repairs have N rows. Either way we end up with a uniform
    // items[] array on the response.
    const items = await fetchRepairItemsWithOverlay(row.repair_id, row.tenant_id);

    return {
      repairId: row.repair_id,
      clientName: clientNameMap ? (clientNameMap[row.tenant_id] || '') : '',
      clientSheetId: row.tenant_id,
      sourceTaskId: '',
      itemId: row.item_id || '',
      // Multi-item repairs (items.length > 1) intentionally leave the
      // top-level description/vendor/location/sidemark blank so the
      // page doesn't show a single item's metadata as if it described
      // the whole job. The items table renders the per-item detail;
      // the parent Description card stays empty (or surfaces the
      // operator's own repair_notes / item_notes lower down).
      // Single-item repairs (the legacy + 1-item-new case) keep the
      // single-item denormalization for back-compat with existing UI.
      //
      // EXCEPTION: itemClass. When every item in a multi-item repair
      // shares the same class (typical — staff usually batch items of
      // the same furniture style/size), surface that common class so
      // the Quote Builder's class-based rate lookup (resolveCatalogRate
      // in RepairDetailPanel) can auto-fill catalog rates for Restock /
      // Inspection / etc. instead of leaving the operator to type each
      // line's rate by hand. When the items span mixed classes the
      // class IS ambiguous for the whole job — leave it blank and the
      // operator types per line (same as the single-class==='' case).
      description: items.length > 1 ? '' : (items[0]?.description || ''),
      itemClass: (() => {
        if (items.length === 0) return '';
        if (items.length === 1) return items[0]?.itemClass || '';
        const classes = new Set(
          items.map(i => (i.itemClass || '').trim()).filter(Boolean)
        );
        return classes.size === 1 ? [...classes][0] : '';
      })(),
      vendor:      items.length > 1 ? '' : (items[0]?.vendor      || ''),
      location:    items.length > 1 ? '' : (items[0]?.location    || ''),
      sidemark:    items.length > 1 ? '' : (items[0]?.sidemark    || ''),
      taskNotes: row.task_notes || '',
      createdBy: row.created_by || '',
      createdDate: row.created_date || '',
      quoteAmount: row.quote_amount,
      quoteSentDate: row.quote_sent_date || '',
      status: row.status || '',
      approved: false,
      scheduledDate: row.scheduled_date || '',
      startDate: row.start_date || '',
      repairVendor: row.repair_vendor || '',
      partsCost: null,
      laborHours: null,
      repairResult: row.repair_result || '',
      finalAmount: row.final_amount,
      invoiceId: '',
      itemNotes: row.item_notes || '',
      repairNotes: row.repair_notes || '',
      completedDate: row.completed_date || '',
      billed: false,
      repairFolderUrl: row.repair_folder_url || '',
      shipmentFolderUrl: row.shipment_folder_url || '',
      taskFolderUrl: row.task_folder_url || '',
      // v38.120.0 — multi-line quote (single-row fast path).
      quoteLines: Array.isArray(row.quote_lines_json)
        ? (row.quote_lines_json as ApiRepairQuoteLine[])
        : null,
      quoteSubtotal:        row.quote_subtotal != null ? Number(row.quote_subtotal) : null,
      quoteTaxableSubtotal: row.quote_taxable_subtotal != null ? Number(row.quote_taxable_subtotal) : null,
      quoteTaxAreaId:       row.quote_tax_area_id || null,
      quoteTaxAreaName:     row.quote_tax_area_name || null,
      quoteTaxRate:         row.quote_tax_rate != null ? Number(row.quote_tax_rate) : null,
      quoteTaxAmount:       row.quote_tax_amount != null ? Number(row.quote_tax_amount) : null,
      quoteGrandTotal:      row.quote_grand_total != null ? Number(row.quote_grand_total) : null,
      items,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch repair_items for a single repair, overlaying inventory fields
 * (description, vendor, sidemark, etc.) for display. Returns [] when
 * the repair has no items (which shouldn't happen post-backfill, but
 * is safe to render). Same eager-load pattern as
 * fetchWillCallByIdFromSupabase's items section.
 */
async function fetchRepairItemsWithOverlay(
  repairId: string,
  tenantId: string,
): Promise<NonNullable<ApiRepair['items']>> {
  if (!repairId || !tenantId) return [];

  const { data: itemRows } = await supabase
    .from('repair_items')
    .select('item_id, qty, item_result, item_notes')
    .eq('repair_id', repairId)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true });

  const rows = (itemRows ?? []) as Array<{
    item_id: string;
    qty: number | string | null;
    item_result: string | null;
    item_notes: string | null;
  }>;
  if (rows.length === 0) return [];

  const itemIds = rows.map(r => r.item_id).filter(Boolean);
  const { data: invRows } = await supabase
    .from('inventory')
    .select('item_id, description, vendor, sidemark, location, room, item_class, status')
    .eq('tenant_id', tenantId)
    .in('item_id', itemIds);

  const invByItemId = new Map<string, {
    description: string | null; vendor: string | null;
    sidemark: string | null; location: string | null;
    room: string | null; item_class: string | null;
    status: string | null;
  }>();
  for (const inv of (invRows ?? []) as Array<{
    item_id: string; description: string | null; vendor: string | null;
    sidemark: string | null; location: string | null; room: string | null;
    item_class: string | null; status: string | null;
  }>) {
    invByItemId.set(inv.item_id, inv);
  }

  return rows.map(r => {
    const inv = invByItemId.get(r.item_id);
    return {
      itemId: r.item_id,
      qty: r.qty != null ? Number(r.qty) : 1,
      itemResult: r.item_result,
      itemNotes: r.item_notes,
      description:     inv?.description ?? '',
      vendor:          inv?.vendor ?? '',
      sidemark:        inv?.sidemark ?? '',
      location:        inv?.location ?? '',
      room:            inv?.room ?? '',
      itemClass:       inv?.item_class ?? '',
      inventoryStatus: inv?.status ?? '',
    };
  });
}

/**
 * Fetch repairs by item_id + tenant_id from Supabase.
 * Used for task detail parity: shows related repairs for the same item.
 */
export async function fetchRepairsByItemIdFromSupabase(
  itemId: string,
  tenantId: string
): Promise<ApiRepair[]> {
  try {
    const { data, error } = await supabase
      .from('repairs')
      .select('*')
      .eq('item_id', itemId)
      .eq('tenant_id', tenantId);
    if (error || !data) return [];
    return (data as SupabaseRepairRow[]).map(row => ({
      repairId: row.repair_id,
      clientName: '',
      clientSheetId: row.tenant_id,
      sourceTaskId: '',
      itemId: row.item_id || '',
      description: '',
      itemClass: '',
      vendor: '',
      location: '',
      sidemark: '',
      taskNotes: row.task_notes || '',
      createdBy: row.created_by || '',
      createdDate: row.created_date || '',
      quoteAmount: row.quote_amount,
      quoteSentDate: row.quote_sent_date || '',
      status: row.status || '',
      approved: false,
      scheduledDate: row.scheduled_date || '',
      startDate: row.start_date || '',
      repairVendor: row.repair_vendor || '',
      partsCost: null,
      laborHours: null,
      repairResult: row.repair_result || '',
      finalAmount: row.final_amount,
      invoiceId: '',
      itemNotes: row.item_notes || '',
      repairNotes: row.repair_notes || '',
      completedDate: row.completed_date || '',
      billed: false,
      repairFolderUrl: row.repair_folder_url || '',
      shipmentFolderUrl: row.shipment_folder_url || '',
      taskFolderUrl: row.task_folder_url || '',
      // v38.120.0 — multi-line quote (by-item-id fast path).
      quoteLines: Array.isArray(row.quote_lines_json)
        ? (row.quote_lines_json as ApiRepairQuoteLine[])
        : null,
      quoteSubtotal:        row.quote_subtotal != null ? Number(row.quote_subtotal) : null,
      quoteTaxableSubtotal: row.quote_taxable_subtotal != null ? Number(row.quote_taxable_subtotal) : null,
      quoteTaxAreaId:       row.quote_tax_area_id || null,
      quoteTaxAreaName:     row.quote_tax_area_name || null,
      quoteTaxRate:         row.quote_tax_rate != null ? Number(row.quote_tax_rate) : null,
      quoteTaxAmount:       row.quote_tax_amount != null ? Number(row.quote_tax_amount) : null,
      quoteGrandTotal:      row.quote_grand_total != null ? Number(row.quote_grand_total) : null,
    }));
  } catch {
    return [];
  }
}

// ─── Dashboard Summary from Supabase ─────────────────────────────────────────

import type {
  SummaryTask,
  SummaryRepair,
  SummaryWillCall,
  BatchSummaryResponse,
} from './api';

export async function fetchDashboardSummaryFromSupabase(
  clientNameMap: ClientNameMap,
  tenantFilter?: string[]
): Promise<BatchSummaryResponse | null> {
  try {
    const openTaskStatuses = ['Open', 'In Progress'];
    const openRepairStatuses = ['Pending Quote', 'Quote Sent', 'Approved', 'In Progress'];
    const openWcStatuses = ['Pending', 'Scheduled', 'Partial'];

    let tasksQ = supabase.from('tasks').select('*').in('status', openTaskStatuses);
    let repairsQ = supabase.from('repairs').select('*').in('status', openRepairStatuses);
    let wcQ = supabase.from('will_calls').select('*').in('status', openWcStatuses);

    // Client-role users: filter to their accessible tenants only
    if (tenantFilter && tenantFilter.length > 0) {
      tasksQ = tasksQ.in('tenant_id', tenantFilter);
      repairsQ = repairsQ.in('tenant_id', tenantFilter);
      wcQ = wcQ.in('tenant_id', tenantFilter);
    }

    // Override PostgREST 1000-row cap (dashboard sums open items across ALL tenants)
    tasksQ = tasksQ.range(0, 49999);
    repairsQ = repairsQ.range(0, 49999);
    wcQ = wcQ.range(0, 49999);

    const [tasksRes, repairsRes, wcRes] = await Promise.all([tasksQ, repairsQ, wcQ]);

    if (tasksRes.error || repairsRes.error || wcRes.error) return null;

    const tasks: SummaryTask[] = ((tasksRes.data || []) as SupabaseTaskRow[]).map(row => ({
      taskId: row.task_id,
      clientName: clientNameMap[row.tenant_id] || '',
      clientSheetId: row.tenant_id,
      itemId: row.item_id || '',
      taskType: row.type || '',
      status: row.status || 'Open',
      assignedTo: row.assigned_to || '',
      created: row.created || '',
      dueDate: row.due_date || '',
      priority: row.priority || 'Normal',
      startedAt: row.started_at || '',
      description: row.description || '',
      vendor: row.vendor || '',
      sidemark: row.sidemark || '',
      location: row.location || '',
      taskFolderUrl: row.task_folder_url || '',
      shipmentFolderUrl: row.shipment_folder_url || '',
    }));

    const repairs: SummaryRepair[] = ((repairsRes.data || []) as SupabaseRepairRow[]).map(row => ({
      repairId: row.repair_id,
      clientName: clientNameMap[row.tenant_id] || '',
      clientSheetId: row.tenant_id,
      itemId: row.item_id || '',
      vendor: '',
      repairVendor: row.repair_vendor || '',
      status: row.status || '',
      createdDate: row.created_date || '',
      quoteAmount: row.quote_amount,
      description: '',
      sidemark: '',
      location: '',
      repairFolderUrl: row.repair_folder_url || '',
      shipmentFolderUrl: row.shipment_folder_url || '',
    }));

    // Session 69 Phase 4: overlay inventory fields on dashboard tasks + repairs
    try {
      const invMap = await _fetchInvFieldMap(tenantFilter);
      for (const t of tasks) {
        const inv = t.itemId ? invMap[t.itemId] : null;
        if (inv) {
          if (inv.location) t.location = inv.location;
          if (inv.vendor) t.vendor = inv.vendor;
          if (inv.sidemark) t.sidemark = inv.sidemark;
          if (inv.description) t.description = inv.description;
          if (inv.shipmentNumber) t.shipmentNumber = inv.shipmentNumber;
        }
      }
      for (const r of repairs) {
        const inv = r.itemId ? invMap[r.itemId] : null;
        if (inv) {
          if (inv.location) r.location = inv.location;
          if (inv.vendor) r.vendor = inv.vendor; // item vendor (from inventory)
          if (inv.sidemark) r.sidemark = inv.sidemark;
          if (inv.description) r.description = inv.description;
        }
      }
    } catch { /* best-effort */ }

    const willCalls: SummaryWillCall[] = ((wcRes.data || []) as SupabaseWillCallRow[]).map(row => ({
      wcNumber: row.wc_number,
      clientName: clientNameMap[row.tenant_id] || '',
      clientSheetId: row.tenant_id,
      status: row.status || 'Pending',
      pickupParty: row.pickup_party || '',
      createdDate: row.created_date || '',
      estPickupDate: row.estimated_pickup_date || '',
      itemCount: row.item_count ?? 0,
      notes: row.notes || '',
      wcFolderUrl: row.wc_folder_url || '',
      shipmentFolderUrl: row.shipment_folder_url || '',
    }));

    return {
      tasks,
      repairs,
      willCalls,
      counts: { tasks: tasks.length, repairs: repairs.length, willCalls: willCalls.length },
      summaryVersion: 1,
    };
  } catch {
    return null;
  }
}

// ─── DispatchTrack Orders ─────────────────────────────────────────────────────

export interface SupabaseDtStatusRow {
  id: number;
  code: string;
  name: string;
  category: string;
  display_order: number;
  color: string | null;
}

export interface SupabaseDtOrderRow {
  id: string;
  tenant_id: string | null;
  dt_dispatch_id: number | null;
  dt_identifier: string;
  dt_mode: number | null;
  is_pickup: boolean | null;
  status_id: number | null;
  substatus_id: number | null;
  contact_name: string | null;
  contact_address: string | null;
  contact_city: string | null;
  contact_state: string | null;
  contact_zip: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  contact_latitude: number | null;
  contact_longitude: number | null;
  pickup_address_json: Record<string, unknown> | null;
  local_service_date: string | null;
  /** DT-side scheduled date pulled from export.xml by dt-sync-statuses
   *  v19+. When non-null this is what dt-push-order sends in
   *  <delivery_date> on re-pushes (preserves dispatcher route
   *  assignments). UI shows this as "Scheduled" alongside the
   *  Stride-requested "Requested" date. */
  dt_scheduled_date: string | null;
  window_start_local: string | null;
  window_end_local: string | null;
  timezone: string;
  service_time_minutes: number | null;
  load: number | null;
  priority: number | null;
  po_number: string | null;
  sidemark: string | null;
  client_reference: string | null;
  details: string | null;
  driver_notes: string | null;
  internal_notes: string | null;
  /** v42 — per-leg notes split. NULL on rows created pre-split (back-compat). */
  pickup_notes: string | null;
  delivery_notes: string | null;
  latest_note_preview: string | null;
  linked_order_id: string | null;
  // Pickup→Delivery propagation (2026-05-13). Populated by
  // stamp-pickup-on-linked-delivery helper when the linked PU completes.
  // NULL on standalone deliveries + on deliveries whose linked PU has not
  // completed yet. Drives the "Picked up" banner on OrderPage.
  linked_pickup_finished_at: string | null;
  linked_pickup_driver_name: string | null;
  source: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
  // Pricing (added session 68 — delivery_pricing_schema migration)
  base_delivery_fee: number | null;
  extra_items_count: number | null;
  extra_items_fee: number | null;
  accessorials_json: Array<{ code: string; quantity: number; rate: number; subtotal: number }> | null;
  accessorials_total: number | null;
  fabric_protection_total: number | null;
  order_total: number | null;
  pricing_override: boolean | null;
  pricing_notes: string | null;
  coverage_charge: number | null;
  tax_amount: number | null;
  tax_rate_pct: number | null;
  // Review workflow
  review_status: string | null;
  review_notes: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_by_user: string | null;
  created_by_role: string | null;
  pushed_to_dt_at: string | null;
  // v41 (2026-05-26) — TRUE when the last DT push used the STRIDE LOGISTICS
  // fallback instead of the tenant's mapped account (because the tenant
  // isn't in dt_credentials.verified_account_tenants yet). Drives the
  // OrderPage warning banner. Default false.
  pushed_account_was_fallback: boolean | null;
  // Billing
  billing_method: string | null;
  payment_collected: boolean | null;
  payment_collected_at: string | null;
  payment_notes: string | null;
  // Phase 2c — order type + linking
  order_type: string | null;
  // DT sync-back (export.xml mirror) — populated by dt-sync-statuses v7+.
  // Null until the order has been pushed and the next sync runs.
  scheduled_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  signature_captured_at: string | null;
  driver_id: number | null;
  driver_name: string | null;
  truck_id: number | null;
  truck_name: string | null;
  service_unit: string | null;
  stop_number: number | null;
  actual_service_time_minutes: number | null;
  cod_amount: number | null;
  dt_status_code: string | null;
}

export interface DtOrderItemForUI {
  id: string;
  // FK to public.inventory.id when this line maps to a Stride inventory
  // row; null for ad-hoc / free-text items. Used by OrderPage to drive
  // the manual-release flow.
  inventoryId: string | null;
  dtItemCode: string;
  description: string;
  quantity: number | null;
  deliveredQuantity: number | null;
  unitPrice: number | null;
  notes: string;
  cubicFeet: number | null;
  className: string;
  vendor: string;
  sidemark: string;
  location: string;
  room: string;
  // DT sync-back per-item fields (populated by dt-sync-statuses v7+).
  delivered: boolean | null;
  itemNote: string;
  checkedQuantity: number | null;
  dtLocation: string;
  returnCodes: string[] | null;
  // Pickup→Delivery propagation (2026-05-13). Set on delivery items
  // (the items belonging to dt_orders rows where order_type !== 'pickup')
  // by stamp-pickup-on-linked-delivery when the linked PU leg completes.
  // Matched by parent_pickup_item_id (forward path) or dt_item_code
  // (legacy fallback). NULL for items not picked up yet or not on a P+D pair.
  pickedUpAt: string | null;
  // PU-mirror audit fields — set by the Tier-B propagation step in
  // dt-sync-statuses (sync path only; the webhook path has stale
  // PU items). Independent of itemNote/returnCodes which belong to
  // the delivery leg own driver.
  pickupItemNote: string | null;
  pickupReturnCodes: string[] | null;
  pickupDeliveredQuantity: number | null;
  // Phase 2 per-leg tracking (2026-05-30). FK to dt_pickup_links.id
  // identifying which pickup leg this delivery item came from. NULL =
  // warehouse item (no pickup) OR legacy row predating the backfill.
  // Drives the OrderPage item grouping ("Pickup 1 ✅", "Pickup 2 Pending",
  // "Warehouse") and the leg-aware blanket pass in
  // stamp-pickup-on-linked-delivery.
  pickupLegId: string | null;
}

export interface DtOrderForUI {
  id: string;
  tenantId: string | null;
  dtIdentifier: string;
  dtDispatchId: number | null;
  isPickup: boolean;
  statusId: number | null;
  statusCode: string;
  statusName: string;
  statusColor: string;
  statusCategory: string;
  contactName: string;
  contactAddress: string;
  contactCity: string;
  contactState: string;
  contactZip: string;
  contactPhone: string;
  contactEmail: string;
  localServiceDate: string;
  /** DT-side scheduled date (date-only, YYYY-MM-DD). Empty string when DT
   *  hasn't scheduled the order yet (initial push or sync hasn't run).
   *  Distinct from localServiceDate (the Stride-requested date kept for
   *  billing/audit). The OrderPage shows this as "Scheduled" alongside
   *  "Requested" when the two diverge. */
  dtScheduledDate: string;
  windowStartLocal: string;
  windowEndLocal: string;
  timezone: string;
  poNumber: string;
  sidemark: string;
  clientReference: string;
  details: string;
  driverNotes: string;
  internalNotes: string;
  /** v42 — per-leg notes split. Falls back to driverNotes for legacy
   *  rows. On a delivery order this is the pickup leg's notes; on a
   *  pickup order this is its own notes. The DT push uses the same
   *  fallback chain server-side. */
  pickupNotes: string;
  /** v42 — per-leg notes split for the delivery side. Empty string
   *  on pickup-only rows. */
  deliveryNotes: string;
  latestNotePreview: string;
  source: string;
  lastSyncedAt: string;
  clientName: string;
  items: DtOrderItemForUI[];
  // Pricing
  baseDeliveryFee: number | null;
  extraItemsCount: number;
  extraItemsFee: number;
  accessorials: Array<{ code: string; quantity: number; rate: number; subtotal: number; clientNotes?: string | null; quotePending?: boolean }>;
  accessorialsTotal: number;
  fabricProtectionTotal: number;
  orderTotal: number | null;
  pricingOverride: boolean;
  pricingNotes: string;
  // Service time + ancillary pricing fields surfaced on the detail page.
  serviceTimeMinutes: number | null;
  coverageCharge: number | null;
  taxAmount: number | null;
  taxRatePct: number | null;
  // Review workflow
  reviewStatus: string;
  reviewNotes: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  // v2026-05-09 — client-resubmit diff snapshot. Set when a client
  // saves changes to a non-draft order; cleared when staff Approves.
  // Drives the "Updated by [client]" banner on OrderPage and the
  // {{CHANGES_LIST}} body in the office email.
  lastResubmitDiff: Record<string, { old: unknown; new: unknown }> | null;
  lastResubmitAt: string | null;
  lastResubmitBy: string | null;
  createdByRole: string;
  createdByUser: string | null;
  createdByName: string;
  createdByEmail: string;
  pushedToDtAt: string | null;
  /** v41 — TRUE when the last DT push used the STRIDE LOGISTICS fallback
   *  instead of the tenant's mapped account. OrderPage banner reads this
   *  and warns the operator that the order didn't land under the right
   *  account, with instructions to verify the DT-side account name and
   *  re-push. */
  pushedAccountWasFallback: boolean;
  /** Last DB-update timestamp. Used by the Order page to detect "edited
   *  since last DT push" and surface the Republish-to-DT affordance. */
  updatedAt: string | null;
  // Billing
  billingMethod: 'bill_to_client' | 'customer_collect' | 'prepaid';
  paymentCollected: boolean;
  paymentCollectedAt: string | null;
  paymentNotes: string;
  // Phase 2c — order type + linked pickup/delivery pair
  orderType: 'delivery' | 'pickup' | 'pickup_and_delivery' | 'service_only' | 'transfer';
  linkedOrderId: string | null;
  // Pickup→Delivery propagation (2026-05-13). Populated on the delivery
  // row when its linked PU leg completes. Drives the "Picked up" banner.
  linkedPickupFinishedAt: string | null;
  linkedPickupDriverName: string | null;
  // Multi-pickup Phase 1 (v42 / 2026-05-29) — populated on the delivery
  // row from dt_pickup_links. Empty array on standalone deliveries,
  // pickup-only orders, and orders with no linked pickup. The OrderPage
  // renders one row per linked pickup with status + completion warning.
  linkedPickups: Array<{
    id: string;                              // dt_pickup_links.id
    pickupOrderId: string;
    pickupDtIdentifier: string | null;       // joined from dt_orders for display
    pickupContactName: string | null;        // joined
    pickupContactZip: string | null;         // joined; needed for per-leg zone lookup
    pickupLabel: string | null;              // operator-editable, defaults to contact name
    // pickupNotes is read from the joined dt_orders.pickup_notes column
    // (the authoritative source — same column dt-push-order reads when
    // building the leg's DT payload). dt_pickup_links.pickup_notes is
    // kept for legacy rows but is no longer written; the read falls
    // back to it only when the joined column is NULL.
    pickupNotes: string | null;
    pickupCompletionNotes: string | null;    // driver-entered notes captured after PU
    sortOrder: number;
    pickupStatusId: number | null;           // joined; drives "Pending / In Transit / Complete"
    pickupFinishedAt: string | null;         // joined; drives completion timestamp display
    pickupDriverName: string | null;         // joined
    pickupLegFee: number | null;             // dt_pickup_links.pickup_leg_fee snapshot
  }>;
  // DT sync-back (export.xml mirror) — see SupabaseDtOrderRow for source.
  scheduledAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  signatureCapturedAt: string | null;
  driverId: number | null;
  driverName: string;
  truckId: number | null;
  truckName: string;
  serviceUnit: string;
  stopNumber: number | null;
  actualServiceTimeMinutes: number | null;
  codAmount: number | null;
  dtStatusCode: string;
  // When the row was first written to dt_orders (Postgres-side
  // created_at). Used as the default-newest sort on the Orders page
  // and for the "Date Created" column. Distinct from
  // localServiceDate, which is the operator-picked delivery day
  // (often unset on drafts).
  createdAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Delivery pricing (session 68 — PLT_PRICE_LISTS_v2 seeded into Supabase)
// ─────────────────────────────────────────────────────────────────────────────

export interface DeliveryZone {
  zipCode: string;
  city: string;
  zone: string;
  baseRate: number | null;
  pickupRate: number | null;
  serviceDays: string;
}

export interface DeliveryAccessorial {
  code: string;
  name: string;
  rate: number | null;
  /**
   * Rate-unit set is the union of the legacy delivery_accessorials shapes
   * (per_mile / per_15min / plus_base) and the service_catalog shapes
   * (per_task / per_item / per_hour / per_day) so the modal can render both
   * sources uniformly. `per_task` is mapped to 'flat' at fetch time —
   * downstream code only needs to handle the unit values listed below.
   *
   * NOTE — display label only. The actual billing math is driven by
   * `billingMode` below; this string just sets the suffix shown next to
   * the rate ("$45 / item", "$95 / hour"). Kept around for backward
   * compat with the existing picker UI.
   */
  rateUnit: 'flat' | 'per_mile' | 'per_15min' | 'plus_base' | 'per_item' | 'per_hour' | 'per_day';
  /**
   * Drives the actual subtotal math for this service:
   *   per_class — sum( classRates[item.itemClass] × item.qty ) over the
   *               order's selected items. Quantity is implicit; the rate
   *               varies per item class.
   *   per_qty   — flat_rate × quantity. Quantity defaults to the order's
   *               item count for "per item" services, or operator-entered
   *               for hours/sqft/etc.
   *   per_job   — flat_rate × 1, regardless of items. One-shot fee.
   * Backed by service_catalog.billing_mode (migration
   * service_catalog_billing_mode). Defaults to 'per_job' if the row is
   * missing the column for any reason — safe fallback that won't double-
   * charge.
   */
  billingMode: 'per_class' | 'per_qty' | 'per_job';
  /**
   * Per-item-class rates used when billingMode === 'per_class'. Mirrors
   * service_catalog.rates with XXL spliced in from xxl_rate.
   */
  classRates: { XS: number; S: number; M: number; L: number; XL: number; XXL: number };
  description: string;
  displayOrder: number;
  active: boolean;
  /** Phase 2c — false means staff/admin-only (applied post-hoc by dispatch). */
  visibleToClient: boolean;
  /** Minutes added to delivery service time when this accessorial is selected. */
  serviceMinutes: number;
  /** If true, price requires a quote — $0 subtotal, flagged in amber. */
  quoteRequired: boolean;
  /** If false, hidden from the delivery order dropdown (staff/admin apply post-hoc). */
  availableForDelivery: boolean;
}

export interface FabricProtectionRate {
  itemType: string;
  rate: number;
  rateUnit: 'flat' | 'per_sqft' | 'each';
  minCharge: number | null;
  displayOrder: number;
  active: boolean;
}

export async function fetchDtStatusesFromSupabase(): Promise<SupabaseDtStatusRow[]> {
  try {
    const { data, error } = await supabase
      .from('dt_statuses')
      .select('*')
      .order('display_order');
    if (error || !data) return [];
    return data as SupabaseDtStatusRow[];
  } catch {
    return [];
  }
}

export async function fetchDtOrdersFromSupabase(
  clientNameMap: ClientNameMap,
  clientSheetId?: string
): Promise<DtOrderForUI[] | null> {
  try {
    const [statuses, profilesRes] = await Promise.all([
      fetchDtStatusesFromSupabase(),
      supabase.from('profiles').select('id,email,display_name'),
    ]);
    const statusMap = new Map(statuses.map(s => [s.id, s]));
    const profileMap = new Map<string, { email: string; displayName: string }>();
    if (!profilesRes.error && profilesRes.data) {
      for (const p of profilesRes.data) {
        profileMap.set(p.id, { email: p.email ?? '', displayName: p.display_name ?? p.email ?? '' });
      }
    }
    let query = supabase
      .from('dt_orders')
      // v2026-05-04: dt_order_items.removed_at filter — soft-removed
      // rows (e.g. lines DT no longer carries) are kept for audit but
      // hidden from the active items list.
      .select('*, dt_order_items(*)')
      .is('dt_order_items.removed_at', null)
      // Default newest-first by created_at — matches the Orders page
      // sort default and surfaces drafts (which have no service date)
      // alongside everything else without the "drafts at the bottom"
      // problem an order-by service_date would create.
      .order('created_at', { ascending: false });
    if (clientSheetId) {
      query = query.eq('tenant_id', clientSheetId);
    }
    const { data, error } = await query;
    if (error || !data) return null;
    return (data as SupabaseDtOrderRow[]).map(row => {
      const status = row.status_id != null ? statusMap.get(row.status_id) : undefined;
      // Status derivation hierarchy (most specific wins):
      //   1. Draft → "Draft" / category 'draft'
      //   2. DT status known (pushed to DT) → use it verbatim
      //   3. review_status carries the meaningful state for app-created
      //      orders that haven't been pushed yet. The old "—" fallback
      //      hid the fact that admin-auto-approved orders were just
      //      sitting there waiting on a push.
      const isDraft = row.review_status === 'draft';
      const hasDtStatus = !!status;
      let appStatusName = '';
      let appStatusCategory = 'open';
      if (!isDraft && !hasDtStatus) {
        switch (row.review_status) {
          case 'pending_review':
            appStatusName = 'Pending Review'; appStatusCategory = 'review'; break;
          case 'revision_requested':
            appStatusName = 'Revision Needed'; appStatusCategory = 'review'; break;
          case 'rejected':
            appStatusName = 'Rejected'; appStatusCategory = 'exception'; break;
          case 'approved':
            // Approved AND pushed → it's just waiting on the next DT
            // sync to fill in a real status_id. That's not a "review"
            // bucket anymore — nothing for a human to do. Show under
            // OPEN. Approved-and-NOT-pushed still goes to review since
            // a reviewer needs to click Push to DT.
            appStatusName = row.pushed_to_dt_at ? 'Awaiting DT Sync' : 'Ready to Push';
            appStatusCategory = row.pushed_to_dt_at ? 'open' : 'review';
            break;
          default:
            appStatusName = '—';
        }
      }
      return {
        id: row.id,
        tenantId: row.tenant_id,
        dtIdentifier: row.dt_identifier,
        dtDispatchId: row.dt_dispatch_id,
        isPickup: row.is_pickup ?? false,
        statusId: row.status_id,
        statusCode: isDraft ? 'draft' : (status?.code ?? ''),
        statusName: isDraft ? 'Draft' : (status?.name ?? appStatusName),
        statusColor: isDraft ? '#6B7280' : (status?.color ?? '#94a3b8'),
        statusCategory: isDraft ? 'draft' : (status?.category ?? appStatusCategory),
        contactName: row.contact_name ?? '',
        contactAddress: row.contact_address ?? '',
        contactCity: row.contact_city ?? '',
        contactState: row.contact_state ?? '',
        contactZip: row.contact_zip ?? '',
        contactPhone: row.contact_phone ?? '',
        contactEmail: row.contact_email ?? '',
        localServiceDate: row.local_service_date ?? '',
        dtScheduledDate: row.dt_scheduled_date ?? '',
        windowStartLocal: row.window_start_local ?? '',
        windowEndLocal: row.window_end_local ?? '',
        timezone: row.timezone,
        poNumber: row.po_number ?? '',
        sidemark: row.sidemark ?? '',
        clientReference: row.client_reference ?? '',
        details: row.details ?? '',
        driverNotes: row.driver_notes ?? '',
        internalNotes: row.internal_notes ?? '',
        pickupNotes: row.pickup_notes ?? '',
        deliveryNotes: row.delivery_notes ?? '',
        serviceTimeMinutes: row.service_time_minutes != null ? Number(row.service_time_minutes) : null,
        coverageCharge: row.coverage_charge != null ? Number(row.coverage_charge) : null,
        taxAmount: row.tax_amount != null ? Number(row.tax_amount) : null,
        taxRatePct: row.tax_rate_pct != null ? Number(row.tax_rate_pct) : null,
        latestNotePreview: row.latest_note_preview ?? '',
        source: row.source ?? '',
        lastSyncedAt: row.last_synced_at ?? '',
        clientName: (row.tenant_id ? clientNameMap[row.tenant_id] : null) ?? '',
        items: (((row as unknown as Record<string, unknown>).dt_order_items as Array<Record<string, unknown>>) || []).map((item) => {
          const extras = (item.extras as Record<string, unknown>) || {};
          const rawReturnCodes = item.return_codes;
          let returnCodes: string[] | null = null;
          if (Array.isArray(rawReturnCodes)) returnCodes = rawReturnCodes.map(String);
          else if (typeof rawReturnCodes === 'string' && rawReturnCodes.trim()) returnCodes = [rawReturnCodes.trim()];
          return {
            id: String(item.id ?? ''),
            inventoryId: item.inventory_id ? String(item.inventory_id) : null,
            dtItemCode: String(item.dt_item_code ?? ''),
            description: String(item.description ?? ''),
            quantity: item.quantity != null ? Number(item.quantity) : null,
            deliveredQuantity: item.delivered_quantity != null ? Number(item.delivered_quantity) : null,
            unitPrice: item.unit_price != null ? Number(item.unit_price) : null,
            notes: String(extras.notes ?? ''),
            cubicFeet: item.cubic_feet != null ? Number(item.cubic_feet) : null,
            className: String(item.class_name ?? extras.className ?? ''),
            vendor: String(item.vendor ?? extras.vendor ?? ''),
            sidemark: String(extras.sidemark ?? ''),
            location: String(extras.location ?? ''),
            room: String(item.room ?? extras.room ?? ''),
            delivered: typeof item.delivered === 'boolean' ? item.delivered : null,
            itemNote: String(item.item_note ?? ''),
            checkedQuantity: item.checked_quantity != null ? Number(item.checked_quantity) : null,
            dtLocation: String(item.location ?? ''),
            returnCodes,
            pickedUpAt: item.picked_up_at ? String(item.picked_up_at) : null,
            pickupItemNote: item.pickup_item_note ? String(item.pickup_item_note) : null,
            pickupReturnCodes: Array.isArray(item.pickup_return_codes)
              ? (item.pickup_return_codes as unknown[]).filter(x => typeof x === 'string').map(String)
              : null,
            pickupDeliveredQuantity: item.pickup_delivered_quantity != null ? Number(item.pickup_delivered_quantity) : null,
            pickupLegId: item.pickup_leg_id ? String(item.pickup_leg_id) : null,
          };
        }),
        // Pricing
        baseDeliveryFee: row.base_delivery_fee != null ? Number(row.base_delivery_fee) : null,
        extraItemsCount: row.extra_items_count ?? 0,
        extraItemsFee: row.extra_items_fee != null ? Number(row.extra_items_fee) : 0,
        accessorials: Array.isArray(row.accessorials_json) ? row.accessorials_json : [],
        accessorialsTotal: row.accessorials_total != null ? Number(row.accessorials_total) : 0,
        fabricProtectionTotal: row.fabric_protection_total != null ? Number(row.fabric_protection_total) : 0,
        orderTotal: row.order_total != null ? Number(row.order_total) : null,
        pricingOverride: row.pricing_override ?? false,
        pricingNotes: row.pricing_notes ?? '',
        // Review workflow
        reviewStatus: row.review_status ?? 'not_required',
        reviewNotes: row.review_notes ?? '',
        reviewedBy: row.reviewed_by,
        reviewedAt: row.reviewed_at,
        lastResubmitDiff: (row as { last_resubmit_diff?: Record<string, { old: unknown; new: unknown }> | null }).last_resubmit_diff ?? null,
        lastResubmitAt:   (row as { last_resubmit_at?:   string | null }).last_resubmit_at   ?? null,
        lastResubmitBy:   (row as { last_resubmit_by?:   string | null }).last_resubmit_by   ?? null,
        createdByRole: row.created_by_role ?? '',
        createdByUser: row.created_by_user,
        createdByName: (row.created_by_user ? profileMap.get(row.created_by_user)?.displayName : '') ?? '',
        createdByEmail: (row.created_by_user ? profileMap.get(row.created_by_user)?.email : '') ?? '',
        pushedToDtAt: row.pushed_to_dt_at,
        pushedAccountWasFallback: !!(row as { pushed_account_was_fallback?: boolean | null }).pushed_account_was_fallback,
        updatedAt: row.updated_at,
        // Billing
        billingMethod: (row.billing_method as DtOrderForUI['billingMethod']) ?? 'bill_to_client',
        paymentCollected: row.payment_collected ?? false,
        paymentCollectedAt: row.payment_collected_at,
        paymentNotes: row.payment_notes ?? '',
        // Phase 2c — order type + linked pickup/delivery
        orderType: (row.order_type as DtOrderForUI['orderType']) ?? (row.is_pickup ? 'pickup' : 'delivery'),
        linkedOrderId: row.linked_order_id,
        linkedPickupFinishedAt: row.linked_pickup_finished_at,
        linkedPickupDriverName: row.linked_pickup_driver_name,
        // List query intentionally returns empty linkedPickups — too
        // expensive to JOIN for every row. OrderPage refetches the
        // full pickups list via fetchDtOrderByIdFromSupabase.
        linkedPickups: [],
        createdAt: row.created_at ?? '',
        // DT sync-back
        scheduledAt: row.scheduled_at,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
        signatureCapturedAt: row.signature_captured_at,
        driverId: row.driver_id,
        driverName: row.driver_name ?? '',
        truckId: row.truck_id,
        truckName: row.truck_name ?? '',
        serviceUnit: row.service_unit ?? '',
        stopNumber: row.stop_number,
        actualServiceTimeMinutes: row.actual_service_time_minutes,
        codAmount: row.cod_amount != null ? Number(row.cod_amount) : null,
        dtStatusCode: row.dt_status_code ?? '',
      };
    });
  } catch {
    return null;
  }
}

/** Fetch a single DT order by its Supabase UUID. Used by OrderPage. */
export async function fetchDtOrderByIdFromSupabase(
  orderId: string,
  clientNameMap: ClientNameMap = {}
): Promise<DtOrderForUI | null> {
  try {
    const statuses = await fetchDtStatusesFromSupabase();
    const statusMap = new Map(statuses.map(s => [s.id, s]));
    const { data, error } = await supabase
      .from('dt_orders')
      // v2026-05-04: dt_order_items.removed_at filter — soft-removed
      // rows (e.g. lines DT no longer carries) are kept for audit but
      // hidden from the active items list.
      .select('*, dt_order_items(*)')
      .is('dt_order_items.removed_at', null)
      .eq('id', orderId)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as SupabaseDtOrderRow;
    const status = row.status_id != null ? statusMap.get(row.status_id) : undefined;
    const isDraft = row.review_status === 'draft';

    // Multi-pickup Phase 1 — fetch linked pickup join rows + the pickup
    // dt_orders details for display. Always run the query (cheap; returns
    // [] on standalone orders). Joins with the pickup_order side of
    // dt_orders for identifier / contact_name / status_id / finished_at /
    // driver_name so the OrderPage can render per-leg status badges
    // without a second round-trip. Empty array when no links exist —
    // OrderPage falls back to the scalar linked_order_id path for
    // back-compat.
    const { data: linkRows, error: linkErr } = await supabase
      .from('dt_pickup_links')
      .select(`
        id,
        pickup_order_id,
        pickup_label,
        pickup_notes,
        pickup_completion_notes,
        pickup_leg_fee,
        sort_order,
        pickup_order:pickup_order_id (
          dt_identifier,
          contact_name,
          contact_zip,
          pickup_notes,
          status_id,
          finished_at,
          driver_name
        )
      `)
      .eq('delivery_order_id', orderId)
      .order('sort_order', { ascending: true });
    if (linkErr) {
      // Don't break the order load — render the page with empty
      // linkedPickups and surface the failure in the console so a
      // schema/permission regression is visible.
      console.warn('[fetchDtOrderByIdFromSupabase] dt_pickup_links fetch failed:', linkErr.message);
    }

    const linkedPickups: DtOrderForUI['linkedPickups'] = (((linkRows ?? []) as unknown) as Array<Record<string, unknown>>).map(lr => {
      const puJoin = (lr.pickup_order as Record<string, unknown> | null) ?? {};
      // Authoritative pickup_notes lives on the joined dt_orders row
      // (same column dt-push-order reads). Fall back to the dt_pickup_
      // links.pickup_notes mirror only for legacy rows where the
      // joined column is NULL but the link mirror was populated by
      // the pre-fix AddPickupLegModal write.
      const joinedPickupNotes = (puJoin.pickup_notes as string | null | undefined) ?? null;
      const linkPickupNotes   = (lr.pickup_notes      as string | null | undefined) ?? null;
      const legFeeRaw = lr.pickup_leg_fee;
      const pickupLegFee = legFeeRaw == null || legFeeRaw === ''
        ? null
        : Number(legFeeRaw);
      return {
        id:                    String(lr.id ?? ''),
        pickupOrderId:         String(lr.pickup_order_id ?? ''),
        pickupDtIdentifier:    (puJoin.dt_identifier  as string | null | undefined) ?? null,
        pickupContactName:     (puJoin.contact_name   as string | null | undefined) ?? null,
        pickupContactZip:      (puJoin.contact_zip    as string | null | undefined) ?? null,
        pickupLabel:           (lr.pickup_label       as string | null | undefined) ?? null,
        pickupNotes:           joinedPickupNotes ?? linkPickupNotes,
        pickupCompletionNotes: (lr.pickup_completion_notes as string | null | undefined) ?? null,
        sortOrder:             Number(lr.sort_order ?? 0),
        pickupStatusId:        (puJoin.status_id      as number | null | undefined) ?? null,
        pickupFinishedAt:      (puJoin.finished_at    as string | null | undefined) ?? null,
        pickupDriverName:      (puJoin.driver_name    as string | null | undefined) ?? null,
        pickupLegFee:          Number.isFinite(pickupLegFee as number) ? (pickupLegFee as number) : null,
      };
    });

    // Same status-derivation hierarchy as the list query — see
    // fetchDtOrdersFromSupabase for the rationale.
    const hasDtStatus = !!status;
    let appStatusName = '';
    let appStatusCategory = 'open';
    if (!isDraft && !hasDtStatus) {
      switch (row.review_status) {
        case 'pending_review':     appStatusName = 'Pending Review';   appStatusCategory = 'review';    break;
        case 'revision_requested': appStatusName = 'Revision Needed';  appStatusCategory = 'review';    break;
        case 'rejected':           appStatusName = 'Rejected';         appStatusCategory = 'exception'; break;
        case 'approved':
          appStatusName = row.pushed_to_dt_at ? 'Awaiting DT Sync' : 'Ready to Push';
          appStatusCategory = row.pushed_to_dt_at ? 'open' : 'review';
          break;
        default:                   appStatusName = '—';
      }
    }
    return {
      id: row.id,
      tenantId: row.tenant_id,
      dtIdentifier: row.dt_identifier,
      dtDispatchId: row.dt_dispatch_id,
      isPickup: row.is_pickup ?? false,
      statusId: row.status_id,
      statusCode: isDraft ? 'draft' : (status?.code ?? ''),
      statusName: isDraft ? 'Draft' : (status?.name ?? appStatusName),
      statusColor: isDraft ? '#6B7280' : (status?.color ?? '#94a3b8'),
      statusCategory: isDraft ? 'draft' : (status?.category ?? appStatusCategory),
      contactName: row.contact_name ?? '',
      contactAddress: row.contact_address ?? '',
      contactCity: row.contact_city ?? '',
      contactState: row.contact_state ?? '',
      contactZip: row.contact_zip ?? '',
      contactPhone: row.contact_phone ?? '',
      contactEmail: row.contact_email ?? '',
      localServiceDate: row.local_service_date ?? '',
      dtScheduledDate: row.dt_scheduled_date ?? '',
      windowStartLocal: row.window_start_local ?? '',
      windowEndLocal: row.window_end_local ?? '',
      timezone: row.timezone,
      poNumber: row.po_number ?? '',
      sidemark: row.sidemark ?? '',
      clientReference: row.client_reference ?? '',
      details: row.details ?? '',
      driverNotes: row.driver_notes ?? '',
      internalNotes: row.internal_notes ?? '',
      pickupNotes: row.pickup_notes ?? '',
      deliveryNotes: row.delivery_notes ?? '',
      serviceTimeMinutes: row.service_time_minutes != null ? Number(row.service_time_minutes) : null,
      coverageCharge: row.coverage_charge != null ? Number(row.coverage_charge) : null,
      taxAmount: row.tax_amount != null ? Number(row.tax_amount) : null,
      taxRatePct: row.tax_rate_pct != null ? Number(row.tax_rate_pct) : null,
      latestNotePreview: row.latest_note_preview ?? '',
      source: row.source ?? '',
      lastSyncedAt: row.last_synced_at ?? '',
      clientName: (row.tenant_id ? clientNameMap[row.tenant_id] : null) ?? '',
      items: (((row as unknown as Record<string, unknown>).dt_order_items as Array<Record<string, unknown>>) || []).map((item) => {
        const extras = (item.extras as Record<string, unknown>) || {};
        const rawReturnCodes = item.return_codes;
        let returnCodes: string[] | null = null;
        if (Array.isArray(rawReturnCodes)) returnCodes = rawReturnCodes.map(String);
        else if (typeof rawReturnCodes === 'string' && rawReturnCodes.trim()) returnCodes = [rawReturnCodes.trim()];
        return {
          id: String(item.id ?? ''),
          inventoryId: item.inventory_id ? String(item.inventory_id) : null,
          dtItemCode: String(item.dt_item_code ?? ''),
          description: String(item.description ?? ''),
          quantity: item.quantity != null ? Number(item.quantity) : null,
          deliveredQuantity: item.delivered_quantity != null ? Number(item.delivered_quantity) : null,
          unitPrice: item.unit_price != null ? Number(item.unit_price) : null,
          notes: String(extras.notes ?? ''),
          cubicFeet: item.cubic_feet != null ? Number(item.cubic_feet) : null,
          className: String(item.class_name ?? extras.className ?? ''),
          vendor: String(item.vendor ?? extras.vendor ?? ''),
          sidemark: String(extras.sidemark ?? ''),
          location: String(extras.location ?? ''),
          room: String(item.room ?? extras.room ?? ''),
          delivered: typeof item.delivered === 'boolean' ? item.delivered : null,
          itemNote: String(item.item_note ?? ''),
          checkedQuantity: item.checked_quantity != null ? Number(item.checked_quantity) : null,
          dtLocation: String(item.location ?? ''),
          returnCodes,
          pickedUpAt: item.picked_up_at ? String(item.picked_up_at) : null,
          pickupItemNote: item.pickup_item_note ? String(item.pickup_item_note) : null,
          pickupReturnCodes: Array.isArray(item.pickup_return_codes)
            ? (item.pickup_return_codes as unknown[]).filter(x => typeof x === 'string').map(String)
            : null,
          pickupDeliveredQuantity: item.pickup_delivered_quantity != null ? Number(item.pickup_delivered_quantity) : null,
          pickupLegId: item.pickup_leg_id ? String(item.pickup_leg_id) : null,
        };
      }),
      baseDeliveryFee: row.base_delivery_fee != null ? Number(row.base_delivery_fee) : null,
      extraItemsCount: row.extra_items_count ?? 0,
      extraItemsFee: row.extra_items_fee != null ? Number(row.extra_items_fee) : 0,
      accessorials: Array.isArray(row.accessorials_json) ? row.accessorials_json : [],
      accessorialsTotal: row.accessorials_total != null ? Number(row.accessorials_total) : 0,
      fabricProtectionTotal: row.fabric_protection_total != null ? Number(row.fabric_protection_total) : 0,
      orderTotal: row.order_total != null ? Number(row.order_total) : null,
      pricingOverride: row.pricing_override ?? false,
      pricingNotes: row.pricing_notes ?? '',
      reviewStatus: row.review_status ?? 'not_required',
      reviewNotes: row.review_notes ?? '',
      reviewedBy: row.reviewed_by,
      reviewedAt: row.reviewed_at,
      lastResubmitDiff: (row as { last_resubmit_diff?: Record<string, { old: unknown; new: unknown }> | null }).last_resubmit_diff ?? null,
      lastResubmitAt:   (row as { last_resubmit_at?:   string | null }).last_resubmit_at   ?? null,
      lastResubmitBy:   (row as { last_resubmit_by?:   string | null }).last_resubmit_by   ?? null,
      createdByRole: row.created_by_role ?? '',
      createdByUser: row.created_by_user,
      createdByName: '',
      createdByEmail: '',
      pushedToDtAt: row.pushed_to_dt_at,
      pushedAccountWasFallback: !!(row as { pushed_account_was_fallback?: boolean | null }).pushed_account_was_fallback,
      updatedAt: row.updated_at,
      billingMethod: (row.billing_method as DtOrderForUI['billingMethod']) ?? 'bill_to_client',
      paymentCollected: row.payment_collected ?? false,
      paymentCollectedAt: row.payment_collected_at,
      paymentNotes: row.payment_notes ?? '',
      orderType: (row.order_type as DtOrderForUI['orderType']) ?? (row.is_pickup ? 'pickup' : 'delivery'),
      linkedOrderId: row.linked_order_id,
      linkedPickupFinishedAt: row.linked_pickup_finished_at,
      linkedPickupDriverName: row.linked_pickup_driver_name,
      linkedPickups,
      createdAt: row.created_at ?? '',
      // DT sync-back
      scheduledAt: row.scheduled_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      signatureCapturedAt: row.signature_captured_at,
      driverId: row.driver_id,
      driverName: row.driver_name ?? '',
      truckId: row.truck_id,
      truckName: row.truck_name ?? '',
      serviceUnit: row.service_unit ?? '',
      stopNumber: row.stop_number,
      actualServiceTimeMinutes: row.actual_service_time_minutes,
      codAmount: row.cod_amount != null ? Number(row.cod_amount) : null,
      dtStatusCode: row.dt_status_code ?? '',
    };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DT order history + DT-side notes (sync-back from dt-sync-statuses)
// ─────────────────────────────────────────────────────────────────────────────

export interface DtOrderHistoryEvent {
  id: string;
  code: number | null;
  description: string;
  happenedAt: string;
  ownerId: number | null;
  ownerName: string;
  ownerType: string;
  lat: number | null;
  lng: number | null;
  source: string;
}

export async function fetchDtOrderHistory(dtOrderId: string): Promise<DtOrderHistoryEvent[]> {
  const { data, error } = await supabase
    .from('dt_order_history')
    .select('id, code, description, happened_at, owner_id, owner_name, owner_type, lat, lng, source')
    .eq('dt_order_id', dtOrderId)
    .order('happened_at', { ascending: false });
  if (error || !data) return [];
  return (data as Array<Record<string, unknown>>).map(r => ({
    id:          String(r.id ?? ''),
    code:        r.code != null ? Number(r.code) : null,
    description: String(r.description ?? ''),
    happenedAt:  String(r.happened_at ?? ''),
    ownerId:     r.owner_id != null ? Number(r.owner_id) : null,
    ownerName:   String(r.owner_name ?? ''),
    ownerType:   String(r.owner_type ?? ''),
    lat:         r.lat != null ? Number(r.lat) : null,
    lng:         r.lng != null ? Number(r.lng) : null,
    source:      String(r.source ?? ''),
  }));
}

export interface DtSideNote {
  id: string;
  body: string;
  authorName: string;
  authorType: string;
  visibility: string;
  createdAtDt: string | null;
  createdAt: string;
  source: string;
}

export async function fetchDtOrderNotes(dtOrderId: string): Promise<DtSideNote[]> {
  const { data, error } = await supabase
    .from('dt_order_notes')
    .select('id, body, author_name, author_type, visibility, created_at_dt, created_at, source')
    .eq('dt_order_id', dtOrderId)
    .order('created_at_dt', { ascending: false, nullsFirst: false });
  if (error || !data) return [];
  return (data as Array<Record<string, unknown>>).map(r => ({
    id:          String(r.id ?? ''),
    body:        String(r.body ?? ''),
    authorName:  String(r.author_name ?? ''),
    authorType:  String(r.author_type ?? ''),
    visibility:  String(r.visibility ?? 'public'),
    createdAtDt: r.created_at_dt ? String(r.created_at_dt) : null,
    createdAt:   String(r.created_at ?? ''),
    source:      String(r.source ?? ''),
  }));
}

// ─── DT POD photos (sync-back from dt-sync-statuses v10) ─────────────────

export interface DtOrderPhoto {
  id: string;
  dtImageId: string;
  dtImageName: string;
  capturedAt: string | null;
  fullUrl: string | null;       // signed URL into dt-pod-photos bucket
  thumbnailUrl: string | null;  // signed URL for the thumbnail
  storagePath: string | null;   // raw path (debugging)
  fetchError: string | null;
}

/**
 * Fetch all POD photos for an order, returning signed URLs into the
 * private dt-pod-photos bucket. The DT-side URLs expire 30 min after
 * each export.xml call so we never link to them directly — the edge
 * function captures bytes into storage and the UI reads from there.
 */
export async function fetchDtOrderPhotos(dtOrderId: string): Promise<DtOrderPhoto[]> {
  const { data, error } = await supabase
    .from('dt_order_photos')
    .select('id, dt_image_id, dt_image_name, captured_at, storage_path, thumbnail_path, fetch_error')
    .eq('dt_order_id', dtOrderId)
    .order('captured_at', { ascending: true });
  if (error || !data) return [];
  // Generate one signed URL per asset. 1 hr TTL — long enough for the
  // user to browse photos / open a lightbox without re-signing.
  const out: DtOrderPhoto[] = [];
  for (const r of data as Array<Record<string, unknown>>) {
    let fullUrl: string | null = null;
    let thumbnailUrl: string | null = null;
    if (r.storage_path) {
      const { data: signed } = await supabase.storage
        .from('dt-pod-photos')
        .createSignedUrl(String(r.storage_path), 3600);
      if (signed?.signedUrl) fullUrl = signed.signedUrl;
    }
    if (r.thumbnail_path) {
      const { data: signed } = await supabase.storage
        .from('dt-pod-photos')
        .createSignedUrl(String(r.thumbnail_path), 3600);
      if (signed?.signedUrl) thumbnailUrl = signed.signedUrl;
    }
    out.push({
      id:           String(r.id ?? ''),
      dtImageId:    String(r.dt_image_id ?? ''),
      dtImageName:  String(r.dt_image_name ?? ''),
      capturedAt:   r.captured_at ? String(r.captured_at) : null,
      fullUrl,
      thumbnailUrl,
      storagePath:  r.storage_path ? String(r.storage_path) : null,
      fetchError:   r.fetch_error ? String(r.fetch_error) : null,
    });
  }
  return out;
}

// ─── Delivery pricing fetchers (session 68) ───────────────────────────────

/** Look up a single ZIP → zone/rate/service days. Returns null if not in the table. */
export async function fetchDeliveryZone(zip: string): Promise<DeliveryZone | null> {
  try {
    const { data, error } = await supabase
      .from('delivery_zones')
      .select('*')
      .eq('zip_code', zip.trim())
      .maybeSingle();
    if (error || !data) return null;
    return {
      zipCode: data.zip_code,
      city: data.city,
      zone: data.zone,
      baseRate: data.base_rate != null ? Number(data.base_rate) : null,
      pickupRate: data.pickup_rate != null ? Number(data.pickup_rate) : null,
      serviceDays: data.service_days ?? '',
    };
  } catch {
    return null;
  }
}

/** Fetch all zones for the admin rate editor. */
export async function fetchAllDeliveryZones(): Promise<DeliveryZone[] | null> {
  try {
    const { data, error } = await supabase
      .from('delivery_zones')
      .select('*')
      .order('zip_code');
    if (error || !data) return null;
    return data.map((r: {
      zip_code: string;
      city: string;
      zone: string;
      base_rate: number | null;
      pickup_rate: number | null;
      service_days: string | null;
    }) => ({
      zipCode: r.zip_code,
      city: r.city,
      zone: r.zone,
      baseRate: r.base_rate != null ? Number(r.base_rate) : null,
      pickupRate: r.pickup_rate != null ? Number(r.pickup_rate) : null,
      serviceDays: r.service_days ?? '',
    }));
  } catch {
    return null;
  }
}

/**
 * Fetch the delivery-add-on rate card from `service_catalog`.
 *
 * Replaces `fetchDeliveryAccessorials` for the order-creation flow — the
 * delivery_accessorials table is being phased out in favour of a single
 * service_catalog source of truth for billable services. Rows are filtered
 * by `show_as_delivery_service = true AND active = true`. The output is
 * shaped to match `DeliveryAccessorial` so the modal doesn't need a
 * second rendering path.
 *
 * v2 2026-04-25 PST — reads the new delivery-specific columns added in
 * migration 20260425030000_service_catalog_delivery_fields:
 *   • delivery_rate_unit overrides the generic `unit` — lets a flat-billed
 *     row still render as per_mile / per_15min / plus_base in the modal.
 *   • visible_to_client gates whether clients see the service.
 *   • description is shown next to the toggle.
 *   • quote_required no longer has to be inferred from rate == 0; admins
 *     can flag a priced service as quote-only when an in-person estimate
 *     is required.
 *
 * serviceMinutes still defaults to `m_time` (Medium-class minutes) — see
 * useItemClasses for per-class dispatch routing minutes.
 */
export async function fetchDeliveryServicesFromCatalog(): Promise<DeliveryAccessorial[] | null> {
  try {
    const { data, error } = await supabase
      .from('service_catalog')
      // billing_mode + rates + xxl_rate added so the modal can do per-class
      // and per-qty math instead of treating every add-on as flat × qty.
      .select('code, name, billing, billing_mode, flat_rate, rates, xxl_rate, unit, display_order, active, m_time, delivery_rate_unit, visible_to_client, description, quote_required')
      .eq('show_as_delivery_service', true)
      .eq('active', true)
      .order('display_order');
    if (error || !data) return null;
    return data.map((r: {
      code: string;
      name: string;
      billing: string | null;
      billing_mode: string | null;
      flat_rate: number | string | null;
      rates: Record<string, number> | null;
      xxl_rate: number | string | null;
      unit: string | null;
      display_order: number | null;
      active: boolean | null;
      m_time: number | null;
      delivery_rate_unit: string | null;
      visible_to_client: boolean | null;
      description: string | null;
      quote_required: boolean | null;
    }) => {
      // Prefer delivery_rate_unit (admin-set, delivery-specific) over the
      // generic service_catalog.unit. Fall back to mapping unit when
      // delivery_rate_unit hasn't been customised on legacy rows.
      const dru = (r.delivery_rate_unit ?? '').trim();
      let rateUnit: DeliveryAccessorial['rateUnit'];
      if (dru === 'per_mile' || dru === 'per_15min' || dru === 'plus_base' || dru === 'per_item') {
        rateUnit = dru;
      } else if (dru === 'flat') {
        rateUnit = 'flat';
      } else {
        const unit = (r.unit ?? 'per_task') as string;
        rateUnit =
          unit === 'per_item' ? 'per_item' :
          unit === 'per_hour' ? 'per_hour' :
          unit === 'per_day'  ? 'per_day'  :
          'flat';
      }
      const rate = r.flat_rate != null ? Number(r.flat_rate) : 0;
      const quoteRequired = r.quote_required === true || (r.quote_required === null && rate === 0);
      // billing_mode default — per_job is the safe fallback (single flat
      // charge); won't overcharge if the column is somehow null.
      const bm = r.billing_mode === 'per_class' || r.billing_mode === 'per_qty' || r.billing_mode === 'per_job'
        ? r.billing_mode
        : 'per_job';
      const rawRates = (r.rates ?? {}) as Record<string, number>;
      const xxl = Number(r.xxl_rate ?? 0);
      const classRates = {
        XS:  Number(rawRates.XS  ?? 0) || 0,
        S:   Number(rawRates.S   ?? 0) || 0,
        M:   Number(rawRates.M   ?? 0) || 0,
        L:   Number(rawRates.L   ?? 0) || 0,
        XL:  Number(rawRates.XL  ?? 0) || 0,
        XXL: Number(rawRates.XXL ?? xxl) || 0,
      };
      return {
        code: r.code,
        name: r.name,
        rate,
        rateUnit,
        billingMode: bm,
        classRates,
        description: r.description ?? '',
        displayOrder: r.display_order ?? 0,
        active: r.active !== false,
        visibleToClient: r.visible_to_client !== false,
        serviceMinutes: r.m_time ?? 0,
        quoteRequired,
        availableForDelivery: true,
      };
    });
  } catch {
    return null;
  }
}

/** Fetch delivery_minutes per item class id → minutes map. */
export async function fetchItemClassMinutes(): Promise<Record<string, number>> {
  try {
    const { data, error } = await supabase
      .from('item_classes')
      .select('id, delivery_minutes')
      .eq('active', true);
    if (error || !data) return {};
    return Object.fromEntries(
      (data as { id: string; delivery_minutes: number | null }[])
        .map(r => [r.id, r.delivery_minutes ?? 0])
    );
  } catch {
    return {};
  }
}

/** Fetch the active fabric protection rate card. */
export async function fetchFabricProtectionRates(): Promise<FabricProtectionRate[] | null> {
  try {
    const { data, error } = await supabase
      .from('fabric_protection_rates')
      .select('*')
      .eq('active', true)
      .order('display_order');
    if (error || !data) return null;
    return data.map((r: {
      item_type: string;
      rate: number;
      rate_unit: FabricProtectionRate['rateUnit'];
      min_charge: number | null;
      display_order: number;
      active: boolean;
    }) => ({
      itemType: r.item_type,
      rate: Number(r.rate),
      rateUnit: r.rate_unit,
      minCharge: r.min_charge != null ? Number(r.min_charge) : null,
      displayOrder: r.display_order,
      active: r.active,
    }));
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Clients — session 65. Fast dropdown (was 120-240s via GAS cold-start).
// Mirror written by StrideAPI.gs on every client edit + backfill endpoint.
// Returns null on any failure so the caller can fall back to fetchClients (GAS).
// ─────────────────────────────────────────────────────────────────────────────

interface SupabaseClientRow {
  tenant_id: string;
  name: string;
  spreadsheet_id: string;
  email: string | null;
  contact_name: string | null;
  phone: string | null;
  folder_id: string | null;
  photos_folder_id: string | null;
  invoice_folder_id: string | null;
  free_storage_days: number | null;
  discount_storage_pct: number | null;
  discount_services_pct: number | null;
  payment_terms: string | null;
  enable_receiving_billing: boolean | null;
  enable_shipment_email: boolean | null;
  enable_notifications: boolean | null;
  auto_inspection: boolean | null;
  separate_by_sidemark: boolean | null;
  auto_charge: boolean | null;
  web_app_url: string | null;
  qb_customer_name: string | null;
  stax_customer_name: string | null;
  stax_customer_id: string | null;
  parent_client: string | null;
  notes: string | null;
  shipment_note: string | null;
  active: boolean | null;
  // v38.159.0 — Supabase-only billing contact fields
  billing_contact_name: string | null;
  billing_email: string | null;
  billing_address: string | null;
  // COD Storage (Supabase-only)
  end_customer_pays_storage: boolean | null;
}

export async function fetchClientsFromSupabase(
  includeInactive = false
): Promise<ClientsResponse | null> {
  try {
    let query = supabase.from('clients').select('*');
    if (!includeInactive) query = query.eq('active', true);
    const { data, error } = await query.order('name');
    if (error || !data || data.length === 0) return null;

    const clients: ApiClient[] = (data as SupabaseClientRow[]).map(row => ({
      name: row.name,
      spreadsheetId: row.spreadsheet_id,
      email: row.email ?? '',
      contactName: row.contact_name ?? '',
      phone: row.phone ?? '',
      folderId: row.folder_id ?? '',
      photosFolderId: row.photos_folder_id ?? '',
      invoiceFolderId: row.invoice_folder_id ?? '',
      freeStorageDays: row.free_storage_days ?? 0,
      discountStoragePct: row.discount_storage_pct ?? 0,
      discountServicesPct: row.discount_services_pct ?? 0,
      paymentTerms: row.payment_terms ?? 'NET 30',
      enableReceivingBilling: row.enable_receiving_billing ?? false,
      enableShipmentEmail: row.enable_shipment_email ?? false,
      enableNotifications: row.enable_notifications ?? false,
      autoInspection: row.auto_inspection ?? false,
      separateBySidemark: row.separate_by_sidemark ?? false,
      autoCharge: row.auto_charge ?? false,
      webAppUrl: row.web_app_url ?? '',
      qbCustomerName: row.qb_customer_name ?? '',
      staxCustomerName: row.stax_customer_name ?? '',
      staxCustomerId: row.stax_customer_id ?? '',
      parentClient: row.parent_client ?? '',
      notes: row.notes ?? '',
      shipmentNote: row.shipment_note ?? '',
      active: row.active ?? true,
      billingContactName: row.billing_contact_name ?? '',
      billingEmail:       row.billing_email ?? '',
      billingAddress:     row.billing_address ?? '',
      endCustomerPaysStorage: row.end_customer_pays_storage ?? false,
    }));

    return { clients, count: clients.length };
  } catch {
    return null;
  }
}

// ─── Claims read cache ──────────────────────────────────────────────────────

interface SupabaseClaimRow {
  claim_id: string;
  claim_type: string | null;
  status: string | null;
  outcome_type: string | null;
  resolution_type: string | null;
  date_opened: string | null;
  incident_date: string | null;
  date_closed: string | null;
  date_settlement_sent: string | null;
  date_signed_settlement_received: string | null;
  created_by: string | null;
  first_reviewed_by: string | null;
  first_reviewed_at: string | null;
  primary_contact_name: string | null;
  company_client_name: string | null;
  email: string | null;
  phone: string | null;
  requested_amount: number | null;
  approved_amount: number | null;
  coverage_type: string | null;
  client_selected_coverage: string | null;
  property_incident_reference: string | null;
  incident_location: string | null;
  issue_description: string | null;
  decision_explanation: string | null;
  internal_notes_summary: string | null;
  public_notes_summary: string | null;
  claim_folder_url: string | null;
  current_settlement_file_url: string | null;
  current_settlement_version: string | null;
  void_reason: string | null;
  close_note: string | null;
  last_updated: string | null;
}

export async function fetchClaimsFromSupabase(): Promise<ClaimsResponse | null> {
  try {
    const { data, error } = await supabase.from('claims').select('*');
    if (error || !data) return null;

    const claims: ApiClaim[] = (data as SupabaseClaimRow[]).map(row => ({
      claimId: row.claim_id,
      claimType: row.claim_type ?? '',
      status: row.status ?? '',
      outcomeType: row.outcome_type ?? '',
      resolutionType: row.resolution_type ?? '',
      dateOpened: row.date_opened ?? '',
      incidentDate: row.incident_date ?? '',
      dateClosed: row.date_closed ?? '',
      dateSettlementSent: row.date_settlement_sent ?? '',
      dateSignedSettlementReceived: row.date_signed_settlement_received ?? '',
      createdBy: row.created_by ?? '',
      firstReviewedBy: row.first_reviewed_by ?? '',
      firstReviewedAt: row.first_reviewed_at ?? '',
      primaryContactName: row.primary_contact_name ?? '',
      companyClientName: row.company_client_name ?? '',
      email: row.email ?? '',
      phone: row.phone ?? '',
      requestedAmount: row.requested_amount,
      approvedAmount: row.approved_amount,
      coverageType: row.coverage_type ?? '',
      clientSelectedCoverage: row.client_selected_coverage ?? '',
      propertyIncidentReference: row.property_incident_reference ?? '',
      incidentLocation: row.incident_location ?? '',
      issueDescription: row.issue_description ?? '',
      decisionExplanation: row.decision_explanation ?? '',
      internalNotesSummary: row.internal_notes_summary ?? '',
      publicNotesSummary: row.public_notes_summary ?? '',
      claimFolderUrl: row.claim_folder_url ?? '',
      currentSettlementFileUrl: row.current_settlement_file_url ?? '',
      currentSettlementVersion: row.current_settlement_version ?? '',
      voidReason: row.void_reason ?? '',
      closeNote: row.close_note ?? '',
      lastUpdated: row.last_updated ?? '',
    }));

    return { claims, count: claims.length };
  } catch {
    return null;
  }
}

// ─── Users read cache ───────────────────────────────────────────────────────

interface SupabaseCbUserRow {
  email: string;
  role: string | null;
  client_name: string | null;
  client_sheet_id: string | null;
  active: boolean | null;
  contact_name: string | null;
  phone: string | null;
  stax_customer_id: string | null;
}

export async function fetchUsersFromSupabase(): Promise<UsersResponse | null> {
  try {
    const { data, error } = await supabase.from('cb_users').select('*');
    if (error || !data) return null;

    const users: ApiUser[] = (data as SupabaseCbUserRow[]).map(row => ({
      email: row.email,
      role: (row.role as ApiUser['role']) || 'client',
      clientName: row.client_name ?? '',
      clientSheetId: row.client_sheet_id ?? '',
      active: row.active ?? true,
      created: '',
      lastLogin: '',
      lastLoginSource: '',
      updatedBy: '',
      updatedAt: '',
      contactName: row.contact_name ?? undefined,
      phone: row.phone ?? undefined,
      staxCustomerId: row.stax_customer_id ?? undefined,
    }));

    return { users, count: users.length };
  } catch {
    return null;
  }
}

// ─── Marketing contacts read cache ──────────────────────────────────────────

interface SupabaseMarketingContactRow {
  email: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  status: string | null;
  existing_client: boolean | null;
  campaign_tag: string | null;
  source: string | null;
  added_by: string | null;
  date_added: string | null;
  last_campaign_date: string | null;
  replied: boolean | null;
  converted: boolean | null;
  bounced: boolean | null;
  unsubscribed: boolean | null;
  suppressed: boolean | null;
  suppression_reason: string | null;
  suppression_date: string | null;
  manual_release_note: string | null;
  notes: string | null;
}

export interface MarketingContactsQueryParams {
  status?: string;        // 'Pending' | 'Client' | 'Suppressed' | undefined (= all)
  search?: string;        // searches first/last/email/company
  page?: number;
  pageSize?: number;
}

export async function fetchMarketingContactsFromSupabase(
  params?: MarketingContactsQueryParams
): Promise<{ contacts: MarketingContact[]; total: number; page: number; pageSize: number } | null> {
  try {
    const page = Math.max(1, params?.page ?? 1);
    const pageSize = Math.max(1, Math.min(500, params?.pageSize ?? 100));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let countQuery = supabase.from('marketing_contacts').select('*', { count: 'exact', head: true });
    let dataQuery = supabase.from('marketing_contacts').select('*');

    if (params?.status && params.status !== 'All') {
      countQuery = countQuery.eq('status', params.status);
      dataQuery = dataQuery.eq('status', params.status);
    }
    if (params?.search) {
      const s = params.search.trim();
      if (s) {
        // Multi-field ILIKE search on first_name, last_name, email, company
        const pattern = `%${s}%`;
        const orFilter = `first_name.ilike.${pattern},last_name.ilike.${pattern},email.ilike.${pattern},company.ilike.${pattern}`;
        countQuery = countQuery.or(orFilter);
        dataQuery = dataQuery.or(orFilter);
      }
    }

    const [{ count, error: countErr }, { data, error: dataErr }] = await Promise.all([
      countQuery,
      dataQuery.order('date_added', { ascending: false, nullsFirst: false }).range(from, to),
    ]);

    if (countErr || dataErr || !data) return null;

    const contacts: MarketingContact[] = (data as SupabaseMarketingContactRow[]).map(row => ({
      email: row.email,
      firstName: row.first_name ?? '',
      lastName: row.last_name ?? '',
      company: row.company ?? '',
      status: (row.status || 'Pending') as MarketingContact['status'],
      existingClient: row.existing_client ?? false,
      campaignTag: row.campaign_tag ?? '',
      dateAdded: row.date_added ?? '',
      addedBy: row.added_by ?? '',
      source: row.source ?? '',
      lastCampaignDate: row.last_campaign_date,
      replied: row.replied ?? false,
      converted: row.converted ?? false,
      bounced: row.bounced ?? false,
      unsubscribed: row.unsubscribed ?? false,
      suppressed: row.suppressed ?? false,
      suppressionReason: row.suppression_reason ?? '',
      suppressionDate: row.suppression_date,
      manualReleaseNote: row.manual_release_note ?? '',
      notes: row.notes ?? '',
    }));

    return { contacts, total: count ?? contacts.length, page, pageSize };
  } catch {
    return null;
  }
}

// ─── Marketing campaigns read cache ─────────────────────────────────────────

interface SupabaseMarketingCampaignRow {
  campaign_id: string; name: string | null; type: string | null; status: string | null;
  priority: number | null; target_type: string | null; target_value: string | null;
  enrollment_mode: string | null;
  initial_template: string | null; follow_up_1_template: string | null;
  follow_up_2_template: string | null; follow_up_3_template: string | null;
  max_follow_ups: number | null; follow_up_interval_days: number | null;
  daily_send_limit: number | null; send_window_start: number | null; send_window_end: number | null;
  start_date: string | null; end_date: string | null;
  test_mode: boolean | null; test_recipient: string | null;
  created_date: string | null; last_run_date: string | null;
  validation_status: string | null; validation_notes: string | null; last_error: string | null;
  total_sent: number | null; total_replied: number | null; total_bounced: number | null;
  total_unsubscribed: number | null; total_converted: number | null;
  notes: string | null; custom_1: string | null; custom_2: string | null; custom_3: string | null;
}

function mapSupabaseCampaign(row: SupabaseMarketingCampaignRow): MarketingCampaign {
  return {
    campaignId: row.campaign_id,
    name: row.name ?? '',
    type: (row.type || 'Blast') as CampaignType,
    status: (row.status || 'Draft') as CampaignStatus,
    priority: row.priority ?? 0,
    targetType: row.target_type ?? '',
    targetValue: row.target_value ?? '',
    enrollmentMode: row.enrollment_mode ?? '',
    initialTemplate: row.initial_template ?? '',
    followUp1Template: row.follow_up_1_template ?? '',
    followUp2Template: row.follow_up_2_template ?? '',
    followUp3Template: row.follow_up_3_template ?? '',
    maxFollowUps: row.max_follow_ups ?? 0,
    followUpIntervalDays: row.follow_up_interval_days ?? 0,
    dailySendLimit: row.daily_send_limit ?? 0,
    sendWindowStart: row.send_window_start ?? 0,
    sendWindowEnd: row.send_window_end ?? 0,
    startDate: row.start_date,
    endDate: row.end_date,
    testMode: row.test_mode ?? false,
    testRecipient: row.test_recipient ?? '',
    createdDate: row.created_date ?? '',
    lastRunDate: row.last_run_date,
    validationStatus: row.validation_status ?? '',
    validationNotes: row.validation_notes ?? '',
    lastError: row.last_error ?? '',
    totalSent: row.total_sent ?? 0,
    totalReplied: row.total_replied ?? 0,
    totalBounced: row.total_bounced ?? 0,
    totalUnsubscribed: row.total_unsubscribed ?? 0,
    totalConverted: row.total_converted ?? 0,
    notes: row.notes ?? '',
    custom1: row.custom_1 ?? '',
    custom2: row.custom_2 ?? '',
    custom3: row.custom_3 ?? '',
  };
}

export async function fetchMarketingCampaignsFromSupabase(): Promise<{ campaigns: MarketingCampaign[] } | null> {
  try {
    const { data, error } = await supabase.from('marketing_campaigns').select('*').order('created_date', { ascending: false, nullsFirst: false });
    if (error || !data) return null;
    const campaigns = (data as SupabaseMarketingCampaignRow[]).map(mapSupabaseCampaign);
    return { campaigns };
  } catch {
    return null;
  }
}

// ─── Marketing templates read cache ─────────────────────────────────────────

interface SupabaseMarketingTemplateRow {
  name: string; subject: string | null; preview_text: string | null;
  html_body: string | null; version: string | null; type: string | null; active: boolean | null;
}

export async function fetchMarketingTemplatesFromSupabase(): Promise<{ templates: MarketingTemplate[] } | null> {
  try {
    const { data, error } = await supabase.from('marketing_templates').select('*').order('name', { ascending: true });
    if (error || !data) return null;
    const templates: MarketingTemplate[] = (data as SupabaseMarketingTemplateRow[]).map(row => ({
      name: row.name,
      subject: row.subject ?? '',
      previewText: row.preview_text ?? '',
      htmlBody: row.html_body ?? '',
      version: row.version ?? '',
      type: row.type ?? undefined,
      active: row.active ?? true,
    }));
    return { templates };
  } catch {
    return null;
  }
}

// ─── Marketing settings read cache (singleton) ──────────────────────────────

interface SupabaseMarketingSettingsRow {
  id: number;
  daily_digest_email: string | null; booking_url: string | null; unsubscribe_base_url: string | null;
  sender_name: string | null; sender_phone: string | null; sender_email: string | null;
  send_from_email: string | null; website_url: string | null;
}

export async function fetchMarketingSettingsFromSupabase(): Promise<MarketingSettings | null> {
  try {
    const { data, error } = await supabase.from('marketing_settings').select('*').eq('id', 1).maybeSingle();
    if (error || !data) return null;
    const row = data as SupabaseMarketingSettingsRow;
    return {
      dailyDigestEmail: row.daily_digest_email ?? '',
      bookingUrl: row.booking_url ?? '',
      unsubscribeBaseUrl: row.unsubscribe_base_url ?? '',
      senderName: row.sender_name ?? '',
      senderPhone: row.sender_phone ?? '',
      senderEmail: row.sender_email ?? '',
      sendFromEmail: row.send_from_email ?? '',
      websiteUrl: row.website_url ?? '',
    };
  } catch {
    return null;
  }
}

// ─── Marketing dashboard aggregates (built from contacts + campaigns) ───────

/**
 * Compute DashboardStats entirely from Supabase — contacts counts + campaigns list
 * with their existing rolling totals. Skips `gmailQuotaRemaining` (GAS-only, reported as 0;
 * caller can fall back to GAS if they truly need that number). Skips per-campaign
 * `enrolled`/`pending`/`exhausted` counts (require Campaign Contacts mirror, which
 * we don't have — reported as 0). Everything else is accurate.
 */
export async function fetchMarketingDashboardFromSupabase(): Promise<DashboardStats | null> {
  try {
    const [contactsRes, campaignsRes] = await Promise.all([
      supabase.from('marketing_contacts').select('status,suppressed,existing_client'),
      supabase.from('marketing_campaigns').select('*').order('created_date', { ascending: false, nullsFirst: false }),
    ]);
    if (contactsRes.error || campaignsRes.error || !contactsRes.data || !campaignsRes.data) return null;

    const contacts = contactsRes.data as Array<{ status: string | null; suppressed: boolean | null; existing_client: boolean | null }>;
    const totalContacts = contacts.length;
    const suppressed = contacts.filter(c => c.suppressed === true).length;
    const existingClients = contacts.filter(c => c.existing_client === true && c.suppressed !== true).length;
    const activeLeads = contacts.filter(c => c.suppressed !== true && c.existing_client !== true).length;

    const campaignRows = campaignsRes.data as SupabaseMarketingCampaignRow[];
    const activeCampaigns = campaignRows.filter(c => c.status === 'Active').length;
    const campaigns: DashboardCampaignRow[] = campaignRows.map(c => ({
      campaignId: c.campaign_id,
      name: c.name ?? '',
      type: (c.type || 'Blast') as CampaignType,
      status: (c.status || 'Draft') as CampaignStatus,
      priority: c.priority ?? 0,
      enrolled: 0,         // requires Campaign Contacts mirror (not built yet)
      sent: c.total_sent ?? 0,
      replied: c.total_replied ?? 0,
      bounced: c.total_bounced ?? 0,
      unsubscribed: c.total_unsubscribed ?? 0,
      converted: c.total_converted ?? 0,
      pending: 0,          // requires Campaign Contacts mirror
      exhausted: 0,        // requires Campaign Contacts mirror
      lastRunDate: c.last_run_date,
    }));
    const globalTotals = {
      sent: campaignRows.reduce((a, c) => a + (c.total_sent ?? 0), 0),
      replied: campaignRows.reduce((a, c) => a + (c.total_replied ?? 0), 0),
      bounced: campaignRows.reduce((a, c) => a + (c.total_bounced ?? 0), 0),
      unsubscribed: campaignRows.reduce((a, c) => a + (c.total_unsubscribed ?? 0), 0),
      converted: campaignRows.reduce((a, c) => a + (c.total_converted ?? 0), 0),
    };

    return {
      totalContacts, activeLeads, existingClients, suppressed,
      activeCampaigns,
      gmailQuotaRemaining: -1, // sentinel — UI can treat as "unknown"
      campaigns,
      globalTotals,
    };
  } catch {
    return null;
  }
}

// ─── Session 68: Locations ───────────────────────────────────────────────────

interface SupabaseLocationRow {
  code: string;
  notes: string | null;
  active: boolean | null;
  tenant_id: string;
  updated_at: string | null;
}

export async function fetchLocationsFromSupabase(): Promise<LocationsResponse | null> {
  try {
    const { data, error } = await supabase
      .from('locations')
      .select('code, notes, active, tenant_id, updated_at')
      .eq('active', true)
      .order('code', { ascending: true })
      .range(0, 9999);
    if (error || !data || data.length === 0) return null;
    const locations: ApiLocation[] = (data as SupabaseLocationRow[]).map(row => ({
      location: row.code,
      notes: row.notes ?? '',
    }));
    return { locations, count: locations.length };
  } catch {
    return null;
  }
}

// ─── Session 68: Batch item ID → inventory row resolution ───────────────────
// Powers the Scanner + Labels pages. Given an array of item IDs, returns the
// matching inventory rows with client name enrichment. RLS limits client
// users to their own tenants; staff/admin see all. Supabase row-cap bumped
// to 50k via range() (see earlier session-67 fix).

export interface ResolvedItem {
  itemId: string;
  tenantId: string;
  clientName: string;
  description: string;
  vendor: string;
  sidemark: string;
  room: string;
  itemClass: string;
  qty: number;
  location: string;
  status: string;
  reference: string;
}

export async function fetchItemsByIdsFromSupabase(
  itemIds: string[],
  clientNameMap: ClientNameMap
): Promise<ResolvedItem[] | null> {
  try {
    if (!itemIds.length) return [];
    const deduped = Array.from(new Set(itemIds.map(s => s.trim()).filter(Boolean)));
    if (!deduped.length) return [];
    // Chunk large batches (Supabase URL length practical limit)
    const CHUNK = 200;
    const results: ResolvedItem[] = [];
    for (let i = 0; i < deduped.length; i += CHUNK) {
      const slice = deduped.slice(i, i + CHUNK);
      const { data, error } = await supabase
        .from('inventory')
        .select('item_id, tenant_id, description, vendor, sidemark, room, item_class, qty, location, status, reference')
        .in('item_id', slice)
        .range(0, 9999);
      if (error || !data) continue;
      for (const row of data as SupabaseInventoryRow[]) {
        results.push({
          itemId: row.item_id,
          tenantId: row.tenant_id,
          clientName: clientNameMap[row.tenant_id] ?? '',
          description: row.description ?? '',
          vendor: row.vendor ?? '',
          sidemark: row.sidemark ?? '',
          room: row.room ?? '',
          itemClass: row.item_class ?? '',
          qty: row.qty ?? 1,
          location: row.location ?? '',
          status: row.status ?? '',
          reference: row.reference ?? '',
        });
      }
    }
    return results;
  } catch {
    return null;
  }
}

// ─── Stax read caches (session 69) ──────────────────────────────────────────

interface SupabaseStaxInvoiceRow {
  qb_invoice_no: string;
  row_index: number | null;
  customer: string | null;
  stax_customer_id: string | null;
  invoice_date: string | null;
  due_date: string | null;
  amount: number | null;
  line_items_json: string | null;
  stax_id: string | null;
  status: string | null;
  created_at_sheet: string | null;
  notes: string | null;
  is_test: boolean | null;
  auto_charge: boolean | null;
  payment_method_status: string | null;
}

export async function fetchStaxInvoicesFromSupabase(): Promise<StaxInvoicesResponse | null> {
  try {
    const { data, error } = await supabase.from('stax_invoices').select('*');
    if (error) {
      console.error('[supabase] stax_invoices fetch failed:', error.code, error.message, error.details);
      return null;
    }
    if (!data) return null;
    const invoices = (data as SupabaseStaxInvoiceRow[]).map(r => ({
      rowIndex: r.row_index ?? 0,
      qbInvoice: r.qb_invoice_no,
      customer: r.customer ?? '',
      staxCustomerId: r.stax_customer_id ?? '',
      invoiceDate: isoDateOnly(r.invoice_date),
      dueDate: isoDateOnly(r.due_date),
      // v38.120.0 — scheduled_date: empty → frontend falls back to due_date for display + charge timing
      scheduledDate: isoDateOnly((r as unknown as { scheduled_date?: string | null }).scheduled_date),
      amount: r.amount ?? 0,
      lineItemsJson: r.line_items_json ?? '',
      staxId: r.stax_id ?? '',
      status: r.status ?? '',
      createdAt: r.created_at_sheet ?? '',
      notes: r.notes ?? '',
      isTest: r.is_test ?? false,
      autoCharge: r.auto_charge ?? false,
      paymentMethodStatus: (r.payment_method_status as any) ?? 'unknown',
    }));
    return { invoices, count: invoices.length };
  } catch {
    return null;
  }
}

interface SupabaseStaxChargeRow {
  timestamp: string | null;
  qb_invoice_no: string | null;
  stax_invoice_id: string | null;
  stax_customer_id: string | null;
  customer: string | null;
  amount: number | null;
  status: string | null;
  txn_id: string | null;
  notes: string | null;
}

export async function fetchStaxChargeLogFromSupabase(): Promise<StaxChargeLogResponse | null> {
  try {
    const { data, error } = await supabase
      .from('stax_charges')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(2000);
    if (error) {
      console.error('[supabase] stax_charges fetch failed:', error.code, error.message, error.details);
      return null;
    }
    if (!data) return null;
    const charges = (data as SupabaseStaxChargeRow[]).map(r => ({
      timestamp: r.timestamp ?? '',
      qbInvoice: r.qb_invoice_no ?? '',
      staxInvoiceId: r.stax_invoice_id ?? '',
      staxCustomerId: r.stax_customer_id ?? '',
      customer: r.customer ?? '',
      amount: r.amount ?? 0,
      status: r.status ?? '',
      txnId: r.txn_id ?? '',
      notes: r.notes ?? '',
    }));
    return { charges, count: charges.length };
  } catch {
    return null;
  }
}

interface SupabaseStaxExceptionRow {
  timestamp: string | null;
  qb_invoice_no: string | null;
  customer: string | null;
  stax_customer_id: string | null;
  amount: number | null;
  due_date: string | null;
  reason: string | null;
  pay_link: string | null;
  resolved: boolean | null;
}

export async function fetchStaxExceptionsFromSupabase(): Promise<StaxExceptionsResponse | null> {
  try {
    const { data, error } = await supabase
      .from('stax_exceptions')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(2000);
    if (error) {
      console.error('[supabase] stax_exceptions fetch failed:', error.code, error.message, error.details);
      return null;
    }
    if (!data) return null;
    const exceptions = (data as SupabaseStaxExceptionRow[]).map(r => ({
      timestamp: r.timestamp ?? '',
      qbInvoice: r.qb_invoice_no ?? '',
      customer: r.customer ?? '',
      staxCustomerId: r.stax_customer_id ?? '',
      amount: r.amount ?? 0,
      dueDate: isoDateOnly(r.due_date),
      reason: r.reason ?? '',
      payLink: r.pay_link ?? '',
      resolved: r.resolved ?? false,
    }));
    const unresolvedCount = exceptions.filter(e => !e.resolved).length;
    return { exceptions, count: exceptions.length, unresolvedCount };
  } catch {
    return null;
  }
}

interface SupabaseStaxCustomerRow {
  qb_name: string;
  stax_company: string | null;
  stax_name: string | null;
  stax_id: string | null;
  email: string | null;
  pay_method: string | null;
  notes: string | null;
}

export async function fetchStaxCustomersFromSupabase(): Promise<StaxCustomersResponse | null> {
  try {
    const { data, error } = await supabase.from('stax_customers').select('*');
    if (error) {
      console.error('[supabase] stax_customers fetch failed:', error.code, error.message, error.details);
      return null;
    }
    if (!data) return null;
    const customers = (data as SupabaseStaxCustomerRow[]).map(r => ({
      qbName: r.qb_name,
      staxCompany: r.stax_company ?? '',
      staxName: r.stax_name ?? '',
      staxId: r.stax_id ?? '',
      email: r.email ?? '',
      payMethod: r.pay_method ?? '',
      notes: r.notes ?? '',
    }));
    return { customers, count: customers.length };
  } catch {
    return null;
  }
}

// fetchStaxCustomersFromClients was retired in v38.154.0 — Payments.tsx
// now derives the Stax customers list from the cached useClients hook
// (apiCache + 'client' entityEvents + Supabase realtime), so a separate
// per-mount Supabase query was redundant. The same shape is built in-page
// by `clientsToStaxCustomers` against the in-memory ApiClient[].

interface SupabaseStaxRunLogRow {
  timestamp: string | null;
  fn: string | null;
  summary: string | null;
  details: string | null;
}

// ─── Single Item by ID ────────────────────────────────────────────────────────

/**
 * Fetch a single inventory item by item_id. Used by ItemPage standalone route.
 * Falls back to null on error or not-found — caller handles state.
 */
export async function fetchItemByIdFromSupabase(
  itemId: string,
  clientNameMap: ClientNameMap,
  /**
   * Optional tenant filter (the user's accessibleClientSheetIds). When
   * provided, only rows from these tenants are considered. Critical for
   * transferred items: after a transfer, the same item_id exists as TWO
   * rows in `inventory` — one Transferred row under the source tenant
   * and one Active row under the destination tenant. Without scoping,
   * the unordered fetch could return the source row whose tenant the
   * current client user doesn't have access to, producing a spurious
   * Access Denied. For staff/admin, leave undefined to fetch any tenant.
   */
  tenantScope?: string[],
): Promise<ApiInventoryItem | null> {
  try {
    // Read from the `inventory_live` view, which excludes status='Transferred'
    // rows. The DB layer now guarantees we never see the historical/source
    // row for a transferred item, so the "two rows per item_id" duplication
    // can't trip up this lookup. The view is RLS-passthrough (security_invoker)
    // so tenant restrictions still apply.
    let q = supabase.from('inventory_live').select('*').eq('item_id', itemId);
    if (tenantScope && tenantScope.length > 0) {
      q = q.in('tenant_id', tenantScope);
    }
    const { data, error } = await q.limit(10);
    if (error || !data || data.length === 0) return null;
    // Defense in depth: even though the view filters Transferred, prefer
    // any non-Transferred row if multiple come back (e.g. legacy rows that
    // pre-date the view).
    const rows = data as SupabaseInventoryRow[];
    const row = rows.find(r => r.status !== 'Transferred') || rows[0];
    return {
      itemId: row.item_id,
      clientName: clientNameMap[row.tenant_id] || '',
      clientSheetId: row.tenant_id,
      reference: row.reference || '',
      qty: row.qty ?? 1,
      vendor: row.vendor || '',
      description: row.description || '',
      itemClass: row.item_class || '',
      location: row.location || '',
      sidemark: row.sidemark || '',
      room: row.room || '',
      itemNotes: row.item_notes || '',
      taskNotes: row.task_notes || '',
      needsInspection: !!row.needs_inspection,
      needsAssembly: !!row.needs_assembly,
      carrier: row.carrier || '',
      trackingNumber: row.tracking_number || '',
      shipmentNumber: row.shipment_number || '',
      receiveDate: row.receive_date || '',
      releaseDate: row.release_date || '',
      status: (row.status as ApiInventoryItem['status']) || 'Active',
      invoiceUrl: row.invoice_url || '',
      shipmentFolderUrl: row.shipment_folder_url || undefined,
      declaredValue: row.declared_value ?? 0,
      coverageOptionId: row.coverage_option_id ?? '',
    };
  } catch {
    return null;
  }
}

export async function fetchStaxRunLogFromSupabase(): Promise<StaxRunLogResponse | null> {
  try {
    const { data, error } = await supabase
      .from('stax_run_log')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(500);
    if (error) {
      console.error('[supabase] stax_run_log fetch failed:', error.code, error.message, error.details);
      return null;
    }
    if (!data) return null;
    const entries = (data as SupabaseStaxRunLogRow[]).map(r => ({
      timestamp: r.timestamp ?? '',
      fn: r.fn ?? '',
      summary: r.summary ?? '',
      details: r.details ?? '',
    }));
    return { entries, count: entries.length };
  } catch {
    return null;
  }
}

// ─── Billing Activity Log (v38.114.0) ────────────────────────────────────────

export interface BillingActivityRow {
  id: string;
  tenantId: string;
  clientName: string | null;
  action: string;                // 'invoice_create' | 'qbo_push' | 'invoice_email_send' | 'charge_stax' | 'charge_manual' | 'pay_link_send' | 'exception'
  status: string;                // 'success' | 'failure' | 'partial' | 'skipped'
  invoiceNo: string | null;
  ledgerRowId: string | null;
  qboInvoiceId: string | null;
  qboDocNumber: string | null;
  staxInvoiceId: string | null;
  amount: number | null;
  summary: string | null;
  errorMessage: string | null;
  details: Record<string, unknown> | null;
  performedBy: string | null;
  performedAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolvedNote: string | null;
}

export interface BillingActivityFilters {
  tenantIds?: string[];          // Limit to these tenants (undefined = all accessible)
  actions?: string[];            // e.g. ['invoice_create', 'qbo_push']
  statuses?: string[];           // e.g. ['failure']
  unresolvedOnly?: boolean;      // Failures without resolved_at
  startDate?: string;            // ISO timestamp
  endDate?: string;              // ISO timestamp
  limit?: number;                // Default 500
}

interface SupabaseBillingActivityRow {
  id: string;
  tenant_id: string;
  client_name: string | null;
  action: string;
  status: string;
  invoice_no: string | null;
  ledger_row_id: string | null;
  qbo_invoice_id: string | null;
  qbo_doc_number: string | null;
  stax_invoice_id: string | null;
  amount: number | null;
  summary: string | null;
  error_message: string | null;
  details: Record<string, unknown> | null;
  performed_by: string | null;
  performed_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolved_note: string | null;
}

export async function fetchBillingActivityLog(
  filters: BillingActivityFilters = {}
): Promise<{ rows: BillingActivityRow[]; count: number } | null> {
  try {
    let query = supabase
      .from('billing_activity_log')
      .select('*')
      .order('performed_at', { ascending: false });

    if (filters.tenantIds?.length) query = query.in('tenant_id', filters.tenantIds);
    if (filters.actions?.length) query = query.in('action', filters.actions);
    if (filters.statuses?.length) query = query.in('status', filters.statuses);
    if (filters.unresolvedOnly) {
      query = query.eq('status', 'failure').is('resolved_at', null);
    }
    if (filters.startDate) query = query.gte('performed_at', filters.startDate);
    if (filters.endDate) query = query.lte('performed_at', filters.endDate);

    query = query.limit(filters.limit ?? 500);

    const { data, error } = await query;
    if (error || !data) return null;

    const rows: BillingActivityRow[] = (data as SupabaseBillingActivityRow[]).map(r => ({
      id: r.id,
      tenantId: r.tenant_id,
      clientName: r.client_name,
      action: r.action,
      status: r.status,
      invoiceNo: r.invoice_no,
      ledgerRowId: r.ledger_row_id,
      qboInvoiceId: r.qbo_invoice_id,
      qboDocNumber: r.qbo_doc_number,
      staxInvoiceId: r.stax_invoice_id,
      amount: r.amount,
      summary: r.summary,
      errorMessage: r.error_message,
      details: r.details,
      performedBy: r.performed_by,
      performedAt: r.performed_at,
      resolvedAt: r.resolved_at,
      resolvedBy: r.resolved_by,
      resolvedNote: r.resolved_note,
    }));

    return { rows, count: rows.length };
  } catch {
    return null;
  }
}

// ─── Storage charges (Postgres RPC) ─────────────────────────────────────────
//
// Replaces postPreviewStorageCharges + postGenerateStorageCharges (GAS).
// The Postgres functions live in the 2026-05-02 storage charges migration
// and run against the Supabase mirror tables — finishes in seconds even for
// thousands of items, where the GAS path was timing out.

interface SupabaseStoragePreviewRow {
  tenant_id: string;
  client_name: string | null;
  item_id: string;
  description: string | null;
  vendor: string | null;
  sidemark: string | null;
  item_class: string | null;
  storage_size: number | null;
  receive_date: string | null;
  release_date: string | null;
  free_days: number | null;
  billable_start: string;
  billable_end: string;
  billable_days: number;
  daily_rate: number;
  total_charge: number;
  task_id: string;
  notes: string | null;
  shipment_no: string | null;
  location: string | null;
}

export interface StoragePreviewRow {
  tenantId: string;
  clientName: string;
  itemId: string;
  description: string;
  vendor: string;
  sidemark: string;
  itemClass: string;
  storageSize: number;
  receiveDate: string;
  releaseDate: string | null;
  freeDays: number;
  billableStart: string;
  billableEnd: string;
  billableDays: number;
  dailyRate: number;
  totalCharge: number;
  taskId: string;
  notes: string;
  shipmentNo: string;
  location: string;
}

/**
 * Call public.calculate_storage_charges. Pass `null` for any unfiltered arg.
 * Returns the full row set; client-side filtering by sidemark/client is the
 * caller's responsibility for multi-select cases.
 */
export async function fetchStoragePreviewFromSupabase(args: {
  tenantId?: string | null;
  sidemark?: string | null;
  periodStart: string;
  periodEnd: string;
}): Promise<StoragePreviewRow[] | null> {
  try {
    const { data, error } = await supabase.rpc('calculate_storage_charges', {
      p_tenant_id: args.tenantId ?? null,
      p_sidemark: args.sidemark ?? null,
      p_period_start: args.periodStart,
      p_period_end: args.periodEnd,
    });
    if (error || !data) return null;
    const rows = data as SupabaseStoragePreviewRow[];
    return rows.map(r => ({
      tenantId: r.tenant_id,
      clientName: r.client_name ?? '',
      itemId: r.item_id,
      description: r.description ?? '',
      vendor: r.vendor ?? '',
      sidemark: r.sidemark ?? '',
      itemClass: r.item_class ?? '',
      storageSize: Number(r.storage_size ?? 0),
      receiveDate: r.receive_date ?? '',
      releaseDate: r.release_date,
      freeDays: Number(r.free_days ?? 0),
      billableStart: r.billable_start,
      billableEnd: r.billable_end,
      billableDays: Number(r.billable_days),
      dailyRate: Number(r.daily_rate),
      totalCharge: Number(r.total_charge),
      taskId: r.task_id,
      notes: r.notes ?? '',
      shipmentNo: r.shipment_no ?? '',
      location: r.location ?? '',
    }));
  } catch {
    return null;
  }
}

/**
 * A per-item already-invoiced storage charge from `storage_billing_items`.
 * This is the itemized breakdown behind a STOR-SUMMARY invoice line — the
 * Storage tab's "Invoiced" view reads these so an operator can pull up the
 * per-item detail the collapsed summary row hides.
 */
export interface InvoicedStorageRow {
  tenantId: string;
  itemId: string;
  sidemark: string;
  description: string;
  periodStart: string;
  periodEnd: string;
  billableDays: number | null;
  rate: number;
  amount: number;
  status: string;
  invoiceNo: string;
  invoiceDate: string | null;
}

/**
 * Read FINALIZED (Invoiced/Billed) per-item storage from storage_billing_items
 * for the (tenant?, sidemark?, period) triple. Period match is overlap-based
 * (period_start <= end AND period_end >= start) so a charge whose window
 * straddles the requested range is still returned. Admin/staff can read all
 * tenants via the sbi_select_staff RLS policy; clients see only their own.
 */
export async function fetchInvoicedStorageItems(args: {
  tenantId?: string | null;
  sidemark?: string | null;
  periodStart: string;
  periodEnd: string;
}): Promise<InvoicedStorageRow[] | null> {
  try {
    let q = supabase
      .from('storage_billing_items')
      .select('tenant_id,item_id,sidemark,description,period_start,period_end,billable_days,rate,amount,status,invoice_no,invoice_date')
      .in('status', ['Invoiced', 'Billed'])
      .lte('period_start', args.periodEnd)
      .gte('period_end', args.periodStart);
    if (args.tenantId) q = q.eq('tenant_id', args.tenantId);
    if (args.sidemark) q = q.eq('sidemark', args.sidemark);
    const { data, error } = await q;
    if (error || !data) return null;
    return (data as Array<Record<string, unknown>>).map(r => ({
      tenantId:     String(r.tenant_id ?? ''),
      itemId:       String(r.item_id ?? ''),
      sidemark:     String(r.sidemark ?? ''),
      description:  String(r.description ?? ''),
      periodStart:  String(r.period_start ?? ''),
      periodEnd:    String(r.period_end ?? ''),
      billableDays: r.billable_days == null ? null : Number(r.billable_days),
      rate:         Number(r.rate ?? 0),
      amount:       Number(r.amount ?? 0),
      status:       String(r.status ?? ''),
      invoiceNo:    String(r.invoice_no ?? ''),
      invoiceDate:  r.invoice_date == null ? null : String(r.invoice_date),
    }));
  } catch {
    return null;
  }
}

export interface StorageGenerateResult {
  totalCreated: number;
  totalAmount: number;
  clientsAffected: number;
}

/**
 * Call public.generate_storage_charges. Writes Unbilled rows into
 * public.billing for the (tenant?, sidemark?, period) triple. Returns
 * counts. Admin-only — function raises if the JWT role isn't 'admin'.
 */
export async function generateStorageChargesViaSupabase(args: {
  tenantId?: string | null;
  sidemark?: string | null;
  periodStart: string;
  periodEnd: string;
}): Promise<{ ok: true; result: StorageGenerateResult } | { ok: false; error: string }> {
  try {
    const { data, error } = await supabase.rpc('generate_storage_charges', {
      p_tenant_id: args.tenantId ?? null,
      p_sidemark: args.sidemark ?? null,
      p_period_start: args.periodStart,
      p_period_end: args.periodEnd,
    });
    if (error) return { ok: false, error: error.message || 'RPC failed' };
    const rows = (data ?? []) as Array<{ total_created: number; total_amount: number; clients_affected: number }>;
    const row = rows[0] ?? { total_created: 0, total_amount: 0, clients_affected: 0 };
    return {
      ok: true,
      result: {
        totalCreated: Number(row.total_created ?? 0),
        totalAmount: Number(row.total_amount ?? 0),
        clientsAffected: Number(row.clients_affected ?? 0),
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Tax jurisdictions ──────────────────────────────────────────────────────
// Replaces the hardcoded Kent 10.4% literals that used to live in
// CreateDeliveryOrderModal / PublicServiceRequest. One row is flagged
// is_default (enforced single by a partial unique index); per-client
// overrides still live on clients.tax_rate_pct and take precedence.

export interface TaxJurisdiction {
  id: string;
  city: string;
  state: string;
  ratePct: number;
  isDefault: boolean;
  effectiveDate: string | null;
  source: string | null;
  notes: string | null;
}

interface TaxJurisdictionRow {
  id: string;
  city: string;
  state: string;
  rate_pct: number | string;
  is_default: boolean;
  effective_date: string | null;
  source: string | null;
  notes: string | null;
}

function mapTaxJurisdiction(r: TaxJurisdictionRow): TaxJurisdiction {
  return {
    id: r.id,
    city: r.city,
    state: r.state,
    ratePct: Number(r.rate_pct),
    isDefault: r.is_default === true,
    effectiveDate: r.effective_date,
    source: r.source,
    notes: r.notes,
  };
}

const TAX_JURISDICTION_COLS =
  'id, city, state, rate_pct, is_default, effective_date, source, notes';

export async function fetchTaxJurisdictions(): Promise<TaxJurisdiction[]> {
  const { data, error } = await supabase
    .from('tax_jurisdictions')
    .select(TAX_JURISDICTION_COLS)
    .order('is_default', { ascending: false })
    .order('state', { ascending: true })
    .order('city', { ascending: true });
  if (error || !data) return [];
  return (data as TaxJurisdictionRow[]).map(mapTaxJurisdiction);
}

export async function fetchDefaultTaxJurisdiction(): Promise<TaxJurisdiction | null> {
  const { data, error } = await supabase
    .from('tax_jurisdictions')
    .select(TAX_JURISDICTION_COLS)
    .eq('is_default', true)
    .maybeSingle();
  if (error || !data) return null;
  return mapTaxJurisdiction(data as TaxJurisdictionRow);
}

export interface TaxJurisdictionInput {
  city: string;
  state: string;
  ratePct: number;
  effectiveDate?: string | null;
  source?: string | null;
  notes?: string | null;
}

export async function createTaxJurisdiction(
  input: TaxJurisdictionInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.from('tax_jurisdictions').insert({
    city: input.city,
    state: input.state,
    rate_pct: input.ratePct,
    effective_date: input.effectiveDate || null,
    source: input.source || null,
    notes: input.notes || null,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function updateTaxJurisdiction(
  id: string,
  patch: Partial<TaxJurisdictionInput>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.city !== undefined) row.city = patch.city;
  if (patch.state !== undefined) row.state = patch.state;
  if (patch.ratePct !== undefined) row.rate_pct = patch.ratePct;
  if (patch.effectiveDate !== undefined) row.effective_date = patch.effectiveDate || null;
  if (patch.source !== undefined) row.source = patch.source || null;
  if (patch.notes !== undefined) row.notes = patch.notes || null;
  const { data, error } = await supabase
    .from('tax_jurisdictions')
    .update(row)
    .eq('id', id)
    .select('id');
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) {
    return { ok: false, error: 'Update affected no row — refresh and retry.' };
  }
  return { ok: true };
}

export async function deleteTaxJurisdiction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // The default row is protected — clearing it would leave the app with
  // no jurisdiction to fall back to. Caller also disables the button, but
  // re-check here so a stale UI can't slip a delete through.
  const { data: target, error: readErr } = await supabase
    .from('tax_jurisdictions')
    .select('is_default')
    .eq('id', id)
    .maybeSingle();
  if (readErr) return { ok: false, error: readErr.message };
  if (target?.is_default) {
    return { ok: false, error: 'Cannot delete the default jurisdiction. Set another as default first.' };
  }
  const { error } = await supabase.from('tax_jurisdictions').delete().eq('id', id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function setDefaultTaxJurisdiction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // The partial unique index allows only one is_default=true row, so the
  // previous default must be cleared BEFORE the new one is set or the
  // second update collides with the index. Two statements (no transaction
  // in supabase-js); the gap is sub-second and this is a rare admin click.
  const { error: clearErr } = await supabase
    .from('tax_jurisdictions')
    .update({ is_default: false, updated_at: new Date().toISOString() })
    .eq('is_default', true)
    .neq('id', id);
  if (clearErr) return { ok: false, error: clearErr.message };
  const { data, error } = await supabase
    .from('tax_jurisdictions')
    .update({ is_default: true, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id');
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) {
    return { ok: false, error: 'Update affected no row — refresh and retry.' };
  }
  return { ok: true };
}

