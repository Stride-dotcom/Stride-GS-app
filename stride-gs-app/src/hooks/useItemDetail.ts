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
      const result = await fetchItemByIdFromSupabase(itemId, clientNameMapRef.current);
      if (seq !== fetchCountRef.current) return; // stale

      if (!result) {
        setStatus('not-found');
        return;
      }

      // Access check — client role can only see items in their own tenant
      if (user.role === 'client' && user.clientSheetId && result.clientSheetId !== user.clientSheetId) {
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
