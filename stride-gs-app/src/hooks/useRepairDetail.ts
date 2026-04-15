/**
 * useRepairDetail.ts — Single-repair fetch hook for standalone detail page.
 * Fetches one repair from Supabase (~50ms) with legacy GAS fallback.
 * Mirrors useTaskDetail pattern.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { fetchRepairByIdFromSupabase } from '../lib/supabaseQueries';
import { fetchRepairById } from '../lib/api';
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
  const [repair, setRepair] = useState<ApiRepair | null>(null);
  const [status, setStatus] = useState<RepairDetailStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<'supabase' | 'legacy' | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fetchCountRef = useRef(0);

  const fetchRepair = useCallback(async () => {
    if (!repairId || !user) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const fetchId = ++fetchCountRef.current;

    setStatus('loading');
    setError(null);

    try {
      // Step 1: Try Supabase (fast path)
      const sbRepair = await fetchRepairByIdFromSupabase(repairId);

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
              setRepair({ ...gasResp.data.repair, clientSheetId: sbRepair.clientSheetId });
              setSource('legacy');
              setStatus('loaded');
              return;
            }
          } catch {
            // GAS failed — use Supabase data as-is
          }
        }

        setRepair(sbRepair);
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
