/**
 * useRepairs — Fetches repairs from the Stride API.
 *
 * Performance: checks BatchDataContext first (client users get all data in 1 call).
 * Falls back to individual API call for staff/admin users or when batch is unavailable.
 *
 * Phase 2C: optimistic patch architecture added.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchRepairs } from '../lib/api';
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
    repairVendor: api.repairVendor || undefined,
    assignedTo: api.createdBy || undefined,
    createdDate: api.createdDate,
    quoteSentDate: api.quoteSentDate || undefined,
    approvedDate: api.scheduledDate || undefined,
    completedDate: api.completedDate || undefined,
    notes: api.repairNotes || undefined,
    internalNotes: api.taskNotes || undefined,
    repairFolderUrl: api.repairFolderUrl || undefined,
    taskFolderUrl: api.taskFolderUrl || undefined,
    shipmentFolderUrl: api.shipmentFolderUrl || undefined,
  };
}

export function useRepairs(autoFetch = true, filterClientSheetId?: string): UseRepairsResult {
  const clientFilter = useClientFilter();
  const clientSheetId = clientFilter ?? filterClientSheetId;
  const { batchData, batchEnabled, batchLoading, batchError, silentRefetchBatch } = useBatchData();
  const { clients } = useClients();

  const clientNameMap = useMemo<ClientNameMap>(() => {
    const map: ClientNameMap = {};
    for (const c of clients) { map[c.id] = c.name; }
    return map;
  }, [clients]);

  const shouldFetchIndividual = !batchEnabled;

  const fetchFn = useCallback(
    async (signal?: AbortSignal) => {
      if (await isSupabaseCacheAvailable()) {
        const sbResult = await fetchRepairsFromSupabase(clientNameMap, clientSheetId);
        if (sbResult) return { data: sbResult, ok: true, error: null } as { data: RepairsResponse; ok: true; error: null };
      }
      return fetchRepairs(signal, clientSheetId);
    },
    [clientSheetId, clientNameMap]
  );

  const { data, loading: individualLoading, error: individualError, refetch: individualRefetch, lastFetched: individualLastFetched } = useApiData<RepairsResponse>(
    fetchFn,
    autoFetch && shouldFetchIndividual,
    `repairs:${clientSheetId || 'all'}`
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
    setOptimisticCreates(prev => [repair, ...prev]);
  }, []);

  const removeOptimisticRepair = useCallback((tempRepairId: string) => {
    setOptimisticCreates(prev => prev.filter(r => r.repairId !== tempRepairId));
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
        itemClass: '',
        vendor: b.vendor,
        location: '',
        sidemark: '',
        taskNotes: '',
        createdBy: '',
        createdDate: b.createdDate,
        quoteAmount: b.quoteAmount,
        quoteSentDate: '',
        status: b.status,
        approved: false,
        scheduledDate: '',
        startDate: '',
        repairVendor: b.repairVendor,
        partsCost: null,
        laborHours: null,
        repairResult: '',
        finalAmount: null,
        invoiceId: '',
        itemNotes: '',
        repairNotes: '',
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
