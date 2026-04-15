/**
 * useTaskDetail.ts — Single-task fetch hook for standalone task detail page.
 * Fetches one task by ID from Supabase (fast), falls back to legacy API.
 * Also fetches related repairs for the same item.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { fetchTaskByIdFromSupabase, fetchRepairsByItemIdFromSupabase } from '../lib/supabaseQueries';
import { fetchTaskById } from '../lib/api';
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
  const [task, setTask] = useState<ApiTask | null>(null);
  const [relatedRepairs, setRelatedRepairs] = useState<ApiRepair[]>([]);
  const [status, setStatus] = useState<TaskDetailStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<'supabase' | 'legacy' | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fetchCountRef = useRef(0);

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
      // Step 1: Try Supabase (fast path)
      const sbTask = await fetchTaskByIdFromSupabase(taskId);

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
