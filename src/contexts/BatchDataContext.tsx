/**
 * BatchDataContext — Single API call for all entity data.
 *
 * For client users (who always have a clientSheetId), this fetches all data
 * (inventory, tasks, repairs, will calls, shipments, billing) in ONE call
 * via the getBatch endpoint. This avoids 6 sequential requests on Apps Script's
 * single-threaded backend.
 *
 * Individual hooks (useInventory, useTasks, etc.) check this context first.
 * If batch data is available, they use it instead of making their own API call.
 *
 * Staff users (no single clientSheetId) still use individual hooks,
 * which benefit from server-side CacheService (120s TTL).
 */
import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { fetchBatch, isApiConfigured } from '../lib/api';
import type { BatchResponse } from '../lib/api';
import { useAuth } from './AuthContext';
import { cacheGet, cacheSet } from '../lib/apiCache';
import { entityEvents } from '../lib/entityEvents';

interface BatchDataContextValue {
  /** The batch response data (null until fetched or if not applicable) */
  batchData: BatchResponse | null;
  /** Whether the batch endpoint is being used (client user with clientSheetId) */
  batchEnabled: boolean;
  /** Loading state for the batch fetch */
  batchLoading: boolean;
  /** Error from batch fetch */
  batchError: string | null;
  /** Force refetch — shows loading state. Use for explicit refresh button. */
  refetchBatch: () => void;
  /** Silent background refetch — no loading state. Use after write operations. */
  silentRefetchBatch: () => void;
  /** The clientSheetId used for batch (if any) */
  batchClientSheetId: string | null;
}

const BatchDataContext = createContext<BatchDataContextValue>({
  batchData: null,
  batchEnabled: false,
  batchLoading: false,
  batchError: null,
  refetchBatch: () => {},
  silentRefetchBatch: () => {},
  batchClientSheetId: null,
});

const BATCH_CACHE_KEY = 'batch';

export function BatchDataProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [batchData, setBatchData] = useState<BatchResponse | null>(null);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Client users pass their clientSheetId; multi-client/parent clients pass '' (server scopes via access list); staff/admin pass '' (all)
  const isMultiClient = (user?.accessibleClientSheetIds?.length ?? 0) > 1 || user?.isParent;
  const clientSheetId = (user?.role === 'client' && !isMultiClient) ? (user?.clientSheetId || '') : '';
  // Only use getBatch for single-client users — staff/admin/parent users take 30-60s cold.
  // Staff/admin/parent load entity pages on-demand (select-a-client pattern) and use getBatchSummary for Dashboard.
  const batchEnabled = !!user && isApiConfigured()
    && user.role === 'client'
    && !user.isParent
    && (user.accessibleClientSheetIds?.length ?? 0) <= 1;

  const doFetch = useCallback((bypassCache = false, serverNoCache = false, silent = false) => {
    if (!isApiConfigured()) return;

    const cacheKey = `${BATCH_CACHE_KEY}:${clientSheetId || 'all'}`;

    // Check client-side cache first
    if (!bypassCache) {
      const cached = cacheGet<BatchResponse>(cacheKey);
      if (cached) {
        setBatchData(cached);
        setBatchLoading(false);
        return;
      }
    }

    // Abort previous request
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Silent mode: don't show loading spinner (used for post-write background refresh)
    if (!silent) setBatchLoading(true);
    setBatchError(null);

    fetchBatch(clientSheetId, controller.signal, serverNoCache)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.ok && result.data) {
          setBatchData(result.data);
          setBatchError(null);
          cacheSet(cacheKey, result.data);
        } else {
          setBatchError(result.error || 'Batch fetch failed');
        }
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setBatchError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setBatchLoading(false);
        }
      });
  }, [clientSheetId]);

  useEffect(() => {
    if (batchEnabled) {
      // Check cache first
      const cacheKey = `${BATCH_CACHE_KEY}:${clientSheetId || 'all'}`;
      const cached = cacheGet<BatchResponse>(cacheKey);
      if (cached) {
        setBatchData(cached);
        // Still do a background refresh (silent — cached data already shown)
        doFetch(true, false, true);
      } else {
        doFetch();
      }
    }

    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchEnabled, clientSheetId]);

  /** Explicit refetch — shows loading state. For refresh buttons. */
  const refetchBatch = useCallback(() => doFetch(true, true, false), [doFetch]);
  /** Silent background refetch — no loading state. For post-write cache sync. */
  const silentRefetchBatch = useCallback(() => doFetch(true, true, true), [doFetch]);

  // Subscribe to entityEvents when batchEnabled — silent refetch after any confirmed write
  useEffect(() => {
    if (!batchEnabled) return;
    return entityEvents.subscribe(() => {
      silentRefetchBatch();
    });
  }, [batchEnabled, silentRefetchBatch]);

  return (
    <BatchDataContext.Provider value={{
      batchData,
      batchEnabled,
      batchLoading,
      batchError,
      refetchBatch,
      silentRefetchBatch,
      batchClientSheetId: clientSheetId,
    }}>
      {children}
    </BatchDataContext.Provider>
  );
}

export function useBatchData() {
  return useContext(BatchDataContext);
}
