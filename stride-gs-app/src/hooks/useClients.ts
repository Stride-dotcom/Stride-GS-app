/**
 * useClients — Fetches client list, Supabase-first with GAS fallback.
 *
 * Uses the same useApiData + Supabase-first fetchFn pattern as every other
 * data hook (useInventory, useTasks, useRepairs, etc.). This keeps the hook
 * count stable at 11 per call and lets useApiData handle caching, abort,
 * and loading state consistently.
 *
 * Session 66 fix: the session-65 rewrite replaced useApiData with a
 * custom 12-hook implementation (added mountedRef + cleanup useEffect).
 * With 7 concurrent useClients calls on the Inventory page (1 direct + 6
 * via data hooks), the extra hook AND the Supabase→GAS dual-setData caused
 * React #300. Reverted to useApiData; Supabase-first logic lives in fetchFn.
 *
 * Session 63 historical note: a ClientsProvider Context refactor was
 * attempted to deduplicate the ~11 parallel useApiData instances across
 * AppLayout + pages. Reverted (React #300 on client-filter click, cause
 * unclear under minified build). The in-memory cache tier short-circuits
 * subsequent consumers to the same reference in practice.
 */
import { useMemo, useCallback } from 'react';
import { fetchClients } from '../lib/api';
import { fetchClientsFromSupabase } from '../lib/supabaseQueries';
import type { ApiClient, ClientsResponse } from '../lib/api';
import type { Client } from '../lib/types';
import { useApiData } from './useApiData';

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
  // Supabase-first fetcher — mirrors the pattern in useInventory / useTasks / etc.
  // Returns null on Supabase miss/unreachable, falls back to GAS automatically.
  const fetchFn = useCallback(
    async (signal?: AbortSignal) => {
      // 1. Supabase-first (~50 ms). Returns null if mirror is empty or unreachable.
      try {
        const sb = await fetchClientsFromSupabase(includeInactive);
        if (sb && sb.clients.length > 0) {
          return { data: sb, ok: true as const, error: null };
        }
      } catch {
        // fall through to GAS
      }
      // 2. GAS fallback (authoritative, used on cold start or Supabase miss).
      return fetchClients(signal, includeInactive);
    },
    [includeInactive]
  );

  const { data, loading, error, refetch, lastFetched } = useApiData<ClientsResponse>(
    fetchFn,
    autoFetch,
    includeInactive ? 'clients_all' : 'clients'
  );

  // Stabilize empty-array reference to prevent infinite re-render cascades
  // (data?.clients ?? [] creates a new [] each render when data is null)
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
