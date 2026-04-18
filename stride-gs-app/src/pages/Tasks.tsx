import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  createColumnHelper,
  type ColumnFiltersState,
  type RowSelectionState,
  type FilterFn,
} from '@tanstack/react-table';
import {
  Eye, X,
  Search, Download, ChevronUp, ChevronDown,
  ArrowUpDown,
  Settings2, RefreshCw,
} from 'lucide-react';
import { useVirtualRows } from '../hooks/useVirtualRows';
import { useClientFilterUrlSync } from '../hooks/useClientFilterUrlSync';
import { theme } from '../styles/theme';
import { fmtDate } from '../lib/constants';
import { useItemIndicators } from '../hooks/useItemIndicators';
import { ItemIdBadges } from '../components/shared/ItemIdBadges';
import { TaskDetailPanel } from '../components/shared/TaskDetailPanel';
import { WriteButton } from '../components/shared/WriteButton';
import { BatchGuard, checkBatchClientGuard } from '../components/shared/BatchGuard';
import { ConfirmDialog } from '../components/shared/ConfirmDialog';
import { BulkResultSummary } from '../components/shared/BulkResultSummary';
import { BulkReassignModal } from '../components/shared/BulkReassignModal';
import { useLocation, useNavigate } from 'react-router-dom';
import { isApiConfigured, postRequestRepairQuote, postBatchCancelTasks, postBatchReassignTasks, type BatchMutationResult } from '../lib/api';
import { mergePreflightSkips } from '../lib/batchLoop';
import { applyBulkPatch, revertBulkPatchForFailures } from '../lib/optimisticBulk';
import { useTasks } from '../hooks/useTasks';
import { useRepairs } from '../hooks/useRepairs';
import { useBatchData } from '../contexts/BatchDataContext';
import { useAuth } from '../contexts/AuthContext';
import { MultiSelectFilter } from '../components/shared/MultiSelectFilter';
import { SyncBanner } from '../components/shared/SyncBanner';
import { useClients } from '../hooks/useClients';
import { useTablePreferences } from '../hooks/useTablePreferences';
import { SERVICE_CODES } from '../lib/constants';
import type { Task } from '../lib/types';
import { useIsMobile } from '../hooks/useIsMobile';
import { mobileChipsRow } from '../styles/mobileTable';
import { FloatingActionMenu, type FABAction } from '../components/shared/FloatingActionMenu';
import { CheckSquare, XCircle, UserCog } from 'lucide-react';

type TaskStatus = 'Open' | 'In Progress' | 'Completed' | 'Cancelled';
const ALL_STATUSES: TaskStatus[] = ['Open', 'In Progress', 'Completed', 'Cancelled'];

const STATUS_CFG: Record<string, { bg: string; text: string }> = {
  Open: { bg: '#EFF6FF', text: '#1D4ED8' },
  'In Progress': { bg: '#FEF3C7', text: '#B45309' },
  Completed: { bg: '#F0FDF4', text: '#15803D' },
  Cancelled: { bg: '#F3F4F6', text: '#6B7280' },
};
const TYPE_CFG: Record<string, { bg: string; text: string }> = {
  INSP: { bg: '#FEF3EE', text: '#E85D2D' },
  ASM: { bg: '#F0FDF4', text: '#15803D' },
  REPAIR: { bg: '#FEF3C7', text: '#B45309' },
  DLVR: { bg: '#EDE9FE', text: '#7C3AED' },
  RCVG: { bg: '#EFF6FF', text: '#1D4ED8' },
  STOR: { bg: '#F3F4F6', text: '#6B7280' },
};
const RESULT_CFG: Record<string, { bg: string; text: string }> = {
  Pass: { bg: '#F0FDF4', text: '#15803D' },
  Fail: { bg: '#FEF2F2', text: '#DC2626' },
};

const COL_LABELS: Record<string, string> = {
  taskId: 'Task ID', type: 'Type', status: 'Status', itemId: 'Item',
  clientName: 'Client', vendor: 'Vendor', description: 'Description',
  location: 'Location', sidemark: 'Sidemark', assignedTo: 'Assigned',
  created: 'Created', completedAt: 'Completed', result: 'Result',
  taskNotes: 'Notes', svcCode: 'Service', billed: 'Billed',
};
const TOGGLEABLE = Object.keys(COL_LABELS);

const DEFAULT_COL_ORDER = [
  'select', 'taskId', 'type', 'status', 'itemId', 'clientName', 'vendor',
  'description', 'location', 'sidemark', 'assignedTo', 'created',
  'completedAt', 'result', 'taskNotes', 'svcCode', 'billed', 'actions',
];

const multiFilter: FilterFn<Task> = (row, colId, val: string[]) => {
  if (!val || !val.length) return true;
  return val.includes(String(row.getValue(colId)));
};
multiFilter.autoRemove = (v: string[]) => !v || !v.length;

const fmt = fmtDate;

function Badge({ t, c }: { t: string; c?: { bg: string; text: string } }) {
  const s = c || { bg: '#F3F4F6', text: '#6B7280' };
  return <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, letterSpacing: '0.02em', background: s.bg, color: s.text, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{t}</span>;
}

function toCSV(rows: Task[], fn: string) {
  const h = 'Task ID,Type,Status,Item,Client,Vendor,Description,Location,Sidemark,Assigned,Created,Completed,Result,Notes,Svc Code,Billed';
  const b = rows.map(r => [r.taskId, r.type, r.status, r.itemId, r.clientName, r.vendor, r.description, r.location, r.sidemark, r.assignedTo, r.created, r.completedAt || '', r.result || '', r.taskNotes || '', r.svcCode, r.billed ? 'Yes' : 'No'].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const bl = new Blob([h + '\n' + b], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(bl); a.download = fn; a.click();
}

const col = createColumnHelper<Task>();

function cols() {
  return [
    col.display({ id: 'select', header: ({ table }) => <input type="checkbox" checked={table.getIsAllPageRowsSelected()} onChange={table.getToggleAllPageRowsSelectedHandler()} style={{ cursor: 'pointer', accentColor: theme.colors.orange }} />, cell: ({ row }) => <input type="checkbox" checked={row.getIsSelected()} onChange={row.getToggleSelectedHandler()} style={{ cursor: 'pointer', accentColor: theme.colors.orange }} />, size: 40, enableSorting: false }),
    col.accessor('taskId', { header: 'Task ID', size: 100, cell: i => {
      const url = i.row.original.taskFolderUrl;
      const val = i.getValue();
      if (url) return <a href={url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={{ fontWeight: 600, fontSize: 12, color: theme.colors.orange, textDecoration: 'none' }} onMouseEnter={e => (e.currentTarget.style.textDecoration = 'underline')} onMouseLeave={e => (e.currentTarget.style.textDecoration = 'none')}>{val}</a>;
      return <span style={{ fontWeight: 600, fontSize: 12, color: theme.colors.textMuted }}>{val}</span>;
    } }),
    col.accessor('type', { header: 'Type', size: 100, filterFn: multiFilter, cell: i => <Badge t={SERVICE_CODES[i.getValue() as keyof typeof SERVICE_CODES] || i.getValue()} c={TYPE_CFG[i.getValue()]} /> }),
    col.accessor('status', { header: 'Status', size: 100, filterFn: multiFilter, cell: i => <Badge t={i.getValue()} c={STATUS_CFG[i.getValue()]} /> }),
    col.accessor('itemId', { header: 'Item', size: 110, cell: i => { const id = i.getValue(); const ind = (window as any).__itemIndicators; return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}><span style={{ color: theme.colors.textSecondary, fontSize: 12 }}>{id}</span>{ind && <ItemIdBadges itemId={id} inspItems={ind.inspItems} asmItems={ind.asmItems} repairItems={ind.repairItems} />}</div>; } }),
    col.accessor('clientName', { header: 'Client', size: 160, filterFn: multiFilter, cell: i => <span style={{ fontWeight: 500, fontSize: 12 }}>{i.getValue()}</span> }),
    col.accessor('vendor', { header: 'Vendor', size: 120, cell: i => <span style={{ color: theme.colors.textSecondary, fontSize: 12 }}>{i.getValue()}</span> }),
    col.accessor('description', { header: 'Description', size: 240, cell: i => <span style={{ color: theme.colors.textSecondary, fontSize: 12, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{i.getValue()}</span> }),
    col.accessor('location', { header: 'Location', size: 90, cell: i => <span style={{ fontSize: 12, fontFamily: 'monospace', color: theme.colors.textSecondary }}>{i.getValue()}</span> }),
    col.accessor('sidemark', { header: 'Sidemark', size: 180, cell: i => <span style={{ color: theme.colors.textSecondary, fontSize: 12, maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{i.getValue()}</span> }),
    col.accessor('assignedTo', { header: 'Assigned', size: 90, filterFn: multiFilter, cell: i => <span style={{ fontSize: 12, color: i.getValue() ? theme.colors.text : theme.colors.textMuted }}>{i.getValue() || '\u2014'}</span> }),
    col.accessor('created', { header: 'Created', size: 100, cell: i => <span style={{ fontSize: 12, color: theme.colors.textSecondary }}>{fmt(i.getValue())}</span> }),
    col.accessor('completedAt', { header: 'Completed', size: 100, cell: i => <span style={{ fontSize: 12, color: theme.colors.textMuted }}>{fmt(i.getValue())}</span> }),
    col.accessor('result', { header: 'Result', size: 80, cell: i => i.getValue() ? <Badge t={i.getValue()!} c={RESULT_CFG[i.getValue()!]} /> : <span style={{ color: theme.colors.textMuted }}>{'\u2014'}</span> }),
    col.accessor('taskNotes', { header: 'Notes', size: 200, cell: i => <span style={{ color: theme.colors.textSecondary, fontSize: 12, maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{i.getValue() || '\u2014'}</span> }),
    col.accessor('svcCode', { header: 'Service', size: 100, cell: i => <span style={{ fontSize: 11, color: theme.colors.textMuted }}>{SERVICE_CODES[i.getValue() as keyof typeof SERVICE_CODES] || i.getValue()}</span> }),
    col.accessor('billed', { header: 'Billed', size: 60, cell: i => <span style={{ fontSize: 12, color: i.getValue() ? '#15803D' : theme.colors.textMuted }}>{i.getValue() ? '\u2713' : '\u2014'}</span> }),
    col.display({ id: 'actions', header: '', size: 40, enableSorting: false, cell: ({ row }) => <div className="row-actions" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', opacity: 0 }}><Eye size={15} color={theme.colors.textSecondary} style={{ cursor: 'pointer' }} onClick={() => (window as any).__openTaskDetail?.(row.original)} /></div> }),
  ];
}

/** ⚠️  FRAGILE HOOK ORDER — see Inventory.tsx for full warning. Do not reorder/add/remove hooks. */
export function Tasks() {
  const { isMobile } = useIsMobile();
  const location = useLocation();
  const navigate = useNavigate();
  const apiConfigured = isApiConfigured();
  useBatchData();
  const pendingOpenRef = useRef<string | null>(null);
  // Deep-link: stash ?client= spreadsheet ID until apiClients loads, then resolve to name
  const deepLinkPendingTenantRef = useRef<string | null>(null);

  // Client list for MultiSelectFilter — declared before data hooks so clientFilter gates fetching
  const { clients, apiClients } = useClients();
  const clientNames = useMemo(() => clients.map(c => c.name).sort(), [clients]);
  const [clientFilter, setClientFilter] = useState<string[]>([]);
  const { user } = useAuth();
  // Client-role users only see their own accounts in the dropdown — admin/staff see all.
  const dropdownClientNames = useMemo(() => {
    if (user?.role === 'client' && user.accessibleClientNames?.length) {
      const allowed = new Set(user.accessibleClientNames);
      return clientNames.filter(n => allowed.has(n));
    }
    return clientNames;
  }, [clientNames, user?.role, user?.accessibleClientNames]);
  useEffect(() => {
    if (user?.role === 'client' && user.accessibleClientNames?.length && clientFilter.length === 0) {
      setClientFilter(user.accessibleClientNames);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role, user?.accessibleClientNames?.length]);

  const selectedSheetId = useMemo<string | string[] | undefined>(() => {
    if (clientFilter.length === 0) return undefined;
    const ids = clientFilter.map(n => apiClients.find(c => c.name === n)?.spreadsheetId).filter((x): x is string => !!x);
    if (ids.length === 0) return undefined;
    return ids.length === 1 ? ids[0] : ids;
  }, [clientFilter, apiClients]);

  const { tasks, loading: tasksLoading, refetch: refetchTasks, applyTaskPatch, mergeTaskPatch, clearTaskPatch, addOptimisticTask, removeOptimisticTask } = useTasks(apiConfigured && clientFilter.length > 0, selectedSheetId);
  const { repairs, addOptimisticRepair, removeOptimisticRepair } = useRepairs(apiConfigured && clientFilter.length > 0, selectedSheetId);
  const itemIndicators = useItemIndicators(selectedSheetId);
  (window as any).__itemIndicators = itemIndicators.loaded ? itemIndicators : null;
  const ALL_ASSIGNED = useMemo(() => [...new Set(tasks.map(t => t.assignedTo).filter(Boolean))].sort(), [tasks]);

  const columns = useMemo(() => cols(), []);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const selectedTask = useMemo(() => tasks.find(t => t.taskId === selectedTaskId) ?? null, [tasks, selectedTaskId]);
  // Bridge for column cell access to component state
  (window as any).__openTaskDetail = (task: Task) => setSelectedTaskId(task.taskId);

  // Effect 1: Route state OR ?open= query param → store pendingOpen + auto-load
  useEffect(() => {
    const state = location.state as { openTaskId?: string; clientSheetId?: string } | null;
    // Do NOT call refetchTasks() here — it bypasses the Supabase cache and
    // forces an unscoped GAS call (session 62). The data hook's normal
    // mount fetch already hits Supabase-first (~50ms). The Effect 2 below
    // opens the pending row once tasks arrive.
    if (state?.openTaskId) {
      pendingOpenRef.current = state.openTaskId;
      window.history.replaceState({}, '');
    } else if (location.search) {
      const params = new URLSearchParams(location.search);
      const openId = params.get('open');
      const clientIdParam = params.get('client');
      if (openId) {
        pendingOpenRef.current = openId;
        window.history.replaceState({}, '', window.location.pathname + window.location.hash.split('?')[0]);
        if (clientIdParam) deepLinkPendingTenantRef.current = clientIdParam;
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clientFilterRef = useRef(clientFilter);
  useEffect(() => { clientFilterRef.current = clientFilter; }, [clientFilter]);
  const apiClientsRef = useRef(apiClients);
  useEffect(() => { apiClientsRef.current = apiClients; }, [apiClients]);

  useClientFilterUrlSync(clientFilter, apiClients);

  // Resolve deep-link ?client= param once apiClients loads.
  // Dep is apiClients.length (stable number) — NOT apiClients (unstable ref → #300).
  useEffect(() => {
    const tid = deepLinkPendingTenantRef.current;
    const clients = apiClientsRef.current;
    if (!tid || clients.length === 0 || clientFilterRef.current.length > 0) return;
    const match = clients.find(c => c.spreadsheetId === tid);
    if (match) {
      setClientFilter([match.name]);
      deepLinkPendingTenantRef.current = null;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiClients.length]);

  // Effect 2: When tasks arrive, open the pending task
  useEffect(() => {
    if (pendingOpenRef.current && tasks.length > 0) {
      const match = tasks.find(t => t.taskId === pendingOpenRef.current);
      if (match) { setSelectedTaskId(match.taskId); pendingOpenRef.current = null; }
    }
  }, [tasks]);

  const { sorting, setSorting, colVis, setColVis, columnOrder, setColumnOrder, statusFilter: sf, toggleStatus, clearStatusFilter } = useTablePreferences('tasks', [{ id: 'created', desc: true }], {}, DEFAULT_COL_ORDER);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [rowSel, setRowSel] = useState<RowSelectionState>({});
  const [af, setAf] = useState('');
  const [showCols, setShowCols] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Reset refreshing when loading completes (tied to actual data load, not a timer)
  useEffect(() => { if (!tasksLoading && refreshing) setRefreshing(false); }, [tasksLoading, refreshing]);
  const [batchGuardClients, setBatchGuardClients] = useState<string[] | null>(null);
  const [batchGuardAction, setBatchGuardAction] = useState('');
  const [dragColId, setDragColId] = useState<string | null>(null);
  const [dragOverColId, setDragOverColId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [toast, setToast] = useState<string | null>(null);
  const showToast = useCallback((msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000); }, []);

  // v38.9.0 — Bulk action toolbar state
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  const [reassignModalOpen, setReassignModalOpen] = useState(false);
  const [pendingBulkItems, setPendingBulkItems] = useState<Task[]>([]);
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [bulkResult, setBulkResult] = useState<BatchMutationResult | null>(null);
  const [bulkResultLabel, setBulkResultLabel] = useState('');

  /**
   * Bulk Cancel — preflights ineligible rows (Completed/Cancelled), submits the
   * rest to batchCancelTasks, merges preflight skips into the final result.
   */
  const handleBulkCancel = useCallback(async () => {
    const items = pendingBulkItems;
    if (!items.length) return;

    // Preflight: split eligible vs ineligible by status
    const eligible: Task[] = [];
    const preflightSkipped: Array<{ id: string; reason: string }> = [];
    for (const t of items) {
      if (t.status === 'Completed') {
        preflightSkipped.push({ id: t.taskId, reason: 'Cannot cancel — status is Completed' });
      } else if (t.status === 'Cancelled') {
        preflightSkipped.push({ id: t.taskId, reason: 'Cannot cancel — status is Cancelled' });
      } else {
        eligible.push(t);
      }
    }

    if (eligible.length === 0) {
      setConfirmCancelOpen(false);
      setBulkResult({
        success: true,
        processed: preflightSkipped.length,
        succeeded: 0,
        failed: 0,
        skipped: preflightSkipped,
        errors: [],
        message: 'All selections were ineligible',
      });
      setBulkResultLabel('Cancel Tasks');
      return;
    }

    const clientSheetId = eligible[0].clientSheetId || eligible[0].clientId || '';
    if (!apiConfigured || !clientSheetId) {
      showToast('API not configured');
      return;
    }

    // Optimistic: flip eligible rows to Cancelled immediately
    const eligibleIds = eligible.map(t => t.taskId);
    applyBulkPatch(eligibleIds, applyTaskPatch, { status: 'Cancelled', cancelledAt: new Date().toISOString() });

    setBulkProcessing(true);
    try {
      const resp = await postBatchCancelTasks({ taskIds: eligibleIds }, clientSheetId);
      const serverResult: BatchMutationResult = (resp.ok && resp.data) ? resp.data : {
        success: false,
        processed: eligible.length,
        succeeded: 0,
        failed: eligible.length,
        skipped: [],
        errors: eligible.map(t => ({ id: t.taskId, reason: resp.error || 'Request failed' })),
        message: resp.error || 'Batch cancel failed',
      };
      // Revert optimistic patches for any server-side failures; successes will be eclipsed by refetch
      revertBulkPatchForFailures(serverResult.errors, clearTaskPatch);
      const merged = mergePreflightSkips(serverResult, preflightSkipped);
      setBulkResult(merged);
      setBulkResultLabel('Cancel Tasks');
      setRowSel({});
      refetchTasks();
    } catch (err) {
      // Network error: revert all optimistic patches
      for (const id of eligibleIds) clearTaskPatch(id);
      throw err;
    } finally {
      setBulkProcessing(false);
      setConfirmCancelOpen(false);
    }
  }, [pendingBulkItems, apiConfigured, showToast, refetchTasks, applyTaskPatch, clearTaskPatch]);

  /**
   * Bulk Reassign — preflights ineligible rows, submits via batchReassignTasks.
   */
  const handleBulkReassign = useCallback(async (assignedTo: string) => {
    const items = pendingBulkItems;
    if (!items.length || !assignedTo.trim()) return;

    const eligible: Task[] = [];
    const preflightSkipped: Array<{ id: string; reason: string }> = [];
    for (const t of items) {
      if (t.status === 'Completed') {
        preflightSkipped.push({ id: t.taskId, reason: 'Cannot reassign — status is Completed' });
      } else if (t.status === 'Cancelled') {
        preflightSkipped.push({ id: t.taskId, reason: 'Cannot reassign — status is Cancelled' });
      } else {
        eligible.push(t);
      }
    }

    if (eligible.length === 0) {
      setReassignModalOpen(false);
      setBulkResult({
        success: true,
        processed: preflightSkipped.length,
        succeeded: 0,
        failed: 0,
        skipped: preflightSkipped,
        errors: [],
        message: 'All selections were ineligible',
      });
      setBulkResultLabel('Reassign Tasks');
      return;
    }

    const clientSheetId = eligible[0].clientSheetId || eligible[0].clientId || '';
    if (!apiConfigured || !clientSheetId) {
      showToast('API not configured');
      return;
    }

    // Optimistic: flip assignedTo on eligible rows immediately
    const eligibleIds = eligible.map(t => t.taskId);
    applyBulkPatch(eligibleIds, applyTaskPatch, { assignedTo });

    setBulkProcessing(true);
    try {
      const resp = await postBatchReassignTasks(
        { taskIds: eligibleIds, assignedTo },
        clientSheetId
      );
      const serverResult: BatchMutationResult = (resp.ok && resp.data) ? resp.data : {
        success: false,
        processed: eligible.length,
        succeeded: 0,
        failed: eligible.length,
        skipped: [],
        errors: eligible.map(t => ({ id: t.taskId, reason: resp.error || 'Request failed' })),
        message: resp.error || 'Batch reassign failed',
      };
      revertBulkPatchForFailures(serverResult.errors, clearTaskPatch);
      const merged = mergePreflightSkips(serverResult, preflightSkipped);
      setBulkResult(merged);
      setBulkResultLabel(`Reassign Tasks to ${assignedTo}`);
      setRowSel({});
      refetchTasks();
    } catch (err) {
      for (const id of eligibleIds) clearTaskPatch(id);
      throw err;
    } finally {
      setBulkProcessing(false);
      setReassignModalOpen(false);
    }
  }, [pendingBulkItems, apiConfigured, showToast, refetchTasks, applyTaskPatch, clearTaskPatch]);

  const handleRequestRepairQuote = useCallback(async (itemId: string, sourceTaskId?: string) => {
    const task = tasks.find(t => t.itemId === itemId && (!sourceTaskId || t.taskId === sourceTaskId));
    const csId = task?.clientSheetId || task?.clientId || '';
    if (!apiConfigured || !csId || !itemId) { showToast('API not configured'); return; }
    const resp = await postRequestRepairQuote({ itemId, sourceTaskId }, csId);
    if (resp.ok && resp.data?.success) {
      showToast(`Repair ${resp.data.repairId} created — Pending Quote`);
      refetchTasks();
    } else {
      showToast(resp.error || resp.data?.error || 'Failed to create repair');
    }
  }, [tasks, apiConfigured, showToast, refetchTasks]);

  // Session 70 fix #1: split filtering so status-chip counts reflect the client+assignee
  // filtered dataset, not the fully-status-filtered dataset. Clicking one chip used to
  // zero all the others.
  const clientFilteredData = useMemo(() => {
    if (clientFilter.length === 0) return [] as typeof tasks;
    let d = tasks;
    if (clientFilter.length) d = d.filter(t => clientFilter.includes(t.clientName));
    if (af) d = d.filter(t => t.assignedTo === af);
    return d;
  }, [clientFilter, af, tasks]);
  const data = useMemo(() => {
    if (sf.length === 0) return clientFilteredData;
    return clientFilteredData.filter(t => sf.includes(t.status));
  }, [clientFilteredData, sf]);

  // Client-filter change is already handled by useTasks (cacheKeyScope change
  // triggers useApiData refetch via Supabase-first path). A manual refetch() here
  // would force GAS (skipSupabaseCacheOnce) and hang the spinner on multi-client.

  const counts = useMemo(() => {
    const c: Record<string, number> = { '': clientFilteredData.length };
    ALL_STATUSES.forEach(s => { c[s] = clientFilteredData.filter(t => t.status === s).length; });
    return c;
  }, [clientFilteredData]);

  const table = useReactTable({
    data, columns,
    state: { sorting, columnFilters, globalFilter, columnVisibility: colVis, rowSelection: rowSel, columnOrder: columnOrder.length ? columnOrder : DEFAULT_COL_ORDER },
    onSortingChange: setSorting, onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter, onColumnVisibilityChange: setColVis,
    onRowSelectionChange: setRowSel,
    onColumnOrderChange: (updater) => setColumnOrder(typeof updater === 'function' ? updater(columnOrder.length ? columnOrder : DEFAULT_COL_ORDER) : updater),
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    enableMultiSort: true,
  });

  const { containerRef, virtualRows, rows: allRows, totalHeight } = useVirtualRows(table);

  const selCount = Object.keys(rowSel).length;
  useEffect(() => { const h = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowCols(false); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, []);

  const chip = (active: boolean): React.CSSProperties => ({ padding: '5px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: `1px solid ${active ? theme.colors.orange : theme.colors.border}`, background: active ? theme.colors.orangeLight : 'transparent', color: active ? theme.colors.orange : theme.colors.textSecondary, transition: 'all 0.15s', whiteSpace: 'nowrap' });
  const th: React.CSSProperties = { padding: '10px 12px', textAlign: 'left', fontWeight: 500, fontSize: 11, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: `1px solid ${theme.colors.borderLight}`, position: 'sticky', top: 0, background: '#fff', zIndex: 2, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { padding: '10px 12px', borderBottom: `1px solid ${theme.colors.borderLight}`, fontSize: 13, whiteSpace: 'nowrap' };

  if (apiConfigured && tasksLoading && tasks.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 300, gap: 12 }}>
        <div style={{ width: 32, height: 32, border: '3px solid #E5E7EB', borderTopColor: theme.colors.orange, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <span style={{ fontSize: 13, color: theme.colors.textMuted }}>Loading tasks...</span>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{ background: '#F5F2EE', margin: '-28px -32px', padding: '28px 32px', minHeight: '100%' }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: '1px', color: '#1C1C1C' }}>STRIDE LOGISTICS · TASKS</div>
      </div>

      <SyncBanner syncing={refreshing} label={clientFilter.length === 1 ? clientFilter[0] : clientFilter.length > 1 ? `${clientFilter.length} clients` : undefined} />

      {/* Client Filter */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 12, flexWrap: 'wrap' }}>
        <MultiSelectFilter label="Client" options={dropdownClientNames} selected={clientFilter} onChange={setClientFilter} placeholder="Select client(s)..." />
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: 320 }}><Search size={15} color={theme.colors.textMuted} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} /><input value={globalFilter} onChange={e => setGlobalFilter(e.target.value)} placeholder="Search all columns..." style={{ width: '100%', padding: '7px 10px 7px 32px', fontSize: 13, border: `1px solid ${theme.colors.border}`, borderRadius: 8, outline: 'none', background: theme.colors.bgSubtle, fontFamily: 'inherit' }} /></div>
        <select value={af} onChange={e => setAf(e.target.value)} style={{ padding: '7px 12px', fontSize: 13, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', fontFamily: 'inherit', color: theme.colors.text, cursor: 'pointer' }}><option value="">All Assigned</option>{ALL_ASSIGNED.map(a => <option key={a} value={a}>{a}</option>)}</select>
        <div style={{ flex: 1 }} />
        <div style={{ position: 'relative' }} ref={menuRef}>
          <button onClick={() => setShowCols(v => !v)} style={{ padding: '7px 12px', fontSize: 12, fontWeight: 500, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'inherit', color: theme.colors.textSecondary }}><Settings2 size={14} /> Columns</button>
          {showCols && <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, background: '#fff', border: `1px solid ${theme.colors.border}`, borderRadius: 10, padding: 8, zIndex: 50, boxShadow: '0 4px 20px rgba(0,0,0,0.1)', minWidth: 180 }}>{TOGGLEABLE.map(id => <label key={id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', fontSize: 12, cursor: 'pointer', borderRadius: 4 }}><input type="checkbox" checked={colVis[id] !== false} onChange={() => setColVis(v => ({ ...v, [id]: v[id] === false }))} style={{ accentColor: theme.colors.orange }} />{COL_LABELS[id]}</label>)}</div>}
        </div>
        <button onClick={() => toCSV(data, 'stride-tasks.csv')} style={{ padding: '7px 12px', fontSize: 12, fontWeight: 500, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'inherit', color: theme.colors.textSecondary }}><Download size={14} /> Export</button>
        <button onClick={() => { setRefreshing(true); refetchTasks(); }} title="Refresh data" style={{ padding: '7px 8px', fontSize: 12, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', color: (refreshing || tasksLoading) ? theme.colors.orange : theme.colors.textSecondary, transition: 'color 0.2s' }}><RefreshCw size={14} style={(refreshing || tasksLoading) ? { animation: 'spin 1s linear infinite' } : undefined} /></button>
      </div>
      <div style={mobileChipsRow(isMobile)}>
        <button onClick={() => clearStatusFilter()} style={chip(sf.length === 0)}>All ({counts['']})</button>
        {ALL_STATUSES.map(s => <button key={s} onClick={() => toggleStatus(s)} style={chip(sf.includes(s))}>{s} ({counts[s] || 0})</button>)}
        {!isMobile && <div style={{ flex: 1 }} />}
        {!isMobile && <span style={{ fontSize: 12, color: theme.colors.textMuted, alignSelf: 'center' }}>Showing <strong>{table.getRowModel().rows.length}</strong> of <strong>{data.length}</strong> tasks</span>}
        {(sf.length > 0 || af || globalFilter || sorting.length > 0) && (
          <button onClick={() => { clearStatusFilter(); setAf(''); setGlobalFilter(''); setSorting([]); }} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 8, border: `1px solid ${theme.colors.border}`, background: '#fff', cursor: 'pointer', fontSize: 11, color: theme.colors.textSecondary, fontFamily: 'inherit', whiteSpace: 'nowrap' }}><X size={12} />Clear filters</button>
        )}
      </div>
      {clientFilter.length === 0 && <div style={{ padding: '40px 20px', textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>Select one or more clients to load data.</div>}
      <div style={{ border: `1px solid ${theme.colors.border}`, borderRadius: isMobile ? 8 : 12, overflow: 'hidden', background: '#fff' }}>
        <div ref={containerRef} style={{ overflowY: 'auto', overflowX: 'auto', maxHeight: isMobile ? 'calc(100dvh - 200px)' : 'calc(100dvh - 280px)', minHeight: isMobile ? 200 : undefined, WebkitOverflowScrolling: 'touch' }}>
          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, minWidth: isMobile ? 700 : undefined }}>
            <thead>{table.getHeaderGroups().map(hg => <tr key={hg.id}>{hg.headers.map(h => {
              const isDragTarget = dragOverColId === h.id && dragColId !== h.id;
              return <th key={h.id}
                draggable={h.id !== 'select' && h.id !== 'actions'}
                onDragStart={() => setDragColId(h.id)}
                onDragOver={e => { e.preventDefault(); setDragOverColId(h.id); }}
                onDragEnd={() => {
                  if (dragColId && dragOverColId && dragColId !== dragOverColId) {
                    const cur = columnOrder.length ? [...columnOrder] : [...DEFAULT_COL_ORDER];
                    const from = cur.indexOf(dragColId); const to = cur.indexOf(dragOverColId);
                    if (from !== -1 && to !== -1) { cur.splice(from, 1); cur.splice(to, 0, dragColId); setColumnOrder(cur); }
                  }
                  setDragColId(null); setDragOverColId(null);
                }}
                style={{ ...th, width: h.getSize(), color: h.column.getIsSorted() ? theme.colors.orange : theme.colors.textMuted, background: isDragTarget ? theme.colors.orangeLight : '#fff', cursor: h.id !== 'select' && h.id !== 'actions' ? 'grab' : 'default', borderLeft: isDragTarget ? `2px solid ${theme.colors.orange}` : undefined, ...(h.id === 'select' ? { position: 'sticky' as const, left: 0, zIndex: 3 } : {}) }}
                onClick={h.column.getCanSort() ? (e: React.MouseEvent) => h.column.toggleSorting(undefined, e.shiftKey) : undefined}
              ><div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}{h.column.getCanSort() && (h.column.getIsSorted() === 'asc' ? <ChevronUp size={13} color={theme.colors.orange} /> : h.column.getIsSorted() === 'desc' ? <ChevronDown size={13} color={theme.colors.orange} /> : <ArrowUpDown size={13} color={theme.colors.textMuted} />)}</div></th>;
            })}</tr>)}</thead>
            <tbody>
              {virtualRows.length > 0 && <tr style={{ height: virtualRows[0].start }}><td colSpan={table.getVisibleFlatColumns().length} /></tr>}
              {virtualRows.map(vRow => { const row = allRows[vRow.index]; const t = row.original; const isActivePanel = selectedTask?.taskId === t.taskId; const statusBg = row.getIsSelected() ? theme.colors.orangeLight : isActivePanel ? '#FEF3EE' : t.status === 'Completed' ? '#F0FDF4' : (t.status === 'In Progress' || (t as any).startedAt) ? '#EFF6FF' : 'transparent'; return <tr key={row.id} style={{ transition: 'background 0.1s', background: statusBg, cursor: 'pointer', borderLeft: isActivePanel ? `3px solid ${theme.colors.orange}` : '3px solid transparent' }} onClick={(e) => { if (!(e.target as HTMLElement).closest('input[type="checkbox"]') && !(e.target as HTMLElement).closest('.row-actions')) setSelectedTaskId(t.taskId); }} onMouseEnter={e => { if (!row.getIsSelected() && !isActivePanel) e.currentTarget.style.background = theme.colors.bgSubtle; const a = e.currentTarget.querySelector('.row-actions') as HTMLElement; if (a) a.style.opacity = '0.6'; }} onMouseLeave={e => { e.currentTarget.style.background = statusBg; const a = e.currentTarget.querySelector('.row-actions') as HTMLElement; if (a) a.style.opacity = '0'; }}>{row.getVisibleCells().map(cell => <td key={cell.id} style={{ ...td, ...(cell.column.id === 'select' ? { position: 'sticky' as const, left: 0, zIndex: 1, background: '#fff' } : {}) }}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}</tr>; })}
              {virtualRows.length > 0 && <tr style={{ height: totalHeight - (virtualRows[virtualRows.length - 1].end) }}><td colSpan={table.getVisibleFlatColumns().length} /></tr>}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '8px 16px', borderTop: `1px solid ${theme.colors.borderLight}`, fontSize: 12, color: theme.colors.textMuted }}>
          {allRows.length} row{allRows.length !== 1 ? 's' : ''}
        </div>
      </div>
      {selCount > 0 && !isMobile && createPortal(<div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100, background: '#1A1A1A', borderTop: '1px solid #333', padding: '12px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', animation: 'slideUp 0.2s ease-out' }}><div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><span style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>{selCount} task{selCount !== 1 ? 's' : ''} selected</span><button onClick={() => setRowSel({})} style={{ background: 'transparent', border: '1px solid #555', borderRadius: 6, color: '#999', padding: '4px 10px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Clear</button></div><div style={{ display: 'flex', gap: 8 }}><WriteButton label="Cancel" variant="ghost" size="sm" onClick={async () => { const items = table.getSelectedRowModel().rows.map(r => r.original); const guard = checkBatchClientGuard(items); if (guard) { setBatchGuardClients(guard); setBatchGuardAction('Cancel'); return; } setPendingBulkItems(items); setConfirmCancelOpen(true); }} /><WriteButton label="Reassign" variant="ghost" size="sm" onClick={async () => { const items = table.getSelectedRowModel().rows.map(r => r.original); const guard = checkBatchClientGuard(items); if (guard) { setBatchGuardClients(guard); setBatchGuardAction('Reassign'); return; } setPendingBulkItems(items); setReassignModalOpen(true); }} /><WriteButton label="Request Repair Quote" variant="ghost" size="sm" onClick={async () => { const items = table.getSelectedRowModel().rows.map(r => r.original); const guard = checkBatchClientGuard(items); if (guard) { setBatchGuardClients(guard); setBatchGuardAction('Request Repair Quote'); return; } for (const t of items) { await handleRequestRepairQuote(t.itemId, t.taskId); } setRowSel({}); }} /><button onClick={() => { toCSV(table.getSelectedRowModel().rows.map(r => r.original), 'stride-tasks-selected.csv'); }} style={{ padding: '7px 16px', fontSize: 12, fontWeight: 600, border: 'none', borderRadius: 8, background: theme.colors.orange, color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>Export Selected</button></div></div>, document.body)}
      <ConfirmDialog
        open={confirmCancelOpen}
        title="Cancel tasks"
        message={`Cancel ${pendingBulkItems.length} task${pendingBulkItems.length === 1 ? '' : 's'}? This sets their status to Cancelled. Completed and already-cancelled tasks will be skipped.`}
        confirmLabel="Cancel tasks"
        cancelLabel="Back"
        variant="danger"
        onConfirm={handleBulkCancel}
        onCancel={() => setConfirmCancelOpen(false)}
        processing={bulkProcessing}
      />
      <BulkReassignModal
        open={reassignModalOpen}
        taskCount={pendingBulkItems.length}
        onCancel={() => setReassignModalOpen(false)}
        onConfirm={handleBulkReassign}
        processing={bulkProcessing}
      />
      <BulkResultSummary
        open={bulkResult !== null}
        actionLabel={bulkResultLabel}
        result={bulkResult}
        onClose={() => setBulkResult(null)}
      />
      <style>{`@keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } } @keyframes spin { to { transform: rotate(360deg); } }`}</style>
      {toast && createPortal(<div style={{ position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)', background: '#1A1A1A', color: '#fff', padding: '10px 20px', borderRadius: 10, fontSize: 13, fontWeight: 600, zIndex: 9999, boxShadow: '0 4px 12px rgba(0,0,0,0.3)', animation: 'slideUp 0.2s ease-out' }}>{toast}</div>, document.body)}
      {batchGuardClients && <BatchGuard selectedClients={batchGuardClients} actionName={batchGuardAction} onDismiss={() => setBatchGuardClients(null)} />}
      {selectedTask && <TaskDetailPanel task={selectedTask} onClose={() => setSelectedTaskId(null)} onTaskUpdated={refetchTasks} onNavigateToItem={(itemId) => { setSelectedTaskId(null); navigate('/inventory', { state: { openItemId: itemId } }); }} itemRepairs={repairs.filter(r => r.itemId === selectedTask.itemId)} applyTaskPatch={applyTaskPatch} mergeTaskPatch={mergeTaskPatch} clearTaskPatch={clearTaskPatch} addOptimisticTask={addOptimisticTask} removeOptimisticTask={removeOptimisticTask} addOptimisticRepair={addOptimisticRepair} removeOptimisticRepair={removeOptimisticRepair} />}
      <FloatingActionMenu
        show={isMobile}
        actions={(() => {
          const selectedItems = table.getSelectedRowModel().rows.map(r => r.original);
          const visibleItems = table.getRowModel().rows.map(r => r.original);
          const items = selCount > 0 ? selectedItems : visibleItems;
          const fabActions: FABAction[] = [];

          if (selCount > 0) {
            fabActions.push({ label: 'Clear (' + selCount + ' selected)', icon: <X size={16} />, onClick: () => setRowSel({}) });
          } else {
            fabActions.push({ label: 'Select All (' + visibleItems.length + ')', icon: <CheckSquare size={16} />, onClick: () => {
              const sel: RowSelectionState = {};
              table.getRowModel().rows.forEach(r => { sel[r.id] = true; });
              setRowSel(sel);
            }});
          }

          fabActions.push(
            { label: 'Cancel Tasks', icon: <XCircle size={16} />, color: '#DC2626', onClick: () => { setPendingBulkItems(items); setConfirmCancelOpen(true); }},
            { label: 'Reassign', icon: <UserCog size={16} />, onClick: () => { setPendingBulkItems(items); setReassignModalOpen(true); }},
            { label: 'Export', icon: <Download size={16} />, onClick: () => { toCSV(items, 'stride-tasks-export.csv'); showToast('Exported ' + items.length + ' tasks'); }},
          );
          return fabActions;
        })()}
      />
    </div>
  );
}
