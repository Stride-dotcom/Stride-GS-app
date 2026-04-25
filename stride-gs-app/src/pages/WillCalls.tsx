import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { createPortal } from 'react-dom';
import {
  useReactTable, getCoreRowModel, getSortedRowModel, getFilteredRowModel,
  flexRender, createColumnHelper,
  type ColumnFiltersState,
  type RowSelectionState, type FilterFn,
} from '@tanstack/react-table';
import {
  Eye, X, Search, Download,
  ChevronUp, ChevronDown, ArrowUpDown, Settings2, Package, RefreshCw,
} from 'lucide-react';
import { useVirtualRows } from '../hooks/useVirtualRows';
import { theme } from '../styles/theme';
import { fmtDate } from '../lib/constants';
import { WillCallDetailPanel } from '../components/shared/WillCallDetailPanel';
import { WriteButton } from '../components/shared/WriteButton';
import { BatchGuard, checkBatchClientGuard } from '../components/shared/BatchGuard';
import { ConfirmDialog } from '../components/shared/ConfirmDialog';
import { BulkResultSummary } from '../components/shared/BulkResultSummary';
import { BulkScheduleModal } from '../components/shared/BulkScheduleModal';
import { BatchProgress } from '../components/shared/BatchProgress';
import { isApiConfigured, postBatchCancelWillCalls, postBatchScheduleWillCalls, postProcessWcRelease, fetchWillCalls, type BatchMutationResult } from '../lib/api';
import { applyBulkPatch, revertBulkPatchForFailures } from '../lib/optimisticBulk';
import { runBatchLoop, mergePreflightSkips } from '../lib/batchLoop';
import { useWillCalls } from '../hooks/useWillCalls';
import { useBatchData } from '../contexts/BatchDataContext';
import { useAuth } from '../contexts/AuthContext';
import { MultiSelectFilter } from '../components/shared/MultiSelectFilter';
import { SyncBanner } from '../components/shared/SyncBanner';
import { useClients } from '../hooks/useClients';
import { useClientFilterUrlSync } from '../hooks/useClientFilterUrlSync';
import { useTablePreferences } from '../hooks/useTablePreferences';
import { useUrlState } from '../hooks/useUrlState';
import type { WillCall } from '../lib/types';
import { useIsMobile } from '../hooks/useIsMobile';
import { mobileChipsRow } from '../styles/mobileTable';
import { FloatingActionMenu, type FABAction } from '../components/shared/FloatingActionMenu';
import { CheckSquare, XCircle, Calendar as CalendarIcon, Download as DownloadIcon } from 'lucide-react';

type WC = WillCall;

const ALL_STATUSES = ['Pending', 'Scheduled', 'Released', 'Partial', 'Cancelled'];

const STATUS_CFG: Record<string, { bg: string; text: string }> = {
  'Pending':   { bg: '#FEF3C7', text: '#B45309' },
  'Scheduled': { bg: '#EFF6FF', text: '#1D4ED8' },
  'Released':  { bg: '#F0FDF4', text: '#15803D' },
  'Partial':   { bg: '#EDE9FE', text: '#7C3AED' },
  'Cancelled': { bg: '#F3F4F6', text: '#6B7280' },
};

const COL_LABELS: Record<string, string> = {
  wcNumber: 'WC Number', clientName: 'Client', status: 'Status',
  pickupParty: 'Pickup Party', pickupPartyPhone: 'Phone',
  scheduledDate: 'Scheduled', itemCount: 'Items',
  createdDate: 'Created', notes: 'Notes',
};
const TOGGLEABLE = Object.keys(COL_LABELS);
const DEFAULT_COL_ORDER = ['select', 'wcNumber', 'clientName', 'status', 'pickupParty', 'pickupPartyPhone', 'scheduledDate', 'itemCount', 'createdDate', 'notes', 'actions'];

const mf: FilterFn<WC> = (row, colId, val: string[]) => { if (!val || !val.length) return true; return val.includes(String(row.getValue(colId))); };
mf.autoRemove = (v: string[]) => !v || !v.length;

const fmt = fmtDate;
function Badge({ t, c }: { t: string; c?: { bg: string; text: string } }) { const s = c || { bg: '#F3F4F6', text: '#6B7280' }; return <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, letterSpacing: '0.02em', background: s.bg, color: s.text, whiteSpace: 'nowrap' }}>{t}</span>; }

function toCSV(rows: WC[], fn: string) {
  const h = 'WC Number,Client,Status,Pickup Party,Phone,Scheduled,Items,Created,Notes';
  const b = rows.map(r => [r.wcNumber, r.clientName, r.status, r.pickupParty, r.pickupPartyPhone || '', r.scheduledDate || '', r.itemCount, r.createdDate || '', r.notes || ''].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const bl = new Blob([h + '\n' + b], { type: 'text/csv' }); const a = document.createElement('a'); a.href = URL.createObjectURL(bl); a.download = fn; a.click();
}

const col = createColumnHelper<WC>();
function cols() {
  return [
    col.display({ id: 'select', header: ({ table }) => <input type="checkbox" checked={table.getIsAllPageRowsSelected()} onChange={table.getToggleAllPageRowsSelectedHandler()} style={{ cursor: 'pointer', accentColor: theme.colors.orange }} />, cell: ({ row }) => <input type="checkbox" checked={row.getIsSelected()} onChange={row.getToggleSelectedHandler()} style={{ cursor: 'pointer', accentColor: theme.colors.orange }} />, size: 40, enableSorting: false }),
    col.accessor('wcNumber', { header: 'WC Number', size: 110, cell: i => <span style={{ fontWeight: 600, fontSize: 12 }}>{i.getValue()}</span> }),
    col.accessor('clientName', { header: 'Client', size: 160, filterFn: mf, cell: i => <span style={{ fontWeight: 500, fontSize: 12 }}>{i.getValue()}</span> }),
    col.accessor('status', { header: 'Status', size: 110, filterFn: mf, cell: i => <Badge t={i.getValue()} c={STATUS_CFG[i.getValue()]} /> }),
    col.accessor('pickupParty', { header: 'Pickup Party', size: 150, cell: i => <span style={{ fontSize: 12 }}>{i.getValue()}</span> }),
    col.accessor('pickupPartyPhone', { header: 'Phone', size: 130, cell: i => <span style={{ fontSize: 12, color: theme.colors.textSecondary }}>{i.getValue() || '\u2014'}</span> }),
    col.accessor('scheduledDate', { header: 'Scheduled', size: 110, cell: i => <span style={{ fontSize: 12, color: i.getValue() ? theme.colors.text : theme.colors.textMuted, fontWeight: i.getValue() ? 500 : 400 }}>{fmt(i.getValue())}</span> }),
    col.accessor('itemCount', { header: 'Items', size: 70, cell: i => <span style={{ fontSize: 12, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Package size={13} color={theme.colors.textSecondary} />{i.getValue()}</span> }),
    col.accessor('createdDate', { header: 'Created', size: 100, cell: i => <span style={{ fontSize: 12, color: theme.colors.textSecondary }}>{fmt(i.getValue())}</span> }),
    col.accessor('notes', { header: 'Notes', size: 200, cell: i => <span style={{ color: theme.colors.textSecondary, fontSize: 12, maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{i.getValue() || '\u2014'}</span> }),
    col.display({ id: 'actions', header: '', size: 40, enableSorting: false, cell: ({ row }) => <div className="row-actions" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', opacity: 0 }}><Eye size={15} color={theme.colors.textSecondary} style={{ cursor: 'pointer' }} onClick={() => (window as any).__openWCDetail?.(row.original)} /></div> }),
  ];
}

/** ⚠️  FRAGILE HOOK ORDER — see Inventory.tsx for full warning. Do not reorder/add/remove hooks. */
export function WillCalls() {
  const { isMobile } = useIsMobile();
  const location = useLocation();
  const apiConfigured = isApiConfigured();
  useBatchData();
  // Deep-link: stash ?client= spreadsheet ID until apiClients loads, then resolve to name
  const deepLinkPendingTenantRef = useRef<string | null>(null);

  // Client list for MultiSelectFilter — declared before data hooks so clientFilter gates fetching
  const { clients, apiClients } = useClients();
  const clientNames = useMemo(() => clients.map(c => c.name).sort(), [clients]);
  const [clientFilter, setClientFilter] = useState<string[]>([]);
  const { user: authUser } = useAuth();
  // Client-role users only see their own accounts in the dropdown — admin/staff see all.
  const dropdownClientNames = useMemo(() => {
    if (authUser?.role === 'client' && authUser.accessibleClientNames?.length) {
      const allowed = new Set(authUser.accessibleClientNames);
      return clientNames.filter(n => allowed.has(n));
    }
    return clientNames;
  }, [clientNames, authUser?.role, authUser?.accessibleClientNames]);
  useEffect(() => {
    // Session 77: auto-load all accounts on mount.
    // - client role: selection is locked to their own accessibleClientNames
    //   (existing behavior).
    // - staff / admin: pre-select every client in the dropdown so the
    //   page auto-loads all data instead of showing "Select one or more
    //   clients to load data." The dropdown still lets them narrow down.
    if (clientFilter.length > 0) return;
    if (authUser?.role === 'client' && authUser.accessibleClientNames?.length) {
      setClientFilter(authUser.accessibleClientNames);
    } else if ((authUser?.role === 'admin' || authUser?.role === 'staff') && clientNames.length > 0) {
      setClientFilter(clientNames);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.role, authUser?.accessibleClientNames?.length, clientNames.length]);

  const selectedSheetId = useMemo<string | string[] | undefined>(() => {
    if (clientFilter.length === 0) return undefined;
    const ids = clientFilter.map(n => apiClients.find(c => c.name === n)?.spreadsheetId).filter((x): x is string => !!x);
    if (ids.length === 0) return undefined;
    return ids.length === 1 ? ids[0] : ids;
  }, [clientFilter, apiClients]);

  const { willCalls, loading: wcsLoading, refetch: refetchWCs, applyWcPatch, mergeWcPatch, clearWcPatch, addOptimisticWc, removeOptimisticWc } = useWillCalls(apiConfigured && clientFilter.length > 0, selectedSheetId);

  const columns = useMemo(() => cols(), []);
  // selectedWcId in the URL (?open=WC_NUMBER) so back closes the panel.
  const [selectedWcId, setSelectedWcId] = useUrlState('open', '');
  const selectedWC = useMemo(() => willCalls.find(w => w.wcNumber === selectedWcId) ?? null, [willCalls, selectedWcId]);
  (window as any).__openWCDetail = (w: WC) => setSelectedWcId(w.wcNumber);

  // Effect 1: ?open= query param → store pendingOpen + auto-load
  // (Dashboard now opens standalone page via #/will-calls/:wcNumber — no route state needed)
  useEffect(() => {
    // Do NOT call refetchWCs() here — it bypasses Supabase cache and
    // forces unscoped GAS (session 62). Data hook auto-fetches via
    // Supabase-first; Effect 2 opens the pending row when data arrives.
    if (location.search) {
      const params = new URLSearchParams(location.search);
      const clientIdParam = params.get('client');
      // ?open= is consumed by useUrlState (selectedWcId); only ?client= needs
      // capture here for filter scoping below.
      if (clientIdParam) deepLinkPendingTenantRef.current = clientIdParam;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clientFilterRef = useRef(clientFilter);
  useEffect(() => { clientFilterRef.current = clientFilter; }, [clientFilter]);
  const apiClientsRef = useRef(apiClients);
  useEffect(() => { apiClientsRef.current = apiClients; }, [apiClients]);

  useClientFilterUrlSync(clientFilter, apiClients);

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

  // (Effect 2 removed: selectedWcId is in the URL via useUrlState; the
  // selectedWC derivation resolves automatically when willCalls arrives.)
  const { sorting, setSorting, colVis, setColVis, columnOrder, setColumnOrder, statusFilter: sf, toggleStatus, clearStatusFilter } = useTablePreferences('willcalls', [{ id: 'scheduledDate', desc: false }], {}, DEFAULT_COL_ORDER);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [rowSel, setRowSel] = useState<RowSelectionState>({});
  const [showCols, setShowCols] = useState(false);
  const [dragColId, setDragColId] = useState<string | null>(null);
  const [dragOverColId, setDragOverColId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => { if (!wcsLoading && refreshing) setRefreshing(false); }, [wcsLoading, refreshing]);
  const [batchGuardClients, setBatchGuardClients] = useState<string[] | null>(null);
  const [batchGuardAction, setBatchGuardAction] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);

  // Page-level safety net: resolve clientName from apiClients if empty (race with useClients load)
  const idToName = useMemo<Record<string, string>>(() => { const m: Record<string, string> = {}; for (const c of apiClients) { m[c.spreadsheetId] = c.name; } return m; }, [apiClients]);
  // Session 70 fix #1: split filtering so status-chip counts reflect the client-filtered dataset
  // (not the client-filtered AND status-filtered dataset — previously clicking one chip zeroed the others).
  const clientFilteredData = useMemo(() => {
    if (clientFilter.length === 0) return [] as WC[];
    let d = (willCalls as WC[]).map(w => w.clientName ? w : { ...w, clientName: idToName[(w as any).clientSheetId || (w as any).clientId] || '' });
    if (clientFilter.length) d = d.filter(w => clientFilter.includes(w.clientName));
    return d;
  }, [clientFilter, willCalls, idToName]);
  const data = useMemo(() => {
    if (sf.length === 0) return clientFilteredData;
    return clientFilteredData.filter(w => sf.includes(w.status));
  }, [clientFilteredData, sf]);

  // Client-filter change is already handled by useWillCalls (cacheKeyScope change
  // triggers useApiData refetch via Supabase-first path). A manual refetch() here
  // would force GAS (skipSupabaseCacheOnce) and hang the spinner on multi-client.

  const counts = useMemo(() => {
    const c: Record<string, number> = { '': clientFilteredData.length };
    ALL_STATUSES.forEach(s => { c[s] = clientFilteredData.filter(w => w.status === s).length; });
    return c;
  }, [clientFilteredData]);

  const table = useReactTable({
    data, columns,
    state: { sorting, columnFilters, globalFilter, columnVisibility: colVis, rowSelection: rowSel, columnOrder: columnOrder.length ? columnOrder : DEFAULT_COL_ORDER },
    onSortingChange: setSorting, onColumnFiltersChange: setColumnFilters, onGlobalFilterChange: setGlobalFilter, onColumnVisibilityChange: setColVis, onRowSelectionChange: setRowSel,
    onColumnOrderChange: (updater) => setColumnOrder(typeof updater === 'function' ? updater(columnOrder.length ? columnOrder : DEFAULT_COL_ORDER) : updater),
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getFilteredRowModel: getFilteredRowModel(),
    enableMultiSort: true,
  });

  const { containerRef, virtualRows, rows: allRows, totalHeight } = useVirtualRows(table);

  const selCount = Object.keys(rowSel).length;

  // v38.9.0 — Bulk action toolbar state
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  const [confirmReleaseOpen, setConfirmReleaseOpen] = useState(false);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [pendingBulkItems, setPendingBulkItems] = useState<WC[]>([]);
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number; label: string } | null>(null);
  const [bulkResult, setBulkResult] = useState<BatchMutationResult | null>(null);
  const [bulkResultLabel, setBulkResultLabel] = useState('');

  const handleBulkCancelWillCalls = async () => {
    const items = pendingBulkItems;
    if (!items.length) return;

    const eligible: WC[] = [];
    const preflightSkipped: Array<{ id: string; reason: string }> = [];
    for (const w of items) {
      if (w.status === 'Cancelled') {
        preflightSkipped.push({ id: w.wcNumber, reason: 'Cannot cancel — status is Cancelled' });
      } else if (w.status === 'Released') {
        preflightSkipped.push({ id: w.wcNumber, reason: 'Cannot cancel — status is Released' });
      } else {
        eligible.push(w);
      }
    }

    if (eligible.length === 0) {
      setConfirmCancelOpen(false);
      setBulkResult({
        success: true, processed: preflightSkipped.length, succeeded: 0, failed: 0,
        skipped: preflightSkipped, errors: [], message: 'All selections were ineligible',
      });
      setBulkResultLabel('Cancel Will Calls');
      return;
    }

    const clientSheetId = eligible[0].clientSheetId || eligible[0].clientId || '';
    if (!apiConfigured || !clientSheetId) return;

    // Optimistic: flip eligible WCs to Cancelled immediately
    const eligibleIds = eligible.map(w => w.wcNumber);
    applyBulkPatch(eligibleIds, applyWcPatch, { status: 'Cancelled' } as any);

    setBulkProcessing(true);
    try {
      const resp = await postBatchCancelWillCalls({ wcNumbers: eligibleIds }, clientSheetId);
      const serverResult: BatchMutationResult = (resp.ok && resp.data) ? resp.data : {
        success: false, processed: eligible.length, succeeded: 0, failed: eligible.length,
        skipped: [], errors: eligible.map(w => ({ id: w.wcNumber, reason: resp.error || 'Request failed' })),
        message: resp.error || 'Batch cancel failed',
      };
      revertBulkPatchForFailures(serverResult.errors, clearWcPatch);
      setBulkResult(mergePreflightSkips(serverResult, preflightSkipped));
      setBulkResultLabel('Cancel Will Calls');
      setRowSel({});
      refetchWCs();
    } catch (err) {
      for (const id of eligibleIds) clearWcPatch(id);
      throw err;
    } finally {
      setBulkProcessing(false);
      setConfirmCancelOpen(false);
    }
  };

  const handleBulkSchedule = async (isoDate: string) => {
    const items = pendingBulkItems;
    if (!items.length || !isoDate) return;

    const eligible: WC[] = [];
    const preflightSkipped: Array<{ id: string; reason: string }> = [];
    for (const w of items) {
      if (w.status === 'Pending' || w.status === 'Scheduled') {
        eligible.push(w);
      } else {
        preflightSkipped.push({ id: w.wcNumber, reason: `Cannot schedule — status is ${w.status}` });
      }
    }

    if (eligible.length === 0) {
      setScheduleModalOpen(false);
      setBulkResult({
        success: true, processed: preflightSkipped.length, succeeded: 0, failed: 0,
        skipped: preflightSkipped, errors: [], message: 'All selections were ineligible',
      });
      setBulkResultLabel('Schedule Will Calls');
      return;
    }

    const clientSheetId = eligible[0].clientSheetId || eligible[0].clientId || '';
    if (!apiConfigured || !clientSheetId) return;

    // Optimistic: flip eligible WCs to Scheduled + pickup date immediately
    const eligibleIds = eligible.map(w => w.wcNumber);
    applyBulkPatch(eligibleIds, applyWcPatch, { status: 'Scheduled', estimatedPickupDate: isoDate } as any);

    setBulkProcessing(true);
    try {
      // v38.58.0 — single server-side batch call. Safe against tab close.
      const resp = await postBatchScheduleWillCalls(
        { wcNumbers: eligibleIds, estimatedPickupDate: isoDate },
        clientSheetId
      );
      const serverResult: BatchMutationResult = (resp.ok && resp.data) ? resp.data : {
        success: false, processed: eligible.length, succeeded: 0, failed: eligible.length,
        skipped: [], errors: eligible.map(w => ({ id: w.wcNumber, reason: resp.error || 'Request failed' })),
        message: resp.error || 'Batch schedule failed',
      };
      revertBulkPatchForFailures(serverResult.errors, clearWcPatch);
      setBulkResult(mergePreflightSkips(serverResult, preflightSkipped));
      setBulkResultLabel('Schedule Will Calls');
      setRowSel({});
      refetchWCs();
    } catch (err) {
      for (const id of eligibleIds) clearWcPatch(id);
      throw err;
    } finally {
      setBulkProcessing(false);
      setScheduleModalOpen(false);
    }
  };

  const handleBulkRelease = async () => {
    const items = pendingBulkItems;
    if (!items.length) return;

    const clientSheetId = items[0].clientSheetId || items[0].clientId || '';
    if (!apiConfigured || !clientSheetId) return;

    setBulkProcessing(true);
    setBulkProgress({ done: 0, total: items.length, label: 'Hydrating' });

    try {
      // v38.9.0 hydration guard: if items come from the batch path (useBatchData),
      // `items` may be empty on each WC. Re-fetch via fetchWillCalls (hydrated) to
      // get the items[] array per WC before calling handleProcessWcRelease.
      let hydratedMap: Record<string, WC> = {};
      const needsHydration = items.some(w => !w.items || w.items.length === 0);
      if (needsHydration) {
        const resp = await fetchWillCalls(undefined, clientSheetId);
        if (resp.ok && resp.data?.willCalls) {
          for (const api of resp.data.willCalls) {
            hydratedMap[api.wcNumber] = {
              ...items.find(i => i.wcNumber === api.wcNumber),
              wcNumber: api.wcNumber,
              status: api.status as any,
              items: (api.items || []).map(it => ({
                itemId: it.itemId,
                description: it.description,
                qty: it.qty,
                released: it.released,
                vendor: it.vendor,
                location: it.location,
                status: it.status,
              })),
            } as WC;
          }
        }
      }

      // Preflight: eligible status + has pending items
      const eligible: Array<{ wc: WC; pendingItemIds: string[] }> = [];
      const preflightSkipped: Array<{ id: string; reason: string }> = [];
      for (const w of items) {
        const hydrated = hydratedMap[w.wcNumber] || w;
        if (!['Pending', 'Scheduled', 'Partial'].includes(hydrated.status)) {
          preflightSkipped.push({ id: w.wcNumber, reason: `Status=${hydrated.status} — not releasable` });
          continue;
        }
        const pendingIds = (hydrated.items || [])
          .filter(i => !i.released && String(i.status || '').toLowerCase() !== 'released')
          .map(i => i.itemId);
        if (pendingIds.length === 0) {
          preflightSkipped.push({ id: w.wcNumber, reason: 'No pending items to release' });
          continue;
        }
        eligible.push({ wc: hydrated, pendingItemIds: pendingIds });
      }

      if (eligible.length === 0) {
        setConfirmReleaseOpen(false);
        setBulkResult({
          success: true, processed: preflightSkipped.length, succeeded: 0, failed: 0,
          skipped: preflightSkipped, errors: [], message: 'All selections were ineligible',
        });
        setBulkResultLabel('Release Will Calls');
        return;
      }

      // Optimistic: flip eligible WCs to Released immediately.
      // If partial (some items previously released), the refetch will reconcile to 'Partial' where appropriate.
      const eligibleIds = eligible.map(e => e.wc.wcNumber);
      applyBulkPatch(eligibleIds, applyWcPatch, { status: 'Released' } as any);

      setBulkProgress({ done: 0, total: eligible.length, label: 'Releasing' });
      const loopResult = await runBatchLoop<{ wc: WC; pendingItemIds: string[] }, unknown>({
        items: eligible.map(e => ({ id: e.wc.wcNumber, item: e })),
        call: async (e) => {
          const resp = await postProcessWcRelease(
            { wcNumber: e.wc.wcNumber, releaseItemIds: e.pendingItemIds },
            clientSheetId
          );
          return { ok: !!(resp.ok && resp.data?.success), data: resp.data, error: resp.error || resp.data?.error };
        },
        onProgress: (done, total) => setBulkProgress({ done, total, label: 'Releasing' }),
        preflightSkipped,
      });
      revertBulkPatchForFailures(loopResult.errors, clearWcPatch);
      setBulkResult(loopResult);
      setBulkResultLabel('Release Will Calls');
      setRowSel({});
      refetchWCs();
    } finally {
      setBulkProcessing(false);
      setBulkProgress(null);
      setConfirmReleaseOpen(false);
    }
  };

  useEffect(() => { const h = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowCols(false); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, []);

  const chip = (active: boolean): React.CSSProperties => ({ padding: '8px 16px', borderRadius: 100, fontSize: 11, fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', cursor: 'pointer', border: active ? 'none' : '1px solid rgba(0,0,0,0.08)', background: active ? '#1C1C1C' : '#fff', color: active ? '#fff' : '#666', transition: 'all 0.15s', whiteSpace: 'nowrap', fontFamily: 'inherit' });
  const thS: React.CSSProperties = { padding: '14px 12px', textAlign: 'left', fontWeight: 600, fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '2px', borderBottom: 'none', position: 'sticky', top: 0, background: '#F5F2EE', zIndex: 2, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' };
  const tdS: React.CSSProperties = { padding: '10px 12px', borderBottom: `1px solid ${theme.colors.borderLight}`, fontSize: 13, whiteSpace: 'nowrap' };

  if (apiConfigured && wcsLoading && willCalls.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 300, gap: 12 }}>
        <div style={{ width: 32, height: 32, border: '3px solid #E5E7EB', borderTopColor: theme.colors.orange, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <span style={{ fontSize: 13, color: theme.colors.textMuted }}>Loading will calls...</span>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{ background: '#F5F2EE', margin: '-28px -32px', padding: '28px 32px', minHeight: '100%' }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '2px', color: '#1C1C1C' }}>STRIDE LOGISTICS · WILL CALLS</div>
      </div>
      <div style={{ background: '#FFFFFF', borderRadius: 20, padding: 24, border: '1px solid rgba(0,0,0,0.04)' }}>

      <SyncBanner syncing={refreshing} label={clientFilter.length === 1 ? clientFilter[0] : clientFilter.length > 1 ? `${clientFilter.length} clients` : undefined} />

      {/* Client Filter */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 12, flexWrap: 'wrap' }}>
        <MultiSelectFilter label="Client" options={dropdownClientNames} selected={clientFilter} onChange={setClientFilter} placeholder="Select client(s)..." />
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: 320 }}><Search size={15} color={theme.colors.textMuted} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} /><input value={globalFilter} onChange={e => setGlobalFilter(e.target.value)} placeholder="Search will calls..." style={{ width: '100%', padding: '10px 16px 10px 36px', fontSize: 13, border: '1px solid rgba(0,0,0,0.08)', borderRadius: 100, outline: 'none', background: '#fff', fontFamily: 'inherit' }} /></div>
        <div style={{ flex: 1 }} />
        <div style={{ position: 'relative' }} ref={menuRef}>
          <button onClick={() => setShowCols(v => !v)} style={{ padding: '7px 12px', fontSize: 12, fontWeight: 500, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'inherit', color: theme.colors.textSecondary }}><Settings2 size={14} /> Columns</button>
          {showCols && <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, background: '#fff', border: `1px solid ${theme.colors.border}`, borderRadius: 10, padding: 8, zIndex: 50, boxShadow: '0 4px 20px rgba(0,0,0,0.1)', minWidth: 180 }}>{TOGGLEABLE.map(id => <label key={id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', fontSize: 12, cursor: 'pointer', borderRadius: 4 }}><input type="checkbox" checked={colVis[id] !== false} onChange={() => setColVis(v => ({ ...v, [id]: v[id] === false }))} style={{ accentColor: theme.colors.orange }} />{COL_LABELS[id]}</label>)}</div>}
        </div>
        <button onClick={() => toCSV(data, 'stride-willcalls.csv')} style={{ padding: '7px 12px', fontSize: 12, fontWeight: 500, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'inherit', color: theme.colors.textSecondary }}><Download size={14} /> Export</button>
        <button onClick={() => { setRefreshing(true); refetchWCs(); }} title="Refresh data" style={{ padding: '7px 8px', fontSize: 12, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', color: (refreshing || wcsLoading) ? theme.colors.orange : theme.colors.textSecondary, transition: 'color 0.2s' }}><RefreshCw size={14} style={(refreshing || wcsLoading) ? { animation: 'spin 1s linear infinite' } : undefined} /></button>
      </div>
      <div style={mobileChipsRow(isMobile)}>
        <button onClick={() => clearStatusFilter()} style={chip(sf.length === 0)}>All ({counts['']})</button>
        {ALL_STATUSES.map(s => <button key={s} onClick={() => toggleStatus(s)} style={chip(sf.includes(s))}>{s} ({counts[s] || 0})</button>)}
        {!isMobile && <div style={{ flex: 1 }} />}
        {!isMobile && <span style={{ fontSize: 12, color: theme.colors.textMuted, alignSelf: 'center' }}>Showing <strong>{table.getRowModel().rows.length}</strong> of <strong>{data.length}</strong> will calls</span>}
        {(sf.length > 0 || globalFilter || sorting.length > 0) && (
          <button onClick={() => { clearStatusFilter(); setGlobalFilter(''); setSorting([]); }} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 8, border: `1px solid ${theme.colors.border}`, background: '#fff', cursor: 'pointer', fontSize: 11, color: theme.colors.textSecondary, fontFamily: 'inherit', whiteSpace: 'nowrap' }}><X size={12} />Clear filters</button>
        )}
      </div>
      {clientFilter.length === 0 && <div style={{ padding: '40px 20px', textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>Select one or more clients to load data.</div>}
      <div style={{ border: `1px solid ${theme.colors.border}`, borderRadius: isMobile ? 8 : 12, overflow: 'hidden', background: '#fff' }}>
        <div ref={containerRef} style={{ overflowY: 'auto', overflowX: 'auto', maxHeight: isMobile ? 'calc(100dvh - 200px)' : 'calc(100dvh - 280px)', minHeight: isMobile ? 200 : undefined, WebkitOverflowScrolling: 'touch' }}>
          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, minWidth: isMobile ? 600 : undefined }}>
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
                style={{ ...thS, width: h.getSize(), color: h.column.getIsSorted() ? theme.colors.orange : theme.colors.textMuted, cursor: h.id !== 'select' && h.id !== 'actions' ? 'grab' : 'default', background: isDragTarget ? theme.colors.orangeLight : '#fff', borderLeft: isDragTarget ? `2px solid ${theme.colors.orange}` : undefined, ...(h.id === 'select' ? { position: 'sticky' as const, left: 0, zIndex: 3 } : {}) }}
                onClick={h.column.getCanSort() ? (e: React.MouseEvent) => h.column.toggleSorting(undefined, e.shiftKey) : undefined}
              ><div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}{h.column.getCanSort() && (h.column.getIsSorted() === 'asc' ? <ChevronUp size={13} color={theme.colors.orange} /> : h.column.getIsSorted() === 'desc' ? <ChevronDown size={13} color={theme.colors.orange} /> : <ArrowUpDown size={13} color={theme.colors.textMuted} />)}</div></th>;
            })}</tr>)}</thead>
            <tbody>
              {virtualRows.length > 0 && <tr style={{ height: virtualRows[0].start }}><td colSpan={table.getVisibleFlatColumns().length} /></tr>}
              {virtualRows.map(vRow => { const row = allRows[vRow.index]; const wc = row.original; const isActivePanel = selectedWC?.wcNumber === wc.wcNumber; const rowBg = row.getIsSelected() ? theme.colors.orangeLight : isActivePanel ? '#FEF3EE' : 'transparent'; return <tr key={row.id} style={{ transition: 'background 0.1s', background: rowBg, cursor: 'pointer', borderLeft: isActivePanel ? `3px solid ${theme.colors.orange}` : '3px solid transparent' }} onClick={(e) => { if (!(e.target as HTMLElement).closest('input[type="checkbox"]') && !(e.target as HTMLElement).closest('.row-actions')) setSelectedWcId(wc.wcNumber); }} onMouseEnter={e => { if (!row.getIsSelected() && !isActivePanel) e.currentTarget.style.background = theme.colors.bgSubtle; const a = e.currentTarget.querySelector('.row-actions') as HTMLElement; if (a) a.style.opacity = '0.6'; }} onMouseLeave={e => { e.currentTarget.style.background = rowBg; const a = e.currentTarget.querySelector('.row-actions') as HTMLElement; if (a) a.style.opacity = '0'; }}>{row.getVisibleCells().map(cell => <td key={cell.id} style={{ ...tdS, ...(cell.column.id === 'select' ? { position: 'sticky' as const, left: 0, zIndex: 1, background: '#fff' } : {}) }}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}</tr>; })}
              {virtualRows.length > 0 && <tr style={{ height: totalHeight - (virtualRows[virtualRows.length - 1].end) }}><td colSpan={table.getVisibleFlatColumns().length} /></tr>}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '8px 16px', borderTop: `1px solid ${theme.colors.borderLight}`, fontSize: 12, color: theme.colors.textMuted }}>
          {allRows.length} row{allRows.length !== 1 ? 's' : ''}
        </div>
      </div>
      {selCount > 0 && !isMobile && createPortal(<div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100, background: '#1A1A1A', borderTop: '1px solid #333', padding: '12px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', animation: 'slideUp 0.2s ease-out' }}><div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><span style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>{selCount} will call{selCount !== 1 ? 's' : ''} selected</span><button onClick={() => setRowSel({})} style={{ background: 'transparent', border: '1px solid #555', borderRadius: 6, color: '#999', padding: '4px 10px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Clear</button></div><div style={{ display: 'flex', gap: 8 }}><WriteButton label="Schedule" variant="ghost" size="sm" onClick={async () => { const items = table.getSelectedRowModel().rows.map(r => r.original); const guard = checkBatchClientGuard(items); if (guard) { setBatchGuardClients(guard); setBatchGuardAction('Schedule'); return; } setPendingBulkItems(items); setScheduleModalOpen(true); }} /><WriteButton label="Release" variant="ghost" size="sm" onClick={async () => { const items = table.getSelectedRowModel().rows.map(r => r.original); const guard = checkBatchClientGuard(items); if (guard) { setBatchGuardClients(guard); setBatchGuardAction('Release'); return; } setPendingBulkItems(items); setConfirmReleaseOpen(true); }} /><WriteButton label="Cancel" variant="ghost" size="sm" onClick={async () => { const items = table.getSelectedRowModel().rows.map(r => r.original); const guard = checkBatchClientGuard(items); if (guard) { setBatchGuardClients(guard); setBatchGuardAction('Cancel'); return; } setPendingBulkItems(items); setConfirmCancelOpen(true); }} /><button onClick={() => toCSV(table.getSelectedRowModel().rows.map(r => r.original), 'stride-wc-selected.csv')} style={{ padding: '7px 16px', fontSize: 12, fontWeight: 600, border: 'none', borderRadius: 8, background: theme.colors.orange, color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>Export Selected</button></div></div>, document.body)}
      <ConfirmDialog
        open={confirmCancelOpen}
        title="Cancel will calls"
        message={`Cancel ${pendingBulkItems.length} will call${pendingBulkItems.length === 1 ? '' : 's'}? Linked non-released items will also be set to Cancelled. Cancellation emails are NOT sent in bulk mode — use the single-WC flow if you need the email.`}
        confirmLabel="Cancel will calls"
        cancelLabel="Back"
        variant="danger"
        onConfirm={handleBulkCancelWillCalls}
        onCancel={() => setConfirmCancelOpen(false)}
        processing={bulkProcessing}
      />
      <ConfirmDialog
        open={confirmReleaseOpen}
        title="Release will calls"
        message={`Release all pending items on ${pendingBulkItems.length} will call${pendingBulkItems.length === 1 ? '' : 's'}? Each will call will generate a release PDF and send an email. Will calls with no pending items or non-releasable status will be skipped.`}
        confirmLabel="Release"
        cancelLabel="Back"
        onConfirm={handleBulkRelease}
        onCancel={() => setConfirmReleaseOpen(false)}
        processing={bulkProcessing}
      />
      <BulkScheduleModal
        open={scheduleModalOpen}
        wcCount={pendingBulkItems.length}
        onCancel={() => setScheduleModalOpen(false)}
        onConfirm={handleBulkSchedule}
        processing={bulkProcessing}
      />
      {bulkProgress && bulkProcessing && createPortal(
        <div style={{ position: 'fixed', top: 20, right: 20, zIndex: 2100 }}>
          <BatchProgress
            state="processing"
            total={bulkProgress.total}
            processed={bulkProgress.done}
            succeeded={bulkProgress.done}
            failed={0}
            actionLabel={bulkProgress.label}
          />
        </div>,
        document.body
      )}
      <BulkResultSummary
        open={bulkResult !== null}
        actionLabel={bulkResultLabel}
        result={bulkResult}
        onClose={() => setBulkResult(null)}
      />
      <style>{`@keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } } @keyframes spin { to { transform: rotate(360deg); } }`}</style>
      {batchGuardClients && <BatchGuard selectedClients={batchGuardClients} actionName={batchGuardAction} onDismiss={() => setBatchGuardClients(null)} />}
      {selectedWC && <WillCallDetailPanel wc={selectedWC} onClose={() => setSelectedWcId('')} onWcUpdated={refetchWCs} onNavigateToWc={(wcNumber) => {
        setSelectedWcId('');
        // After refetch, set the new WC ID — derived selectedWC will auto-resolve once willCalls updates
        setTimeout(() => {
          setSelectedWcId(wcNumber);
        }, 300);
      }} applyWcPatch={applyWcPatch} mergeWcPatch={mergeWcPatch} clearWcPatch={clearWcPatch} addOptimisticWc={addOptimisticWc} removeOptimisticWc={removeOptimisticWc} />}
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
            { label: 'Schedule', icon: <CalendarIcon size={16} />, onClick: () => { setPendingBulkItems(items); setScheduleModalOpen(true); }},
            { label: 'Release', icon: <Package size={16} />, onClick: () => { setPendingBulkItems(items); setConfirmReleaseOpen(true); }},
            { label: 'Cancel', icon: <XCircle size={16} />, color: '#DC2626', onClick: () => { setPendingBulkItems(items); setConfirmCancelOpen(true); }},
            { label: 'Export', icon: <DownloadIcon size={16} />, onClick: () => { toCSV(items, 'stride-wc-export.csv'); }},
          );
          return fabActions;
        })()}
      />
      </div>
    </div>
  );
}
