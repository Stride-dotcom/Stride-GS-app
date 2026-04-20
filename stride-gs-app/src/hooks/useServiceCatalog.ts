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
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { entityEvents } from '../lib/entityEvents';
import { useAuth } from '../contexts/AuthContext';

// ─── Types ────────────────────────────────────────────────────────────────

export type ServiceCategory =
  | 'Warehouse' | 'Storage' | 'Shipping' | 'Assembly'
  | 'Repair' | 'Labor' | 'Admin' | 'Delivery'
  | 'Fabric Protection';
export type ServiceBilling = 'class_based' | 'flat';
export type ServiceUnit    = 'per_item' | 'per_day' | 'per_task' | 'per_hour';
export type AutoApplyRule  = 'overweight' | 'no_id' | 'fragile' | 'oversized';
export type ServicePriority = 'Normal' | 'High';

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
] as const;

function stringify(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
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
}

export function useServiceCatalog(): UseServiceCatalogResult {
  const { user } = useAuth();
  const [services, setServices] = useState<CatalogService[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    return created;
  }, []);

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
        await supabase.from('service_catalog_audit').insert(auditRows);
      }
    } catch (auditErr) {
      console.warn('[service_catalog_audit] insert failed (non-fatal):', auditErr);
    }

    setServices(prev => prev.map(s => s.id === id ? after : s).sort((a, b) => a.displayOrder - b.displayOrder));
    return after;
  }, [services, user]);

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
  }), [services, loading, error, refetch, createService, updateService, deleteService, getAuditForService]);
}
