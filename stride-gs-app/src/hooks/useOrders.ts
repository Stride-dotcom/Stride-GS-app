/**
 * useOrders — Fetches DispatchTrack orders from Supabase.
 * Supabase-only (no GAS fallback — DT data never comes from Apps Script).
 * Phase 1b: read-only, admin only.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { fetchDtOrdersFromSupabase, isSupabaseCacheAvailable } from '../lib/supabaseQueries';
import type { DtOrderForUI, ClientNameMap } from '../lib/supabaseQueries';
import { useClients } from './useClients';
import { useClientFilter } from './useClientFilter';
import { entityEvents } from '../lib/entityEvents';

export type { DtOrderForUI };

export interface UseOrdersResult {
  orders: DtOrderForUI[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
  lastFetched: Date | null;
}

export function useOrders(): UseOrdersResult {
  const [orders, setOrders] = useState<DtOrderForUI[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const hasFetched = useRef(false);
  const { clients } = useClients();
  const clientSheetId = useClientFilter();

  const clientNameMap = useMemo<ClientNameMap>(() => {
    const map: ClientNameMap = {};
    for (const c of clients) { map[c.id] = c.name; }
    return map;
  }, [clients]);

  const doFetch = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    if (!hasFetched.current) setLoading(true);
    setError(null);

    try {
      const available = await isSupabaseCacheAvailable();
      if (!available) {
        setError('Supabase connection unavailable');
        return;
      }

      const result = await fetchDtOrdersFromSupabase(clientNameMap, clientSheetId);
      if (ctrl.signal.aborted) return;
      if (result !== null) {
        setOrders(result);
        setLastFetched(new Date());
        hasFetched.current = true;
      } else {
        setError('Failed to load orders');
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, [clientNameMap, clientSheetId]);

  useEffect(() => {
    doFetch();
    return () => { abortRef.current?.abort(); };
  }, [doFetch]);

  const refetch = useCallback(() => { doFetch(); }, [doFetch]);

  // Phase 2 (Realtime): refetch when another tab writes a DT order.
  useEffect(() => {
    return entityEvents.subscribe((type) => {
      if (type === 'order') doFetch();
    });
  }, [doFetch]);

  return { orders, loading, error, refetch, lastFetched };
}
