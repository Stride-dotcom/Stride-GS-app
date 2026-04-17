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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchBilling, setNextFetchNoCache } from '../lib/api';
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
  // Session 69 — optimistic hide for Create Invoices flow.
  // IDs are Ledger Row IDs; hidden rows are filtered out of `rows` until revealed
  // or cleared by the next refetch.
  hideUnbilled: (ledgerRowIds: string[]) => void;
  revealUnbilled: (ledgerRowIds: string[]) => void;
  clearHiddenUnbilled: () => void;
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
  clientNameMapRef.current = clientNameMap;

  // Mirror filters via ref so callback stays stable when filter value changes.
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const shouldFetchIndividual = hasServerFilters || !batchEnabled;

  // Stable string key for filters — prevents fetchFn from rebuilding when callers pass
  // inline filter objects (new reference each render, same logical value).
  // Unconditional JSON.stringify so it handles both the hasServerFilters=true and =false cases.
  const filtersKey = useMemo(() => JSON.stringify(filters || {}), [filters]);

  const fetchFn = useCallback(
    async (signal?: AbortSignal) => {
      // When server-side filters are active, go direct to GAS (no Supabase, no batch)
      if (hasServerFilters) {
        return fetchBilling(signal, clientSheetId, filtersRef.current);
      }
      const skipSb = entityEvents.shouldSkipSupabase('billing');
      if (!skipSb && await isSupabaseCacheAvailable()) {
        const sbResult = await fetchBillingFromSupabase(clientNameMapRef.current, clientSheetId);
        if (sbResult) return { data: sbResult, ok: true, error: null } as { data: BillingResponse; ok: true; error: null };
      }
      if (skipSb) setNextFetchNoCache();
      return fetchBilling(signal, clientSheetId);
    },
    // clientNameMap intentionally omitted — read via ref to prevent perpetual refetch loop.
    // filters intentionally omitted — read via filtersRef.current; filtersKey is the stable rebuild trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clientSheetId, hasServerFilters, filtersKey]
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
        // v38.60.1 — batch now includes full ApiBillingRow field set
        client: b.client || '',
        date: b.date,
        svcCode: b.svcCode,
        svcName: b.svcName,
        category: b.category || '',
        itemId: b.itemId,
        description: b.description,
        itemClass: b.itemClass || '',
        qty: b.qty ?? 0,
        rate: b.rate,
        total: b.total,
        taskId: b.taskId || '',
        repairId: b.repairId || '',
        shipmentNo: b.shipmentNo || '',
        itemNotes: b.itemNotes || '',
        invoiceDate: b.invoiceDate || '',
        invoiceUrl: b.invoiceUrl || '',
        sidemark: b.sidemark || '',
      } as ApiBillingRow));
    }
    return data?.rows ?? [];
  }, [hasServerFilters, batchEnabled, batchData, data]);

  // Session 69 — optimistic hide state for Create Invoices.
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const hideUnbilled = useCallback((ids: string[]) => {
    if (!ids || !ids.length) return;
    setHiddenIds(prev => {
      const next = new Set(prev);
      for (const id of ids) if (id) next.add(id);
      return next;
    });
  }, []);
  const revealUnbilled = useCallback((ids: string[]) => {
    if (!ids || !ids.length) return;
    setHiddenIds(prev => {
      const next = new Set(prev);
      for (const id of ids) if (id) next.delete(id);
      return next;
    });
  }, []);
  const clearHiddenUnbilled = useCallback(() => setHiddenIds(new Set()), []);

  const rows = useMemo(() => {
    if (hiddenIds.size === 0) return apiRows;
    return apiRows.filter(r => !hiddenIds.has(r.ledgerRowId));
  }, [apiRows, hiddenIds]);

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
    hideUnbilled,
    revealUnbilled,
    clearHiddenUnbilled,
  };
}
