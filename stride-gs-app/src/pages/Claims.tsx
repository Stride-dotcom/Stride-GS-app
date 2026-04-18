import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useIsMobile } from '../hooks/useIsMobile';
import { useTablePreferences } from '../hooks/useTablePreferences';
import { createPortal } from 'react-dom';
import {
  useReactTable, getCoreRowModel, getSortedRowModel, getFilteredRowModel,
  getPaginationRowModel, flexRender, createColumnHelper,
  type RowSelectionState, type FilterFn,
} from '@tanstack/react-table';
import {
  Eye, FileText, Search, Download, ChevronUp, ChevronDown,
  ArrowUpDown, ChevronLeft, ChevronRight, Settings2, Shield, Plus, RefreshCw,
} from 'lucide-react';
import { useVirtualRows } from '../hooks/useVirtualRows';
import { theme } from '../styles/theme';
import { fmtDate } from '../lib/constants';
import { ClaimDetailPanel } from '../components/shared/ClaimDetailPanel';
import { CreateClaimModal } from '../components/shared/CreateClaimModal';
import { WriteButton } from '../components/shared/WriteButton';
import { MultiSelectFilter } from '../components/shared/MultiSelectFilter';
import { isApiConfigured } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { useClaims } from '../hooks/useClaims';
import { useClients } from '../hooks/useClients';
import type { Claim, ClaimType, ClaimStatus } from '../lib/types';

const ALL_STATUSES: ClaimStatus[] = [
  'Under Review', 'Waiting on Info', 'Settlement Sent', 'Approved', 'Closed', 'Void',
];
const ALL_TYPES: ClaimType[] = ['Item Claim', 'Property Claim'];

const STATUS_CFG: Record<string, { bg: string; text: string }> = {
  'Under Review':    { bg: '#FEF3C7', text: '#B45309' },
  'Waiting on Info': { bg: '#EFF6FF', text: '#1D4ED8' },
  'Settlement Sent': { bg: '#EDE9FE', text: '#7C3AED' },
  'Approved':        { bg: '#F0FDF4', text: '#15803D' },
  'Closed':          { bg: '#F3F4F6', text: '#6B7280' },
  'Void':            { bg: '#F3F4F6', text: '#9CA3AF' },
};

const TYPE_CFG: Record<string, { bg: string; text: string }> = {
  'Item Claim':     { bg: '#FEF3EE', text: '#E85D2D' },
  'Property Claim': { bg: '#FEF2F2', text: '#DC2626' },
};

const OUTCOME_CFG: Record<string, { bg: string; text: string }> = {
  'Approved':         { bg: '#F0FDF4', text: '#15803D' },
  'Partial Approval': { bg: '#FEF3C7', text: '#B45309' },
  'Denied':           { bg: '#FEF2F2', text: '#DC2626' },
  'Withdrawn':        { bg: '#F3F4F6', text: '#6B7280' },
};

const COL_LABELS: Record<string, string> = {
  claimId: 'Claim ID',
  companyClientName: 'Client',
  claimType: 'Type',
  status: 'Status',
  outcomeType: 'Outcome',
  issueDescription: 'Description',
  requestedAmount: 'Requested',
  approvedAmount: 'Approved',
  createdBy: 'Created By',
  dateOpened: 'Opened',
  incidentDate: 'Incident',
  dateClosed: 'Closed',
  incidentLocation: 'Location',
};
const TOGGLEABLE = Object.keys(COL_LABELS);
const DEFAULT_COL_ORDER = ['select', 'claimId', 'companyClientName', 'claimType', 'status', 'outcomeType', 'issueDescription', 'requestedAmount', 'approvedAmount', 'createdBy', 'dateOpened', 'incidentDate', 'dateClosed', 'incidentLocation', 'actions'];

const mf: FilterFn<Claim> = (row, colId, val: string[]) => {
  if (!val || !val.length) return true;
  return val.includes(String(row.getValue(colId)));
};
mf.autoRemove = (v: string[]) => !v || !v.length;

const fmt = fmtDate;
function fmtMoney(n?: number) {
  if (n == null) return '—';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0 });
}
function Badge({ t, c }: { t: string; c?: { bg: string; text: string } }) {
  const s = c || { bg: '#F3F4F6', text: '#6B7280' };
  return (
    <span style={{
      display: 'inline-block', padding: '2px 10px', borderRadius: 12, fontSize: 11,
      fontWeight: 600, letterSpacing: '0.02em', background: s.bg, color: s.text, whiteSpace: 'nowrap',
    }}>{t}</span>
  );
}

function toCSV(rows: Claim[], fn: string) {
  const h = 'Claim ID,Client,Type,Status,Outcome,Description,Requested,Approved,Opened,Incident';
  const b = rows.map(r => [
    r.claimId, r.companyClientName, r.claimType, r.status,
    r.outcomeType || '', r.issueDescription || '',
    r.requestedAmount ?? '', r.approvedAmount ?? '',
    r.dateOpened, r.incidentDate || '',
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const bl = new Blob([h + '\n' + b], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(bl);
  a.download = fn;
  a.click();
}

const col = createColumnHelper<Claim>();
function cols() {
  return [
    col.display({
      id: 'select',
      header: ({ table }) => (
        <input type="checkbox" checked={table.getIsAllPageRowsSelected()}
          onChange={table.getToggleAllPageRowsSelectedHandler()}
          style={{ cursor: 'pointer', accentColor: theme.colors.orange }} />
      ),
      cell: ({ row }) => (
        <input type="checkbox" checked={row.getIsSelected()}
          onChange={row.getToggleSelectedHandler()}
          style={{ cursor: 'pointer', accentColor: theme.colors.orange }} />
      ),
      size: 40, enableSorting: false,
    }),
    col.accessor('claimId', {
      header: 'Claim ID', size: 100,
      cell: i => <span style={{ fontWeight: 600, fontSize: 12 }}>{i.getValue()}</span>,
    }),
    col.accessor('status', {
      header: 'Status', size: 130, filterFn: mf,
      cell: i => <Badge t={i.getValue()} c={STATUS_CFG[i.getValue()]} />,
    }),
    col.accessor('claimType', {
      header: 'Type', size: 120, filterFn: mf,
      cell: i => <Badge t={i.getValue()} c={TYPE_CFG[i.getValue()]} />,
    }),
    col.accessor('companyClientName', {
      header: 'Client', size: 160, filterFn: mf,
      cell: i => <span style={{ fontWeight: 500, fontSize: 12 }}>{i.getValue()}</span>,
    }),
    col.accessor('issueDescription', {
      header: 'Description', size: 260,
      cell: i => (
        <span style={{
          color: theme.colors.textSecondary, fontSize: 12, maxWidth: 240,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block',
        }}>{i.getValue() || '—'}</span>
      ),
    }),
    col.accessor('outcomeType', {
      header: 'Outcome', size: 120, filterFn: mf,
      cell: i => i.getValue()
        ? <Badge t={i.getValue()!} c={OUTCOME_CFG[i.getValue()!]} />
        : <span style={{ color: theme.colors.textMuted, fontSize: 12 }}>—</span>,
    }),
    col.accessor('requestedAmount', {
      header: 'Requested', size: 95,
      cell: i => (
        <span style={{ fontSize: 12, fontWeight: 600, color: i.getValue() ? theme.colors.text : theme.colors.textMuted }}>
          {fmtMoney(i.getValue())}
        </span>
      ),
    }),
    col.accessor('approvedAmount', {
      header: 'Approved', size: 95,
      cell: i => (
        <span style={{ fontSize: 12, fontWeight: 600, color: i.getValue() ? '#15803D' : theme.colors.textMuted }}>
          {fmtMoney(i.getValue())}
        </span>
      ),
    }),
    col.accessor('createdBy', {
      header: 'Created By', size: 110,
      cell: i => {
        const v = i.getValue();
        const name = v ? v.split('@')[0] : null;
        return <span style={{ fontSize: 12, color: name ? theme.colors.text : theme.colors.textMuted }}>{name || '—'}</span>;
      },
    }),
    col.accessor('dateOpened', {
      header: 'Opened', size: 90,
      cell: i => <span style={{ fontSize: 12, color: theme.colors.textSecondary }}>{fmt(i.getValue())}</span>,
    }),
    col.accessor('incidentDate', {
      header: 'Incident', size: 90,
      cell: i => <span style={{ fontSize: 12, color: theme.colors.textMuted }}>{fmt(i.getValue())}</span>,
    }),
    col.accessor('dateClosed', {
      header: 'Closed', size: 90,
      cell: i => <span style={{ fontSize: 12, color: theme.colors.textMuted }}>{fmt(i.getValue())}</span>,
    }),
    col.accessor('incidentLocation', {
      header: 'Location', size: 130,
      cell: i => (
        <span style={{ color: theme.colors.textSecondary, fontSize: 12, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
          {i.getValue() || '—'}
        </span>
      ),
    }),
    col.display({
      id: 'actions', header: '', size: 60, enableSorting: false,
      cell: ({ row }) => (
        <div className="row-actions" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', opacity: 0 }}>
          <Eye size={15} color={theme.colors.textSecondary} style={{ cursor: 'pointer' }}
            onClick={() => (window as any).__openClaimDetail?.(row.original)} />
        </div>
      ),
    }),
  ];
}

export function Claims() {
  const { isMobile } = useIsMobile();
  const hasApi = isApiConfigured();

  // Claims always fetches (not gated by client filter) because claims can be filed
  // for non-managed clients (e.g. "Michelle Dirkse Interiors" who isn't in CB Clients)
  const { clients } = useClients();
  const [clientFilter, setClientFilter] = useState<string[]>([]);
  const { user: authUser } = useAuth();
  useEffect(() => {
    if (authUser?.role === 'client' && authUser.accessibleClientNames?.length && clientFilter.length === 0) {
      setClientFilter(authUser.accessibleClientNames);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.role, authUser?.accessibleClientNames?.length]);

  const {
    claims: liveClaims,
    loading: apiLoading,
    error: apiError,
    refetch,
    applyClaimPatch,
    mergeClaimPatch,
    clearClaimPatch,
    addOptimisticClaim,
    removeOptimisticClaim,
  } = useClaims(hasApi);

  // Client filter options: merge managed clients + unique client names from claims data.
  // Client-role users only see their own accounts — admin sees everything.
  const clientNames = useMemo(() => {
    const names = new Set(clients.map(c => c.name));
    for (const c of liveClaims) { if (c.companyClientName) names.add(c.companyClientName); }
    const all = Array.from(names).sort();
    if (authUser?.role === 'client' && authUser.accessibleClientNames?.length) {
      const allowed = new Set(authUser.accessibleClientNames);
      return all.filter(n => allowed.has(n));
    }
    return all;
  }, [clients, liveClaims, authUser?.role, authUser?.accessibleClientNames]);
  const apiSucceeded = hasApi && !apiError && !apiLoading;
  const isLive = apiSucceeded;
  const isDemo = !hasApi;

  const { colVis: columnVisibility, setColVis: setColumnVisibility, sorting, setSorting, columnOrder, setColumnOrder } = useTablePreferences('claims', [{ id: 'dateOpened', desc: true }], { outcomeType: false, dateClosed: false, incidentLocation: false, createdBy: false }, DEFAULT_COL_ORDER);
  // columnFilters removed — status/type/client filtering done in data useMemo
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [globalFilter, setGlobalFilter] = useState('');
  const [selectedClaim, setSelectedClaim] = useState<Claim | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showColMenu, setShowColMenu] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => { if (!apiLoading && refreshing) setRefreshing(false); }, [apiLoading, refreshing]);
  const [dragColId, setDragColId] = useState<string | null>(null);
  const [dragOverColId, setDragOverColId] = useState<string | null>(null);
  const colBtnRef = useRef<HTMLButtonElement>(null);
  const colMenuRef = useRef<HTMLDivElement>(null);
  const [statusFilter, setStatusFilterRaw] = useState<string[]>(() => {
    try { const v = localStorage.getItem('stride_filter_claims_status'); return v ? JSON.parse(v) : []; } catch { return []; }
  });
  const setStatusFilter = useCallback((v: string[]) => { setStatusFilterRaw(v); try { localStorage.setItem('stride_filter_claims_status', JSON.stringify(v)); } catch {} }, []);
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  // showStatusDrop/showTypeDrop/showClientDrop removed — using MultiSelectFilter components

  // ALL_CLIENTS removed — using clientNames from useClients instead

  // Client-side filtering by selected clients + status + type
  // Empty clientFilter = show ALL claims (Claims always fetches, unlike other pages)
  const data: Claim[] = useMemo(() => {
    let d = liveClaims;
    if (clientFilter.length > 0) d = d.filter(c => clientFilter.includes(c.companyClientName));
    if (statusFilter.length) d = d.filter(c => statusFilter.includes(c.status));
    if (typeFilter.length) d = d.filter(c => typeFilter.includes(c.claimType));
    return d;
  }, [liveClaims, clientFilter, statusFilter, typeFilter]);

  useEffect(() => {
    (window as any).__openClaimDetail = (c: Claim) => setSelectedClaim(c);
    return () => { delete (window as any).__openClaimDetail; };
  }, []);

  // Close column menu on outside click
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (colMenuRef.current && !colMenuRef.current.contains(e.target as Node) &&
          colBtnRef.current && !colBtnRef.current.contains(e.target as Node)) {
        setShowColMenu(false);
      }
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  // Status + Type filtering moved to data useMemo (client-side) — no more useEffect/setColumnFilters loop

  // Memoize columns — cols() must NOT be called inline (causes infinite re-render loop)
  const columns = useMemo(() => cols(), []);

  const table = useReactTable({
    data, columns,
    state: { sorting, columnVisibility, rowSelection, globalFilter, columnOrder: columnOrder.length ? columnOrder : DEFAULT_COL_ORDER },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onGlobalFilterChange: setGlobalFilter,
    onColumnOrderChange: (updater) => setColumnOrder(typeof updater === 'function' ? updater(columnOrder.length ? columnOrder : DEFAULT_COL_ORDER) : updater),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    enableMultiSort: true,
    initialState: { pagination: { pageSize: 50 } },
    getRowId: r => r.claimId,
    enableRowSelection: true,
  });

  const { containerRef, virtualRows, rows: allRows, totalHeight } = useVirtualRows(table);
  const selectedRows = table.getSelectedRowModel().rows.map(r => r.original);

  // Stats
  const openCount = data.filter(c => ['Under Review', 'Waiting on Info', 'Settlement Sent'].includes(c.status)).length;
  const resolvedCount = data.filter(c => ['Approved', 'Closed'].includes(c.status)).length;
  const totalRequested = data.reduce((s, c) => s + (c.requestedAmount ?? 0), 0);
  const totalApproved = data.reduce((s, c) => s + (c.approvedAmount ?? 0), 0);

  // FilterDrop removed — replaced by MultiSelectFilter components in the toolbar

  return (
    <div style={{ fontFamily: theme.typography.fontFamily, background: '#F5F2EE', margin: '-28px -32px', padding: '28px 32px', minHeight: '100%' }}>
      {/* Page Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: '1px', color: '#1C1C1C' }}>
            STRIDE LOGISTICS · CLAIMS
          </div>
          {isLive && <span style={{ fontSize: 10, fontWeight: 600, color: '#15803D', background: '#F0FDF4', padding: '2px 10px', borderRadius: 100, textTransform: 'uppercase', letterSpacing: '1px' }}>Live</span>}
          {isDemo && <span style={{ fontSize: 10, fontWeight: 600, color: '#B45309', background: '#FEF3C7', padding: '2px 10px', borderRadius: 100, textTransform: 'uppercase', letterSpacing: '1px' }}>Demo</span>}
          {hasApi && apiLoading && <span style={{ fontSize: 10, color: theme.colors.textMuted }}>Loading...</span>}
        </div>
        <WriteButton
          label="New Claim"
          icon={<Plus size={14} />}
          onClick={async () => setShowCreateModal(true)}
        />
      </div>
      <div style={{ background: '#FFFFFF', borderRadius: 20, padding: 24, border: '1px solid rgba(0,0,0,0.04)' }}>

      {/* Client Filter */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 12, flexWrap: 'wrap' }}>
        <MultiSelectFilter label="Client" options={clientNames} selected={clientFilter} onChange={setClientFilter} placeholder="Select client(s)..." />
      </div>

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        {[
          { label: 'Total Claims', value: data.length, color: '#fff' },
          { label: 'Open', value: openCount, color: '#FBBF24' },
          { label: 'Resolved', value: resolvedCount, color: '#4ADE80' },
          { label: 'Total Requested', value: fmtMoney(totalRequested), color: '#C084FC' },
        ].map(c => (
          <div key={c.label} style={{
            background: '#1C1C1C', border: 'none', borderRadius: 20, padding: '20px 22px',
          }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '2px', marginBottom: 10 }}>{c.label}</div>
            <div style={{ fontSize: 28, fontWeight: 300, color: c.color, lineHeight: 1 }}>{c.value}</div>
            {c.label === 'Resolved' && totalApproved > 0 && (
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', marginTop: 8 }}>
                {fmtMoney(totalApproved)} approved
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: 300 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: theme.colors.textMuted }} />
          <input
            value={globalFilter}
            onChange={e => setGlobalFilter(e.target.value)}
            placeholder="Search claims..."
            style={{
              width: '100%', padding: '10px 16px 10px 36px', fontSize: 13,
              border: '1px solid rgba(0,0,0,0.08)', borderRadius: 100, outline: 'none', background: '#fff',
              fontFamily: theme.typography.fontFamily,
            }}
          />
        </div>
        <MultiSelectFilter label="Status" options={ALL_STATUSES} selected={statusFilter} onChange={setStatusFilter} placeholder="All Statuses" />
        <MultiSelectFilter label="Type" options={ALL_TYPES} selected={typeFilter} onChange={setTypeFilter} placeholder="All Types" />
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button
            onClick={() => toCSV(data, `claims-export-${new Date().toISOString().slice(0, 10)}.csv`)}
            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px', fontSize: 11, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', color: theme.colors.textSecondary }}
          >
            <Download size={13} /> CSV
          </button>
          <button
            ref={colBtnRef}
            onClick={() => setShowColMenu(!showColMenu)}
            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px', fontSize: 11, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', color: theme.colors.textSecondary }}
          >
            <Settings2 size={13} /> Columns
          </button>
          <button onClick={() => { setRefreshing(true); refetch(); }} title="Refresh data" style={{ padding: '6px 7px', fontSize: 11, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', color: (refreshing || apiLoading) ? theme.colors.orange : theme.colors.textSecondary, transition: 'color 0.2s' }}><RefreshCw size={13} style={(refreshing || apiLoading) ? { animation: 'spin 1s linear infinite' } : undefined} /></button>
        </div>
      </div>

      {/* Column toggle menu */}
      {showColMenu && createPortal(
        <div ref={colMenuRef} style={{
          position: 'fixed',
          top: (colBtnRef.current?.getBoundingClientRect().bottom ?? 0) + 4,
          left: (colBtnRef.current?.getBoundingClientRect().left ?? 0),
          background: '#fff', border: `1px solid ${theme.colors.border}`, borderRadius: 10,
          boxShadow: theme.shadows.lg, zIndex: 200, padding: 8, minWidth: 180,
        }}>
          {TOGGLEABLE.map(id => {
            const isVis = columnVisibility[id] !== false;
            return (
              <label key={id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', fontSize: 12, cursor: 'pointer', borderRadius: 4 }}>
                <input type="checkbox" checked={isVis}
                  onChange={() => setColumnVisibility(prev => ({ ...prev, [id]: !isVis }))}
                  style={{ accentColor: theme.colors.orange }} />
                {COL_LABELS[id]}
              </label>
            );
          })}
        </div>, document.body
      )}

      {/* Table */}
      {/* Empty-state message now inside table body — see allRows.length === 0 block */}
      <div style={{ background: '#fff', border: `1px solid ${theme.colors.border}`, borderRadius: isMobile ? 8 : 12, overflow: 'hidden' }}>
        <div ref={containerRef} style={{ overflowY: 'auto', overflowX: 'auto', maxHeight: isMobile ? 'calc(100dvh - 200px)' : 'calc(100dvh - 280px)', minHeight: isMobile ? 200 : undefined, WebkitOverflowScrolling: 'touch' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: isMobile ? 600 : undefined }}>
            <thead>
              {table.getHeaderGroups().map(hg => (
                <tr key={hg.id} style={{ borderBottom: `1px solid ${theme.colors.border}` }}>
                  {hg.headers.map(h => {
                    const isDragTarget = dragOverColId === h.id && dragColId !== h.id;
                    return (
                      <th key={h.id}
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
                        style={{
                          padding: '14px 12px', textAlign: 'left', fontSize: 10, fontWeight: 600,
                          color: h.column.getIsSorted() ? theme.colors.orange : '#888', textTransform: 'uppercase', letterSpacing: '2px',
                          whiteSpace: 'nowrap', cursor: h.id !== 'select' && h.id !== 'actions' ? 'grab' : 'default',
                          userSelect: 'none', width: h.getSize(),
                          background: isDragTarget ? theme.colors.orangeLight : '#F5F2EE',
                          borderLeft: isDragTarget ? `2px solid ${theme.colors.orange}` : undefined,
                        }} onClick={(e: React.MouseEvent) => h.column.toggleSorting(undefined, e.shiftKey)}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {h.column.getCanSort() && (
                            h.column.getIsSorted() === 'asc' ? <ChevronUp size={12} color={theme.colors.orange} /> :
                            h.column.getIsSorted() === 'desc' ? <ChevronDown size={12} color={theme.colors.orange} /> :
                            <ArrowUpDown size={12} style={{ opacity: 0.3 }} />
                          )}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {virtualRows.length > 0 && <tr style={{ height: virtualRows[0].start }}><td colSpan={table.getVisibleLeafColumns().length} /></tr>}
              {virtualRows.map(vRow => { const row = allRows[vRow.index]; const isActivePanel = selectedClaim?.claimId === row.original.claimId; const rowBg = isActivePanel ? '#FEF3EE' : ''; return (
                <tr key={row.id}
                  style={{ borderBottom: `1px solid ${theme.colors.borderSubtle}`, cursor: 'pointer', transition: 'background 0.1s', background: rowBg, borderLeft: isActivePanel ? `3px solid ${theme.colors.orange}` : '3px solid transparent' }}
                  onMouseEnter={e => { if (!isActivePanel) e.currentTarget.style.background = theme.colors.bgSubtle; const a = e.currentTarget.querySelector('.row-actions') as HTMLElement; if (a) a.style.opacity = '1'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = rowBg; const a = e.currentTarget.querySelector('.row-actions') as HTMLElement; if (a) a.style.opacity = '0'; }}
                  onClick={() => setSelectedClaim(row.original)}
                >
                  {row.getVisibleCells().map(cell => (
                    <td key={cell.id} style={{ padding: '8px 12px', verticalAlign: 'middle' }}
                      onClick={e => { if (cell.column.id === 'select') e.stopPropagation(); }}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ); })}
              {virtualRows.length > 0 && <tr style={{ height: totalHeight - (virtualRows[virtualRows.length - 1].end) }}><td colSpan={table.getVisibleLeafColumns().length} /></tr>}
              {allRows.length === 0 && (
                <tr>
                  <td colSpan={table.getVisibleLeafColumns().length} style={{ padding: 40, textAlign: 'center', color: theme.colors.textMuted, fontSize: 13 }}>
                    <Shield size={32} style={{ opacity: 0.3, marginBottom: 8 }} /><br />
                    No claims found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', borderTop: `1px solid ${theme.colors.borderLight}`, fontSize: 13 }}>
          <span style={{ color: theme.colors.textMuted }}>Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}{selectedRows.length > 0 && ` \u00B7 ${selectedRows.length} selected`}</span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()} style={{ padding: '4px 8px', border: `1px solid ${theme.colors.border}`, borderRadius: 6, background: '#fff', cursor: 'pointer', opacity: table.getCanPreviousPage() ? 1 : 0.4 }}><ChevronLeft size={16} /></button>
            <button style={{ padding: '4px 12px', border: 'none', borderRadius: 6, background: theme.colors.orange, color: '#fff', fontWeight: 600, fontSize: 13 }}>{table.getState().pagination.pageIndex + 1}</button>
            <button disabled={!table.getCanNextPage()} onClick={() => table.nextPage()} style={{ padding: '4px 8px', border: `1px solid ${theme.colors.border}`, borderRadius: 6, background: '#fff', cursor: 'pointer', opacity: table.getCanNextPage() ? 1 : 0.4 }}><ChevronRight size={16} /></button>
          </div>
          <select value={table.getState().pagination.pageSize} onChange={e => table.setPageSize(Number(e.target.value))} style={{ padding: '4px 8px', border: `1px solid ${theme.colors.border}`, borderRadius: 6, fontSize: 13, fontFamily: 'inherit' }}>{[25, 50, 100].map(n => <option key={n} value={n}>{n} / page</option>)}</select>
        </div>
      </div>

      {/* Floating Action Bar */}
      {selectedRows.length > 0 && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: '#fff', border: `1px solid ${theme.colors.border}`, borderRadius: 14,
          boxShadow: theme.shadows.xl, padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 12, zIndex: 80,
        }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: theme.colors.text }}>{selectedRows.length} selected</span>
          <div style={{ width: 1, height: 20, background: theme.colors.border }} />
          <WriteButton
            label="Export Selected"
            icon={<FileText size={14} />}
            variant="ghost"
            size="sm"
            onClick={async () => toCSV(selectedRows, 'claims-selected.csv')}
          />
        </div>
      )}

      {/* Create Claim Modal */}
      {showCreateModal && (
        <CreateClaimModal
          onClose={() => setShowCreateModal(false)}
          onCreated={() => { setShowCreateModal(false); refetch(); }}
          addOptimisticClaim={addOptimisticClaim}
          removeOptimisticClaim={removeOptimisticClaim}
        />
      )}

      {/* Detail Panel */}
      {selectedClaim && (
        <ClaimDetailPanel
          claim={selectedClaim}
          onClose={() => setSelectedClaim(null)}
          onUpdated={() => refetch()}
          applyClaimPatch={applyClaimPatch}
          mergeClaimPatch={mergeClaimPatch}
          clearClaimPatch={clearClaimPatch}
        />
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>{/* always-rendered for refresh button */}
      </div>
    </div>
  );
}
