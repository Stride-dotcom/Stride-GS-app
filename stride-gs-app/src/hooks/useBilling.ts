/**
 * useBilling — Fetches billing ledger data from the Stride API.
 *
 * v38.13.0: Accepts optional BillingFilterParams for server-side filtering
 * (report builder mode). When filters are provided, skips Supabase cache
 * and batch path — always goes direct to GAS endpoint.
 *
 * Performance: checks BatchDataContext first (client users get all data in 1 call).
 * Falls back to individual API call for staff/admin users or when batch is unavailable.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { fetchBilling } from '../lib/api';
import type { ApiBillingRow, BillingResponse, BillingSummary, BillingFilterParams } from '../lib/api';
import { useApiData } from './useApiData';
import { useClientFilter } from './useClientFilter';
import { useBatchData } from '../contexts/BatchDataContext';
import { useClients } from './useClients';
import { entityEvents } from '../lib/entityEvents';
import { fetchBillingFromSupabase, isSupabaseCacheAvailable } from '../lib/supabaseQueries';
import type { ClientNameMap } from '../lib/supabaseQueries';

export interface UseBillingResult {
  apiRows: ApiBillingRow[];
  rows: ApiBillingRow[];
  count: number;
  summary: BillingSummary | null;
  clientsQueried: number;
  errors?: { client: string; error: string }[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
  lastFetched: Date | null;
}

export function useBilling(autoFetch = true, filterClientSheetId?: string, filters?: BillingFilterParams): UseBillingResult {
  const clientFilter = useClientFilter();
  const clientSheetId = clientFilter ?? filterClientSheetId;
  const { batchData, batchEnabled, batchLoading, batchError, silentRefetchBatch } = useBatchData();
  const { clients } = useClients();

  // When filters are provided, bypass batch + Supabase (server-side filtering is GAS-only)
  const hasServerFilters = !!(filters?.statusFilter?.length || filters?.svcFilter?.length || filters?.sidemarkFilter?.length || filters?.endDate || filters?.clientFilter?.length);

  const clientNameMap = useMemo<ClientNameMap>(() => {
    const map: ClientNameMap = {};
    for (const c of clients) { map[c.id] = c.name; }
    return map;
  }, [clients]);

  // Mirror clientNameMap via ref so fetchFn stays stable across client-list re-renders.
  // Same pattern applied to the 5 list hooks in session 62 to prevent perpetual refetch loops.
  const clientNameMapRef = useRef(clientNameMap);
  useEffect(() => { clientNameMapRef.current = clientNameMap; }, [clientNameMap]);

  const shouldFetchIndividual = hasServerFilters || !batchEnabled;

  const fetchFn = useCallback(
    async (signal?: AbortSignal) => {
      // When server-side filters are active, go direct to GAS (no Supabase, no batch)
      if (hasServerFilters) {
        return fetchBilling(signal, clientSheetId, filters);
      }
      if (await isSupabaseCacheAvailable()) {
        const sbResult = await fetchBillingFromSupabase(clientNameMapRef.current, clientSheetId);
        if (sbResult) return { data: sbResult, ok: true, error: null } as { data: BillingResponse; ok: true; error: null };
      }
      return fetchBilling(signal, clientSheetId);
    },
    // clientNameMap intentionally omitted — read via ref to prevent perpetual refetch loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clientSheetId, hasServerFilters, filters]
  );

  const { data, loading: individualLoading, error: individualError, refetch: individualRefetch, lastFetched: individualLastFetched } = useApiData<BillingResponse>(
    fetchFn,
    autoFetch && shouldFetchIndividual,
    `billing:${clientSheetId || 'all'}:${hasServerFilters ? JSON.stringify(filters) : ''}`
  );

  // Phase 4: subscribe to entityEvents for confirmed billing writes (non-batch path only)
  useEffect(() => {
    if (batchEnabled && !hasServerFilters) return;
    return entityEvents.subscribe((type) => {
      if (type === 'billing') individualRefetch();
    });
  }, [batchEnabled, hasServerFilters, individualRefetch]);

  // Map batch data to ApiBillingRow shape (only when NOT using server filters)
  const apiRows = useMemo(() => {
    if (!hasServerFilters && batchEnabled && batchData) {
      return batchData.billing.map(b => ({
        ledgerRowId: b.ledgerRowId,
        clientName: (b as any).clientName || '',
        clientSheetId: b.clientSheetId,
        status: b.status,
        invoiceNo: b.invoiceNo,
        client: '',
        date: b.date,
        svcCode: b.svcCode,
        svcName: b.svcName,
        category: '',
        itemId: b.itemId,
        description: b.description,
        itemClass: '',
        qty: b.qty ?? 0,
        rate: b.rate,
        total: b.total,
        taskId: '',
        repairId: '',
        shipmentNo: '',
        itemNotes: '',
        invoiceDate: '',
        invoiceUrl: '',
        sidemark: (b as any).sidemark || '',
      } as ApiBillingRow));
    }
    return data?.rows ?? [];
  }, [hasServerFilters, batchEnabled, batchData, data]);

  const rows = useMemo(() => apiRows, [apiRows]);

  const summary = useMemo(() => {
    if (!hasServerFilters && batchEnabled && batchData) {
      return batchData.billingSummary as BillingSummary;
    }
    return data?.summary ?? null;
  }, [hasServerFilters, batchEnabled, batchData, data]);

  const useBatch = !hasServerFilters && batchEnabled;

  return {
    apiRows,
    rows,
    count: useBatch ? (batchData?.counts?.billing ?? 0) : (data?.count ?? 0),
    summary,
    clientsQueried: useBatch ? 1 : (data?.clientsQueried ?? 0),
    errors: useBatch ? undefined : data?.errors,
    loading: useBatch ? batchLoading : individualLoading,
    error: useBatch ? batchError : individualError,
    refetch: useBatch ? silentRefetchBatch : individualRefetch,
    lastFetched: useBatch ? new Date() : individualLastFetched,
  };
}
