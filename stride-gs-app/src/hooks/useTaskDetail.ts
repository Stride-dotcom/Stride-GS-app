/**
 * useTaskDetail.ts — Single-task fetch hook for standalone task detail page.
 * Fetches one task by ID from Supabase (fast), falls back to legacy API.
 * Also fetches related repairs for the same item.
 *
 * Session 70 fix #9: thread clientNameMap through Supabase fetcher so deep-link
 * opens resolve clientName from tenant_id when the row's client_name is null.
 * Additionally, when Supabase task row has no sidemark, fall back to inventory.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  fetchTaskByIdFromSupabase,
  fetchRepairsByItemIdFromSupabase,
  fetchItemsByIdsFromSupabase,
  type ClientNameMap,
} from '../lib/supabaseQueries';
import { fetchTaskById } from '../lib/api';
import { useClients } from './useClients';
import type { ApiTask, ApiRepair } from '../lib/api';

export type TaskDetailStatus = 'loading' | 'loaded' | 'not-found' | 'access-denied' | 'error';

export interface UseTaskDetailResult {
  task: ApiTask | null;
  relatedRepairs: ApiRepair[];
  status: TaskDetailStatus;
  error: string | null;
  source: 'supabase' | 'legacy' | null;
  refetch: () => void;
}

export function useTaskDetail(taskId: string | undefined): UseTaskDetailResult {
  const { user } = useAuth();
  const { clients } = useClients();
  const [task, setTask] = useState<ApiTask | null>(null);
  const [relatedRepairs, setRelatedRepairs] = useState<ApiRepair[]>([]);
  const [status, setStatus] = useState<TaskDetailStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<'supabase' | 'legacy' | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fetchCountRef = useRef(0);

  // Build clientNameMap to resolve client names from tenant_id on Supabase rows
  // whose client_name column is null (historical tasks).
  const clientNameMap = useMemo<ClientNameMap>(() => {
    const map: ClientNameMap = {};
    for (const c of clients) { map[c.id] = c.name; }
    return map;
  }, [clients]);
  const clientNameMapRef = useRef(clientNameMap);
  clientNameMapRef.current = clientNameMap;

  const fetchTask = useCallback(async () => {
    if (!taskId || !user) return;

    // Abort previous in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const fetchId = ++fetchCountRef.current;

    setStatus('loading');
    setError(null);

    try {
      // Step 1: Try Supabase (fast path) — pass map for client-name fallback
      const sbTask = await fetchTaskByIdFromSupabase(taskId, clientNameMapRef.current);

      if (controller.signal.aborted || fetchId !== fetchCountRef.current) return;

      if (sbTask) {
        // Check tenant access
        if (!hasAccess(user, sbTask.clientSheetId)) {
          setStatus('access-denied');
          return;
        }
        setTask(sbTask);
        setSource('supabase');
        setStatus('loaded');

        // Session 70 fix #9: if sidemark / clientName still empty, fall back to
        // inventory for the same itemId. Many historical task rows have null
        // sidemark / client_name on the Supabase side.
        const needsFallback = !sbTask.sidemark || !sbTask.clientName || !sbTask.vendor || !sbTask.description;
        if (needsFallback && sbTask.itemId) {
          fetchItemsByIdsFromSupabase([sbTask.itemId], clientNameMapRef.current)
            .then(items => {
              if (fetchId !== fetchCountRef.current) return;
              const inv = items?.find(x => x.tenantId === sbTask.clientSheetId) || items?.[0];
              if (!inv) return;
              setTask(prev => prev ? {
                ...prev,
                sidemark: prev.sidemark || inv.sidemark || '',
                clientName: prev.clientName || inv.clientName || '',
                vendor: prev.vendor || inv.vendor || '',
                description: prev.description || inv.description || '',
                location: prev.location || inv.location || '',
              } : prev);
            })
            .catch(() => {}); // best-effort
        }

        // Fetch related repairs
        if (sbTask.itemId && sbTask.clientSheetId) {
          fetchRepairsByItemIdFromSupabase(sbTask.itemId, sbTask.clientSheetId)
            .then(repairs => {
              if (fetchId === fetchCountRef.current) setRelatedRepairs(repairs);
            });
        }

        // Background enrichment: if task is started but Supabase has no folder URL,
        // fetch from GAS which reads hyperlinks (covers tasks started before resync fix)
        const isStarted = sbTask.status === 'In Progress' || sbTask.status === 'Completed';
        if (isStarted && !sbTask.taskFolderUrl && sbTask.clientSheetId) {
          fetchTaskById(taskId, sbTask.clientSheetId)
            .then(gasResp => {
              if (fetchId !== fetchCountRef.current) return;
              if (gasResp.data?.success && gasResp.data.task?.taskFolderUrl) {
                setTask(prev => prev ? { ...prev, taskFolderUrl: gasResp.data!.task!.taskFolderUrl } : prev);
              }
            })
            .catch(() => {}); // best-effort, non-blocking
        }
        return;
      }

      // Step 2: Supabase miss — fallback to legacy API (scan accessible clients)
      const accessibleIds = user.role === 'admin' || user.role === 'staff'
        ? user.accessibleClientSheetIds
        : user.clientSheetId
          ? [user.clientSheetId, ...user.childClientSheetIds]
          : [];

      let legacyTask: ApiTask | null = null;
      for (const clientSheetId of accessibleIds) {
        if (controller.signal.aborted) return;
        try {
          const result = await fetchTaskById(taskId, clientSheetId, controller.signal);
          if (result.data?.success && result.data.task) {
            legacyTask = { ...result.data.task, clientSheetId };
            break;
          }
        } catch {
          // Not found on this client, try next
        }
      }

      if (controller.signal.aborted || fetchId !== fetchCountRef.current) return;

      if (legacyTask) {
        if (!hasAccess(user, legacyTask.clientSheetId)) {
          setStatus('access-denied');
          return;
        }
        setTask(legacyTask);
        setSource('legacy');
        setStatus('loaded');

        // Fetch related repairs from Supabase
        if (legacyTask.itemId && legacyTask.clientSheetId) {
          fetchRepairsByItemIdFromSupabase(legacyTask.itemId, legacyTask.clientSheetId)
            .then(repairs => {
              if (fetchId === fetchCountRef.current) setRelatedRepairs(repairs);
            });
        }
        return;
      }

      // Neither found
      setStatus('not-found');
    } catch (err) {
      if (controller.signal.aborted || fetchId !== fetchCountRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load task');
      setStatus('error');
    }
  }, [taskId, user]);

  useEffect(() => {
    fetchTask();
    return () => { abortRef.current?.abort(); };
  }, [fetchTask]);

  return { task, relatedRepairs, status, error, source, refetch: fetchTask };
}

function hasAccess(user: NonNullable<ReturnType<typeof useAuth>['user']>, clientSheetId: string): boolean {
  if (user.role === 'admin' || user.role === 'staff') return true;
  return user.accessibleClientSheetIds.includes(clientSheetId);
}
