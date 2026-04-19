import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { fetchBatchSummary, setNextFetchNoCache } from '../lib/api';
import { entityEvents } from '../lib/entityEvents';
import type { SummaryTask, SummaryRepair, SummaryWillCall } from '../lib/api';
import { fetchDashboardSummaryFromSupabase, isSupabaseCacheAvailable } from '../lib/supabaseQueries';
import type { ClientNameMap } from '../lib/supabaseQueries';
import { useClients } from './useClients';
import { useAuth } from '../contexts/AuthContext';

export type { SummaryTask, SummaryRepair, SummaryWillCall };

export interface UseDashboardSummaryResult {
  tasks: SummaryTask[];
  repairs: SummaryRepair[];
  willCalls: SummaryWillCall[];
  loading: boolean;
  error: string | null;
  refetch: (noCache?: boolean) => void;
  lastFetched: Date | null;
}

export function useDashboardSummary(autoFetch = true): UseDashboardSummaryResult {
  const [tasks, setTasks] = useState<SummaryTask[]>([]);
  const [repairs, setRepairs] = useState<SummaryRepair[]>([]);
  const [willCalls, setWillCalls] = useState<SummaryWillCall[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const hasFetched = useRef(false);
  const { clients } = useClients();
  const { user } = useAuth();

  // For client-role users, only include their accessible tenants
  const tenantFilter = useMemo<string[] | undefined>(() => {
    if (!user || user.role === 'admin' || user.role === 'staff') return undefined; // no filter
    return user.accessibleClientSheetIds || [];
  }, [user]);

  const clientNameMap = useMemo<ClientNameMap>(() => {
    const map: ClientNameMap = {};
    for (const c of clients) { map[c.id] = c.name; }
    return map;
  }, [clients]);

  // Session 72: keep clientNameMap off the doFetch dep list. clients array
  // identity churns as useClients settles on cold load, which was re-creating
  // doFetch and re-firing the mount effect — producing 2-3 overlapping
  // inventory paginations inside fetchDashboardSummaryFromSupabase.
  const clientNameMapRef = useRef(clientNameMap);
  clientNameMapRef.current = clientNameMap;
  const tenantFilterRef = useRef(tenantFilter);
  tenantFilterRef.current = tenantFilter;

  const doFetch = useCallback(async (noCache = false) => {
    // Abort any in-flight request
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    if (!hasFetched.current) setLoading(true);
    setError(null);

    try {
      // Session 71: After any entity write, skip Supabase and go to GAS for fresh data
      const skipSb = entityEvents.shouldSkipSupabase('task')
        || entityEvents.shouldSkipSupabase('repair')
        || entityEvents.shouldSkipSupabase('will_call');

      // Try Supabase read cache first (50-100ms vs 3-44s)
      if (!skipSb && !noCache && await isSupabaseCacheAvailable()) {
        const sbResult = await fetchDashboardSummaryFromSupabase(clientNameMapRef.current, tenantFilterRef.current);
        if (sbResult && !ctrl.signal.aborted) {
          setTasks(sbResult.tasks || []);
          setRepairs(sbResult.repairs || []);
          setWillCalls(sbResult.willCalls || []);
          setLastFetched(new Date());
          hasFetched.current = true;
          setLoading(false);
          return;
        }
      }

      // Fall back to GAS API (or forced by skipSb/noCache)
      if (skipSb) setNextFetchNoCache();
      const resp = await fetchBatchSummary(ctrl.signal, noCache || skipSb);
      if (ctrl.signal.aborted) return;
      if (resp.ok && resp.data) {
        setTasks(resp.data.tasks || []);
        setRepairs(resp.data.repairs || []);
        setWillCalls(resp.data.willCalls || []);
        setLastFetched(new Date());
        hasFetched.current = true;
      } else if (!resp.ok) {
        setError(resp.error || 'Failed to load dashboard data');
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Initial fetch
  useEffect(() => {
    if (!autoFetch) return;
    doFetch(false);
    return () => { abortRef.current?.abort(); };
  }, [autoFetch, doFetch]);

  // Session 71: Auto-refresh dashboard when any entity is written
  useEffect(() => {
    return entityEvents.subscribe((type) => {
      if (type === 'task' || type === 'repair' || type === 'will_call' || type === 'inventory') {
        doFetch(false);
      }
    });
  }, [doFetch]);

  const refetch = useCallback((noCache = false) => {
    if (noCache) setNextFetchNoCache();
    doFetch(noCache);
  }, [doFetch]);

  return { tasks, repairs, willCalls, loading, error, refetch, lastFetched };
}
