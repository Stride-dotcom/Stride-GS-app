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
} from './api';

/** Map of clientSheetId → clientName for enriching Supabase rows */
export type ClientNameMap = Record<string, string>;

/**
 * Check if Supabase read cache is available (tables exist and have data).
 * Cached for the session to avoid repeated checks.
 */
let _cacheAvailable: boolean | null = null;
let _skipNextSupabase = false;
let _impersonating = false;

/** When impersonating, skip Supabase cache — RLS uses the real admin session,
 *  not the impersonated user. GAS fallback scopes correctly via callerEmail. */
export function setSupabaseImpersonating(active: boolean): void {
  _impersonating = active;
}

export async function isSupabaseCacheAvailable(): Promise<boolean> {
  if (_impersonating) return false;
  if (_skipNextSupabase) {
    _skipNextSupabase = false;
    return false;
  }
  if (_cacheAvailable !== null) return _cacheAvailable;
  try {
    const { count, error } = await supabase
      .from('inventory')
      .select('id', { count: 'exact', head: true })
      .limit(1);
    _cacheAvailable = !error && (count ?? 0) > 0;
  } catch {
    _cacheAvailable = false;
  }
  return _cacheAvailable;
}

/** Reset the cache availability check (call after bulk sync) */
export function resetCacheAvailability(): void {
  _cacheAvailable = null;
}

/** Skip Supabase cache for the next fetch (force GAS fallback). One-shot flag. */
export function skipSupabaseCacheOnce(): void {
  _skipNextSupabase = true;
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
  buildQuery: () => { range: (from: number, to: number) => Promise<{ data: T[] | null; error: unknown }> }
): Promise<T[] | null> {
  const all: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await buildQuery().range(from, to);
    if (error) return null;
    if (!data || data.length === 0) break;
    for (let i = 0; i < data.length; i++) all.push(data[i]);
    if (data.length < PAGE_SIZE) break;
  }
  return all;
}

// ─── Inventory ───────────────────────────────────────────────────────────────

interface SupabaseInventoryRow {
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
}

export async function fetchInventoryFromSupabase(
  clientNameMap: ClientNameMap,
  clientSheetId?: string | string[]
): Promise<InventoryResponse | null> {
  try {
    // v38.65.0 — paginate instead of a single `.range(0, 49999)`. The previous
    // approach hit the Supabase project `max_rows` cap (1000) which silently
    // truncated the result, causing "Select All → only N-S clients showing"
    // because the first 1000 rows (by tenant_id hash order) covered only a
    // subset of tenants. Inventory currently has ~4.8k rows across 47 tenants;
    // pagination iterates in 1000-row chunks until the server returns <1000.
    const data = await paginateAll<SupabaseInventoryRow>(() => {
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
    if (!data) return null;

    const items: ApiInventoryItem[] = data.map(row => ({
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
      needsInspection: false,
      needsAssembly: false,
      carrier: row.carrier || '',
      trackingNumber: row.tracking_number || '',
      shipmentNumber: row.shipment_number || '',
      receiveDate: row.receive_date || '',
      releaseDate: row.release_date || '',
      status: row.status || 'Active',
      invoiceUrl: '',
      shipmentFolderUrl: undefined,
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
  repair_folder_url: string | null;
  shipment_folder_url: string | null;
  task_folder_url: string | null;
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
      sourceTaskId: '',
      itemId: row.item_id || '',
      description: '',
      itemClass: '',
      vendor: '',
      location: '',
      sidemark: '',
      taskNotes: row.task_notes || '',
      createdBy: '',
      createdDate: row.created_date || '',
      quoteAmount: row.quote_amount,
      quoteSentDate: '',
      status: row.status || '',
      approved: false,
      scheduledDate: '',
      startDate: '',
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
    }));

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
      createdBy: '',
      pickupParty: row.pickup_party || '',
      pickupPhone: '',
      requestedBy: '',
      estimatedPickupDate: row.estimated_pickup_date || '',
      actualPickupDate: '',
      notes: row.notes || '',
      cod: row.cod ?? false,
      codAmount: row.cod_amount != null ? Number(row.cod_amount) : null,
      itemsCount: row.item_count ?? 0,
      totalWcFee: null,
      items: [], // WC items loaded lazily via detail panel
      wcFolderUrl: row.wc_folder_url || '',
      shipmentFolderUrl: row.shipment_folder_url || '',
    }));

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
      photosUrl: '',
      notes: row.notes || '',
      invoiceUrl: '',
      folderUrl: row.folder_url || '',
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
    };
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
}

export async function fetchBillingFromSupabase(
  clientNameMap: ClientNameMap,
  clientSheetId?: string
): Promise<BillingResponse | null> {
  try {
    let query = supabase.from('billing').select('*');
    if (clientSheetId) {
      query = query.eq('tenant_id', clientSheetId);
    }
    query = query.range(0, 49999); // override 1000-row cap
    const { data, error } = await query;
    if (error || !data) return null;

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
      };
    });

    return {
      rows,
      count: rows.length,
      clientsQueried: clientSheetId ? 1 : Object.keys(clientNameMap).length,
      summary,
    };
  } catch {
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

    let query = supabase.from('billing').select('*');

    if (filters.clientFilter?.length) {
      const tenantIds = filters.clientFilter.map(n => nameToId[n]).filter(Boolean);
      if (tenantIds.length === 0) {
        console.warn('[supabaseQueries] clientFilter provided but no tenant_ids resolved — falling back to GAS');
        return null;
      }
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
    if (filters.endDate) {
      query = query.lte('date', filters.endDate);
    }

    query = query.range(0, 49999); // override 1000-row cap
    const { data, error } = await query;
    if (error || !data) return null;

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
      };
    });

    return {
      rows,
      count: rows.length,
      clientsQueried: filters.clientFilter?.length ?? Object.keys(clientNameMap).length,
      summary,
    };
  } catch {
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
    taskFolderUrl: row.task_folder_url || '',
    shipmentFolderUrl: row.shipment_folder_url || '',
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
  clientNameMap?: ClientNameMap
): Promise<ApiTask | null> {
  try {
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('task_id', taskId)
      .maybeSingle();
    if (error || !data) return null;
    return mapSupabaseTaskRow(data as SupabaseTaskRow, clientNameMap);
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
    return {
      wcNumber: row.wc_number,
      clientName: clientNameMap ? (clientNameMap[row.tenant_id] || '') : '',
      clientSheetId: row.tenant_id,
      status: row.status || 'Pending',
      createdDate: row.created_date || '',
      createdBy: '',
      pickupParty: row.pickup_party || '',
      pickupPhone: '',
      requestedBy: '',
      estimatedPickupDate: row.estimated_pickup_date || '',
      actualPickupDate: '',
      notes: row.notes || '',
      cod: row.cod ?? false,
      codAmount: row.cod_amount != null ? Number(row.cod_amount) : null,
      itemsCount: row.item_count ?? 0,
      totalWcFee: null,
      items: [], // WC items not stored in Supabase — GAS fallback needed for full data
      wcFolderUrl: row.wc_folder_url || '',
      shipmentFolderUrl: row.shipment_folder_url || '',
    };
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
    return {
      repairId: row.repair_id,
      clientName: clientNameMap ? (clientNameMap[row.tenant_id] || '') : '',
      clientSheetId: row.tenant_id,
      sourceTaskId: '',
      itemId: row.item_id || '',
      description: '',
      itemClass: '',
      vendor: '',
      location: '',
      sidemark: '',
      taskNotes: row.task_notes || '',
      createdBy: '',
      createdDate: row.created_date || '',
      quoteAmount: row.quote_amount,
      quoteSentDate: '',
      status: row.status || '',
      approved: false,
      scheduledDate: '',
      startDate: '',
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
    };
  } catch {
    return null;
  }
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
      createdBy: '',
      createdDate: row.created_date || '',
      quoteAmount: row.quote_amount,
      quoteSentDate: '',
      status: row.status || '',
      approved: false,
      scheduledDate: '',
      startDate: '',
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
      dueDate: '',
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
      vendor: row.repair_vendor || '',
      status: row.status || '',
      createdDate: row.created_date || '',
      quoteAmount: row.quote_amount,
      description: '',
      sidemark: '',
      location: '',
      repairFolderUrl: row.repair_folder_url || '',
      shipmentFolderUrl: row.shipment_folder_url || '',
    }));

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
  latest_note_preview: string | null;
  linked_order_id: string | null;
  source: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
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
  windowStartLocal: string;
  windowEndLocal: string;
  timezone: string;
  poNumber: string;
  sidemark: string;
  clientReference: string;
  details: string;
  latestNotePreview: string;
  source: string;
  lastSyncedAt: string;
  clientName: string;
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
    const statuses = await fetchDtStatusesFromSupabase();
    const statusMap = new Map(statuses.map(s => [s.id, s]));
    let query = supabase
      .from('dt_orders')
      .select('*')
      .order('local_service_date', { ascending: false });
    if (clientSheetId) {
      query = query.eq('tenant_id', clientSheetId);
    }
    const { data, error } = await query;
    if (error || !data) return null;
    return (data as SupabaseDtOrderRow[]).map(row => {
      const status = row.status_id != null ? statusMap.get(row.status_id) : undefined;
      return {
        id: row.id,
        tenantId: row.tenant_id,
        dtIdentifier: row.dt_identifier,
        dtDispatchId: row.dt_dispatch_id,
        isPickup: row.is_pickup ?? false,
        statusId: row.status_id,
        statusCode: status?.code ?? '',
        statusName: status?.name ?? '—',
        statusColor: status?.color ?? '#94a3b8',
        statusCategory: status?.category ?? 'open',
        contactName: row.contact_name ?? '',
        contactAddress: row.contact_address ?? '',
        contactCity: row.contact_city ?? '',
        contactState: row.contact_state ?? '',
        contactZip: row.contact_zip ?? '',
        contactPhone: row.contact_phone ?? '',
        contactEmail: row.contact_email ?? '',
        localServiceDate: row.local_service_date ?? '',
        windowStartLocal: row.window_start_local ?? '',
        windowEndLocal: row.window_end_local ?? '',
        timezone: row.timezone,
        poNumber: row.po_number ?? '',
        sidemark: row.sidemark ?? '',
        clientReference: row.client_reference ?? '',
        details: row.details ?? '',
        latestNotePreview: row.latest_note_preview ?? '',
        source: row.source ?? '',
        lastSyncedAt: row.last_synced_at ?? '',
        clientName: (row.tenant_id ? clientNameMap[row.tenant_id] : null) ?? '',
      };
    });
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
  stax_customer_id: string | null;
  parent_client: string | null;
  notes: string | null;
  shipment_note: string | null;
  active: boolean | null;
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
      staxCustomerId: row.stax_customer_id ?? '',
      parentClient: row.parent_client ?? '',
      notes: row.notes ?? '',
      shipmentNote: row.shipment_note ?? '',
      active: row.active ?? true,
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
    if (error || !data) return null;
    const invoices = (data as SupabaseStaxInvoiceRow[]).map(r => ({
      rowIndex: r.row_index ?? 0,
      qbInvoice: r.qb_invoice_no,
      customer: r.customer ?? '',
      staxCustomerId: r.stax_customer_id ?? '',
      invoiceDate: r.invoice_date ?? '',
      dueDate: r.due_date ?? '',
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
    if (error || !data) return null;
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
    if (error || !data) return null;
    const exceptions = (data as SupabaseStaxExceptionRow[]).map(r => ({
      timestamp: r.timestamp ?? '',
      qbInvoice: r.qb_invoice_no ?? '',
      customer: r.customer ?? '',
      staxCustomerId: r.stax_customer_id ?? '',
      amount: r.amount ?? 0,
      dueDate: r.due_date ?? '',
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
    if (error || !data) return null;
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

interface SupabaseStaxRunLogRow {
  timestamp: string | null;
  fn: string | null;
  summary: string | null;
  details: string | null;
}

export async function fetchStaxRunLogFromSupabase(): Promise<StaxRunLogResponse | null> {
  try {
    const { data, error } = await supabase
      .from('stax_run_log')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(500);
    if (error || !data) return null;
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

