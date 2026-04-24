import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { fetchDtOrderByIdFromSupabase, type DtOrderForUI, type ClientNameMap } from '../lib/supabaseQueries';
import { useClients } from './useClients';

export type OrderDetailStatus = 'loading' | 'loaded' | 'not-found' | 'error';

export interface UseOrderDetailResult {
  order: DtOrderForUI | null;
  status: OrderDetailStatus;
  error: string | null;
  refetch: () => void;
}

export function useOrderDetail(orderId: string | undefined): UseOrderDetailResult {
  const { clients } = useClients();
  const [order, setOrder] = useState<DtOrderForUI | null>(null);
  const [status, setStatus] = useState<OrderDetailStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fetchCountRef = useRef(0);

  // Keep a stable ref so the fetch callback doesn't re-create when clients load
  const clientNameMap = useMemo<ClientNameMap>(() => {
    const map: ClientNameMap = {};
    for (const c of clients) map[c.id] = c.name;
    return map;
  }, [clients]);
  const clientNameMapRef = useRef(clientNameMap);
  clientNameMapRef.current = clientNameMap;

  const fetchOrder = useCallback(async () => {
    if (!orderId) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const fetchId = ++fetchCountRef.current;

    setStatus('loading');
    setError(null);

    try {
      const result = await fetchDtOrderByIdFromSupabase(orderId, clientNameMapRef.current);
      if (controller.signal.aborted || fetchId !== fetchCountRef.current) return;
      if (!result) {
        setStatus('not-found');
        return;
      }
      setOrder(result);
      setStatus('loaded');
    } catch (err) {
      if (controller.signal.aborted || fetchId !== fetchCountRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load order');
      setStatus('error');
    }
  }, [orderId]);

  useEffect(() => {
    fetchOrder();
    return () => { abortRef.current?.abort(); };
  }, [fetchOrder]);

  return { order, status, error, refetch: fetchOrder };
}
