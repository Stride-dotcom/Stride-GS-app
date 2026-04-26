/**
 * useServiceCatalog — Supabase CRUD for the unified service catalog.
 *
 * Phase 1 (session 72): powers the /price-list admin page. Reads all
 * services, subscribes to Realtime changes so multiple admins see each
 * other's edits instantly, and writes with automatic audit-log inserts
 * (one audit row per changed field).
 *
 * Phase 2+ will extend this hook to feed the Quote Tool catalog tab,
 * Receiving add-on toggles, Task-type dropdowns, and Delivery service
 * pickers — all from this single source of truth.
 *
 * v2 2026-04-25 PST — adds delivery-only fields (delivery_rate_unit,
 *                     visible_to_client, description, quote_required)
 *                     so a row flagged show_as_delivery_service can be
 *                     fully configured from the Price List page.
 *                     Migration: 20260425030000_service_catalog_delivery_fields.
 *
 * v3 2026-04-25 PST — exposes syncService(id) so the Price List can run
 *                     a manual Stax + QBO sync per row (or in bulk for
 *                     unsynced rows). syncToExternalCatalogs now returns
 *                     a structured ExternalSyncResult instead of void so
 *                     callers can render per-leg success / failure
 *                     indicators.
 *
 * v4 2026-04-25 PST — QBO leg timeout. The qboSyncCatalogItem GAS handler
 *                     occasionally hangs past the default 90s apiPost
 *                     watchdog, which made the whole sync UI sit in
 *                     "Syncing…" forever and then flash "Sync failed" even
 *                     when Stax succeeded. postQboSyncCatalogItem now
 *                     forces an 8s timeout, so a wedged QBO leg surfaces
 *                     as "QBO: <timeout msg>" while staxOk still flips.
 *
 * v5 2026-04-25 PST — auto-sync to MPL Price_List sheet on every create /
 *                     update. Replaces the manual "Sync to Sheet" button
 *                     on PriceList. Pure fire-and-forget — failures land
 *                     in console.warn only (sheet is a fallback cache for
 *                     the Supabase-primary billing path; admin can run
 *                     the full handleSyncPriceListFromSupabase_ from the
 *                     Parity Monitor to recover). Skips the round trip
 *                     when no sheet-mirrored field changed.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { entityEvents } from '../lib/entityEvents';
import { useAuth } from '../contexts/AuthContext';
import { postQboSyncCatalogItem, syncSingleServiceToSheet } from '../lib/api';

// ─── Types ────────────────────────────────────────────────────────────────

export type ServiceCategory =
  | 'Warehouse' | 'Storage' | 'Shipping' | 'Assembly'
  | 'Repair' | 'Labor' | 'Admin' | 'Delivery'
  | 'Fabric Protection';
export type ServiceBilling = 'class_based' | 'flat';
export type ServiceUnit    = 'per_item' | 'per_day' | 'per_task' | 'per_hour';
export type AutoApplyRule  = 'overweight' | 'no_id' | 'fragile' | 'oversized';
export type ServicePriority = 'Normal' | 'High';
/**
 * How a service's flat_rate is interpreted when it is offered as a delivery
 * add-on. Mirrors the CHECK constraint on service_catalog.delivery_rate_unit.
 */
export type DeliveryRateUnit =
  | 'flat'       // one-time charge regardless of quantity / distance
  | 'per_mile'   // multiplied by trip miles
  | 'per_15min'  // multiplied by 15-minute service blocks
  | 'plus_base'  // base + per-item add (handled in CreateDeliveryOrderModal)
  | 'per_item';  // multiplied by item count

export interface ClassRates {
  XS?: number; S?: number; M?: number; L?: number; XL?: number; XXL?: number;
}

export interface ClassTimes {
  XS?: number; S?: number; M?: number; L?: number; XL?: number; XXL?: number;
}

export interface CatalogService {
  id: string;
  code: string;
  name: string;
  category: ServiceCategory;
  billing: ServiceBilling;
  rates: ClassRates;
  xxlRate: number;              // mirrored into rates.XXL; kept for DB parity
  flatRate: number;
  unit: ServiceUnit;
  taxable: boolean;
  active: boolean;
  showInMatrix: boolean;
  showAsTask: boolean;
  showAsDeliveryService: boolean;
  showAsReceivingAddon: boolean;
  autoApplyRule: AutoApplyRule | null;
  defaultSlaHours: number | null;
  defaultPriority: ServicePriority | null;
  hasDedicatedPage: boolean;
  displayOrder: number;
  // Session 73 — MPL-sourced schema additions
  billIfPass: boolean;
  billIfFail: boolean;
  times: ClassTimes;            // minutes per unit by class
  // External catalog IDs (hidden in UI, auto-synced)
  staxItemId: string | null;
  qbItemId: string | null;
  // Delivery-only configuration (active when showAsDeliveryService is true)
  deliveryRateUnit: DeliveryRateUnit;
  visibleToClient: boolean;
  description: string;
  quoteRequired: boolean;
  /** For "first N included" overage services like XTRA_PC. null = N/A. */
  includedQuantity: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogAuditEntry {
  id: string;
  serviceId: string;
  fieldChanged: string;
  oldValue: string | null;
  newValue: string | null;
  changedBy: string | null;
  changedByName: string | null;
  changedAt: string;
}

export type NewServiceInput = Omit<CatalogService, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdateServiceInput = Partial<Omit<CatalogService, 'id' | 'createdAt' | 'updatedAt'>>;

// ─── Row mapping (snake_case → camelCase) ─────────────────────────────────

interface CatalogRow {
  id: string;
  code: string;
  name: string;
  category: string;
  billing: string;
  rates: Record<string, number> | null;
  flat_rate: number | string | null;
  unit: string;
  taxable: boolean;
  active: boolean;
  show_in_matrix: boolean;
  show_as_task: boolean;
  show_as_delivery_service: boolean;
  show_as_receiving_addon: boolean;
  auto_apply_rule: string | null;
  default_sla_hours: number | null;
  default_priority: string | null;
  has_dedicated_page: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
  // Session 73 additions
  xxl_rate: number | string | null;
  bill_if_pass: boolean | null;
  bill_if_fail: boolean | null;
  xs_time: number | null;
  s_time: number | null;
  m_time: number | null;
  l_time: number | null;
  xl_time: number | null;
  xxl_time: number | null;
  // External catalog IDs
  stax_item_id: string | null;
  qb_item_id: string | null;
  // Delivery-only configuration
  delivery_rate_unit: string | null;
  visible_to_client: boolean | null;
  description: string | null;
  quote_required: boolean | null;
  // Per-piece overage charges (e.g. XTRA_PC) — pieces included in some
  // base fee before this charge applies. NULL = not applicable.
  included_quantity: number | null;
}

function rowToService(row: CatalogRow): CatalogService {
  const xxlRate = Number(row.xxl_rate ?? 0);
  const rawRates = (row.rates ?? {}) as Record<string, number>;
  // Always mirror xxl_rate into rates.XXL so calcQuote can index by class id.
  const mergedRates: ClassRates = {
    XS:  rawRates.XS  ?? 0,
    S:   rawRates.S   ?? 0,
    M:   rawRates.M   ?? 0,
    L:   rawRates.L   ?? 0,
    XL:  rawRates.XL  ?? 0,
    XXL: (rawRates.XXL ?? xxlRate) || 0,
  };
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    category: row.category as ServiceCategory,
    billing: row.billing as ServiceBilling,
    rates: mergedRates,
    xxlRate,
    flatRate: Number(row.flat_rate ?? 0),
    unit: row.unit as ServiceUnit,
    taxable: row.taxable,
    active: row.active,
    showInMatrix: row.show_in_matrix,
    showAsTask: row.show_as_task,
    showAsDeliveryService: row.show_as_delivery_service,
    showAsReceivingAddon: row.show_as_receiving_addon,
    autoApplyRule: (row.auto_apply_rule as AutoApplyRule | null) ?? null,
    defaultSlaHours: row.default_sla_hours,
    defaultPriority: (row.default_priority as ServicePriority | null) ?? null,
    hasDedicatedPage: row.has_dedicated_page,
    displayOrder: row.display_order,
    billIfPass: row.bill_if_pass ?? true,
    billIfFail: row.bill_if_fail ?? true,
    staxItemId: row.stax_item_id ?? null,
    qbItemId: row.qb_item_id ?? null,
    deliveryRateUnit: ((row.delivery_rate_unit as DeliveryRateUnit | null) ?? 'flat'),
    visibleToClient: row.visible_to_client !== false,
    description: row.description ?? '',
    quoteRequired: row.quote_required === true,
    includedQuantity: row.included_quantity ?? null,
    times: {
      XS:  row.xs_time  ?? undefined,
      S:   row.s_time   ?? undefined,
      M:   row.m_time   ?? undefined,
      L:   row.l_time   ?? undefined,
      XL:  row.xl_time  ?? undefined,
      XXL: row.xxl_time ?? undefined,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serviceToRow(input: UpdateServiceInput): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (input.code !== undefined)                  row.code = input.code;
  if (input.name !== undefined)                  row.name = input.name;
  if (input.category !== undefined)              row.category = input.category;
  if (input.billing !== undefined)               row.billing = input.billing;
  if (input.rates !== undefined)                 row.rates = input.rates;
  if (input.xxlRate !== undefined)               row.xxl_rate = input.xxlRate;
  if (input.flatRate !== undefined)              row.flat_rate = input.flatRate;
  if (input.unit !== undefined)                  row.unit = input.unit;
  if (input.taxable !== undefined)               row.taxable = input.taxable;
  if (input.active !== undefined)                row.active = input.active;
  if (input.showInMatrix !== undefined)          row.show_in_matrix = input.showInMatrix;
  if (input.showAsTask !== undefined)            row.show_as_task = input.showAsTask;
  if (input.showAsDeliveryService !== undefined) row.show_as_delivery_service = input.showAsDeliveryService;
  if (input.showAsReceivingAddon !== undefined)  row.show_as_receiving_addon = input.showAsReceivingAddon;
  if (input.autoApplyRule !== undefined)         row.auto_apply_rule = input.autoApplyRule;
  if (input.defaultSlaHours !== undefined)       row.default_sla_hours = input.defaultSlaHours;
  if (input.defaultPriority !== undefined)       row.default_priority = input.defaultPriority;
  if (input.hasDedicatedPage !== undefined)      row.has_dedicated_page = input.hasDedicatedPage;
  if (input.displayOrder !== undefined)          row.display_order = input.displayOrder;
  if (input.includedQuantity !== undefined)      row.included_quantity = input.includedQuantity;
  if (input.billIfPass !== undefined)            row.bill_if_pass = input.billIfPass;
  if (input.billIfFail !== undefined)            row.bill_if_fail = input.billIfFail;
  if (input.times !== undefined) {
    row.xs_time  = input.times.XS  ?? null;
    row.s_time   = input.times.S   ?? null;
    row.m_time   = input.times.M   ?? null;
    row.l_time   = input.times.L   ?? null;
    row.xl_time  = input.times.XL  ?? null;
    row.xxl_time = input.times.XXL ?? null;
  }
  if (input.deliveryRateUnit !== undefined) row.delivery_rate_unit = input.deliveryRateUnit;
  if (input.visibleToClient !== undefined)  row.visible_to_client  = input.visibleToClient;
  if (input.description !== undefined)      row.description        = input.description;
  if (input.quoteRequired !== undefined)    row.quote_required     = input.quoteRequired;
  return row;
}

// Fields tracked by audit (rates + times are diffed specially below).
const AUDITABLE_SIMPLE_FIELDS: readonly (keyof CatalogService)[] = [
  'code', 'name', 'category', 'billing', 'flatRate', 'xxlRate', 'unit',
  'taxable', 'active', 'showInMatrix', 'showAsTask',
  'showAsDeliveryService', 'showAsReceivingAddon',
  'autoApplyRule', 'defaultSlaHours', 'defaultPriority',
  'hasDedicatedPage', 'displayOrder',
  'billIfPass', 'billIfFail',
  'deliveryRateUnit', 'visibleToClient', 'description', 'quoteRequired',
] as const;

function stringify(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

// Fields that materially affect a Stax / QBO catalog item. UI-only
// toggles (showInMatrix, displayOrder, showAsTask, …) are deliberately
// excluded so a tab reorder or matrix-visibility flip doesn't trigger
// two external API calls.
const EXTERNAL_SYNC_FIELDS: readonly (keyof CatalogService)[] = [
  'code', 'name', 'flatRate', 'rates', 'taxable', 'active', 'billing',
] as const;

function didExternalRelevantFieldsChange(
  before: CatalogService,
  after: CatalogService,
): boolean {
  return EXTERNAL_SYNC_FIELDS.some(f => {
    const a = before[f];
    const b = after[f];
    if (typeof a === 'object' || typeof b === 'object') {
      return JSON.stringify(a) !== JSON.stringify(b);
    }
    return a !== b;
  });
}

// v38.128.0 — fields mirrored into the MPL Price_List sheet by the
// syncSingleServiceToSheet GAS handler. UI-only fields and delivery-only
// extensions are excluded so a tab reorder or delivery toggle doesn't
// trigger a sheet round trip.
//
// `description` is intentionally omitted: the Price_List sheet has no
// Description column today and handleSyncSingleServiceToSheet_ does not
// setByHeader for it. Keep this list aligned with the GAS handler's
// setByHeader call list when the sheet schema grows.
const SHEET_SYNC_FIELDS: readonly (keyof CatalogService)[] = [
  'code', 'name', 'category', 'active', 'billIfPass', 'billIfFail',
  'showAsTask', 'taxable', 'unit', 'billing', 'flatRate', 'displayOrder',
  'rates', 'xxlRate', 'times',
] as const;

function didSheetRelevantFieldsChange(
  before: CatalogService,
  after: CatalogService,
): boolean {
  return SHEET_SYNC_FIELDS.some(f => {
    const a = before[f];
    const b = after[f];
    if (typeof a === 'object' || typeof b === 'object') {
      return JSON.stringify(a) !== JSON.stringify(b);
    }
    return a !== b;
  });
}

/**
 * v38.128.0 — fire-and-forget per-row push to the MPL Price_List sheet so
 * the sheet stays in sync as a fallback cache after every Supabase write.
 *
 * Deliberately NOT plumbed into syncError state: failures here are pure
 * background telemetry. The sheet is a fallback for the Supabase-primary
 * billing path, so a stale sheet row is recoverable (admin can run the
 * full handleSyncPriceListFromSupabase_ from the Parity Monitor) and is
 * not user-visible. Surfacing every transient GAS hiccup as a banner
 * would only cause noise — console.warn is the right channel.
 *
 * No abort signal: the request intentionally outlives unmount so a save
 * triggered just before the user navigates away still mirrors to the
 * sheet. The 8s apiPost timeout prevents the request from leaking forever.
 */
function pushRowToSheet(code: string): void {
  if (!code) return;
  void syncSingleServiceToSheet(code).then(
    (result) => {
      if (!result.ok) {
        console.warn(`[catalog-sheet-sync] ${code}: ${result.error ?? 'unknown error'}`);
      }
    },
    (err) => {
      console.warn(`[catalog-sheet-sync] ${code}:`, err);
    },
  );
}

// ─── External catalog sync (best-effort, non-blocking) ───────────────────

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

export interface ExternalSyncResult {
  staxOk: boolean;
  qbOk: boolean;
  /** Non-fatal failure messages (one per failed leg). Empty when both legs succeeded. */
  errors: string[];
}

async function syncToExternalCatalogs(service: CatalogService): Promise<ExternalSyncResult> {
  const errors: string[] = [];
  let staxOk = false;
  let qbOk = false;

  // ── Stax (Edge Function) ──
  try {
    const accessToken = (await supabase.auth.getSession()).data.session?.access_token;
    if (!accessToken) {
      // Session expired — skip the sync rather than send an empty Bearer
      // token (which the Edge Function rejects as 401 and pollutes logs).
      // Realtime / next admin action will retrigger sync once auth recovers.
      console.warn('[catalog-sync] Stax sync skipped: no active Supabase session');
      errors.push('Stax: session expired');
    } else {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/stax-catalog-sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ serviceId: service.id }),
      });
      const result = await resp.json();
      if (result.ok) {
        console.log(`[catalog-sync] Stax ${result.action}: ${service.code} → ${result.stax_item_id}`);
        staxOk = true;
      } else {
        console.warn('[catalog-sync] Stax sync failed:', result.error);
        errors.push(`Stax: ${result.error ?? 'unknown error'}`);
      }
    }
  } catch (err) {
    console.warn('[catalog-sync] Stax sync error (non-fatal):', err);
    errors.push(`Stax: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── QBO (Apps Script) ──
  try {
    const result = await postQboSyncCatalogItem(
      service.id,
      service.code,
      service.name,
      service.qbItemId,
    );
    if (result.ok) {
      console.log(`[catalog-sync] QBO ${result.data?.action}: ${service.code} → ${result.data?.qb_item_id}`);
      qbOk = true;
    } else {
      errors.push(`QBO: ${result.error ?? 'unknown error'}`);
    }
  } catch (err) {
    console.warn('[catalog-sync] QBO sync error (non-fatal):', err);
    errors.push(`QBO: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { staxOk, qbOk, errors };
}

// ─── Hook ─────────────────────────────────────────────────────────────────

export interface UseServiceCatalogResult {
  services: CatalogService[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  createService: (input: NewServiceInput) => Promise<CatalogService | null>;
  updateService: (id: string, updates: UpdateServiceInput) => Promise<CatalogService | null>;
  deleteService: (id: string) => Promise<boolean>;
  getAuditForService: (serviceId: string) => Promise<CatalogAuditEntry[]>;
  /**
   * Manually push one row to Stax + QBO. Surfaces a structured result so
   * callers can show success / failure indicators per leg.
   * Refetches the catalog on completion so the new stax_item_id /
   * qb_item_id show up in read-mode badges without an extra round-trip.
   */
  syncService: (id: string) => Promise<ExternalSyncResult | null>;
  /**
   * Background-sync failure message from the most recent create/update.
   * Null when the last sync succeeded or no sync has run yet. The auto-sync
   * after create/update is fire-and-forget, so failures used to silently
   * hit only console; this lets the page render a visible warning banner.
   */
  syncError: string | null;
  clearSyncError: () => void;
}

export function useServiceCatalog(): UseServiceCatalogResult {
  const { user } = useAuth();
  const [services, setServices] = useState<CatalogService[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const clearSyncError = useCallback(() => setSyncError(null), []);

  // Helper: run the fire-and-forget sync but capture any failure message in
  // syncError so the UI can surface it. Manual syncService bypasses this and
  // returns the structured result directly.
  const runBackgroundSync = useCallback(async (svc: CatalogService) => {
    try {
      const result = await syncToExternalCatalogs(svc);
      if (result.errors.length > 0) {
        setSyncError(`Catalog sync failed for ${svc.code} — ${result.errors.join(' · ')}`);
      } else {
        setSyncError(null);
      }
    } catch (err) {
      setSyncError(`Catalog sync failed for ${svc.code} — ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  const refetch = useCallback(async () => {
    setError(null);
    const { data, error: err } = await supabase
      .from('service_catalog')
      .select('*')
      .order('display_order', { ascending: true });
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    setServices(((data ?? []) as CatalogRow[]).map(rowToService));
    setLoading(false);
  }, []);

  // Initial load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!cancelled) await refetch();
    })();
    return () => { cancelled = true; };
  }, [refetch]);

  // Session 74: Realtime refetch via the shared central channel.
  // Previously this hook opened its own `service_catalog_live` channel;
  // now useSupabaseRealtime listens for service_catalog rows and emits
  // the 'service_catalog' entity event. One fewer WebSocket per session.
  useEffect(() => {
    return entityEvents.subscribe((type) => {
      if (type === 'service_catalog') void refetch();
    });
  }, [refetch]);

  // ── Create ─────────────────────────────────────────────────────────────
  const createService = useCallback(async (input: NewServiceInput): Promise<CatalogService | null> => {
    const row = serviceToRow(input);
    const { data, error: err } = await supabase
      .from('service_catalog')
      .insert(row)
      .select('*')
      .single();
    if (err || !data) {
      setError(err?.message ?? 'Failed to create service');
      return null;
    }
    const created = rowToService(data as CatalogRow);
    setServices(prev => [...prev, created].sort((a, b) => a.displayOrder - b.displayOrder));
    // Best-effort sync to Stax + QBO (non-blocking, surfaces failures via syncError)
    void runBackgroundSync(created);
    // v38.128.0 — also push to the MPL Price_List sheet so the fallback
    // cache covers the new row. Pure fire-and-forget (no syncError surface).
    pushRowToSheet(created.code);
    return created;
  }, [runBackgroundSync]);

  // ── Update (with audit) ────────────────────────────────────────────────
  const updateService = useCallback(async (id: string, updates: UpdateServiceInput): Promise<CatalogService | null> => {
    const before = services.find(s => s.id === id);
    if (!before) {
      setError('Service not found in local cache');
      return null;
    }

    // 1. Apply update
    const row = serviceToRow(updates);
    const { data, error: err } = await supabase
      .from('service_catalog')
      .update(row)
      .eq('id', id)
      .select('*')
      .single();
    if (err || !data) {
      setError(err?.message ?? 'Failed to update service');
      return null;
    }
    const after = rowToService(data as CatalogRow);

    // 2. Diff and write audit rows. Best-effort — audit failure must not
    //    roll back the update (RLS allows any authenticated insert).
    try {
      const sessionResp = await supabase.auth.getSession();
      const authUserId = sessionResp.data.session?.user.id ?? null;
      const changedByName = user?.displayName ?? user?.email ?? null;
      const auditRows: Record<string, unknown>[] = [];

      for (const field of AUDITABLE_SIMPLE_FIELDS) {
        const oldV = before[field];
        const newV = after[field];
        if (stringify(oldV) !== stringify(newV)) {
          auditRows.push({
            service_id: id,
            field_changed: field as string,
            old_value: stringify(oldV),
            new_value: stringify(newV),
            changed_by: authUserId,
            changed_by_name: changedByName,
          });
        }
      }
      // Diff rates as a whole (one audit row if the object changed)
      if (JSON.stringify(before.rates) !== JSON.stringify(after.rates)) {
        auditRows.push({
          service_id: id,
          field_changed: 'rates',
          old_value: JSON.stringify(before.rates),
          new_value: JSON.stringify(after.rates),
          changed_by: authUserId,
          changed_by_name: changedByName,
        });
      }
      // Diff times as a whole
      if (JSON.stringify(before.times) !== JSON.stringify(after.times)) {
        auditRows.push({
          service_id: id,
          field_changed: 'times',
          old_value: JSON.stringify(before.times),
          new_value: JSON.stringify(after.times),
          changed_by: authUserId,
          changed_by_name: changedByName,
        });
      }

      if (auditRows.length > 0) {
        const { error: auditInsertErr } = await supabase
          .from('service_catalog_audit')
          .insert(auditRows);
        if (auditInsertErr) {
          // Surface the underlying message so RLS / constraint failures
          // don't slip through silently. Audit failure is still
          // non-fatal — we don't roll back the service update.
          console.warn(
            '[service_catalog_audit] insert rejected:',
            auditInsertErr.message,
            auditInsertErr,
          );
        }
      }
    } catch (auditErr) {
      console.warn('[service_catalog_audit] insert failed (non-fatal):', auditErr);
    }

    setServices(prev => prev.map(s => s.id === id ? after : s).sort((a, b) => a.displayOrder - b.displayOrder));
    // Best-effort sync to Stax + QBO (non-blocking). Skip when only UI-only
    // fields (showInMatrix, displayOrder, etc.) changed — Stax/QBO neither
    // know nor care, and avoiding the round trip saves two network calls
    // per save.
    if (didExternalRelevantFieldsChange(before, after)) {
      void runBackgroundSync(after);
    }
    // v38.128.0 — fire-and-forget push to the MPL Price_List sheet.
    // Skip when no sheet-mirrored field changed (e.g., only delivery-only
    // toggles flipped) so we don't wake a GAS handler for nothing.
    if (didSheetRelevantFieldsChange(before, after)) {
      pushRowToSheet(after.code);
    }
    return after;
  }, [services, user, runBackgroundSync]);

  // ── Delete ─────────────────────────────────────────────────────────────
  const deleteService = useCallback(async (id: string): Promise<boolean> => {
    const { error: err } = await supabase
      .from('service_catalog')
      .delete()
      .eq('id', id);
    if (err) {
      setError(err.message);
      return false;
    }
    setServices(prev => prev.filter(s => s.id !== id));
    return true;
  }, []);

  // ── Manual sync to Stax + QBO ──────────────────────────────────────────
  const syncService = useCallback(async (id: string): Promise<ExternalSyncResult | null> => {
    const target = services.find(s => s.id === id);
    if (!target) {
      setError('Service not found in local cache');
      return null;
    }
    const result = await syncToExternalCatalogs(target);
    // Even when only one leg succeeded the row's stax_item_id / qb_item_id
    // may have been set, so refetch unconditionally to refresh the badges.
    await refetch();
    return result;
  }, [services, refetch]);

  // ── Fetch audit for one service ────────────────────────────────────────
  const getAuditForService = useCallback(async (serviceId: string): Promise<CatalogAuditEntry[]> => {
    const { data, error: err } = await supabase
      .from('service_catalog_audit')
      .select('*')
      .eq('service_id', serviceId)
      .order('changed_at', { ascending: false })
      .limit(100);
    if (err || !data) return [];
    return (data as Array<{
      id: string; service_id: string; field_changed: string;
      old_value: string | null; new_value: string | null;
      changed_by: string | null; changed_by_name: string | null;
      changed_at: string;
    }>).map(r => ({
      id: r.id,
      serviceId: r.service_id,
      fieldChanged: r.field_changed,
      oldValue: r.old_value,
      newValue: r.new_value,
      changedBy: r.changed_by,
      changedByName: r.changed_by_name,
      changedAt: r.changed_at,
    }));
  }, []);

  return useMemo(() => ({
    services,
    loading,
    error,
    refetch,
    createService,
    updateService,
    deleteService,
    getAuditForService,
    syncService,
    syncError,
    clearSyncError,
  }), [services, loading, error, refetch, createService, updateService, deleteService, getAuditForService, syncService, syncError, clearSyncError]);
}
