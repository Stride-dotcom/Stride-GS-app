/**
 * useTasks — Fetches tasks from the Stride API.
 *
 * Performance: checks BatchDataContext first (client users get all data in 1 call).
 * Falls back to individual API call for staff/admin users or when batch is unavailable.
 *
 * Phase 2C: optimistic patch architecture added.
 * - applyTaskPatch: replace patch for an entity (status changes, atomic ops)
 * - mergeTaskPatch: accumulate fields into patch (multi-field blur-triggered saves)
 * - clearTaskPatch: remove patch, server data takes over
 * - addOptimisticTask / removeOptimisticTask: temp entities for create ops
 * Patches auto-expire after 120s (guarded in useMemo merge).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchTasks, setNextFetchNoCache } from '../lib/api';
import type { ApiTask, TasksResponse } from '../lib/api';
import type { Task, TaskStatus, ServiceCode } from '../lib/types';
import { useApiData } from './useApiData';
import { useClientFilter } from './useClientFilter';
import { useBatchData } from '../contexts/BatchDataContext';
import { useClients } from './useClients';
import { entityEvents } from '../lib/entityEvents';
import { fetchTasksFromSupabase, isSupabaseCacheAvailable } from '../lib/supabaseQueries';
import type { ClientNameMap } from '../lib/supabaseQueries';

export interface UseTasksResult {
  apiTasks: ApiTask[];
  tasks: Task[];
  count: number;
  clientsQueried: number;
  errors?: { client: string; error: string }[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
  lastFetched: Date | null;
  // Phase 2C — optimistic patch functions
  applyTaskPatch: (taskId: string, patch: Partial<Task>) => void;
  mergeTaskPatch: (taskId: string, patch: Partial<Task>) => void;
  clearTaskPatch: (taskId: string) => void;
  addOptimisticTask: (task: Task) => void;
  removeOptimisticTask: (tempTaskId: string) => void;
}

const VALID_STATUSES: TaskStatus[] = ['Open', 'In Progress', 'Completed', 'Cancelled'];
const VALID_SVC_CODES: ServiceCode[] = ['RCVG', 'INSP', 'ASM', 'REPAIR', 'STOR', 'DLVR', 'WCPU', 'OTHER'];
const PATCH_TTL_MS = 120_000; // 120 seconds

function mapToAppTask(api: ApiTask): Task {
  const status = VALID_STATUSES.includes(api.status as TaskStatus)
    ? (api.status as TaskStatus)
    : 'Open';

  const svcCode = VALID_SVC_CODES.includes(api.svcCode as ServiceCode)
    ? (api.svcCode as ServiceCode)
    : 'OTHER';

  return {
    taskId: api.taskId,
    type: svcCode,
    status,
    itemId: api.itemId,
    clientId: api.clientSheetId,
    clientSheetId: api.clientSheetId,
    clientName: api.clientName,
    vendor: api.vendor || undefined,
    description: api.description,
    location: api.location || undefined,
    sidemark: api.sidemark || undefined,
    assignedTo: api.assignedTo || undefined,
    created: api.created,
    dueDate: api.dueDate || undefined,
    priority: (api.priority === 'High' ? 'High' : 'Normal') as 'High' | 'Normal',
    startedAt: api.startedAt || undefined,
    completedAt: api.completedAt || undefined,
    cancelledAt: api.cancelledAt || undefined,
    result: (api.result === 'Pass' || api.result === 'Fail') ? api.result : undefined,
    taskNotes: api.taskNotes || undefined,
    svcCode,
    billed: api.billed,
    customPrice: api.customPrice != null ? Number(api.customPrice) : undefined,
    taskFolderUrl: api.taskFolderUrl || undefined,
    shipmentFolderUrl: api.shipmentFolderUrl || undefined,
  };
}

export function useTasks(autoFetch = true, filterClientSheetId?: string | string[]): UseTasksResult {
  const clientFilter = useClientFilter();
  const clientSheetId = clientFilter ?? filterClientSheetId;
  const { batchData, batchEnabled, batchLoading, batchError, silentRefetchBatch } = useBatchData();
  const { clients } = useClients();

  const clientNameMap = useMemo<ClientNameMap>(() => {
    const map: ClientNameMap = {};
    for (const c of clients) { map[c.id] = c.name; }
    return map;
  }, [clients]);

  // Ref keeps fetchFn stable across client-list re-renders
  const clientNameMapRef = useRef(clientNameMap);
  clientNameMapRef.current = clientNameMap;

  const shouldFetchIndividual = !batchEnabled;

  // Stable dep key — prevents infinite refetch when clientSheetId is an array
  const cacheKeyScope = Array.isArray(clientSheetId) ? clientSheetId.slice().sort().join(',') : (clientSheetId || 'all');

  const fetchFn = useCallback(
    async (signal?: AbortSignal) => {
      // Session 71: After a write, skip Supabase (may be stale) and go to GAS
      const skipSb = entityEvents.shouldSkipSupabase('task');
      if (!skipSb && await isSupabaseCacheAvailable()) {
        const sbResult = await fetchTasksFromSupabase(clientNameMapRef.current, clientSheetId);
        if (sbResult) return { data: sbResult, ok: true, error: null } as { data: TasksResponse; ok: true; error: null };
      }
      if (skipSb) setNextFetchNoCache(); // also bypass GAS 600s cache
      const gasClientId = Array.isArray(clientSheetId)
        ? (clientSheetId.length === 1 ? clientSheetId[0] : undefined)
        : clientSheetId;
      return fetchTasks(signal, gasClientId);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cacheKeyScope]
  );

  const { data, loading: individualLoading, error: individualError, refetch: individualRefetch, lastFetched: individualLastFetched } = useApiData<TasksResponse>(
    fetchFn,
    autoFetch && shouldFetchIndividual,
    `tasks:${cacheKeyScope}`
  );

  // ─── Phase 2C: Optimistic patch state ────────────────────────────────────
  const [patches, setPatches] = useState<Record<string, { data: Partial<Task>; appliedAt: number }>>({});
  const [optimisticCreates, setOptimisticCreates] = useState<Task[]>([]);

  const applyTaskPatch = useCallback((taskId: string, patch: Partial<Task>) => {
    setPatches(prev => ({ ...prev, [taskId]: { data: patch, appliedAt: Date.now() } }));
  }, []);

  const mergeTaskPatch = useCallback((taskId: string, patch: Partial<Task>) => {
    setPatches(prev => ({
      ...prev,
      [taskId]: {
        data: { ...(prev[taskId]?.data ?? {}), ...patch },
        appliedAt: Date.now(),
      },
    }));
  }, []);

  const clearTaskPatch = useCallback((taskId: string) => {
    setPatches(prev => {
      const next = { ...prev };
      delete next[taskId];
      return next;
    });
  }, []);

  const addOptimisticTask = useCallback((task: Task) => {
    setOptimisticCreates(prev => [task, ...prev]);
  }, []);

  const removeOptimisticTask = useCallback((tempTaskId: string) => {
    setOptimisticCreates(prev => prev.filter(t => t.taskId !== tempTaskId));
  }, []);
  // ─────────────────────────────────────────────────────────────────────────

  // Phase 2: subscribe to entityEvents for confirmed task writes (non-batch path only)
  useEffect(() => {
    if (batchEnabled) return; // BatchDataContext handles its own subscription
    return entityEvents.subscribe((type) => {
      if (type === 'task') individualRefetch();
    });
  }, [batchEnabled, individualRefetch]);

  // Map batch data to ApiTask shape (lightweight — no folder URLs, no notes)
  const apiTasks = useMemo(() => {
    if (batchEnabled && batchData) {
      return batchData.tasks.map(b => ({
        taskId: b.taskId,
        clientName: (b as any).clientName || '',
        clientSheetId: b.clientSheetId,
        type: b.type,
        status: b.status,
        itemId: b.itemId,
        vendor: b.vendor,
        description: b.description,
        location: b.location,
        sidemark: b.sidemark,
        shipmentNumber: b.shipmentNumber,
        created: b.created,
        // v38.60.1 — batch now includes these (was hardcoded empty)
        itemNotes: b.itemNotes || '',
        completedAt: b.completedAt,
        cancelledAt: b.cancelledAt || '',
        result: b.result,
        taskNotes: b.taskNotes || '',
        svcCode: b.svcCode,
        billed: b.billed,
        assignedTo: b.assignedTo,
        startedAt: b.startedAt,
        customPrice: b.customPrice || undefined,
        taskFolderUrl: b.taskFolderUrl || undefined,
        shipmentFolderUrl: b.shipmentFolderUrl || undefined,
      } as ApiTask));
    }
    // Individual path: resolve "(single)" clientName using the clients list
    const tasks = data?.tasks ?? [];
    if (clientSheetId && tasks.length > 0 && tasks[0].clientName === '(single)') {
      const resolved = clients.find(c => c.id === clientSheetId)?.name;
      if (resolved) return tasks.map(t => ({ ...t, clientName: resolved }));
    }
    return tasks;
  }, [batchEnabled, batchData, data, clientSheetId, clients]);

  // Phase 2C: merge patches into raw mapped tasks, then prepend optimistic creates
  const tasks = useMemo(() => {
    const now = Date.now();
    const rawTasks = apiTasks.map(mapToAppTask);
    const merged = rawTasks.map(t => {
      const p = patches[t.taskId];
      if (!p || now - p.appliedAt > PATCH_TTL_MS) return t;
      return { ...t, ...p.data };
    });
    return [...optimisticCreates, ...merged];
  }, [apiTasks, patches, optimisticCreates]);

  return {
    apiTasks,
    tasks,
    count: batchEnabled ? (batchData?.counts?.tasks ?? 0) : (data?.count ?? 0),
    clientsQueried: batchEnabled ? 1 : (data?.clientsQueried ?? 0),
    errors: batchEnabled ? undefined : data?.errors,
    loading: batchEnabled ? batchLoading : individualLoading,
    error: batchEnabled ? batchError : individualError,
    refetch: batchEnabled ? silentRefetchBatch : individualRefetch,
    lastFetched: batchEnabled ? new Date() : individualLastFetched,
    applyTaskPatch,
    mergeTaskPatch,
    clearTaskPatch,
    addOptimisticTask,
    removeOptimisticTask,
  };
}
