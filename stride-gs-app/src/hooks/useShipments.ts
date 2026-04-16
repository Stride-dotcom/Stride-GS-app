/**
 * useShipments — Fetches shipments from the Stride API.
 *
 * Performance: checks BatchDataContext first (client users get all data in 1 call).
 * Falls back to individual API call for staff/admin users or when batch is unavailable.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { fetchShipments } from '../lib/api';
import type { ApiShipment, ShipmentsResponse } from '../lib/api';
import type { Shipment } from '../lib/types';
import { useApiData } from './useApiData';
import { useClientFilter } from './useClientFilter';
import { useBatchData } from '../contexts/BatchDataContext';
import { useClients } from './useClients';
import { entityEvents } from '../lib/entityEvents';
import { fetchShipmentsFromSupabase, isSupabaseCacheAvailable } from '../lib/supabaseQueries';
import type { ClientNameMap } from '../lib/supabaseQueries';

export interface UseShipmentsResult {
  apiShipments: ApiShipment[];
  shipments: Shipment[];
  count: number;
  clientsQueried: number;
  errors?: { client: string; error: string }[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
  lastFetched: Date | null;
}

function mapToAppShipment(api: ApiShipment): Shipment {
  return {
    shipmentId: api.shipmentNumber,
    clientId: api.clientSheetId,
    clientName: api.clientName,
    carrier: api.carrier,
    trackingNumber: api.trackingNumber,
    status: 'Received', // All shipments in the Shipments tab are received
    expectedDate: api.receiveDate, // Sheet doesn't have separate expected date
    receivedDate: api.receiveDate,
    itemCount: api.itemCount,
    notes: api.notes || undefined,
    folderUrl: api.folderUrl || undefined,
  };
}

export function useShipments(autoFetch = true, filterClientSheetId?: string | string[]): UseShipmentsResult {
  const clientFilter = useClientFilter();
  const clientSheetId = clientFilter ?? filterClientSheetId;
  const { batchData, batchEnabled, batchLoading, batchError, silentRefetchBatch } = useBatchData();
  const { clients } = useClients();

  const clientNameMap = useMemo<ClientNameMap>(() => {
    const map: ClientNameMap = {};
    for (const c of clients) { map[c.id] = c.name; }
    return map;
  }, [clients]);

  // Ref keeps fetchFn stable even when clients (and thus clientNameMap)
  // gets a new reference every render. Without this, fetchFn rebuilds every
  // render → useApiData effect fires → aborts in-flight → perpetual refetch.
  const clientNameMapRef = useRef(clientNameMap);
  clientNameMapRef.current = clientNameMap;

  const shouldFetchIndividual = !batchEnabled;

  // Stable dep key — prevents infinite refetch when clientSheetId is an array
  const cacheKeyScope = Array.isArray(clientSheetId) ? clientSheetId.slice().sort().join(',') : (clientSheetId || 'all');

  const fetchFn = useCallback(
    async (signal?: AbortSignal) => {
      if (await isSupabaseCacheAvailable()) {
        const sbResult = await fetchShipmentsFromSupabase(clientNameMapRef.current, clientSheetId);
        if (sbResult) return { data: sbResult, ok: true, error: null } as { data: ShipmentsResponse; ok: true; error: null };
      }
      const gasClientId = Array.isArray(clientSheetId)
        ? (clientSheetId.length === 1 ? clientSheetId[0] : undefined)
        : clientSheetId;
      return fetchShipments(signal, gasClientId);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cacheKeyScope]
  );

  const { data, loading: individualLoading, error: individualError, refetch: individualRefetch, lastFetched: individualLastFetched } = useApiData<ShipmentsResponse>(
    fetchFn,
    autoFetch && shouldFetchIndividual,
    `shipments:${cacheKeyScope}`
  );

  // Phase 4: subscribe to entityEvents for confirmed shipment writes (non-batch path only)
  useEffect(() => {
    if (batchEnabled) return;
    return entityEvents.subscribe((type) => {
      if (type === 'shipment') individualRefetch();
    });
  }, [batchEnabled, individualRefetch]);

  // Map batch data to ApiShipment shape (lightweight)
  const apiShipments = useMemo(() => {
    if (batchEnabled && batchData) {
      return batchData.shipments.map(b => ({
        shipmentNumber: b.shipmentNumber,
        clientName: (b as any).clientName || '',
        clientSheetId: b.clientSheetId,
        receiveDate: b.receiveDate,
        itemCount: b.itemCount,
        carrier: b.carrier,
        trackingNumber: b.trackingNumber,
        // v38.60.1 — batch now includes full ApiShipment field set
        photosUrl: b.photosUrl || '',
        notes: b.notes,
        invoiceUrl: b.invoiceUrl || '',
        folderUrl: b.folderUrl || '',
      } as ApiShipment));
    }
    // Individual path: resolve "(single)" clientName using the clients list
    const shipments = data?.shipments ?? [];
    if (clientSheetId && shipments.length > 0 && shipments[0].clientName === '(single)') {
      const resolved = clients.find(c => c.id === (typeof clientSheetId === 'string' ? clientSheetId : clientSheetId[0]))?.name;
      if (resolved) return shipments.map(s => ({ ...s, clientName: resolved }));
    }
    return shipments;
  }, [batchEnabled, batchData, data, clientSheetId, clients]);

  const shipments = useMemo(() => apiShipments.map(mapToAppShipment), [apiShipments]);

  return {
    apiShipments,
    shipments,
    count: batchEnabled ? (batchData?.counts?.shipments ?? 0) : (data?.count ?? 0),
    clientsQueried: batchEnabled ? 1 : (data?.clientsQueried ?? 0),
    errors: batchEnabled ? undefined : data?.errors,
    loading: batchEnabled ? batchLoading : individualLoading,
    error: batchEnabled ? batchError : individualError,
    refetch: batchEnabled ? silentRefetchBatch : individualRefetch,
    lastFetched: batchEnabled ? new Date() : individualLastFetched,
  };
}
