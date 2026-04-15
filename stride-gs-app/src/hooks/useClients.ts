/**
 * useClients — Fetches client list, Supabase-first with GAS fallback.
 *
 * Session 65 rewrite: was GAS-only (120-240s cold-start). Now tries
 * fetchClientsFromSupabase (~50ms) first; if it returns null (Supabase
 * unreachable or empty mirror) or throws, falls back to the original
 * GAS fetchClients path. Matches the pattern used by the 6 data hooks
 * (useInventory, useTasks, etc.) since session 47.
 *
 * Mirror table: public.clients (see migration 20260415120000). StrideAPI.gs
 * writes through on every handleUpdateClient_ / handleOnboardClient_ /
 * handleFinishClientSetup_ call. The backfill endpoint
 * bulkSyncClientsToSupabase rebuilds it from CB Clients on demand.
 *
 * Session 63 historical note: a ClientsProvider Context refactor was
 * attempted to deduplicate the ~11 parallel useApiData instances across
 * AppLayout + pages. Reverted (React #300 on client-filter click, cause
 * unclear under minified build). The in-memory cache tier short-circuits
 * subsequent consumers to the same reference in practice.
 */
import { useCallback, useMemo, useEffect, useState, useRef } from 'react';
import { fetchClients } from '../lib/api';
import { fetchClientsFromSupabase } from '../lib/supabaseQueries';
import type { ApiClient, ClientsResponse, ApiResponse } from '../lib/api';
import type { Client } from '../lib/types';
import { cacheGet, cacheSet } from '../lib/apiCache';

export interface UseClientsResult {
  /** Raw API clients (full data from CB) */
  apiClients: ApiClient[];
  /** Mapped clients for UI compatibility (matches existing Client type) */
  clients: Client[];
  /** Total count */
  count: number;
  loading: boolean;
  error: string | null;
  refetch: () => void;
  lastFetched: Date | null;
}

function mapToAppClient(apiClient: ApiClient): Client {
  return {
    id: apiClient.spreadsheetId,
    name: apiClient.name,
    email: apiClient.email,
    phone: apiClient.phone,
    contactName: apiClient.contactName || apiClient.name,
    activeItems: 0,
    onHold: 0,
  };
}

export function useClients(autoFetch = true, includeInactive = false): UseClientsResult {
  const cacheKey = includeInactive ? 'clients_all' : 'clients';

  // Initial state hydrates from in-memory/localStorage cache (~instant if warm).
  const cached = cacheGet<ClientsResponse>(cacheKey);
  const [data, setData] = useState<ClientsResponse | null>(cached);
  const [loading, setLoading] = useState(autoFetch && !cached);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(cached ? new Date() : null);

  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const doFetch = useCallback(async (silent = false) => {
    // Abort any in-flight GAS request
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    if (!silent) setLoading(true);
    setError(null);

    // 1. Supabase-first (~50ms). null on miss / unreachable / empty.
    try {
      const sb = await fetchClientsFromSupabase(includeInactive);
      if (sb && sb.clients.length > 0 && mountedRef.current && !controller.signal.aborted) {
        setData(sb);
        setLastFetched(new Date());
        setLoading(false);
        cacheSet(cacheKey, sb);

        // Background GAS refresh (silent) to keep mirror honest for any fields
        // that lag. Fire-and-forget — never blocks UI.
        void fetchClients(controller.signal, includeInactive)
          .then((gas: ApiResponse<ClientsResponse>) => {
            if (!mountedRef.current || controller.signal.aborted) return;
            if (gas.ok && gas.data) {
              setData(gas.data);
              setLastFetched(new Date());
              cacheSet(cacheKey, gas.data);
            }
          })
          .catch(() => { /* best-effort */ });
        return;
      }
    } catch {
      // fall through to GAS
    }

    // 2. GAS fallback (only path when Supabase mirror is empty / down).
    try {
      const gas: ApiResponse<ClientsResponse> = await fetchClients(controller.signal, includeInactive);
      if (!mountedRef.current || controller.signal.aborted) return;
      if (gas.ok && gas.data) {
        setData(gas.data);
        setLastFetched(new Date());
        cacheSet(cacheKey, gas.data);
        setError(null);
      } else {
        setError(gas.error || 'Failed to load clients');
      }
    } catch (err: unknown) {
      if (!mountedRef.current || controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mountedRef.current && !controller.signal.aborted) setLoading(false);
    }
  }, [cacheKey, includeInactive]);

  // Initial fetch
  useEffect(() => {
    if (!autoFetch) return;
    // If cache was already hydrated from the initial useState call, do a silent
    // background refresh so the user sees up-to-date data on subsequent visits
    // without the loading spinner flashing.
    if (cached) {
      setData(cached);
      setLoading(false);
      void doFetch(true);
    } else {
      void doFetch(false);
    }

    return () => { abortRef.current?.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFetch, cacheKey]);

  const refetch = useCallback(() => { void doFetch(false); }, [doFetch]);

  const apiClients = useMemo(() => data?.clients ?? [], [data]);
  const clients = useMemo(() => apiClients.map(mapToAppClient), [apiClients]);

  return {
    apiClients,
    clients,
    count: data?.count ?? 0,
    loading,
    error,
    refetch,
    lastFetched,
  };
}
