/**
 * useWillCallDetail.ts — Single-will-call fetch hook for standalone detail page.
 * Fetches one WC from Supabase (~50ms) with legacy GAS fallback.
 * Mirrors useTaskDetail pattern.
 *
 * Session 70 fix #9: thread clientNameMap through Supabase fetch for deep-link client resolution.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { fetchWillCallByIdFromSupabase, type ClientNameMap } from '../lib/supabaseQueries';
import { fetchWillCallById } from '../lib/api';
import { useClients } from './useClients';
import type { ApiWillCall } from '../lib/api';

export type WillCallDetailStatus = 'loading' | 'loaded' | 'not-found' | 'access-denied' | 'error';

export interface UseWillCallDetailResult {
  wc: ApiWillCall | null;
  status: WillCallDetailStatus;
  error: string | null;
  source: 'supabase' | 'legacy' | null;
  refetch: () => void;
}

export function useWillCallDetail(wcNumber: string | undefined): UseWillCallDetailResult {
  const { user } = useAuth();
  const { clients } = useClients();
  const [wc, setWc] = useState<ApiWillCall | null>(null);
  const [status, setStatus] = useState<WillCallDetailStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<'supabase' | 'legacy' | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fetchCountRef = useRef(0);

  const clientNameMap = useMemo<ClientNameMap>(() => {
    const map: ClientNameMap = {};
    for (const c of clients) { map[c.id] = c.name; }
    return map;
  }, [clients]);
  const clientNameMapRef = useRef(clientNameMap);
  clientNameMapRef.current = clientNameMap;

  const fetchWc = useCallback(async () => {
    if (!wcNumber || !user) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const fetchId = ++fetchCountRef.current;

    setStatus('loading');
    setError(null);

    try {
      // Step 1: Try Supabase (fast path) — pass map for client-name fallback
      const sbWc = await fetchWillCallByIdFromSupabase(wcNumber, clientNameMapRef.current);

      if (controller.signal.aborted || fetchId !== fetchCountRef.current) return;

      if (sbWc) {
        if (!hasAccess(user, sbWc.clientSheetId)) {
          setStatus('access-denied');
          return;
        }

        // Supabase WC has no items — always enrich from GAS
        if (sbWc.clientSheetId) {
          try {
            const gasResp = await fetchWillCallById(wcNumber, sbWc.clientSheetId, controller.signal);
            if (fetchId !== fetchCountRef.current) return;
            if (gasResp.ok && gasResp.data?.success && gasResp.data.willCall) {
              const gasWc = gasResp.data.willCall;
              setWc({
                ...gasWc,
                clientSheetId: sbWc.clientSheetId,
                clientName: gasWc.clientName || sbWc.clientName,
              });
              setSource('legacy');
              setStatus('loaded');
              return;
            }
          } catch {
            // GAS failed — use Supabase data as-is (no items but better than nothing)
          }
        }

        setWc(sbWc);
        setSource('supabase');
        setStatus('loaded');
        return;
      }

      // Step 2: Supabase miss — fallback to legacy API (scan accessible clients)
      const accessibleIds = user.role === 'admin' || user.role === 'staff'
        ? user.accessibleClientSheetIds
        : user.clientSheetId
          ? [user.clientSheetId, ...user.childClientSheetIds]
          : [];

      for (const clientSheetId of accessibleIds) {
        if (controller.signal.aborted) return;
        try {
          const result = await fetchWillCallById(wcNumber, clientSheetId, controller.signal);
          if (result.ok && result.data?.success && result.data.willCall) {
            if (fetchId !== fetchCountRef.current) return;
            if (!hasAccess(user, clientSheetId)) {
              setStatus('access-denied');
              return;
            }
            setWc({ ...result.data.willCall, clientSheetId });
            setSource('legacy');
            setStatus('loaded');
            return;
          }
        } catch {
          // Not found on this client, try next
        }
      }

      if (controller.signal.aborted || fetchId !== fetchCountRef.current) return;
      setStatus('not-found');
    } catch (err) {
      if (controller.signal.aborted || fetchId !== fetchCountRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load will call');
      setStatus('error');
    }
  }, [wcNumber, user]);

  useEffect(() => {
    fetchWc();
    return () => { abortRef.current?.abort(); };
  }, [fetchWc]);

  return { wc, status, error, source, refetch: fetchWc };
}

function hasAccess(user: NonNullable<ReturnType<typeof useAuth>['user']>, clientSheetId: string): boolean {
  if (user.role === 'admin' || user.role === 'staff') return true;
  return user.accessibleClientSheetIds.includes(clientSheetId);
}
