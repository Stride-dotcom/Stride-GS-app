/**
 * useWillCalls — Fetches will calls from the Stride API.
 *
 * Performance: checks BatchDataContext first (client users get all data in 1 call).
 * Falls back to individual API call for staff/admin users or when batch is unavailable.
 *
 * Phase 2C: optimistic patch architecture added.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchWillCalls } from '../lib/api';
import type { ApiWillCall, WillCallsResponse } from '../lib/api';
import type { WillCall, WillCallStatus } from '../lib/types';
import { useApiData } from './useApiData';
import { useClientFilter } from './useClientFilter';
import { useBatchData } from '../contexts/BatchDataContext';
import { useClients } from './useClients';
import { entityEvents } from '../lib/entityEvents';
import { fetchWillCallsFromSupabase, isSupabaseCacheAvailable } from '../lib/supabaseQueries';
import type { ClientNameMap } from '../lib/supabaseQueries';

export interface UseWillCallsResult {
  apiWillCalls: ApiWillCall[];
  willCalls: WillCall[];
  count: number;
  clientsQueried: number;
  errors?: { client: string; error: string }[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
  lastFetched: Date | null;
  // Phase 2C — optimistic patch functions
  applyWcPatch: (wcNumber: string, patch: Partial<WillCall>) => void;
  mergeWcPatch: (wcNumber: string, patch: Partial<WillCall>) => void;
  clearWcPatch: (wcNumber: string) => void;
  addOptimisticWc: (wc: WillCall) => void;
  removeOptimisticWc: (tempWcNumber: string) => void;
}

const VALID_STATUSES: WillCallStatus[] = ['Pending', 'Scheduled', 'Released', 'Partial', 'Cancelled'];
const PATCH_TTL_MS = 120_000;

function mapToAppWillCall(api: ApiWillCall): WillCall {
  const status = VALID_STATUSES.includes(api.status as WillCallStatus)
    ? (api.status as WillCallStatus)
    : 'Pending';

  return {
    wcNumber: api.wcNumber,
    clientId: api.clientSheetId,
    clientSheetId: api.clientSheetId,
    clientName: api.clientName,
    status,
    pickupParty: api.pickupParty,
    pickupPartyPhone: api.pickupPhone || undefined,
    pickupPartyEmail: undefined, // Not in sheet schema
    scheduledDate: api.estimatedPickupDate || undefined,
    actualPickupDate: api.actualPickupDate || undefined,
    itemCount: api.itemsCount || api.items.length,
    items: api.items.map(item => ({
      itemId: item.itemId,
      description: item.description,
      qty: item.qty,
      released: item.released,
      vendor: item.vendor || undefined,
      location: item.location || undefined,
      status: item.status || undefined,
    })),
    createdDate: api.createdDate,
    notes: api.notes || undefined,
    requiresSignature: false, // Not in sheet schema
    wcFolderUrl: api.wcFolderUrl || undefined,
    shipmentFolderUrl: api.shipmentFolderUrl || undefined,
    cod: api.cod ?? false,
    codAmount: api.codAmount ?? undefined,
  };
}

export function useWillCalls(autoFetch = true, filterClientSheetId?: string | string[]): UseWillCallsResult {
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
  const cacheKeyScope = Array.isArray(clientSheetId) ? clientSheetId.slice().sort().join(',') : (clientSheetId || 'all');

  const fetchFn = useCallback(
    async (signal?: AbortSignal) => {
      if (await isSupabaseCacheAvailable()) {
        const sbResult = await fetchWillCallsFromSupabase(clientNameMapRef.current, clientSheetId);
        if (sbResult) return { data: sbResult, ok: true, error: null } as { data: WillCallsResponse; ok: true; error: null };
      }
      const gasClientId = Array.isArray(clientSheetId)
        ? (clientSheetId.length === 1 ? clientSheetId[0] : undefined)
        : clientSheetId;
      return fetchWillCalls(signal, gasClientId);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cacheKeyScope]
  );

  const { data, loading: individualLoading, error: individualError, refetch: individualRefetch, lastFetched: individualLastFetched } = useApiData<WillCallsResponse>(
    fetchFn,
    autoFetch && shouldFetchIndividual,
    `willcalls:${cacheKeyScope}`
  );

  // ─── Phase 2C: Optimistic patch state ────────────────────────────────────
  const [patches, setPatches] = useState<Record<string, { data: Partial<WillCall>; appliedAt: number }>>({});
  const [optimisticCreates, setOptimisticCreates] = useState<WillCall[]>([]);

  const applyWcPatch = useCallback((wcNumber: string, patch: Partial<WillCall>) => {
    setPatches(prev => ({ ...prev, [wcNumber]: { data: patch, appliedAt: Date.now() } }));
  }, []);

  const mergeWcPatch = useCallback((wcNumber: string, patch: Partial<WillCall>) => {
    setPatches(prev => ({
      ...prev,
      [wcNumber]: {
        data: { ...(prev[wcNumber]?.data ?? {}), ...patch },
        appliedAt: Date.now(),
      },
    }));
  }, []);

  const clearWcPatch = useCallback((wcNumber: string) => {
    setPatches(prev => {
      const next = { ...prev };
      delete next[wcNumber];
      return next;
    });
  }, []);

  const addOptimisticWc = useCallback((wc: WillCall) => {
    setOptimisticCreates(prev => [wc, ...prev]);
  }, []);

  const removeOptimisticWc = useCallback((tempWcNumber: string) => {
    setOptimisticCreates(prev => prev.filter(w => w.wcNumber !== tempWcNumber));
  }, []);
  // ─────────────────────────────────────────────────────────────────────────

  // Phase 2: subscribe to entityEvents for confirmed will_call writes (non-batch path only)
  useEffect(() => {
    if (batchEnabled) return;
    return entityEvents.subscribe((type) => {
      if (type === 'will_call') individualRefetch();
    });
  }, [batchEnabled, individualRefetch]);

  // Map batch data to ApiWillCall shape (lightweight — no items)
  const apiWillCalls = useMemo(() => {
    if (batchEnabled && batchData) {
      return batchData.willCalls.map(b => ({
        wcNumber: b.wcNumber,
        clientName: (b as any).clientName || '',
        clientSheetId: b.clientSheetId,
        status: b.status,
        createdDate: b.createdDate,
        // v38.60.1 — batch now includes full ApiWillCall field set (items still
        // omitted — loaded on detail panel open via separate endpoint)
        createdBy: b.createdBy || '',
        pickupParty: b.pickupParty,
        pickupPhone: b.pickupPhone || '',
        requestedBy: b.requestedBy || '',
        estimatedPickupDate: b.estimatedPickupDate,
        actualPickupDate: b.actualPickupDate || '',
        notes: b.notes || '',
        cod: b.cod,
        codAmount: b.codAmount,
        itemsCount: b.itemsCount,
        totalWcFee: b.totalWcFee ?? null,
        items: [],
        wcFolderUrl: b.wcFolderUrl || undefined,
        shipmentFolderUrl: b.shipmentFolderUrl || undefined,
      } as ApiWillCall));
    }
    // Individual path: resolve "(single)" clientName using the clients list
    const wcs = data?.willCalls ?? [];
    if (clientSheetId && wcs.length > 0 && wcs[0].clientName === '(single)') {
      const resolved = clients.find(c => c.id === clientSheetId)?.name;
      if (resolved) return wcs.map(w => ({ ...w, clientName: resolved }));
    }
    return wcs;
  }, [batchEnabled, batchData, data, clientSheetId, clients]);

  // Phase 2C: merge patches into raw mapped will calls, then prepend optimistic creates
  const willCalls = useMemo(() => {
    const now = Date.now();
    const rawWillCalls = apiWillCalls.map(mapToAppWillCall);
    const merged = rawWillCalls.map(w => {
      const p = patches[w.wcNumber];
      if (!p || now - p.appliedAt > PATCH_TTL_MS) return w;
      return { ...w, ...p.data };
    });
    return [...optimisticCreates, ...merged];
  }, [apiWillCalls, patches, optimisticCreates]);

  return {
    apiWillCalls,
    willCalls,
    count: batchEnabled ? (batchData?.counts?.willCalls ?? 0) : (data?.count ?? 0),
    clientsQueried: batchEnabled ? 1 : (data?.clientsQueried ?? 0),
    errors: batchEnabled ? undefined : data?.errors,
    loading: batchEnabled ? batchLoading : individualLoading,
    error: batchEnabled ? batchError : individualError,
    refetch: batchEnabled ? silentRefetchBatch : individualRefetch,
    lastFetched: batchEnabled ? new Date() : individualLastFetched,
    applyWcPatch,
    mergeWcPatch,
    clearWcPatch,
    addOptimisticWc,
    removeOptimisticWc,
  };
}
