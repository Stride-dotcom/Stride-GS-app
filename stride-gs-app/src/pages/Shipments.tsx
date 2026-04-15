import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { useTablePreferences } from '../hooks/useTablePreferences';
import { createPortal } from 'react-dom';
import {
  useReactTable, getCoreRowModel, getSortedRowModel, getFilteredRowModel,
  flexRender, createColumnHelper,
  type ColumnFiltersState,
  type RowSelectionState, type FilterFn,
} from '@tanstack/react-table';
import {
  Eye, Search, Download, ChevronUp, ChevronDown,
  ArrowUpDown, Settings2,
  PackageOpen, FileText, RefreshCw,
} from 'lucide-react';
import { useVirtualRows } from '../hooks/useVirtualRows';
import { theme } from '../styles/theme';
import { fmtDate } from '../lib/constants';
import { WriteButton } from '../components/shared/WriteButton';
import { isApiConfigured } from '../lib/api';
import type { ApiShipment } from '../lib/api';
import { useShipments } from '../hooks/useShipments';
import { useBatchData } from '../contexts/BatchDataContext';
import { MultiSelectFilter } from '../components/shared/MultiSelectFilter';
import { SyncBanner } from '../components/shared/SyncBanner';
import { useClients } from '../hooks/useClients';
import { useClientFilterUrlSync } from '../hooks/useClientFilterUrlSync';
import { useIsMobile } from '../hooks/useIsMobile';
import { useAuth } from '../contexts/AuthContext';
import { ShipmentDetailPanel as SharedShipmentDetailPanel } from '../components/shared/ShipmentDetailPanel';

// ─── Row type ───────────────────────────────────────────────────────────────
interface ShipmentRow {
  shipmentNo: string;
  clientName: string;
  clientSheetId: string;
  status: string;
  carrier: string;
  tracking: string;
  receivedDate: string;
  createdBy: string;
  notes: string;
  itemCount: number;
  folderUrl: string;
  photosUrl: string;
}

function fromApi(s: ApiShipment): ShipmentRow {
  return {
    shipmentNo: s.shipmentNumber,
    clientName: s.clientName,
    clientSheetId: s.clientSheetId,
    status: 'Received',
    carrier: s.carrier,
    tracking: s.trackingNumber,
    receivedDate: s.receiveDate,
    createdBy: '',
    notes: s.notes ?? '',
    itemCount: s.itemCount,
    folderUrl: s.folderUrl ?? '',
    photosUrl: s.photosUrl ?? '',
  };
}

// ─── Status config ───────────────────────────────────────────────────────────

const ALL_STATUSES = ['Received', 'Pending', 'Expected', 'Exception', 'Cancelled'];

const STATUS_CFG: Record<string, { bg: string; text: string }> = {
  'Received':   { bg: '#F0FDF4', text: '#15803D' },
  'Pending':    { bg: '#FEF3C7', text: '#B45309' },
  'Expected':   { bg: '#EFF6FF', text: '#1D4ED8' },
  'Exception':  { bg: '#FEF2F2', text: '#DC2626' },
  'Cancelled':  { bg: '#F3F4F6', text: '#9CA3AF' },
};

const COL_LABELS: Record<string, string> = {
  shipmentNo: 'Shipment #', clientName: 'Client', status: 'Status', carrier: 'Carrier',
  tracking: 'Tracking #', receivedDate: 'Received', createdBy: 'Received By',
  itemCount: 'Items', notes: 'Notes',
};
const TOGGLEABLE = Object.keys(COL_LABELS);
const DEFAULT_COL_ORDER = ['select', 'shipmentNo', 'clientName', 'status', 'carrier', 'tracking', 'receivedDate', 'createdBy', 'itemCount', 'notes', 'actions'];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const mf: FilterFn<ShipmentRow> = (row, colId, val: string[]) => {
  if (!val || !val.length) return true;
  return val.includes(String(row.getValue(colId)));
};
mf.autoRemove = (v: string[]) => !v || !v.length;

const fmt = fmtDate;

function Badge({ t, c }: { t: string; c?: { bg: string; text: string } }) {
  const s = c || { bg: '#F3F4F6', text: '#6B7280' };
  return (
    <span style={{
      display: 'inline-block', padding: '2px 10px', borderRadius: 12,
      fontSize: 11, fontWeight: 600, letterSpacing: '0.02em',
      background: s.bg, color: s.text, whiteSpace: 'nowrap',
    }}>{t}</span>
  );
}

function toCSV(rows: ShipmentRow[], fn: string) {
  const h = 'Shipment #,Client,Status,Carrier,Tracking #,Received,Received By,Items,Notes';
  const b = rows.map(r =>
    [r.shipmentNo, r.clientName, r.status, r.carrier, r.tracking, r.receivedDate, r.createdBy, r.itemCount, r.notes]
      .map(v => `"${String(v).replace(/"/g, '""')}"`)
      .join(',')
  ).join('\n');
  const bl = new Blob([h + '\n' + b], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(bl);
  a.download = fn;
  a.click();
}

// ─── Columns ─────────────────────────────────────────────────────────────────

const col = createColumnHelper<ShipmentRow>();

function buildColumns(onView: (row: ShipmentRow) => void) {
  return [
    col.display({
      id: 'select',
      header: ({ table }) => (
        <input type="checkbox" checked={table.getIsAllPageRowsSelected()} onChange={table.getToggleAllPageRowsSelectedHandler()} style={{ cursor: 'pointer', accentColor: theme.colors.orange }} />
      ),
      cell: ({ row }) => (
        <input type="checkbox" checked={row.getIsSelected()} onChange={row.getToggleSelectedHandler()} style={{ cursor: 'pointer', accentColor: theme.colors.orange }} />
      ),
      size: 40,
      enableSorting: false,
    }),
    col.accessor('shipmentNo', {
      header: 'Shipment #',
      size: 130,
      cell: i => <span style={{ fontWeight: 600, fontSize: 12, fontFamily: 'monospace' }}>{i.getValue()}</span>,
    }),
    col.accessor('status', {
      header: 'Status',
      size: 110,
      filterFn: mf,
      cell: i => <Badge t={i.getValue()} c={STATUS_CFG[i.getValue()]} />,
    }),
    col.accessor('clientName', {
      header: 'Client',
      size: 170,
      filterFn: mf,
      cell: i => <span style={{ fontWeight: 500, fontSize: 12 }}>{i.getValue()}</span>,
    }),
    col.accessor('carrier', {
      header: 'Carrier',
      size: 150,
      filterFn: mf,
      cell: i => <span style={{ fontSize: 12, color: theme.colors.textSecondary }}>{i.getValue() || '\u2014'}</span>,
    }),
    col.accessor('tracking', {
      header: 'Tracking #',
      size: 170,
      cell: i => (
        <span style={{ fontSize: 12, color: theme.colors.textSecondary, fontFamily: 'monospace' }}>
          {i.getValue() || '\u2014'}
        </span>
      ),
    }),
    col.accessor('receivedDate', {
      header: 'Received',
      size: 100,
      cell: i => <span style={{ fontSize: 12, color: theme.colors.textSecondary }}>{fmt(i.getValue())}</span>,
    }),
    col.accessor('itemCount', {
      header: 'Items',
      size: 70,
      cell: i => (
        <span style={{
          fontSize: 12, fontWeight: 600,
          color: i.getValue() > 0 ? theme.colors.text : theme.colors.textMuted,
        }}>
          {i.getValue()}
        </span>
      ),
    }),
    col.accessor('createdBy', {
      header: 'Received By',
      size: 100,
      cell: i => <span style={{ fontSize: 12, color: i.getValue() ? theme.colors.text : theme.colors.textMuted }}>{i.getValue() || '\u2014'}</span>,
    }),
    col.accessor('notes', {
      header: 'Notes',
      size: 240,
      cell: i => (
        <span style={{
          color: theme.colors.textSecondary, fontSize: 12,
          maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis',
          whiteSpace: 'nowrap', display: 'block',
        }}>
          {i.getValue() || '\u2014'}
        </span>
      ),
    }),
    col.display({
      id: 'actions',
      header: '',
      size: 50,
      enableSorting: false,
      cell: ({ row }) => (
        <div className="row-actions" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', opacity: 0 }}>
          <Eye size={15} color={theme.colors.textSecondary} style={{ cursor: 'pointer' }} onClick={() => onView(row.original)} />
        </div>
      ),
    }),
  ];
}

// ─── Detail Panel — uses shared component with quick actions ─────────────────

function ShipmentDetailPanel({ shipment, onClose, userRole, isParent, onItemsChanged }: {
  shipment: ShipmentRow; onClose: () => void;
  userRole?: 'admin' | 'staff' | 'client'; isParent?: boolean; onItemsChanged?: () => void;
}) {
  // Map ShipmentRow → shared component's Shipment shape
  const mapped = useMemo(() => ({
    shipmentNo: shipment.shipmentNo,
    client: shipment.clientName,
    clientSheetId: shipment.clientSheetId,
    status: shipment.status,
    carrier: shipment.carrier,
    tracking: shipment.tracking,
    receivedDate: shipment.receivedDate,
    createdBy: shipment.createdBy,
    notes: shipment.notes,
    items: [],
    totalItems: shipment.itemCount,
    folderUrl: shipment.folderUrl || undefined,
  }), [shipment]);

  return (
    <SharedShipmentDetailPanel
      shipment={mapped}
      onClose={onClose}
      userRole={userRole}
      isParent={isParent}
      onItemsChanged={onItemsChanged}
    />
  );
}

// ─── Filter Dropdown ─────────────────────────────────────────────────────────

function FilterDrop({ label, options, selected, setSelected, open, setOpen, cfgMap }: {
  label: string; options: string[]; selected: string[]; setSelected: (v: string[]) => void;
  open: boolean; setOpen: (v: boolean) => void; cfgMap?: Record<string, { bg: string; text: string }>;
}) {
  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px',
          fontSize: 12, border: `1px solid ${selected.length ? theme.colors.orange : theme.colors.border}`,
          borderRadius: 8, background: selected.length ? theme.colors.orangeLight : '#fff',
          cursor: 'pointer', color: selected.length ? theme.colors.orange : theme.colors.textSecondary,
          fontWeight: selected.length ? 600 : 400,
        }}
      >
        {label} {selected.length > 0 && `(${selected.length})`}
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 4, background: '#fff',
          border: `1px solid ${theme.colors.border}`, borderRadius: 10, boxShadow: theme.shadows.lg,
          zIndex: 50, minWidth: 180, padding: 6,
        }}>
          {options.map(o => {
            const isChecked = selected.includes(o);
            return (
              <label key={o} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 6,
                cursor: 'pointer', fontSize: 12,
              }}
                onMouseEnter={e => (e.currentTarget.style.background = theme.colors.bgSubtle)}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <input type="checkbox" checked={isChecked} onChange={() => setSelected(isChecked ? selected.filter(x => x !== o) : [...selected, o])} style={{ accentColor: theme.colors.orange }} />
                {cfgMap ? <Badge t={o} c={cfgMap[o]} /> : o}
              </label>
            );
          })}
          {selected.length > 0 && (
            <button onClick={() => setSelected([])} style={{
              width: '100%', padding: '5px 8px', fontSize: 11, color: theme.colors.orange,
              background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
              marginTop: 4, borderTop: `1px solid ${theme.colors.borderSubtle}`, paddingTop: 6,
            }}>Clear</button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function Shipments() {
  const { isMobile } = useIsMobile();
  const location = useLocation();
  const hasApi = isApiConfigured();
  useBatchData();
  const pendingOpenRef = useRef<string | null>(null);
  // Deep-link: stash ?client= spreadsheet ID until apiClients loads, then resolve to name
  const deepLinkPendingTenantRef = useRef<string | null>(null);

  // Client list for MultiSelectFilter — declared before data hooks so clientFilter gates fetching
  const { clients, apiClients } = useClients();
  const clientNames = useMemo(() => clients.map(c => c.name).sort(), [clients]);
  const [clientFilter, setClientFilter] = useState<string[]>([]);

  const selectedSheetId = useMemo<string | string[] | undefined>(() => {
    if (clientFilter.length === 0) return undefined;
    const ids = clientFilter.map(n => apiClients.find(c => c.name === n)?.spreadsheetId).filter((x): x is string => !!x);
    if (ids.length === 0) return undefined;
    return ids.length === 1 ? ids[0] : ids;
  }, [clientFilter, apiClients]);

  const { apiShipments: liveShipments, loading: apiLoading, error: apiError, refetch: refetchShipments } = useShipments(hasApi && clientFilter.length > 0, selectedSheetId);
  const apiSucceeded = hasApi && !apiError && !apiLoading;
  // Map to unified row type (with client-side filtering from top-level MultiSelectFilter)
  const allData: ShipmentRow[] = useMemo(() => liveShipments.map(fromApi), [liveShipments]);

  const isLive = apiSucceeded;
  const isDemo = !hasApi;

  // State
  const { colVis: columnVisibility, setColVis: setColumnVisibility, sorting, setSorting, columnOrder, setColumnOrder } = useTablePreferences('shipments', [{ id: 'receivedDate', desc: true }], { notes: false, createdBy: false }, DEFAULT_COL_ORDER);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [globalFilter, setGlobalFilter] = useState('');
  const [selectedShipment, setSelectedShipment] = useState<ShipmentRow | null>(null);
  const { user } = useAuth();

  // Client-role users only see their own accounts in the dropdown — admin/staff see all.
  const dropdownClientNames = useMemo(() => {
    if (user?.role === 'client' && user.accessibleClientNames?.length) {
      const allowed = new Set(user.accessibleClientNames);
      return clientNames.filter(n => allowed.has(n));
    }
    return clientNames;
  }, [clientNames, user?.role, user?.accessibleClientNames]);

  // Auto-select clients for client-portal users
  useEffect(() => {
    if (user?.role === 'client' && user.accessibleClientNames?.length && clientFilter.length === 0) {
      setClientFilter(user.accessibleClientNames);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role, user?.accessibleClientNames?.length]);

  // Effect 1: Route state OR ?open= query param → store pendingOpen + auto-load
  useEffect(() => {
    const state = location.state as { openShipmentId?: string; clientSheetId?: string } | null;
    // Do NOT call refetchShipments() here — it bypasses Supabase cache and
    // forces unscoped GAS (session 62). Data hook auto-fetches via
    // Supabase-first; Effect 2 opens the pending row when data arrives.
    if (state?.openShipmentId) {
      pendingOpenRef.current = state.openShipmentId;
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

  const [showColMenu, setShowColMenu] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => { if (!apiLoading && refreshing) setRefreshing(false); }, [apiLoading, refreshing]);
  const [dragColId, setDragColId] = useState<string | null>(null);
  const [dragOverColId, setDragOverColId] = useState<string | null>(null);
  const colBtnRef = useRef<HTMLButtonElement>(null);
  const colMenuRef = useRef<HTMLDivElement>(null);

  // Filters (status filter persisted to localStorage)
  const [statusFilter, setStatusFilterRaw] = useState<string[]>(() => {
    try { const v = localStorage.getItem('stride_filter_shipments_status'); return v ? JSON.parse(v) : []; } catch { return []; }
  });
  const setStatusFilter = useCallback((v: string[]) => { setStatusFilterRaw(v); try { localStorage.setItem('stride_filter_shipments_status', JSON.stringify(v)); } catch {} }, []);
  const [carrierFilter, setCarrierFilter] = useState<string[]>([]);
  const [showStatusDrop, setShowStatusDrop] = useState(false);
  const [showCarrierDrop, setShowCarrierDrop] = useState(false);

  // Page-level safety net: resolve clientName from apiClients if empty (race when Supabase fetch happens before useClients loaded)
  const shipIdToName = useMemo<Record<string, string>>(() => { const m: Record<string, string> = {}; for (const c of apiClients) { m[c.spreadsheetId] = c.name; } return m; }, [apiClients]);

  // Client-side filtering by selected clients (top-level MultiSelectFilter)
  const data: ShipmentRow[] = useMemo(() => {
    if (clientFilter.length === 0) return [];
    const resolved = allData.map(r => r.clientName ? r : { ...r, clientName: shipIdToName[(r as any).clientSheetId || (r as any).sourceSheetId || ''] || '' });
    return resolved.filter(r => clientFilter.includes(r.clientName));
  }, [allData, clientFilter, shipIdToName]);

  // Client-filter change is already handled by useShipments (cacheKeyScope change
  // triggers useApiData refetch via Supabase-first path). A manual refetch() here
  // would force GAS (skipSupabaseCacheOnce) and hang the spinner on multi-client.

  // Effect 2: When data arrives, open the pending shipment
  useEffect(() => {
    if (pendingOpenRef.current && data.length > 0) {
      const match = data.find(s => s.shipmentNo === pendingOpenRef.current);
      if (match) { setSelectedShipment(match); pendingOpenRef.current = null; }
    }
  }, [data]);

  // Dynamic lists
  const ALL_CARRIERS = useMemo(() => Array.from(new Set(data.map(r => r.carrier).filter(Boolean))).sort(), [data]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest('[data-filter-drop]')) {
        setShowStatusDrop(false);
        setShowCarrierDrop(false);
      }
      // Column menu outside click
      if (colMenuRef.current && !colMenuRef.current.contains(t) &&
          colBtnRef.current && !colBtnRef.current.contains(t)) {
        setShowColMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Apply column-level filters
  useEffect(() => {
    const f: ColumnFiltersState = [];
    if (statusFilter.length) f.push({ id: 'status', value: statusFilter });
    if (carrierFilter.length) f.push({ id: 'carrier', value: carrierFilter });
    setColumnFilters(f);
  }, [statusFilter, carrierFilter]);

  const columns = useMemo(() => buildColumns(setSelectedShipment), []);

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnFilters, columnVisibility, rowSelection, globalFilter, columnOrder: columnOrder.length ? columnOrder : DEFAULT_COL_ORDER },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onGlobalFilterChange: setGlobalFilter,
    onColumnOrderChange: (updater) => setColumnOrder(typeof updater === 'function' ? updater(columnOrder.length ? columnOrder : DEFAULT_COL_ORDER) : updater),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    enableMultiSort: true,
    getRowId: r => r.shipmentNo,
    enableRowSelection: true,
  });

  const { containerRef, virtualRows, rows: allRows, totalHeight } = useVirtualRows(table);
  const selectedRows = table.getSelectedRowModel().rows.map(r => r.original);

  // Stats
  const receivedCount = data.filter(r => r.status === 'Received').length;
  const pendingCount = data.filter(r => r.status === 'Pending' || r.status === 'Expected').length;
  const totalItems = data.reduce((sum, r) => sum + r.itemCount, 0);

  return (
    <div style={{ fontFamily: theme.typography.fontFamily }}>
      {/* Loading state */}
      {hasApi && apiLoading && data.length === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 300, gap: 12 }}>
          <div style={{ width: 32, height: 32, border: '3px solid #E5E7EB', borderTopColor: theme.colors.orange, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          <span style={{ fontSize: 13, color: theme.colors.textMuted }}>Loading shipments...</span>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* Page Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: theme.typography.sizes['3xl'], fontWeight: theme.typography.weights.bold, color: theme.colors.text, margin: 0, lineHeight: 1.2 }}>
            Shipments
          </h1>
          <p style={{ fontSize: 13, color: theme.colors.textSecondary, margin: '4px 0 0' }}>
            Track incoming shipments and receiving history
            {isLive && <span style={{ marginLeft: 8, display: 'inline-block', fontSize: 10, fontWeight: 600, color: '#15803D', background: '#F0FDF4', padding: '1px 8px', borderRadius: 10 }}>Live</span>}
            {isDemo && <span style={{ marginLeft: 8, display: 'inline-block', fontSize: 10, fontWeight: 600, color: '#B45309', background: '#FEF3C7', padding: '1px 8px', borderRadius: 10 }}>Demo</span>}
            {hasApi && apiLoading && <span style={{ marginLeft: 8, display: 'inline-block', fontSize: 10, color: theme.colors.textMuted }}>Loading...</span>}
          </p>
        </div>
      </div>

      <SyncBanner syncing={refreshing} label={clientFilter.length === 1 ? clientFilter[0] : clientFilter.length > 1 ? `${clientFilter.length} clients` : undefined} />

      {/* Client Filter */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 12, flexWrap: 'wrap' }}>
        <MultiSelectFilter label="Client" options={dropdownClientNames} selected={clientFilter} onChange={setClientFilter} placeholder="Select client(s)..." />
      </div>

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Total Shipments', value: data.length, color: theme.colors.text },
          { label: 'Received', value: receivedCount, color: '#15803D' },
          { label: 'Pending', value: pendingCount, color: '#B45309' },
          { label: 'Total Items', value: totalItems, color: '#1D4ED8' },
        ].map(c => (
          <div key={c.label} style={{
            background: '#fff', border: `1px solid ${theme.colors.border}`, borderRadius: 12, padding: '14px 16px',
          }}>
            <div style={{ fontSize: 10, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{c.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: c.color, marginTop: 2 }}>{c.value}</div>
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
            placeholder="Search shipments..."
            style={{
              width: '100%', padding: '7px 10px 7px 30px', fontSize: 12,
              border: `1px solid ${theme.colors.border}`, borderRadius: 8, outline: 'none',
              fontFamily: theme.typography.fontFamily,
            }}
          />
        </div>
        <div data-filter-drop>
          <FilterDrop label="Status" options={ALL_STATUSES} selected={statusFilter} setSelected={setStatusFilter} open={showStatusDrop} setOpen={v => { setShowStatusDrop(v); setShowCarrierDrop(false); }} cfgMap={STATUS_CFG} />
        </div>
        <div data-filter-drop>
          <FilterDrop label="Carrier" options={ALL_CARRIERS} selected={carrierFilter} setSelected={setCarrierFilter} open={showCarrierDrop} setOpen={v => { setShowCarrierDrop(v); setShowStatusDrop(false); }} />
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button onClick={() => toCSV(data, `shipments-export-${new Date().toISOString().slice(0, 10)}.csv`)} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px', fontSize: 11, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', color: theme.colors.textSecondary }}>
            <Download size={13} /> CSV
          </button>
          <button ref={colBtnRef} onClick={() => setShowColMenu(!showColMenu)} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px', fontSize: 11, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', color: theme.colors.textSecondary }}>
            <Settings2 size={13} /> Columns
          </button>
          <button onClick={() => { setRefreshing(true); refetchShipments(); }} title="Refresh data" style={{ padding: '6px 7px', fontSize: 11, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', color: (refreshing || apiLoading) ? theme.colors.orange : theme.colors.textSecondary, transition: 'color 0.2s' }}><RefreshCw size={13} style={(refreshing || apiLoading) ? { animation: 'spin 1s linear infinite' } : undefined} /></button>
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
                <input type="checkbox" checked={isVis} onChange={() => setColumnVisibility(prev => ({ ...prev, [id]: !isVis }))} style={{ accentColor: theme.colors.orange }} />
                {COL_LABELS[id]}
              </label>
            );
          })}
        </div>, document.body
      )}

      {/* Table */}
      {clientFilter.length === 0 && <div style={{ padding: '40px 20px', textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>Select one or more clients to load data.</div>}
      <div style={{ background: '#fff', border: `1px solid ${theme.colors.border}`, borderRadius: isMobile ? 8 : 12, overflow: 'hidden' }}>
        <div ref={containerRef} style={{ overflowY: 'auto', overflowX: 'auto', maxHeight: isMobile ? 'calc(100dvh - 200px)' : 'calc(100dvh - 280px)', minHeight: isMobile ? 200 : undefined, WebkitOverflowScrolling: 'touch' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: isMobile ? 700 : undefined }}>
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
                          padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600,
                          color: h.column.getIsSorted() ? theme.colors.orange : theme.colors.textSecondary, textTransform: 'uppercase', letterSpacing: '0.04em',
                          whiteSpace: 'nowrap', cursor: h.id !== 'select' && h.id !== 'actions' ? 'grab' : 'default',
                          userSelect: 'none', width: h.getSize(),
                          background: isDragTarget ? theme.colors.orangeLight : undefined,
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
              {virtualRows.map(vRow => { const row = allRows[vRow.index]; const isActivePanel = selectedShipment?.shipmentNo === row.original.shipmentNo; const rowBg = isActivePanel ? '#FEF3EE' : ''; return (
                <tr key={row.id}
                  style={{ borderBottom: `1px solid ${theme.colors.borderSubtle}`, cursor: 'pointer', transition: 'background 0.1s', background: rowBg, borderLeft: isActivePanel ? `3px solid ${theme.colors.orange}` : '3px solid transparent' }}
                  onMouseEnter={e => { if (!isActivePanel) e.currentTarget.style.background = theme.colors.bgSubtle; const a = e.currentTarget.querySelector('.row-actions') as HTMLElement; if (a) a.style.opacity = '1'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = rowBg; const a = e.currentTarget.querySelector('.row-actions') as HTMLElement; if (a) a.style.opacity = '0'; }}
                  onClick={() => setSelectedShipment(row.original)}
                >
                  {row.getVisibleCells().map(cell => (
                    <td key={cell.id} style={{ padding: '8px 12px', verticalAlign: 'middle' }} onClick={e => { if (cell.column.id === 'select') e.stopPropagation(); }}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ); })}
              {virtualRows.length > 0 && <tr style={{ height: totalHeight - (virtualRows[virtualRows.length - 1].end) }}><td colSpan={table.getVisibleLeafColumns().length} /></tr>}
              {allRows.length === 0 && (
                <tr><td colSpan={table.getVisibleLeafColumns().length} style={{ padding: 40, textAlign: 'center', color: theme.colors.textMuted, fontSize: 13 }}>
                  <PackageOpen size={32} style={{ opacity: 0.3, marginBottom: 8 }} /><br />
                  No shipments found
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Row count */}
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '8px 16px', borderTop: `1px solid ${theme.colors.border}`, fontSize: 12, color: theme.colors.textSecondary }}>
          {allRows.length} row{allRows.length !== 1 ? 's' : ''}{selectedRows.length > 0 && ` \u00B7 ${selectedRows.length} selected`}
        </div>
      </div>

      {/* Floating Action Bar */}
      {selectedRows.length > 0 && !isMobile && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: '#fff', border: `1px solid ${theme.colors.border}`, borderRadius: 14,
          boxShadow: theme.shadows.xl, padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 12, zIndex: 80,
        }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: theme.colors.text }}>{selectedRows.length} selected</span>
          <div style={{ width: 1, height: 20, background: theme.colors.border }} />
          <WriteButton label="Export Selected" icon={<FileText size={14} />} variant="ghost" size="sm" onClick={async () => toCSV(selectedRows, 'shipments-selected.csv')} />
        </div>
      )}

      {/* Detail Panel — modals are self-contained inside the panel */}
      {selectedShipment && (
        <ShipmentDetailPanel
          shipment={selectedShipment}
          onClose={() => setSelectedShipment(null)}
          userRole={user?.role}
          isParent={user?.isParent}
          onItemsChanged={() => refetchShipments()}
        />
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
