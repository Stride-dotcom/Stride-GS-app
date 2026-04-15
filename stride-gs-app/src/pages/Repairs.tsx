import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import {
  useReactTable, getCoreRowModel, getSortedRowModel, getFilteredRowModel,
  flexRender, createColumnHelper,
  type ColumnFiltersState,
  type RowSelectionState, type FilterFn,
} from '@tanstack/react-table';
import {
  Eye, X, Search, Download,
  ChevronUp, ChevronDown, ArrowUpDown, Settings2, RefreshCw,
} from 'lucide-react';
import { useVirtualRows } from '../hooks/useVirtualRows';
import { theme } from '../styles/theme';
import { fmtDate } from '../lib/constants';
import { RepairDetailPanel } from '../components/shared/RepairDetailPanel';
import { WriteButton } from '../components/shared/WriteButton';
import { BatchGuard, checkBatchClientGuard } from '../components/shared/BatchGuard';
import { ConfirmDialog } from '../components/shared/ConfirmDialog';
import { BulkResultSummary } from '../components/shared/BulkResultSummary';
import { BatchProgress } from '../components/shared/BatchProgress';
import { isApiConfigured, type ApiRepair, postBatchCancelRepairs, postSendRepairQuote, type BatchMutationResult } from '../lib/api';
import { runBatchLoop, mergePreflightSkips } from '../lib/batchLoop';
import { FloatingActionMenu, type FABAction } from '../components/shared/FloatingActionMenu';
import { XCircle, Send as SendIcon, CheckSquare } from 'lucide-react';
import { useRepairs } from '../hooks/useRepairs';
import { useBatchData } from '../contexts/BatchDataContext';
import { useAuth } from '../contexts/AuthContext';
import { MultiSelectFilter } from '../components/shared/MultiSelectFilter';
import { SyncBanner } from '../components/shared/SyncBanner';
import { useClients } from '../hooks/useClients';
import { useClientFilterUrlSync } from '../hooks/useClientFilterUrlSync';
import { useTablePreferences } from '../hooks/useTablePreferences';
import type { Repair } from '../lib/types';
import { useIsMobile } from '../hooks/useIsMobile';
import { mobileChipsRow } from '../styles/mobileTable';

const ALL_STATUSES = ['Pending Quote', 'Quote Sent', 'Approved', 'Declined', 'In Progress', 'Complete', 'Cancelled'];

const DEFAULT_COL_ORDER = [
  'select', 'repairId', 'sourceTaskId', 'status', 'itemId', 'clientName',
  'description', 'quoteAmount', 'approvedAmount', 'repairVendor', 'assignedTo',
  'createdDate', 'quoteSentDate', 'completedDate', 'notes', 'actions',
];

const STATUS_CFG: Record<string, { bg: string; text: string }> = {
  'Pending Quote': { bg: '#FEF3C7', text: '#B45309' },
  'Quote Sent':    { bg: '#EFF6FF', text: '#1D4ED8' },
  'Approved':      { bg: '#F0FDF4', text: '#15803D' },
  'Declined':      { bg: '#FEF2F2', text: '#DC2626' },
  'In Progress':   { bg: '#EDE9FE', text: '#7C3AED' },
  'Complete':      { bg: '#F0FDF4', text: '#15803D' },
  'Cancelled':     { bg: '#F3F4F6', text: '#6B7280' },
};

const COL_LABELS: Record<string, string> = {
  repairId: 'Repair ID', sourceTaskId: 'Source Task', itemId: 'Item',
  clientName: 'Client', description: 'Description', status: 'Status',
  quoteAmount: 'Quote $', approvedAmount: 'Approved $', repairVendor: 'Repair Tech',
  assignedTo: 'Assigned', createdDate: 'Created', quoteSentDate: 'Quote Sent',
  approvedDate: 'Approved Date', completedDate: 'Completed', notes: 'Notes',
};
const TOGGLEABLE = Object.keys(COL_LABELS);

const mf: FilterFn<Repair> = (row, colId, val: string[]) => { if (!val || !val.length) return true; return val.includes(String(row.getValue(colId))); };
mf.autoRemove = (v: string[]) => !v || !v.length;

const fmt = fmtDate;
function fmtMoney(n?: number) { if (n == null) return '\u2014'; return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0 }); }
function Badge({ t, c }: { t: string; c?: { bg: string; text: string } }) { const s = c || { bg: '#F3F4F6', text: '#6B7280' }; return <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, letterSpacing: '0.02em', background: s.bg, color: s.text, whiteSpace: 'nowrap' }}>{t}</span>; }

function toCSV(rows: Repair[], fn: string) {
  const h = 'Repair ID,Source Task,Item,Client,Description,Status,Quote Amount,Approved Amount,Vendor,Assigned,Created,Quote Sent,Approved,Completed,Notes';
  const b = rows.map(r => [r.repairId, r.sourceTaskId || '', r.itemId, r.clientName, r.description, r.status, r.quoteAmount ?? '', r.approvedAmount ?? '', r.repairVendor || '', r.assignedTo || '', r.createdDate, r.quoteSentDate || '', r.approvedDate || '', r.completedDate || '', r.notes || ''].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const bl = new Blob([h + '\n' + b], { type: 'text/csv' }); const a = document.createElement('a'); a.href = URL.createObjectURL(bl); a.download = fn; a.click();
}

const col = createColumnHelper<Repair>();
function cols() {
  return [
    col.display({ id: 'select', header: ({ table }) => <input type="checkbox" checked={table.getIsAllPageRowsSelected()} onChange={table.getToggleAllPageRowsSelectedHandler()} style={{ cursor: 'pointer', accentColor: theme.colors.orange }} />, cell: ({ row }) => <input type="checkbox" checked={row.getIsSelected()} onChange={row.getToggleSelectedHandler()} style={{ cursor: 'pointer', accentColor: theme.colors.orange }} />, size: 40, enableSorting: false }),
    col.accessor('repairId', { header: 'Repair ID', size: 100, cell: i => <span style={{ fontWeight: 600, fontSize: 12 }}>{i.getValue()}</span> }),
    col.accessor('sourceTaskId', { header: 'Source Task', size: 100, cell: i => <span style={{ color: theme.colors.textSecondary, fontSize: 12 }}>{i.getValue() || '\u2014'}</span> }),
    col.accessor('status', { header: 'Status', size: 120, filterFn: mf, cell: i => <Badge t={i.getValue()} c={STATUS_CFG[i.getValue()]} /> }),
    col.accessor('itemId', { header: 'Item', size: 90, cell: i => <span style={{ color: theme.colors.textSecondary, fontSize: 12 }}>{i.getValue()}</span> }),
    col.accessor('clientName', { header: 'Client', size: 160, filterFn: mf, cell: i => <span style={{ fontWeight: 500, fontSize: 12 }}>{i.getValue()}</span> }),
    col.accessor('description', { header: 'Description', size: 260, cell: i => <span style={{ color: theme.colors.textSecondary, fontSize: 12, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{i.getValue()}</span> }),
    col.accessor('quoteAmount', { header: 'Quote $', size: 90, cell: i => <span style={{ fontSize: 12, fontWeight: 600, color: i.getValue() ? theme.colors.text : theme.colors.textMuted }}>{fmtMoney(i.getValue())}</span> }),
    col.accessor('approvedAmount', { header: 'Approved $', size: 100, cell: i => <span style={{ fontSize: 12, fontWeight: 600, color: i.getValue() ? '#15803D' : theme.colors.textMuted }}>{fmtMoney(i.getValue())}</span> }),
    col.accessor('repairVendor', { header: 'Repair Tech', size: 140, cell: i => <span style={{ color: theme.colors.textSecondary, fontSize: 12 }}>{i.getValue() || '\u2014'}</span> }),
    col.accessor('assignedTo', { header: 'Assigned', size: 90, cell: i => <span style={{ fontSize: 12, color: i.getValue() ? theme.colors.text : theme.colors.textMuted }}>{i.getValue() || '\u2014'}</span> }),
    col.accessor('createdDate', { header: 'Created', size: 100, cell: i => <span style={{ fontSize: 12, color: theme.colors.textSecondary }}>{fmt(i.getValue())}</span> }),
    col.accessor('quoteSentDate', { header: 'Quote Sent', size: 100, cell: i => <span style={{ fontSize: 12, color: theme.colors.textMuted }}>{fmt(i.getValue())}</span> }),
    col.accessor('completedDate', { header: 'Completed', size: 100, cell: i => <span style={{ fontSize: 12, color: theme.colors.textMuted }}>{fmt(i.getValue())}</span> }),
    col.accessor('notes', { header: 'Notes', size: 200, cell: i => <span style={{ color: theme.colors.textSecondary, fontSize: 12, maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{i.getValue() || '\u2014'}</span> }),
    col.display({ id: 'actions', header: '', size: 40, enableSorting: false, cell: ({ row }) => <div className="row-actions" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', opacity: 0 }}><Eye size={15} color={theme.colors.textSecondary} style={{ cursor: 'pointer' }} onClick={() => (window as any).__openRepairDetail?.(row.original)} /></div> }),
  ];
}

export function Repairs() {
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

  const { repairs, apiRepairs, loading: repairsLoading, refetch: refetchRepairs, applyRepairPatch, mergeRepairPatch, clearRepairPatch, addOptimisticRepair, removeOptimisticRepair } = useRepairs(apiConfigured && clientFilter.length > 0, selectedSheetId);

  const columns = useMemo(() => cols(), []);
  const [selectedRepairId, setSelectedRepairId] = useState<string | null>(null);
  const findApiRepair = (repairId: string) => apiRepairs.find(r => r.repairId === repairId) || null;
  const selectedRepair = useMemo<ApiRepair | null>(() => (selectedRepairId ? apiRepairs.find(r => r.repairId === selectedRepairId) ?? null : null), [apiRepairs, selectedRepairId]);
  (window as any).__openRepairDetail = (r: Repair) => setSelectedRepairId(r.repairId);

  // Effect 1: ?open= query param → store pendingOpen + auto-load
  // (Dashboard now opens standalone page via #/repairs/:repairId — no route state needed)
  useEffect(() => {
    // Do NOT call refetchRepairs() here — it bypasses Supabase cache and
    // forces unscoped GAS (session 62). Data hook auto-fetches via
    // Supabase-first; Effect 2 opens the pending row when data arrives.
    if (location.search) {
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

  // Keep URL's ?client= param in sync with the dropdown (bookmarkable state)
  useClientFilterUrlSync(clientFilter, apiClients);

  // Resolve deep-link ?client= param once apiClients loads
  useEffect(() => {
    const tid = deepLinkPendingTenantRef.current;
    if (!tid || apiClients.length === 0 || clientFilterRef.current.length > 0) return;
    const match = apiClients.find(c => c.spreadsheetId === tid);
    if (match) {
      setClientFilter([match.name]);
      deepLinkPendingTenantRef.current = null;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiClients]);

  // Effect 2: When repairs arrive, open the pending repair
  useEffect(() => {
    if (pendingOpenRef.current && apiRepairs.length > 0) {
      const match = findApiRepair(pendingOpenRef.current);
      if (match) { setSelectedRepairId(match.repairId); pendingOpenRef.current = null; }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiRepairs]);
  const { sorting, setSorting, colVis, setColVis, columnOrder, setColumnOrder, statusFilter: sf, toggleStatus, clearStatusFilter } = useTablePreferences('repairs', [{ id: 'createdDate', desc: true }], {}, DEFAULT_COL_ORDER);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [rowSel, setRowSel] = useState<RowSelectionState>({});
  const [showCols, setShowCols] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => { if (!repairsLoading && refreshing) setRefreshing(false); }, [repairsLoading, refreshing]);
  const [batchGuardClients, setBatchGuardClients] = useState<string[] | null>(null);
  const [batchGuardAction, setBatchGuardAction] = useState('');
  const [dragColId, setDragColId] = useState<string | null>(null);
  const [dragOverColId, setDragOverColId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Page-level safety net: resolve clientName from apiClients if empty (race when Supabase fetch happens before useClients loaded)
  const idToName = useMemo<Record<string, string>>(() => { const m: Record<string, string> = {}; for (const c of apiClients) { m[c.spreadsheetId] = c.name; } return m; }, [apiClients]);
  const data = useMemo(() => { if (clientFilter.length === 0) return []; let d = (repairs as Repair[]).map(r => r.clientName ? r : { ...r, clientName: idToName[(r as any).clientSheetId || (r as any).clientId] || '' }); if (clientFilter.length) d = d.filter(r => clientFilter.includes(r.clientName)); if (sf.length) d = d.filter(r => sf.includes(r.status)); return d; }, [sf, clientFilter, repairs, idToName]);

  // Client-filter change is already handled by useRepairs (cacheKeyScope change
  // triggers useApiData refetch via Supabase-first path). A manual refetch() here
  // would force GAS (skipSupabaseCacheOnce) and hang the spinner on multi-client.
  const counts = useMemo(() => { const base = clientFilter.length === 0 ? [] : (repairs as Repair[]).map(r => r.clientName ? r : { ...r, clientName: idToName[(r as any).clientSheetId || (r as any).clientId] || '' }); const filtered = clientFilter.length > 0 && clientFilter.length < 999 ? base.filter(r => clientFilter.includes(r.clientName)) : base; const c: Record<string, number> = { '': filtered.length }; ALL_STATUSES.forEach(s => { c[s] = filtered.filter(r => r.status === s).length; }); return c; }, [repairs, clientFilter, idToName]);

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
  const [confirmSendQuoteOpen, setConfirmSendQuoteOpen] = useState(false);
  const [pendingBulkItems, setPendingBulkItems] = useState<Repair[]>([]);
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [bulkResult, setBulkResult] = useState<BatchMutationResult | null>(null);
  const [bulkResultLabel, setBulkResultLabel] = useState('');

  const handleBulkCancelRepairs = async () => {
    const items = pendingBulkItems;
    if (!items.length) return;

    const eligible: Repair[] = [];
    const preflightSkipped: Array<{ id: string; reason: string }> = [];
    for (const r of items) {
      const s = String(r.status || '').toLowerCase();
      if (s === 'cancelled') {
        preflightSkipped.push({ id: r.repairId, reason: 'Cannot cancel — status is Cancelled' });
      } else if (s === 'complete' || s === 'completed') {
        preflightSkipped.push({ id: r.repairId, reason: `Cannot cancel — status is ${r.status}` });
      } else if (s === 'invoiced') {
        preflightSkipped.push({ id: r.repairId, reason: 'Cannot cancel — status is Invoiced' });
      } else {
        eligible.push(r);
      }
    }

    if (eligible.length === 0) {
      setConfirmCancelOpen(false);
      setBulkResult({
        success: true,
        processed: preflightSkipped.length,
        succeeded: 0, failed: 0,
        skipped: preflightSkipped,
        errors: [],
        message: 'All selections were ineligible',
      });
      setBulkResultLabel('Cancel Repairs');
      return;
    }

    const clientSheetId = eligible[0].clientSheetId || '';
    if (!apiConfigured || !clientSheetId) return;

    setBulkProcessing(true);
    try {
      const resp = await postBatchCancelRepairs({ repairIds: eligible.map(r => r.repairId) }, clientSheetId);
      const serverResult: BatchMutationResult = (resp.ok && resp.data) ? resp.data : {
        success: false,
        processed: eligible.length,
        succeeded: 0, failed: eligible.length,
        skipped: [],
        errors: eligible.map(r => ({ id: r.repairId, reason: resp.error || 'Request failed' })),
        message: resp.error || 'Batch cancel failed',
      };
      setBulkResult(mergePreflightSkips(serverResult, preflightSkipped));
      setBulkResultLabel('Cancel Repairs');
      setRowSel({});
      refetchRepairs();
    } finally {
      setBulkProcessing(false);
      setConfirmCancelOpen(false);
    }
  };

  const handleBulkSendQuote = async () => {
    const items = pendingBulkItems;
    if (!items.length) return;

    // Send Repair Quote requires a quoteAmount per repair. Bulk send only
    // includes repairs that (a) are in Pending Quote status AND (b) already
    // have a quoteAmount > 0 saved on the Repairs row (from a prior edit in
    // the detail panel). Repairs without a quote amount are skipped — users
    // must set the amount in the single-repair detail panel first.
    const eligible: Repair[] = [];
    const preflightSkipped: Array<{ id: string; reason: string }> = [];
    for (const r of items) {
      if (r.status !== 'Pending Quote') {
        preflightSkipped.push({ id: r.repairId, reason: `Quote already sent (status=${r.status})` });
      } else if (!r.quoteAmount || r.quoteAmount <= 0) {
        preflightSkipped.push({ id: r.repairId, reason: 'No quote amount set — set it in the detail panel first' });
      } else {
        eligible.push(r);
      }
    }

    if (eligible.length === 0) {
      setConfirmSendQuoteOpen(false);
      setBulkResult({
        success: true,
        processed: preflightSkipped.length,
        succeeded: 0, failed: 0,
        skipped: preflightSkipped,
        errors: [],
        message: 'All selections were ineligible',
      });
      setBulkResultLabel('Send Repair Quotes');
      return;
    }

    const clientSheetId = eligible[0].clientSheetId || '';
    if (!apiConfigured || !clientSheetId) return;

    setBulkProcessing(true);
    setBulkProgress({ done: 0, total: eligible.length });
    try {
      const loopResult = await runBatchLoop<Repair, unknown>({
        items: eligible.map(r => ({ id: r.repairId, item: r })),
        call: async (r) => {
          const resp = await postSendRepairQuote(
            { repairId: r.repairId, quoteAmount: r.quoteAmount! },
            clientSheetId
          );
          return { ok: !!(resp.ok && resp.data?.success), data: resp.data, error: resp.error || resp.data?.error };
        },
        onProgress: (done, total) => setBulkProgress({ done, total }),
        preflightSkipped,
      });
      setBulkResult(loopResult);
      setBulkResultLabel('Send Repair Quotes');
      setRowSel({});
      refetchRepairs();
    } finally {
      setBulkProcessing(false);
      setBulkProgress(null);
      setConfirmSendQuoteOpen(false);
    }
  };

  useEffect(() => { const h = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowCols(false); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, []);

  const chip = (active: boolean): React.CSSProperties => ({ padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: `1px solid ${active ? theme.colors.orange : theme.colors.border}`, background: active ? theme.colors.orangeLight : 'transparent', color: active ? theme.colors.orange : theme.colors.textSecondary, transition: 'all 0.15s', whiteSpace: 'nowrap' });
  const th: React.CSSProperties = { padding: '10px 12px', textAlign: 'left', fontWeight: 500, fontSize: 11, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: `1px solid ${theme.colors.borderLight}`, position: 'sticky', top: 0, background: '#fff', zIndex: 2, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { padding: '10px 12px', borderBottom: `1px solid ${theme.colors.borderLight}`, fontSize: 13, whiteSpace: 'nowrap' };

  if (apiConfigured && repairsLoading && repairs.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 300, gap: 12 }}>
        <div style={{ width: 32, height: 32, border: '3px solid #E5E7EB', borderTopColor: theme.colors.orange, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <span style={{ fontSize: 13, color: theme.colors.textMuted }}>Loading repairs...</span>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}><h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.3px' }}>Repairs</h1><p style={{ fontSize: 13, color: theme.colors.textMuted, marginTop: 2 }}>Quote workflow, approval tracking, and vendor management</p></div>

      <SyncBanner syncing={refreshing} label={clientFilter.length === 1 ? clientFilter[0] : clientFilter.length > 1 ? `${clientFilter.length} clients` : undefined} />

      {/* Client Filter */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 12, flexWrap: 'wrap' }}>
        <MultiSelectFilter label="Client" options={dropdownClientNames} selected={clientFilter} onChange={setClientFilter} placeholder="Select client(s)..." />
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: 320 }}><Search size={15} color={theme.colors.textMuted} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} /><input value={globalFilter} onChange={e => setGlobalFilter(e.target.value)} placeholder="Search repairs..." style={{ width: '100%', padding: '7px 10px 7px 32px', fontSize: 13, border: `1px solid ${theme.colors.border}`, borderRadius: 8, outline: 'none', background: theme.colors.bgSubtle, fontFamily: 'inherit' }} /></div>
        <div style={{ flex: 1 }} />
        <div style={{ position: 'relative' }} ref={menuRef}>
          <button onClick={() => setShowCols(v => !v)} style={{ padding: '7px 12px', fontSize: 12, fontWeight: 500, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'inherit', color: theme.colors.textSecondary }}><Settings2 size={14} /> Columns</button>
          {showCols && <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, background: '#fff', border: `1px solid ${theme.colors.border}`, borderRadius: 10, padding: 8, zIndex: 50, boxShadow: '0 4px 20px rgba(0,0,0,0.1)', minWidth: 180 }}>{TOGGLEABLE.map(id => <label key={id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', fontSize: 12, cursor: 'pointer', borderRadius: 4 }}><input type="checkbox" checked={colVis[id] !== false} onChange={() => setColVis(v => ({ ...v, [id]: v[id] === false }))} style={{ accentColor: theme.colors.orange }} />{COL_LABELS[id]}</label>)}</div>}
        </div>
        <button onClick={() => toCSV(data, 'stride-repairs.csv')} style={{ padding: '7px 12px', fontSize: 12, fontWeight: 500, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'inherit', color: theme.colors.textSecondary }}><Download size={14} /> Export</button>
        <button onClick={() => { setRefreshing(true); refetchRepairs(); }} title="Refresh data" style={{ padding: '7px 8px', fontSize: 12, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', color: (refreshing || repairsLoading) ? theme.colors.orange : theme.colors.textSecondary, transition: 'color 0.2s' }}><RefreshCw size={14} style={(refreshing || repairsLoading) ? { animation: 'spin 1s linear infinite' } : undefined} /></button>
      </div>
      <div style={mobileChipsRow(isMobile)}>
        <button onClick={() => clearStatusFilter()} style={chip(sf.length === 0)}>All ({counts['']})</button>
        {ALL_STATUSES.map(s => <button key={s} onClick={() => toggleStatus(s)} style={chip(sf.includes(s))}>{s} ({counts[s] || 0})</button>)}
        {!isMobile && <div style={{ flex: 1 }} />}
        {!isMobile && <span style={{ fontSize: 12, color: theme.colors.textMuted, alignSelf: 'center' }}>Showing <strong>{table.getRowModel().rows.length}</strong> of <strong>{data.length}</strong> repairs</span>}
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
                style={{ ...th, width: h.getSize(), color: h.column.getIsSorted() ? theme.colors.orange : theme.colors.textMuted, background: isDragTarget ? theme.colors.orangeLight : '#fff', cursor: h.id !== 'select' && h.id !== 'actions' ? 'grab' : 'default', borderLeft: isDragTarget ? `2px solid ${theme.colors.orange}` : undefined, ...(h.id === 'select' ? { position: 'sticky' as const, left: 0, zIndex: 3 } : {}) }}
                onClick={h.column.getCanSort() ? (e: React.MouseEvent) => h.column.toggleSorting(undefined, e.shiftKey) : undefined}
              ><div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}{h.column.getCanSort() && (h.column.getIsSorted() === 'asc' ? <ChevronUp size={13} color={theme.colors.orange} /> : h.column.getIsSorted() === 'desc' ? <ChevronDown size={13} color={theme.colors.orange} /> : <ArrowUpDown size={13} color={theme.colors.textMuted} />)}</div></th>;
            })}</tr>)}</thead>
            <tbody>
              {virtualRows.length > 0 && <tr style={{ height: virtualRows[0].start }}><td colSpan={table.getVisibleFlatColumns().length} /></tr>}
              {virtualRows.map(vRow => { const row = allRows[vRow.index]; const r = row.original as unknown as Repair; const isActivePanel = selectedRepair?.repairId === r.repairId; const rowBg = row.getIsSelected() ? theme.colors.orangeLight : isActivePanel ? '#FEF3EE' : 'transparent'; return <tr key={row.id} style={{ transition: 'background 0.1s', background: rowBg, cursor: 'pointer', borderLeft: isActivePanel ? `3px solid ${theme.colors.orange}` : '3px solid transparent' }} onClick={(e) => { if (!(e.target as HTMLElement).closest('input[type="checkbox"]') && !(e.target as HTMLElement).closest('.row-actions')) { setSelectedRepairId(r.repairId); }; }} onMouseEnter={e => { if (!row.getIsSelected() && !isActivePanel) e.currentTarget.style.background = theme.colors.bgSubtle; const a = e.currentTarget.querySelector('.row-actions') as HTMLElement; if (a) a.style.opacity = '0.6'; }} onMouseLeave={e => { e.currentTarget.style.background = rowBg; const a = e.currentTarget.querySelector('.row-actions') as HTMLElement; if (a) a.style.opacity = '0'; }}>{row.getVisibleCells().map(cell => <td key={cell.id} style={{ ...td, ...(cell.column.id === 'select' ? { position: 'sticky' as const, left: 0, zIndex: 1, background: '#fff' } : {}) }}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}</tr>; })}
              {virtualRows.length > 0 && <tr style={{ height: totalHeight - (virtualRows[virtualRows.length - 1].end) }}><td colSpan={table.getVisibleFlatColumns().length} /></tr>}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '8px 16px', borderTop: `1px solid ${theme.colors.borderLight}`, fontSize: 12, color: theme.colors.textMuted }}>
          {allRows.length} row{allRows.length !== 1 ? 's' : ''}
        </div>
      </div>
      {selCount > 0 && !isMobile && createPortal(<div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100, background: '#1A1A1A', borderTop: '1px solid #333', padding: '12px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', animation: 'slideUp 0.2s ease-out' }}><div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><span style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>{selCount} repair{selCount !== 1 ? 's' : ''} selected</span><button onClick={() => setRowSel({})} style={{ background: 'transparent', border: '1px solid #555', borderRadius: 6, color: '#999', padding: '4px 10px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Clear</button></div><div style={{ display: 'flex', gap: 8 }}><WriteButton label="Send Quote" variant="ghost" size="sm" onClick={async () => { const items = table.getSelectedRowModel().rows.map(r => r.original); const guard = checkBatchClientGuard(items); if (guard) { setBatchGuardClients(guard); setBatchGuardAction('Send Quote'); return; } setPendingBulkItems(items); setConfirmSendQuoteOpen(true); }} /><WriteButton label="Cancel" variant="ghost" size="sm" onClick={async () => { const items = table.getSelectedRowModel().rows.map(r => r.original); const guard = checkBatchClientGuard(items); if (guard) { setBatchGuardClients(guard); setBatchGuardAction('Cancel'); return; } setPendingBulkItems(items); setConfirmCancelOpen(true); }} /><button onClick={() => toCSV(table.getSelectedRowModel().rows.map(r => r.original), 'stride-repairs-selected.csv')} style={{ padding: '7px 16px', fontSize: 12, fontWeight: 600, border: 'none', borderRadius: 8, background: theme.colors.orange, color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>Export Selected</button></div></div>, document.body)}
      <ConfirmDialog
        open={confirmCancelOpen}
        title="Cancel repairs"
        message={`Cancel ${pendingBulkItems.length} repair${pendingBulkItems.length === 1 ? '' : 's'}? Completed, invoiced, and already-cancelled repairs will be skipped.`}
        confirmLabel="Cancel repairs"
        cancelLabel="Back"
        variant="danger"
        onConfirm={handleBulkCancelRepairs}
        onCancel={() => setConfirmCancelOpen(false)}
        processing={bulkProcessing}
      />
      <ConfirmDialog
        open={confirmSendQuoteOpen}
        title="Send quote emails"
        message={`Send quote emails for ${pendingBulkItems.length} repair${pendingBulkItems.length === 1 ? '' : 's'}? Each quote generates a PDF and emails the client. Only Pending Quote repairs will be processed.`}
        confirmLabel="Send quotes"
        cancelLabel="Back"
        onConfirm={handleBulkSendQuote}
        onCancel={() => setConfirmSendQuoteOpen(false)}
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
            actionLabel="Sending quotes"
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
      {selectedRepair && <RepairDetailPanel repair={selectedRepair} onClose={() => setSelectedRepairId(null)} onRepairUpdated={refetchRepairs} onNavigateToItem={(itemId) => navigate('/inventory', { state: { openItemId: itemId } })} applyRepairPatch={applyRepairPatch} mergeRepairPatch={mergeRepairPatch} clearRepairPatch={clearRepairPatch} addOptimisticRepair={addOptimisticRepair} removeOptimisticRepair={removeOptimisticRepair} />}
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
            { label: 'Send Quotes', icon: <SendIcon size={16} />, onClick: () => { setPendingBulkItems(items); setConfirmSendQuoteOpen(true); }},
            { label: 'Cancel Repairs', icon: <XCircle size={16} />, color: '#DC2626', onClick: () => { setPendingBulkItems(items); setConfirmCancelOpen(true); }},
            { label: 'Export', icon: <Download size={16} />, onClick: () => { toCSV(items, 'stride-repairs-export.csv'); }},
          );
          return fabActions;
        })()}
      />
    </div>
  );
}
