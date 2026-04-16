/**
 * useRepairDetail.ts — Single-repair fetch hook for standalone detail page.
 * Fetches one repair from Supabase (~50ms) with legacy GAS fallback.
 * Mirrors useTaskDetail pattern.
 *
 * Session 70 fix #9: thread clientNameMap through Supabase fetch; fall back to
 * inventory for sidemark/vendor/description when both Supabase and GAS are sparse.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  fetchRepairByIdFromSupabase,
  fetchItemsByIdsFromSupabase,
  type ClientNameMap,
} from '../lib/supabaseQueries';
import { fetchRepairById } from '../lib/api';
import { useClients } from './useClients';
import type { ApiRepair } from '../lib/api';

export type RepairDetailStatus = 'loading' | 'loaded' | 'not-found' | 'access-denied' | 'error';

export interface UseRepairDetailResult {
  repair: ApiRepair | null;
  status: RepairDetailStatus;
  error: string | null;
  source: 'supabase' | 'legacy' | null;
  refetch: () => void;
}

export function useRepairDetail(repairId: string | undefined): UseRepairDetailResult {
  const { user } = useAuth();
  const { clients } = useClients();
  const [repair, setRepair] = useState<ApiRepair | null>(null);
  const [status, setStatus] = useState<RepairDetailStatus>('loading');
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

  const fetchRepair = useCallback(async () => {
    if (!repairId || !user) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const fetchId = ++fetchCountRef.current;

    setStatus('loading');
    setError(null);

    try {
      // Step 1: Try Supabase (fast path) — pass map for client-name fallback
      const sbRepair = await fetchRepairByIdFromSupabase(repairId, clientNameMapRef.current);

      if (controller.signal.aborted || fetchId !== fetchCountRef.current) return;

      if (sbRepair) {
        if (!hasAccess(user, sbRepair.clientSheetId)) {
          setStatus('access-denied');
          return;
        }

        // Supabase repair has sparse fields — enrich from GAS for full data
        if (sbRepair.clientSheetId) {
          try {
            const gasResp = await fetchRepairById(repairId, sbRepair.clientSheetId, controller.signal);
            if (fetchId !== fetchCountRef.current) return;
            if (gasResp.ok && gasResp.data?.success && gasResp.data.repair) {
              const gasRepair = gasResp.data.repair;
              // Merge: GAS is authoritative where it has values, Supabase fills the rest
              // (clientName, sidemark from clientNameMap/Supabase fallback)
              const merged = {
                ...sbRepair,
                ...gasRepair,
                clientSheetId: sbRepair.clientSheetId,
                clientName: gasRepair.clientName || sbRepair.clientName,
              };
              setRepair(merged);
              setSource('legacy');
              setStatus('loaded');
              maybeEnrichFromInventory(merged, fetchId, fetchCountRef, setRepair, clientNameMapRef.current);
              return;
            }
          } catch {
            // GAS failed — use Supabase data as-is
          }
        }

        setRepair(sbRepair);
        setSource('supabase');
        setStatus('loaded');
        maybeEnrichFromInventory(sbRepair, fetchId, fetchCountRef, setRepair, clientNameMapRef.current);
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
          const result = await fetchRepairById(repairId, clientSheetId, controller.signal);
          if (result.ok && result.data?.success && result.data.repair) {
            if (fetchId !== fetchCountRef.current) return;
            if (!hasAccess(user, clientSheetId)) {
              setStatus('access-denied');
              return;
            }
            setRepair({ ...result.data.repair, clientSheetId });
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
      setError(err instanceof Error ? err.message : 'Failed to load repair');
      setStatus('error');
    }
  }, [repairId, user]);

  useEffect(() => {
    fetchRepair();
    return () => { abortRef.current?.abort(); };
  }, [fetchRepair]);

  return { repair, status, error, source, refetch: fetchRepair };
}

function hasAccess(user: NonNullable<ReturnType<typeof useAuth>['user']>, clientSheetId: string): boolean {
  if (user.role === 'admin' || user.role === 'staff') return true;
  return user.accessibleClientSheetIds.includes(clientSheetId);
}

/** Session 70 fix #9: fall back to inventory for sparse repair fields. */
function maybeEnrichFromInventory(
  repair: ApiRepair,
  fetchId: number,
  fetchCountRef: React.MutableRefObject<number>,
  setRepair: React.Dispatch<React.SetStateAction<ApiRepair | null>>,
  clientNameMap: ClientNameMap,
) {
  const needs = !repair.sidemark || !repair.clientName || !repair.vendor || !repair.description;
  if (!needs || !repair.itemId) return;
  fetchItemsByIdsFromSupabase([repair.itemId], clientNameMap)
    .then(items => {
      if (fetchId !== fetchCountRef.current) return;
      const inv = items?.find(x => x.tenantId === repair.clientSheetId) || items?.[0];
      if (!inv) return;
      setRepair(prev => prev ? {
        ...prev,
        sidemark: prev.sidemark || inv.sidemark || '',
        clientName: prev.clientName || inv.clientName || '',
        vendor: prev.vendor || inv.vendor || '',
        description: prev.description || inv.description || '',
        location: prev.location || inv.location || '',
        itemClass: prev.itemClass || inv.itemClass || '',
      } : prev);
    })
    .catch(() => {});
}
