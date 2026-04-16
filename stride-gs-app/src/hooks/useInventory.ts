/**
 * useInventory — Fetches inventory items from the Stride API.
 *
 * Performance priority:
 * 1. BatchDataContext (client users get all data in 1 call)
 * 2. Supabase read cache (50-100ms, Phase 3)
 * 3. Individual GAS API call (fallback)
 *
 * Phase 2C: optimistic patch architecture added.
 * applyItemPatch is also used cross-entity (WC release patches linked item statuses).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchInventory } from '../lib/api';
import type { ApiInventoryItem, InventoryResponse } from '../lib/api';
import type { InventoryItem, InventoryStatus } from '../lib/types';
import { useApiData } from './useApiData';
import { useClientFilter } from './useClientFilter';
import { useBatchData } from '../contexts/BatchDataContext';
import { useClients } from './useClients';
import { entityEvents } from '../lib/entityEvents';
import { fetchInventoryFromSupabase, isSupabaseCacheAvailable } from '../lib/supabaseQueries';
import type { ClientNameMap } from '../lib/supabaseQueries';

export interface UseInventoryResult {
  /** Raw API items */
  apiItems: ApiInventoryItem[];
  /** Mapped items for UI compatibility */
  items: InventoryItem[];
  count: number;
  clientsQueried: number;
  errors?: { client: string; error: string }[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
  lastFetched: Date | null;
  // Phase 2C — optimistic patch functions
  applyItemPatch: (itemId: string, patch: Partial<InventoryItem>) => void;
  mergeItemPatch: (itemId: string, patch: Partial<InventoryItem>) => void;
  clearItemPatch: (itemId: string) => void;
}

const VALID_STATUSES: InventoryStatus[] = ['Active', 'Released', 'On Hold', 'Transferred'];
const PATCH_TTL_MS = 120_000;

function mapToAppItem(api: ApiInventoryItem): InventoryItem {
  const status = VALID_STATUSES.includes(api.status as InventoryStatus)
    ? (api.status as InventoryStatus)
    : 'Active';

  return {
    itemId: api.itemId,
    clientId: api.clientSheetId,
    clientName: api.clientName,
    vendor: api.vendor,
    description: api.description,
    itemClass: api.itemClass,
    qty: api.qty,
    location: api.location,
    sidemark: api.sidemark,
    room: api.room || undefined,
    status,
    shipmentNumber: api.shipmentNumber || undefined,
    receiveDate: api.receiveDate,
    releaseDate: api.releaseDate || undefined,
    reference: api.reference || undefined,
    poNumber: api.reference || undefined,
    trackingNumber: api.trackingNumber || undefined,
    notes: api.itemNotes || undefined,
    itemNotes: api.itemNotes || undefined,
    shipmentFolderUrl: api.shipmentFolderUrl || undefined,
    condition: undefined, // Not in sheet schema
    dimensions: undefined,
  };
}

export function useInventory(autoFetch = true, filterClientSheetId?: string | string[]): UseInventoryResult {
  const clientFilter = useClientFilter(); // client users: their own ID; staff: undefined
  const clientSheetId = clientFilter ?? filterClientSheetId;
  const { batchData, batchEnabled, batchLoading, batchError, silentRefetchBatch } = useBatchData();
  const { clients } = useClients();

  // Build clientNameMap for Supabase queries
  const clientNameMap = useMemo<ClientNameMap>(() => {
    const map: ClientNameMap = {};
    for (const c of clients) { map[c.id] = c.name; }
    return map;
  }, [clients]);

  // Ref keeps fetchFn stable across client-list re-renders
  const clientNameMapRef = useRef(clientNameMap);
  clientNameMapRef.current = clientNameMap;

  // Only use individual fetch if batch is NOT available
  const shouldFetchIndividual = !batchEnabled;

  // Stable dep key — prevents infinite refetch when clientSheetId is an array
  // (array reference changes on every page render even when contents are the same)
  const cacheKeyScope = Array.isArray(clientSheetId) ? clientSheetId.slice().sort().join(',') : (clientSheetId || 'all');

  // Try Supabase first, fall back to GAS API
  const fetchFn = useCallback(
    async (signal?: AbortSignal) => {
      if (await isSupabaseCacheAvailable()) {
        const sbResult = await fetchInventoryFromSupabase(clientNameMapRef.current, clientSheetId);
        if (sbResult) return { data: sbResult, ok: true, error: null } as { data: InventoryResponse; ok: true; error: null };
      }
      const gasClientId = Array.isArray(clientSheetId)
        ? (clientSheetId.length === 1 ? clientSheetId[0] : undefined)
        : clientSheetId;
      return fetchInventory(signal, gasClientId);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cacheKeyScope]
  );

  const { data, loading: individualLoading, error: individualError, refetch: individualRefetch, lastFetched: individualLastFetched } = useApiData<InventoryResponse>(
    fetchFn,
    autoFetch && shouldFetchIndividual,
    `inventory:${cacheKeyScope}`
  );

  // ─── Phase 2C: Optimistic patch state ────────────────────────────────────
  const [patches, setPatches] = useState<Record<string, { data: Partial<InventoryItem>; appliedAt: number }>>({});

  const applyItemPatch = useCallback((itemId: string, patch: Partial<InventoryItem>) => {
    setPatches(prev => ({ ...prev, [itemId]: { data: patch, appliedAt: Date.now() } }));
  }, []);

  const mergeItemPatch = useCallback((itemId: string, patch: Partial<InventoryItem>) => {
    setPatches(prev => ({
      ...prev,
      [itemId]: {
        data: { ...(prev[itemId]?.data ?? {}), ...patch },
        appliedAt: Date.now(),
      },
    }));
  }, []);

  const clearItemPatch = useCallback((itemId: string) => {
    setPatches(prev => {
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
  }, []);
  // ─────────────────────────────────────────────────────────────────────────

  // Phase 2: subscribe to entityEvents for confirmed inventory writes (non-batch path only)
  useEffect(() => {
    if (batchEnabled) return;
    return entityEvents.subscribe((type) => {
      if (type === 'inventory') individualRefetch();
    });
  }, [batchEnabled, individualRefetch]);

  // If batch is enabled, map batch data to ApiInventoryItem shape
  const apiItems = useMemo(() => {
    if (batchEnabled && batchData) {
      return batchData.inventory.map(b => ({
        itemId: b.itemId,
        clientName: (b as any).clientName || '',
        clientSheetId: b.clientSheetId,
        // v38.60.1 — batch payload now mirrors individual-fetch shape
        reference: b.reference || '',
        qty: b.qty,
        vendor: b.vendor,
        description: b.description,
        itemClass: b.itemClass,
        location: b.location,
        sidemark: b.sidemark,
        room: b.room,
        itemNotes: b.itemNotes || '',
        taskNotes: b.taskNotes || '',
        needsInspection: b.needsInspection ?? false,
        needsAssembly: b.needsAssembly ?? false,
        carrier: b.carrier || '',
        trackingNumber: b.trackingNumber || '',
        shipmentNumber: b.shipmentNumber,
        receiveDate: b.receiveDate,
        releaseDate: b.releaseDate,
        status: b.status,
        invoiceUrl: b.invoiceUrl || '',
        shipmentFolderUrl: b.shipmentFolderUrl || undefined,
      } as ApiInventoryItem));
    }
    // Individual path: resolve "(single)" clientName using the clients list
    const items = data?.items ?? [];
    if (clientSheetId && items.length > 0 && items[0].clientName === '(single)') {
      const resolved = clients.find(c => c.id === clientSheetId)?.name;
      if (resolved) return items.map(item => ({ ...item, clientName: resolved }));
    }
    return items;
  }, [batchEnabled, batchData, data, clientSheetId, clients]);

  // Phase 2C: merge patches into raw mapped items
  const items = useMemo(() => {
    const now = Date.now();
    const rawItems = apiItems.map(mapToAppItem);
    return rawItems.map(item => {
      const p = patches[item.itemId];
      if (!p || now - p.appliedAt > PATCH_TTL_MS) return item;
      return { ...item, ...p.data };
    });
  }, [apiItems, patches]);

  return {
    apiItems,
    items,
    count: batchEnabled ? (batchData?.counts?.inventory ?? 0) : (data?.count ?? 0),
    clientsQueried: batchEnabled ? 1 : (data?.clientsQueried ?? 0),
    errors: batchEnabled ? undefined : data?.errors,
    loading: batchEnabled ? batchLoading : individualLoading,
    error: batchEnabled ? batchError : individualError,
    refetch: batchEnabled ? silentRefetchBatch : individualRefetch,
    lastFetched: batchEnabled ? new Date() : individualLastFetched,
    applyItemPatch,
    mergeItemPatch,
    clearItemPatch,
  };
}
