/**
 * useItemDetail.ts — Single-item fetch hook for standalone ItemPage route.
 * Fetches one inventory item by ID from Supabase (~50ms).
 * No GAS legacy fallback — item IDs are always present in Supabase once received.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { fetchItemByIdFromSupabase, type ClientNameMap } from '../lib/supabaseQueries';
import { useClients } from './useClients';
import type { ApiInventoryItem } from '../lib/api';

export type ItemDetailStatus = 'loading' | 'loaded' | 'not-found' | 'access-denied' | 'error';

export interface UseItemDetailResult {
  item: ApiInventoryItem | null;
  status: ItemDetailStatus;
  error: string | null;
  refetch: () => void;
}

export function useItemDetail(itemId: string | undefined): UseItemDetailResult {
  const { user } = useAuth();
  const { clients } = useClients();
  const [item, setItem] = useState<ApiInventoryItem | null>(null);
  const [status, setStatus] = useState<ItemDetailStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const fetchCountRef = useRef(0);

  const clientNameMap = useMemo<ClientNameMap>(() => {
    const map: ClientNameMap = {};
    for (const c of clients) { map[c.id] = c.name; }
    return map;
  }, [clients]);
  const clientNameMapRef = useRef(clientNameMap);
  clientNameMapRef.current = clientNameMap;

  const fetchItem = useCallback(async () => {
    if (!itemId || !user) return;

    const seq = ++fetchCountRef.current;
    setStatus('loading');
    setError(null);

    try {
      // Scope the lookup to the user's accessible tenants when they're a
      // client. After a transfer, the same item_id has TWO rows in
      // `inventory` (Transferred under the source tenant, Active under the
      // destination). Without this scope, the unordered fetch can return
      // the source-tenant row, whose tenant the user doesn't have access
      // to — producing a spurious Access Denied. Staff/admin pass
      // undefined and see whichever row is current.
      const tenantScope = user.role === 'client'
        ? user.accessibleClientSheetIds
        : undefined;
      const result = await fetchItemByIdFromSupabase(itemId, clientNameMapRef.current, tenantScope);
      if (seq !== fetchCountRef.current) return; // stale

      if (!result) {
        setStatus('not-found');
        return;
      }

      // Defense in depth — even with tenantScope applied, double-check the
      // returned row's tenant against the user's accessible list. Catches
      // any future regression where the scope param is dropped.
      if (user.role === 'client' && !user.accessibleClientSheetIds.includes(result.clientSheetId)) {
        setStatus('access-denied');
        return;
      }

      setItem(result);
      setStatus('loaded');
    } catch (e) {
      if (seq !== fetchCountRef.current) return;
      setError(e instanceof Error ? e.message : 'Unknown error');
      setStatus('error');
    }
  }, [itemId, user]);

  // Re-fetch when clientNameMap loads (client name may resolve on second pass)
  useEffect(() => {
    fetchItem();
  }, [fetchItem, clients.length]); // clients.length triggers refetch once clients load

  return { item, status, error, refetch: fetchItem };
}
