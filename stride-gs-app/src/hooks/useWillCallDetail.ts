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
import { entityEvents } from '../lib/entityEvents';
import type { ApiWillCall } from '../lib/api';

export type WillCallDetailStatus = 'loading' | 'loaded' | 'not-found' | 'access-denied' | 'error';

export interface UseWillCallDetailResult {
  wc: ApiWillCall | null;
  status: WillCallDetailStatus;
  error: string | null;
  source: 'supabase' | 'legacy' | null;
  refetch: (opts?: { silent?: boolean }) => void;
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

  // `silent: true` skips flipping status back to 'loading' — used for
  // realtime-echo refetches so the page doesn't unmount the detail panel
  // (and lose scroll position / open sub-tab state) on every save.
  const fetchWc = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!wcNumber || !user) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const fetchId = ++fetchCountRef.current;

    if (!silent) setStatus('loading');
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

        // Supabase already populates wc.items via fetchWillCallByIdFromSupabase's
        // legacy itemIds + inventory overlay branch — no GAS roundtrip needed.
        // Pre-2026-05-06 this was followed by a fire-and-forget fetchWillCallById
        // which (a) added 2-5s of latency on every page open and (b) periodically
        // clobbered the Supabase wc with GAS data, sometimes wiping items back
        // to []. The detail panel has its own enrichment safety net
        // (fetchWcItemsFromSupabase by itemIds) for the rare case where Supabase
        // items came back empty, so the GAS roundtrip here was pure cost.
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

  // Realtime: refetch when this will-call is updated cross-tab/cross-user.
  // Silent so the panel stays mounted (no scroll/tab state loss) — see
  // useTaskDetail for full rationale.
  useEffect(() => {
    if (!wcNumber) return;
    return entityEvents.subscribe((type, id) => {
      if (type === 'will_call' && id === wcNumber) void fetchWc({ silent: true });
    });
  }, [wcNumber, fetchWc]);

  return { wc, status, error, source, refetch: fetchWc };
}

function hasAccess(user: NonNullable<ReturnType<typeof useAuth>['user']>, clientSheetId: string): boolean {
  if (user.role === 'admin' || user.role === 'staff') return true;
  return user.accessibleClientSheetIds.includes(clientSheetId);
}
