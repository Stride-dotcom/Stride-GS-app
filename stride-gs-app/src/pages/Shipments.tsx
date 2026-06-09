import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTablePreferences } from '../hooks/useTablePreferences';
import { ColumnManagerMenu, moveColumnInOrder } from '../components/shared/ColumnManagerMenu';
import { createPortal } from 'react-dom';
import {
  useReactTable, getCoreRowModel, getSortedRowModel, getFilteredRowModel,
  flexRender, createColumnHelper,
  type ColumnFiltersState,
  type RowSelectionState, type FilterFn, type ColumnSizingState,
} from '@tanstack/react-table';
import {
  Eye, Search, Download, ChevronUp, ChevronDown,
  ArrowUpDown, Settings2,
  PackageOpen, FileText, RefreshCw,
} from 'lucide-react';
import { useVirtualRows } from '../hooks/useVirtualRows';
import { useScrollRestoration } from '../hooks/useScrollRestoration';
import { theme } from '../styles/theme';
import { fmtDate } from '../lib/constants';
import { tanstackGlobalFilter } from '../lib/searchFilters';
import { WriteButton } from '../components/shared/WriteButton';
import { isApiConfigured } from '../lib/api';
import { migrateLegacyKey, userScopedKey } from '../lib/userScopedStorage';
import type { ApiShipment } from '../lib/api';
import { useShipments } from '../hooks/useShipments';
import { useBatchData } from '../contexts/BatchDataContext';
import { MultiSelectFilter } from '../components/shared/MultiSelectFilter';
import { SyncBanner } from '../components/shared/SyncBanner';
import { useClients } from '../hooks/useClients';
import { useClientFilterUrlSync } from '../hooks/useClientFilterUrlSync';
import { useClientFilterPersisted } from '../hooks/useClientFilterPersisted';
import { useIsMobile } from '../hooks/useIsMobile';
import { useAuth } from '../contexts/AuthContext';

// ─── Row type ───────────────────────────────────────────────────────────────
interface ShipmentRow {
  shipmentNo: string;
  clientName: string;
  clientSheetId: string;
  status: string;                  // display label — derived from inboundStatus
  inboundStatus: string;           // raw 'expected' | 'in_progress' | 'received' | ''
  carrier: string;
  // `Number` suffix matters: lib/searchFilters.ts numeric-only mode only scans
  // ID-shaped field names. Rename to plain `tracking` and pure-digit search breaks.
  trackingNumber: string;
  receivedDate: string;
  createdBy: string;
  notes: string;
  itemCount: number;
  /** Pieces counted at the dock during Stage 1. Null on pre-2-stage rows. */
  dockPieceCount: number | null;
  folderUrl: string;
  photosUrl: string;
}

// Map raw inbound_status → display label used by the status badge + filter.
// '' (pre-migration rows) falls back to 'Received' so legacy data shows
// correctly without a backfill.
function statusLabel(inbound: string | undefined): string {
  switch ((inbound || '').toLowerCase()) {
    case 'in_progress': return 'In Progress';
    case 'expected':    return 'Expected';
    case 'received':    return 'Received';
    case '':            return 'Received';
    default:            return inbound || 'Received';
  }
}

function fromApi(s: ApiShipment): ShipmentRow {
  const inbound = (s.inboundStatus || '').toLowerCase();
  return {
    shipmentNo: s.shipmentNumber,
    clientName: s.clientName,
    clientSheetId: s.clientSheetId,
    status: statusLabel(inbound),
    inboundStatus: inbound,
    carrier: s.carrier,
    trackingNumber: s.trackingNumber,
    receivedDate: s.receiveDate,
    createdBy: '',
    notes: s.notes ?? '',
    itemCount: s.itemCount,
    dockPieceCount: s.dockPieceCount ?? null,
    folderUrl: s.folderUrl ?? '',
    photosUrl: s.photosUrl ?? '',
  };
}

// ─── Status config ───────────────────────────────────────────────────────────

// Order matters — the filter dropdown renders these in declaration order.
// "In Progress" sits between Expected (truck on its way) and Received (fully
// processed), matching the dock workflow: expected → in_progress → received.
const ALL_STATUSES = ['Received', 'In Progress', 'Expected', 'Pending', 'Exception', 'Cancelled'];

const STATUS_CFG: Record<string, { bg: string; text: string }> = {
  'Received':    { bg: '#F0FDF4', text: '#15803D' },
  // Stride-orange palette so the "Stage 1 done, items pending" rows pop in the
  // list — operators need to see these at a glance to know there's open work.
  'In Progress': { bg: '#FFF1EC', text: '#E85D2D' },
  'Pending':     { bg: '#FEF3C7', text: '#B45309' },
  'Expected':    { bg: '#EFF6FF', text: '#1D4ED8' },
  'Exception':   { bg: '#FEF2F2', text: '#DC2626' },
  'Cancelled':   { bg: '#F3F4F6', text: '#9CA3AF' },
};

const COL_LABELS: Record<string, string> = {
  shipmentNo: 'Shipment #', clientName: 'Client', status: 'Status', carrier: 'Carrier',
  tracking: 'Tracking #', receivedDate: 'Received', createdBy: 'Received By',
  itemCount: 'Items', dockPieceCount: 'Dock Pieces', notes: 'Notes',
};
const TOGGLEABLE = Object.keys(COL_LABELS);
const DEFAULT_COL_ORDER = ['select', 'shipmentNo', 'clientName', 'status', 'carrier', 'tracking', 'receivedDate', 'createdBy', 'dockPieceCount', 'itemCount', 'notes', 'actions'];

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
    [r.shipmentNo, r.clientName, r.status, r.carrier, r.trackingNumber, r.receivedDate, r.createdBy, r.itemCount, r.notes]
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
    // Explicit id 'tracking' preserves the legacy column id in saved user view prefs.
    col.accessor('trackingNumber', {
      id: 'tracking',
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
    col.accessor('dockPieceCount', {
      id: 'dockPieceCount',
      header: 'Dock Pieces',
      size: 90,
      cell: i => {
        const v = i.getValue() as number | null;
        return (
          <span style={{
            fontSize: 12, fontWeight: 600,
            color: v != null && v > 0 ? theme.colors.text : theme.colors.textMuted,
          }}>
            {v != null ? v : '—'}
          </span>
        );
      },
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

/** ⚠️  FRAGILE HOOK ORDER — see Inventory.tsx for full warning. Do not reorder/add/remove hooks. */
export function Shipments() {
  const { isMobile } = useIsMobile();
  const location = useLocation();
  const navigate = useNavigate();
  const hasApi = isApiConfigured();
  useBatchData();
  const pendingOpenRef = useRef<string | null>(null);
  // Deep-link: stash ?client= spreadsheet ID until apiClients loads, then resolve to name
  const deepLinkPendingTenantRef = useRef<string | null>(null);

  // Client list for MultiSelectFilter — declared before data hooks so clientFilter gates fetching
  const { clients, apiClients } = useClients();
  const clientNames = useMemo(() => clients.map(c => c.name).sort(), [clients]);
  // Persists across navigation: hydrates from URL ?client= → localStorage →
  // role-default effect below.
  const [clientFilter, setClientFilter] = useClientFilterPersisted('shipments', apiClients);

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
  const { user } = useAuth();

  // Client-role users only see their own accounts in the dropdown — admin/staff see all.
  const dropdownClientNames = useMemo(() => {
    if (user?.role === 'client' && user.accessibleClientNames?.length) {
      const allowed = new Set(user.accessibleClientNames);
      return clientNames.filter(n => allowed.has(n));
    }
    return clientNames;
  }, [clientNames, user?.role, user?.accessibleClientNames]);

  // Auto-select on mount via a ONE-TIME ref so subsequent user changes
  // (clearing/narrowing the dropdown) are never overwritten.
  //   - client role: ALWAYS force to accessibleClientNames once user loads
  //     to defend against a stale persisted filter from a prior staff session.
  //   - admin/staff: select all clientNames only if filter is empty.
  const filterInitRef = useRef(false);
  useEffect(() => {
    if (filterInitRef.current) return;
    if (!user?.role) return;
    if (user.role === 'client' && user.accessibleClientNames?.length) {
      setClientFilter(user.accessibleClientNames);
      filterInitRef.current = true;
    } else if (user.role === 'admin' || user.role === 'staff') {
      if (clientNames.length === 0) return;
      if (clientFilter.length === 0) setClientFilter(clientNames);
      filterInitRef.current = true;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role, user?.accessibleClientNames, clientNames.length]);

  // Effect 1: Route state OR ?open= query param → navigate directly to entity page.
  // ShipmentPage fetches its own data from Supabase by ID.
  useEffect(() => {
    const state = location.state as { openShipmentId?: string; clientSheetId?: string } | null;
    if (state?.openShipmentId) {
      navigate(`/shipments/${state.openShipmentId}`, { replace: true });
      return;
    }
    if (location.search) {
      const params = new URLSearchParams(location.search);
      const openId = params.get('open');
      if (openId) {
        navigate(`/shipments/${openId}`, { replace: true });
      }
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

  const [showColMenu, setShowColMenu] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => { if (!apiLoading && refreshing) setRefreshing(false); }, [apiLoading, refreshing]);
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [colToggleRect, setColToggleRect] = useState<DOMRect | null>(null);

  // Filters (status filter persisted to localStorage, keyed by user.email
  // so an admin's selection doesn't leak into an impersonated client's
  // view — user.email is the impersonated email during impersonation, see
  // AuthContext).
  const STATUS_FILTER_LEGACY_KEY = 'stride_filter_shipments_status';
  const statusFilterKey = userScopedKey(STATUS_FILTER_LEGACY_KEY, user?.email);
  const [statusFilter, setStatusFilterRaw] = useState<string[]>(() => {
    try {
      // First-paint migration. At cold-start user is often still null here
      // — the rehydrate effect below re-runs migration once auth resolves
      // so the user's saved selection ports over either way.
      migrateLegacyKey(STATUS_FILTER_LEGACY_KEY, user?.email);
      const v = localStorage.getItem(statusFilterKey);
      return v ? JSON.parse(v) : [];
    } catch { return []; }
  });
  const setStatusFilter = useCallback((v: string[]) => {
    setStatusFilterRaw(v);
    try { localStorage.setItem(statusFilterKey, JSON.stringify(v)); } catch {}
  }, [statusFilterKey]);
  // When auth resolves (cold-start) or the impersonation target changes
  // mid-session, port any legacy unkeyed selection into the namespaced
  // slot, then reload the filter from THAT user's key.
  useEffect(() => {
    if (!user?.email) return;
    migrateLegacyKey(STATUS_FILTER_LEGACY_KEY, user.email);
    try {
      const v = localStorage.getItem(statusFilterKey);
      setStatusFilterRaw(v ? JSON.parse(v) : []);
    } catch { setStatusFilterRaw([]); }
  }, [statusFilterKey, user?.email]);
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

  // Effect 2: When data arrives, navigate to the pending shipment
  useEffect(() => {
    if (pendingOpenRef.current && data.length > 0) {
      const id = pendingOpenRef.current;
      const found = data.some(s => s.shipmentNo === id);
      if (found) { pendingOpenRef.current = null; navigate(`/shipments/${id}`); }
    }
  }, [data, navigate]);

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
      // Column menu (ColumnManagerMenu) self-closes on outside click.
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

  // "In Progress" rows are Stage-1 dock intakes waiting for items — clicking
  // one opens the Receiving page in Stage 2 mode rather than the read-only
  // detail panel, because the operator's intent there is to enter items, not
  // browse. Everything else routes to the regular detail page.
  const handleRowOpen = useCallback((row: ShipmentRow) => {
    if (row.inboundStatus === 'in_progress') {
      navigate(`/receiving?shipmentNo=${encodeURIComponent(row.shipmentNo)}`);
    } else {
      navigate(`/shipments/${row.shipmentNo}`);
    }
  }, [navigate]);

  const columns = useMemo(() => buildColumns(handleRowOpen), [handleRowOpen]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnFilters, columnVisibility, rowSelection, globalFilter, columnOrder: columnOrder.length ? columnOrder : DEFAULT_COL_ORDER, columnSizing },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onGlobalFilterChange: setGlobalFilter,
    onColumnOrderChange: (updater) => setColumnOrder(typeof updater === 'function' ? updater(columnOrder.length ? columnOrder : DEFAULT_COL_ORDER) : updater),
    onColumnSizingChange: setColumnSizing,
    columnResizeMode: 'onChange',
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    enableMultiSort: true,
    getRowId: r => r.shipmentNo,
    enableRowSelection: true,
    globalFilterFn: tanstackGlobalFilter as FilterFn<ShipmentRow>,
  });

  const { containerRef, virtualRows, rows: allRows, totalHeight } = useVirtualRows(table);
  // Restore scroll position when navigating back from /shipments/:id.
  useScrollRestoration('shipments', containerRef, allRows.length > 0);
  const selectedRows = table.getSelectedRowModel().rows.map(r => r.original);

  // Time-based stats
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const weekAgo = new Date(now); weekAgo.setDate(weekAgo.getDate() - 7);
  const weekAgoStr = weekAgo.toISOString().slice(0, 10);
  const monthStart = now.toISOString().slice(0, 7); // "YYYY-MM"

  const todayCount = data.filter(r => (r.receivedDate || '').slice(0, 10) === todayStr).length;
  const weekCount = data.filter(r => (r.receivedDate || '').slice(0, 10) >= weekAgoStr).length;
  const monthCount = data.filter(r => (r.receivedDate || '').slice(0, 7) === monthStart).length;
  const monthItems = data.filter(r => (r.receivedDate || '').slice(0, 7) === monthStart).reduce((sum, r) => sum + r.itemCount, 0);

  return (
    <div style={{ fontFamily: theme.typography.fontFamily, background: '#F5F2EE', margin: isMobile ? '-12px -8px' : '-28px -32px', padding: isMobile ? '8px' : '28px 32px', minHeight: '100%', overflowX: isMobile ? 'clip' : undefined, maxWidth: isMobile ? '100vw' : undefined }}>
      {/* Loading state */}
      {hasApi && apiLoading && data.length === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 300, gap: 12 }}>
          <div style={{ width: 32, height: 32, border: '3px solid #E5E7EB', borderTopColor: theme.colors.orange, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          <span style={{ fontSize: 13, color: theme.colors.textMuted }}>Loading shipments...</span>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* Page Header — v2 small inline branding. Hidden on mobile to give the
          table more height (matches the other list pages). */}
      {!isMobile && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '2px', color: '#1C1C1C' }}>
            STRIDE LOGISTICS · SHIPMENTS
            {isLive && <span style={{ marginLeft: 12, display: 'inline-block', fontSize: 10, fontWeight: 700, letterSpacing: '2px', color: '#4A8A5C', background: 'rgba(74,138,92,0.15)', padding: '3px 10px', borderRadius: 100 }}>LIVE</span>}
            {isDemo && <span style={{ marginLeft: 12, display: 'inline-block', fontSize: 10, fontWeight: 700, letterSpacing: '2px', color: '#B08810', background: 'rgba(200,160,40,0.15)', padding: '3px 10px', borderRadius: 100 }}>DEMO</span>}
          </div>
        </div>
      )}
      {/* Session 73: Expected calendar moved to Dashboard; this page is now
          received-shipments only. */}
      <div style={{ background: '#FFFFFF', borderRadius: isMobile ? 10 : 20, padding: isMobile ? 8 : 24, border: '1px solid rgba(0,0,0,0.04)' }}>

      <SyncBanner syncing={refreshing} label={clientFilter.length === 1 ? clientFilter[0] : clientFilter.length > 1 ? `${clientFilter.length} clients` : undefined} />

      {/* Client Filter — staff/admin only. Client-role users have a single
          tenant scope; the selector would expose the count of other tenants. */}
      {user?.role !== 'client' && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 12, flexWrap: 'wrap' }}>
          <MultiSelectFilter label="Client" options={dropdownClientNames} selected={clientFilter} onChange={setClientFilter} placeholder="Select client(s)..." />
        </div>
      )}

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: isMobile ? 8 : 16, marginBottom: isMobile ? 12 : 24 }}>
        {[
          { label: 'Today', value: todayCount, color: '#fff' },
          { label: 'This Week', value: weekCount, color: '#4ADE80' },
          { label: 'This Month', value: monthCount, color: '#FBBF24' },
          { label: 'Items This Month', value: monthItems, color: '#60A5FA' },
        ].map(c => (
          <div key={c.label} style={{
            background: '#1C1C1C', border: 'none', borderRadius: isMobile ? 14 : 20, padding: isMobile ? '12px 14px' : '20px 22px',
          }}>
            <div style={{ fontSize: isMobile ? 9 : 10, fontWeight: 600, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: isMobile ? '1px' : '2px', marginBottom: isMobile ? 6 : 10 }}>{c.label}</div>
            <div style={{ fontSize: isMobile ? 22 : 28, fontWeight: 300, color: c.color, lineHeight: 1 }}>{c.value}</div>
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
              width: '100%', padding: '10px 16px 10px 36px', fontSize: 13,
              border: '1px solid rgba(0,0,0,0.08)', borderRadius: 100, outline: 'none', background: '#fff',
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
          <button onClick={e => { setColToggleRect(e.currentTarget.getBoundingClientRect()); setShowColMenu(v => !v); }} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px', fontSize: 11, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', color: theme.colors.textSecondary }}>
            <Settings2 size={13} /> Columns
          </button>
          <button onClick={() => { setRefreshing(true); refetchShipments(); }} title="Refresh data" style={{ padding: '6px 7px', fontSize: 11, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', color: (refreshing || apiLoading) ? theme.colors.orange : theme.colors.textSecondary, transition: 'color 0.2s' }}><RefreshCw size={13} style={(refreshing || apiLoading) ? { animation: 'spin 1s linear infinite' } : undefined} /></button>
        </div>
      </div>

      {/* Column manager (show/hide + reorder) */}
      {showColMenu && colToggleRect && (
        <ColumnManagerMenu
          anchorRect={colToggleRect}
          toggleableIds={TOGGLEABLE}
          labels={COL_LABELS}
          visibility={columnVisibility}
          onToggle={id => setColumnVisibility(prev => ({ ...prev, [id]: prev[id] === false }))}
          columnOrder={columnOrder.length ? columnOrder : DEFAULT_COL_ORDER}
          onMove={(id, dir) => moveColumnInOrder(id, dir, setColumnOrder, DEFAULT_COL_ORDER)}
          onClose={() => setShowColMenu(false)}
          onResetWidths={() => setColumnSizing({})}
        />
      )}

      {/* Table */}
      {clientFilter.length === 0 && <div style={{ padding: '40px 20px', textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>Select one or more clients to load data.</div>}
      <div style={{ background: '#fff', border: `1px solid ${theme.colors.border}`, borderRadius: isMobile ? 8 : 12, overflow: 'hidden' }}>
        <div ref={containerRef} style={{ overflowY: 'auto', overflowX: 'auto', maxHeight: isMobile ? 'calc(100dvh - 200px)' : 'calc(100dvh - 280px)', minHeight: isMobile ? 200 : undefined, WebkitOverflowScrolling: 'touch' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, tableLayout: 'fixed', minWidth: isMobile ? 700 : table.getTotalSize() }}>
            <thead>
              {table.getHeaderGroups().map(hg => (
                <tr key={hg.id} style={{ borderBottom: `1px solid ${theme.colors.border}` }}>
                  {hg.headers.map(h => {
                    const canResize = h.column.getCanResize();
                    return (
                      <th key={h.id}
                        style={{
                          padding: '14px 12px', textAlign: 'left', fontSize: 10, fontWeight: 600,
                          color: h.column.getIsSorted() ? theme.colors.orange : '#888', textTransform: 'uppercase', letterSpacing: '2px',
                          whiteSpace: 'nowrap', cursor: h.column.getCanSort() ? 'pointer' : 'default',
                          userSelect: 'none', width: h.getSize(), boxSizing: 'border-box', position: 'relative',
                          background: '#F5F2EE',
                        }} onClick={h.column.getCanSort() ? (e: React.MouseEvent) => h.column.toggleSorting(undefined, e.shiftKey) : undefined}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {h.column.getCanSort() && (
                            h.column.getIsSorted() === 'asc' ? <ChevronUp size={12} color={theme.colors.orange} /> :
                            h.column.getIsSorted() === 'desc' ? <ChevronDown size={12} color={theme.colors.orange} /> :
                            <ArrowUpDown size={12} style={{ opacity: 0.3 }} />
                          )}
                        </div>
                        {canResize && (
                          <div
                            onMouseDown={e => { e.stopPropagation(); h.getResizeHandler()(e); }}
                            onTouchStart={e => { e.stopPropagation(); h.getResizeHandler()(e); }}
                            onClick={e => e.stopPropagation()}
                            style={{ position: 'absolute', right: 0, top: 0, height: '100%', width: 8, cursor: 'col-resize', touchAction: 'none', userSelect: 'none', background: h.column.getIsResizing() ? theme.colors.orange : 'transparent', zIndex: 5 }}
                          />
                        )}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {virtualRows.length > 0 && <tr style={{ height: virtualRows[0].start }}><td colSpan={table.getVisibleLeafColumns().length} /></tr>}
              {virtualRows.map(vRow => { const row = allRows[vRow.index]; const rowBg = ''; const isInProgress = row.original.inboundStatus === 'in_progress'; return (
                <tr key={row.id}
                  style={{ borderBottom: `1px solid ${theme.colors.borderSubtle}`, cursor: 'pointer', transition: 'background 0.1s', background: rowBg, borderLeft: `3px solid ${isInProgress ? theme.colors.orange : 'transparent'}` }}
                  onMouseEnter={e => { e.currentTarget.style.background = theme.colors.bgSubtle; const a = e.currentTarget.querySelector('.row-actions') as HTMLElement; if (a) a.style.opacity = '1'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = rowBg; const a = e.currentTarget.querySelector('.row-actions') as HTMLElement; if (a) a.style.opacity = '0'; }}
                  onClick={() => handleRowOpen(row.original)}
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

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}
