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
import { useMemo, useCallback, useState, useEffect } from 'react';
import { fetchClients } from '../lib/api';
import { fetchClientsFromSupabase } from '../lib/supabaseQueries';
import type { ApiClient, ClientsResponse } from '../lib/api';
import type { Client } from '../lib/types';
import { useApiData } from './useApiData';
import { entityEvents } from '../lib/entityEvents';

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
  /** Session 69 — optimistic patch by spreadsheetId. Overlay is cleared after refetch. */
  applyClientPatch: (spreadsheetId: string, patch: Partial<ApiClient>) => void;
  clearClientPatch: (spreadsheetId: string) => void;
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

  // Session 69 — subscribe to 'client' entity events so every mounted useClients
  // instance (every page with a client dropdown) refetches when a client is
  // created / updated / reactivated. Keeps dropdowns live across the app without
  // requiring a page refresh.
  useEffect(() => {
    return entityEvents.subscribe((type) => {
      if (type === 'client') refetch();
    });
  }, [refetch]);

  // Session 69 — optimistic patches keyed by spreadsheetId. Merges into apiClients
  // below. Auto-cleared on next refetch (or explicitly via clearClientPatch).
  const [patches, setPatches] = useState<Record<string, Partial<ApiClient>>>({});
  const applyClientPatch = useCallback((spreadsheetId: string, patch: Partial<ApiClient>) => {
    if (!spreadsheetId) return;
    setPatches(prev => ({ ...prev, [spreadsheetId]: { ...(prev[spreadsheetId] || {}), ...patch } }));
  }, []);
  const clearClientPatch = useCallback((spreadsheetId: string) => {
    setPatches(prev => {
      if (!(spreadsheetId in prev)) return prev;
      const next = { ...prev };
      delete next[spreadsheetId];
      return next;
    });
  }, []);

  // Stabilize empty-array reference to prevent infinite re-render cascades
  // (data?.clients ?? [] creates a new [] each render when data is null)
  const rawApiClients = useMemo(() => data?.clients ?? [], [data]);
  const apiClients = useMemo(() => {
    if (Object.keys(patches).length === 0) return rawApiClients;
    return rawApiClients.map(c => {
      const p = patches[c.spreadsheetId];
      return p ? { ...c, ...p } : c;
    });
  }, [rawApiClients, patches]);
  const clients = useMemo(() => apiClients.map(mapToAppClient), [apiClients]);

  return {
    apiClients,
    clients,
    count: data?.count ?? 0,
    loading,
    error,
    refetch,
    lastFetched,
    applyClientPatch,
    clearClientPatch,
  };
}
