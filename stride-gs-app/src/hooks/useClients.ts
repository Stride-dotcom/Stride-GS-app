/**
 * useClients — Fetches client list from the Stride API.
 *
 * Returns the raw API clients and also maps them to the app's Client type
 * for backward compatibility with existing UI components.
 */
import { useMemo } from 'react';
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

/**
 * Map an API client to the app's Client type.
 * The app currently uses a simplified Client with id/name/email/phone/contactName/activeItems/onHold.
 * activeItems and onHold will be 0 until we wire inventory counts (Batch 2).
 */
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

export function useClients(autoFetch = true): UseClientsResult {
  const { data, loading, error, refetch, lastFetched } = useApiData<ClientsResponse>(
    fetchClients,
    autoFetch,
    'clients'
  );

  // Stabilize empty array reference to prevent infinite re-render cascades
  // (data?.clients ?? [] creates a new [] each render when data is null)
  const apiClients = useMemo(() => data?.clients ?? [], [data]);

  const clients = useMemo(
    () => apiClients.map(mapToAppClient),
    [apiClients]
  );

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
