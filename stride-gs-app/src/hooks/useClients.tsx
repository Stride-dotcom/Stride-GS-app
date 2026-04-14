/**
 * useClients — Fetches the client list from the Stride API.
 *
 * Session 63: single-source-of-truth via ClientsContext. Previously each
 * consumer (page + 8 data hooks) called useClients() independently, which
 * instantiated its own useApiData for the "clients" cache key. On the
 * Inventory page that meant ~7 parallel getClients instances, each with
 * independent `data` state — identical values but DIFFERENT object
 * references across instances. When any one fetched and called setData,
 * its `clients` array rebuilt → every memo in consumers that closed over
 * `clients` rebuilt → fetchFn in the 6 data hooks rebuilt → useApiData
 * effect refired → aborts in-flight → refetches → infinite loop →
 * React error #300.
 *
 * Session 62 band-aid: stabilize `clientNameMap` via useRef in each of the
 * 6 data hooks (useInventory/useTasks/useRepairs/useWillCalls/useShipments +
 * useBilling added in session 63). That broke the immediate loop but did
 * not address the multi-instance divergence.
 *
 * Now: one ClientsProvider at the app root owns a single useApiData
 * instance. Every `useClients()` call reads from context — guaranteed same
 * reference across the entire tree. The ref pattern in the 6 data hooks
 * remains (defense in depth, harmless) but is no longer load-bearing.
 */
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { fetchClients } from '../lib/api';
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
    id: apiClient.spreadsheetId, // Real Google Sheets ID — used as clientSheetId in API calls
    name: apiClient.name,
    email: apiClient.email,
    phone: apiClient.phone,
    contactName: apiClient.contactName || apiClient.name,
    activeItems: 0,
    onHold: 0,
  };
}

// ─── Internal fetcher — one instance lives inside ClientsProvider ───────────
function useClientsInternal(autoFetch: boolean, includeInactive: boolean): UseClientsResult {
  const fetcher = useCallback(
    (signal?: AbortSignal) => fetchClients(signal, includeInactive),
    [includeInactive]
  );

  const { data, loading, error, refetch, lastFetched } = useApiData<ClientsResponse>(
    fetcher,
    autoFetch,
    includeInactive ? 'clients_all' : 'clients'
  );

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

// ─── Context — two channels so includeInactive consumers get their own ──────
// Most of the app only needs active clients; the Settings page needs all.
// Keep them separate so an admin viewing "All clients" doesn't pollute the
// active-only read path that drives ~every other view.
const ClientsActiveContext = createContext<UseClientsResult | null>(null);
const ClientsAllContext = createContext<UseClientsResult | null>(null);

export interface ClientsProviderProps {
  children: ReactNode;
  /** Set false to defer fetching until a consumer opts in. Default true. */
  autoFetch?: boolean;
}

export function ClientsProvider({ children, autoFetch = true }: ClientsProviderProps) {
  const active = useClientsInternal(autoFetch, false);
  const all = useClientsInternal(false, true); // lazy — Settings page refetch() opt-in
  return (
    <ClientsActiveContext.Provider value={active}>
      <ClientsAllContext.Provider value={all}>
        {children}
      </ClientsAllContext.Provider>
    </ClientsActiveContext.Provider>
  );
}

// ─── Public hook — reads from the appropriate context channel ───────────────
export function useClients(autoFetch = true, includeInactive = false): UseClientsResult {
  const ctx = useContext(includeInactive ? ClientsAllContext : ClientsActiveContext);
  if (ctx) {
    // Consumer opt-in for the inactive channel: if they asked for it and
    // data isn't loaded yet, kick a refetch. The ClientsProvider starts the
    // inactive channel with autoFetch=false so we don't waste a call when
    // nothing on the page needs it.
    if (includeInactive && autoFetch && !ctx.loading && !ctx.lastFetched) {
      // Fire once; idempotent via useApiData cache
      queueMicrotask(() => { try { ctx.refetch(); } catch { /* */ } });
    }
    return ctx;
  }
  // Fallback — no provider mounted. Rare (unit tests, story mode). Keep the
  // old behavior so nothing crashes. In production the provider is always
  // present via main.tsx.
  return useClientsInternal(autoFetch, includeInactive);
}
