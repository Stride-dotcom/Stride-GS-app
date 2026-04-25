/**
 * useRepairs — Fetches repairs from the Stride API.
 *
 * Performance: checks BatchDataContext first (client users get all data in 1 call).
 * Falls back to individual API call for staff/admin users or when batch is unavailable.
 *
 * Phase 2C: optimistic patch architecture added.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// ─── Cross-instance optimistic bus ──────────────────────────────────────────
// See useTasks for rationale. The calendar's useRepairs instance needs to
// mirror optimistic creates from the detail panels that request repair
// quotes (TaskDetailPanel calls addOptimisticRepair after the user clicks
// "Request Repair Quote"). Without this bus the calendar lags 1-3s.
type RepairBusEvent =
  | { type: 'add';    repair: import('../lib/types').Repair }
  | { type: 'remove'; repairId: string };
const repairBus = new EventTarget();
function repairBroadcast(evt: RepairBusEvent): void {
  repairBus.dispatchEvent(new CustomEvent<RepairBusEvent>('change', { detail: evt }));
}
import { fetchRepairs, setNextFetchNoCache } from '../lib/api';
import type { ApiRepair, RepairsResponse } from '../lib/api';
import type { Repair, RepairStatus } from '../lib/types';
import { useApiData } from './useApiData';
import { useClientFilter } from './useClientFilter';
import { useBatchData } from '../contexts/BatchDataContext';
import { useClients } from './useClients';
import { entityEvents } from '../lib/entityEvents';
import { fetchRepairsFromSupabase, isSupabaseCacheAvailable } from '../lib/supabaseQueries';
import type { ClientNameMap } from '../lib/supabaseQueries';

export interface UseRepairsResult {
  apiRepairs: ApiRepair[];
  repairs: Repair[];
  count: number;
  clientsQueried: number;
  errors?: { client: string; error: string }[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
  lastFetched: Date | null;
  // Phase 2C — optimistic patch functions
  applyRepairPatch: (repairId: string, patch: Partial<Repair>) => void;
  mergeRepairPatch: (repairId: string, patch: Partial<Repair>) => void;
  clearRepairPatch: (repairId: string) => void;
  addOptimisticRepair: (repair: Repair) => void;
  removeOptimisticRepair: (tempRepairId: string) => void;
}

const VALID_STATUSES: RepairStatus[] = [
  'Pending Quote', 'Quote Sent', 'Approved', 'Declined',
  'In Progress', 'Complete', 'Cancelled'
];
const PATCH_TTL_MS = 120_000;

function mapToAppRepair(api: ApiRepair): Repair {
  const status = VALID_STATUSES.includes(api.status as RepairStatus)
    ? (api.status as RepairStatus)
    : 'Pending Quote';

  return {
    repairId: api.repairId,
    sourceTaskId: api.sourceTaskId || undefined,
    itemId: api.itemId,
    clientId: api.clientSheetId,
    clientSheetId: api.clientSheetId,
    clientName: api.clientName,
    description: api.description,
    status,
    quoteAmount: api.quoteAmount ?? undefined,
    approvedAmount: api.finalAmount ?? undefined,
    // Multi-line repair quote (v38.120.0) — undefined for legacy
    // single-amount quotes. The detail panel renders the new builder
    // when `quoteLines` is set, falls back to the single-input form
    // when undefined.
    quoteLines: Array.isArray(api.quoteLines) ? api.quoteLines : undefined,
    quoteSubtotal:        api.quoteSubtotal ?? undefined,
    quoteTaxableSubtotal: api.quoteTaxableSubtotal ?? undefined,
    quoteTaxAreaId:       api.quoteTaxAreaId ?? undefined,
    quoteTaxAreaName:     api.quoteTaxAreaName ?? undefined,
    quoteTaxRate:         api.quoteTaxRate ?? undefined,
    quoteTaxAmount:       api.quoteTaxAmount ?? undefined,
    quoteGrandTotal:      api.quoteGrandTotal ?? undefined,
    repairVendor: api.repairVendor || undefined,
    assignedTo: api.createdBy || undefined,
    createdDate: api.createdDate,
    quoteSentDate: api.quoteSentDate || undefined,
    approvedDate: api.scheduledDate || undefined,
    completedDate: api.completedDate || undefined,
    notes: api.repairNotes || undefined,
    internalNotes: api.taskNotes || undefined,
    // Session 74: propagate inventory-mirrored context the detail panel
    // needs. `location` was present on ApiRepair but dropped here, so the
    // RepairDetailPanel's `repair.location` branch always read undefined.
    room: api.room || undefined,
    location: api.location || undefined,
    sidemark: api.sidemark || undefined,
    reference: api.reference || undefined,
    repairFolderUrl: api.repairFolderUrl || undefined,
    taskFolderUrl: api.taskFolderUrl || undefined,
    shipmentFolderUrl: api.shipmentFolderUrl || undefined,
  };
}

export function useRepairs(autoFetch = true, filterClientSheetId?: string | string[]): UseRepairsResult {
  const clientFilter = useClientFilter();
  const clientSheetId = clientFilter ?? filterClientSheetId;
  const { batchData, batchEnabled, batchLoading, batchError, silentRefetchBatch } = useBatchData();
  const { clients } = useClients();

  const clientNameMap = useMemo<ClientNameMap>(() => {
    const map: ClientNameMap = {};
    for (const c of clients) { map[c.id] = c.name; }
    return map;
  }, [clients]);

  // Ref keeps fetchFn stable across client-list re-renders
  const clientNameMapRef = useRef(clientNameMap);
  clientNameMapRef.current = clientNameMap;

  const shouldFetchIndividual = !batchEnabled;

  // Stable dep key — prevents infinite refetch when clientSheetId is an array
  // (array reference changes on every page render even when contents are the same)
  const cacheKeyScope = Array.isArray(clientSheetId) ? clientSheetId.slice().sort().join(',') : (clientSheetId || 'all');

  const fetchFn = useCallback(
    async (signal?: AbortSignal) => {
      const skipSb = entityEvents.shouldSkipSupabase('repair');
      if (!skipSb && await isSupabaseCacheAvailable()) {
        const sbResult = await fetchRepairsFromSupabase(clientNameMapRef.current, clientSheetId);
        if (sbResult) return { data: sbResult, ok: true, error: null } as { data: RepairsResponse; ok: true; error: null };
      }
      if (skipSb) setNextFetchNoCache();
      const gasClientId = Array.isArray(clientSheetId)
        ? (clientSheetId.length === 1 ? clientSheetId[0] : undefined)
        : clientSheetId;
      return fetchRepairs(signal, gasClientId);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cacheKeyScope]
  );

  const { data, loading: individualLoading, error: individualError, refetch: individualRefetch, lastFetched: individualLastFetched } = useApiData<RepairsResponse>(
    fetchFn,
    autoFetch && shouldFetchIndividual,
    `repairs:${cacheKeyScope}`
  );

  // ─── Phase 2C: Optimistic patch state ────────────────────────────────────
  const [patches, setPatches] = useState<Record<string, { data: Partial<Repair>; appliedAt: number }>>({});
  const [optimisticCreates, setOptimisticCreates] = useState<Repair[]>([]);

  const applyRepairPatch = useCallback((repairId: string, patch: Partial<Repair>) => {
    setPatches(prev => ({ ...prev, [repairId]: { data: patch, appliedAt: Date.now() } }));
  }, []);

  const mergeRepairPatch = useCallback((repairId: string, patch: Partial<Repair>) => {
    setPatches(prev => ({
      ...prev,
      [repairId]: {
        data: { ...(prev[repairId]?.data ?? {}), ...patch },
        appliedAt: Date.now(),
      },
    }));
  }, []);

  const clearRepairPatch = useCallback((repairId: string) => {
    setPatches(prev => {
      const next = { ...prev };
      delete next[repairId];
      return next;
    });
  }, []);

  const addOptimisticRepair = useCallback((repair: Repair) => {
    setOptimisticCreates(prev => {
      if (prev.some(r => r.repairId === repair.repairId)) return prev;
      return [repair, ...prev];
    });
    repairBroadcast({ type: 'add', repair });
  }, []);

  const removeOptimisticRepair = useCallback((tempRepairId: string) => {
    setOptimisticCreates(prev => prev.filter(r => r.repairId !== tempRepairId));
    repairBroadcast({ type: 'remove', repairId: tempRepairId });
  }, []);

  // Sibling-instance sync: mirror bus events into this instance's state.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<RepairBusEvent>).detail;
      if (!detail) return;
      if (detail.type === 'add') {
        setOptimisticCreates(prev => {
          if (prev.some(r => r.repairId === detail.repair.repairId)) return prev;
          return [detail.repair, ...prev];
        });
      } else {
        setOptimisticCreates(prev => prev.filter(r => r.repairId !== detail.repairId));
      }
    };
    repairBus.addEventListener('change', handler);
    return () => repairBus.removeEventListener('change', handler);
  }, []);
  // ─────────────────────────────────────────────────────────────────────────

  // Phase 2: subscribe to entityEvents for confirmed repair writes (non-batch path only)
  useEffect(() => {
    if (batchEnabled) return;
    return entityEvents.subscribe((type) => {
      if (type === 'repair') individualRefetch();
    });
  }, [batchEnabled, individualRefetch]);

  // Map batch data to ApiRepair shape (lightweight)
  const apiRepairs = useMemo(() => {
    if (batchEnabled && batchData) {
      return batchData.repairs.map(b => ({
        repairId: b.repairId,
        clientName: (b as any).clientName || '',
        clientSheetId: b.clientSheetId,
        sourceTaskId: b.sourceTaskId || '',
        itemId: b.itemId,
        description: b.description,
        // v38.60.1 — batch now includes the full ApiRepair field set
        itemClass: b.itemClass || '',
        vendor: b.vendor,
        location: b.location || '',
        sidemark: b.sidemark || '',
        taskNotes: b.taskNotes || '',
        createdBy: b.createdBy || '',
        createdDate: b.createdDate,
        quoteAmount: b.quoteAmount,
        quoteSentDate: b.quoteSentDate || '',
        status: b.status,
        approved: b.approved ?? false,
        scheduledDate: b.scheduledDate || '',
        startDate: b.startDate || '',
        repairVendor: b.repairVendor,
        partsCost: b.partsCost ?? null,
        laborHours: b.laborHours ?? null,
        repairResult: b.repairResult || '',
        finalAmount: b.finalAmount ?? null,
        invoiceId: b.invoiceId || '',
        itemNotes: b.itemNotes || '',
        repairNotes: b.repairNotes || '',
        completedDate: b.completedDate,
        billed: b.billed,
        repairFolderUrl: b.repairFolderUrl || undefined,
        shipmentFolderUrl: b.shipmentFolderUrl || undefined,
        taskFolderUrl: b.taskFolderUrl || undefined,
      } as ApiRepair));
    }
    // Individual path: resolve "(single)" clientName using the clients list
    const repairs = data?.repairs ?? [];
    if (clientSheetId && repairs.length > 0 && repairs[0].clientName === '(single)') {
      const resolved = clients.find(c => c.id === clientSheetId)?.name;
      if (resolved) return repairs.map(r => ({ ...r, clientName: resolved }));
    }
    return repairs;
  }, [batchEnabled, batchData, data, clientSheetId, clients]);

  // Auto-reconcile temps: drop TEMP- rows once a real repair with matching
  // (sourceTaskId, itemId, clientSheetId) arrives in apiRepairs.
  useEffect(() => {
    if (optimisticCreates.length === 0) return;
    const realIds = new Set(apiRepairs.map(r => r.repairId));
    const realKeys = new Set(apiRepairs.map(r => `${r.sourceTaskId}|${r.itemId}|${r.clientSheetId}`));
    const stillTemp = optimisticCreates.filter(r => {
      if (!r.repairId.startsWith('TEMP-')) return true;
      if (realIds.has(r.repairId)) return false;
      const key = `${(r as any).sourceTaskId ?? ''}|${r.itemId}|${r.clientSheetId ?? ''}`;
      return !realKeys.has(key);
    });
    if (stillTemp.length !== optimisticCreates.length) {
      setOptimisticCreates(stillTemp);
      const removed = optimisticCreates.filter(r => !stillTemp.includes(r));
      for (const rr of removed) repairBroadcast({ type: 'remove', repairId: rr.repairId });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiRepairs]);

  // Phase 2C: merge patches into raw mapped repairs, then prepend optimistic creates
  const repairs = useMemo(() => {
    const now = Date.now();
    const rawRepairs = apiRepairs.map(mapToAppRepair);
    const merged = rawRepairs.map(r => {
      const p = patches[r.repairId];
      if (!p || now - p.appliedAt > PATCH_TTL_MS) return r;
      return { ...r, ...p.data };
    });
    return [...optimisticCreates, ...merged];
  }, [apiRepairs, patches, optimisticCreates]);

  return {
    apiRepairs,
    repairs,
    count: batchEnabled ? (batchData?.counts?.repairs ?? 0) : (data?.count ?? 0),
    clientsQueried: batchEnabled ? 1 : (data?.clientsQueried ?? 0),
    errors: batchEnabled ? undefined : data?.errors,
    loading: batchEnabled ? batchLoading : individualLoading,
    error: batchEnabled ? batchError : individualError,
    refetch: batchEnabled ? silentRefetchBatch : individualRefetch,
    lastFetched: batchEnabled ? new Date() : individualLastFetched,
    applyRepairPatch,
    mergeRepairPatch,
    clearRepairPatch,
    addOptimisticRepair,
    removeOptimisticRepair,
  };
}
