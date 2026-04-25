import { useState, useMemo, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUrlState } from '../hooks/useUrlState';
import {
  useReactTable, getCoreRowModel, getSortedRowModel, getFilteredRowModel,
  flexRender, createColumnHelper,
  type SortingState, type FilterFn,
} from '@tanstack/react-table';
import { Search, RefreshCw, Download, Truck, Calendar, Plus, ClipboardCheck, X, ChevronUp, ChevronDown, ArrowUpDown, CloudDownload } from 'lucide-react';
import { theme } from '../styles/theme';
import { useOrders } from '../hooks/useOrders';
import type { DtOrderForUI } from '../hooks/useOrders';
import { CreateDeliveryOrderModal } from '../components/shared/CreateDeliveryOrderModal';
import { ReviewQueueTab } from '../components/shared/ReviewQueueTab';
import { useVirtualRows } from '../hooks/useVirtualRows';
import { useAuth } from '../contexts/AuthContext';
import { AvailabilityCalendar } from '../components/availability/AvailabilityCalendar';
import { MultiSelectFilter } from '../components/shared/MultiSelectFilter';
import { useClients } from '../hooks/useClients';
import { SyncBanner } from '../components/shared/SyncBanner';
import { supabase } from '../lib/supabase';

type OrdersTab = 'orders' | 'review' | 'availability';

// ─── Status chip ─────────────────────────────────────────────────────────────

const CATEGORY_CFG: Record<string, { bg: string; color: string; label: string }> = {
  // Drafts surface first in the legend so the operator sees them
  // immediately when filtering. The chip is a soft gray to distinguish
  // from any DT-derived status.
  draft:       { bg: '#F3F4F6', color: '#6B7280', label: 'Draft' },
  open:        { bg: '#EFF6FF', color: '#1D4ED8', label: 'Open' },
  in_progress: { bg: '#EDE9FE', color: '#7C3AED', label: 'In Progress' },
  completed:   { bg: '#F0FDF4', color: '#15803D', label: 'Completed' },
  exception:   { bg: '#FEF2F2', color: '#DC2626', label: 'Exception' },
  cancelled:   { bg: '#F3F4F6', color: '#6B7280', label: 'Cancelled' },
  review:      { bg: '#FFFBEB', color: '#B45309', label: 'Review' },
  billing:     { bg: '#F0FDFA', color: '#0F766E', label: 'Billing' },
};

function StatusChip({ order }: { order: DtOrderForUI }) {
  const cfg = CATEGORY_CFG[order.statusCategory] || CATEGORY_CFG.open;
  return (
    <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: cfg.bg, color: cfg.color, whiteSpace: 'nowrap' }}>
      {order.statusName || cfg.label}
    </span>
  );
}

// ─── Global filter ────────────────────────────────────────────────────────────

const globalFilterFn: FilterFn<DtOrderForUI> = (row, _colId, value: string) => {
  if (!value) return true;
  const q = value.toLowerCase();
  const r = row.original;
  return [r.dtIdentifier, r.contactName, r.contactAddress, r.contactCity, r.poNumber, r.sidemark, r.clientReference, r.clientName, r.statusName, r.source, r.createdByName, r.createdByEmail, r.contactPhone, r.contactEmail]
    .some(v => v?.toLowerCase().includes(q));
};
globalFilterFn.autoRemove = (v: string) => !v;

// ─── Column helper ────────────────────────────────────────────────────────────

const ch = createColumnHelper<DtOrderForUI>();

function fmtDate(iso: string): string {
  if (!iso) return '—';
  try { return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return iso; }
}

// ─── Export ───────────────────────────────────────────────────────────────────

function exportCsv(rows: DtOrderForUI[]) {
  const headers = ['ID', 'Client', 'Status', 'Service Date', 'Contact', 'Address', 'City', 'State', 'PO #', 'Sidemark', 'Source', 'Submitted By', 'Submitter Email', 'Bill To', 'Last Synced'];
  const data = rows.map(r => [
    r.dtIdentifier, r.clientName, r.statusName, r.localServiceDate,
    r.contactName, r.contactAddress, r.contactCity, r.contactState,
    r.poNumber, r.sidemark, r.source,
    r.createdByName, r.createdByEmail, r.billingMethod,
    r.lastSyncedAt,
  ]);
  const csv = [headers, ...data].map(row => row.map(c => `"${(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function Orders() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'admin';
  const isStaff = user?.role === 'staff' || user?.role === 'admin';
  const canReview = isStaff;

  // Active tab persisted in the URL (?tab=orders|review|availability) so the
  // browser back button cycles through tab visits and shareable URLs reflect
  // the user's exact view. Default depends on role: admin → orders, staff →
  // availability. Email deep-links pre-select review by appending ?tab=review.
  // The URL is the source of truth — `setActiveTab(x)` pushes a history entry,
  // back/forward navigates between tab visits, no useEffect race needed.
  const defaultTab: OrdersTab = isAdmin ? 'orders' : 'availability';
  const [tabRaw, setTabRaw] = useUrlState('tab', defaultTab);
  // Guard against URL-injected nonsense + role gating (a non-staff user
  // shouldn't land on review even if a stale URL says so).
  const activeTab: OrdersTab | null = !user
    ? null  // still wait for auth to resolve so role gates are accurate
    : tabRaw === 'orders' && isAdmin       ? 'orders'
    : tabRaw === 'review' && canReview     ? 'review'
    : tabRaw === 'availability'            ? 'availability'
    : defaultTab;
  const setActiveTab = useCallback((next: OrdersTab) => setTabRaw(next), [setTabRaw]);
  const { orders, loading, error, refetch, lastFetched } = useOrders();
  const [globalFilter, setGlobalFilter] = useState('');
  // Default sort: newest-created first. Drafts have no service_date so
  // sorting by createdAt makes them surface alongside everything else
  // instead of clumping at the bottom.
  const [sorting, setSorting] = useState<SortingState>([{ id: 'createdAt', desc: true }]);
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  // When set, the create modal opens in edit-existing-draft mode and
  // loads the dt_orders row + items into all the form fields. Cleared
  // on modal close so the next "+ New Delivery Order" button click
  // gets a fresh blank form.
  const [editDraftId, setEditDraftId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [syncingDt, setSyncingDt] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  // Client filter — multi-select (single source of truth for what rows are visible)
  const { clients } = useClients();
  const clientNames = useMemo(() => clients.map(c => c.name).sort(), [clients]);
  const dropdownClientNames = useMemo(() => {
    if (user?.role === 'client' && user.accessibleClientNames?.length) {
      const allowed = new Set(user.accessibleClientNames);
      return clientNames.filter(n => allowed.has(n));
    }
    return clientNames;
  }, [clientNames, user?.role, user?.accessibleClientNames]);

  const [clientFilter, setClientFilter] = useState<string[]>([]);
  useEffect(() => {
    if (clientFilter.length > 0) return;
    if (user?.role === 'client' && user.accessibleClientNames?.length) {
      setClientFilter(user.accessibleClientNames);
    } else if ((user?.role === 'admin' || user?.role === 'staff') && clientNames.length > 0) {
      setClientFilter(clientNames);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role, user?.accessibleClientNames?.length, clientNames.length]);

  const pendingReviewCount = useMemo(
    () => orders.filter(o => o.reviewStatus === 'pending_review' || o.reviewStatus === 'revision_requested').length,
    [orders]
  );

  const clientFilteredOrders = useMemo(() => {
    if (clientFilter.length === 0) return [] as DtOrderForUI[];
    const set = new Set(clientFilter);
    return orders.filter(o => set.has(o.clientName));
  }, [orders, clientFilter]);

  const filteredByCategory = useMemo(() => {
    if (!categoryFilter) return clientFilteredOrders;
    return clientFilteredOrders.filter(o => o.statusCategory === categoryFilter);
  }, [clientFilteredOrders, categoryFilter]);

  const availableStatuses = useMemo(() => {
    const set = new Set<string>();
    for (const o of filteredByCategory) {
      if (o.statusName) set.add(o.statusName);
    }
    return Array.from(set).sort();
  }, [filteredByCategory]);

  // Drop any selected statuses no longer present in the available pool (e.g. after category change).
  useEffect(() => {
    if (statusFilter.length === 0) return;
    const valid = new Set(availableStatuses);
    const next = statusFilter.filter(s => valid.has(s));
    if (next.length !== statusFilter.length) setStatusFilter(next);
  }, [availableStatuses, statusFilter]);

  const filteredByStatus = useMemo(() => {
    if (statusFilter.length === 0) return filteredByCategory;
    const set = new Set(statusFilter);
    return filteredByCategory.filter(o => set.has(o.statusName));
  }, [filteredByCategory, statusFilter]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const o of clientFilteredOrders) {
      counts[o.statusCategory] = (counts[o.statusCategory] ?? 0) + 1;
    }
    return counts;
  }, [clientFilteredOrders]);

  const columns = useMemo(() => [
    ch.accessor('dtIdentifier', {
      header: 'Order ID', size: 150,
      cell: info => <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 600, color: theme.colors.orange }}>{info.getValue()}</span>,
    }),
    ...(user?.role !== 'client' ? [ch.accessor('clientName', { header: 'Client', size: 160 })] : []),
    ch.accessor('statusCategory', {
      header: 'Status', size: 120,
      cell: info => <StatusChip order={info.row.original} />,
    }),
    ch.accessor('localServiceDate', {
      header: 'Service Date', size: 120,
      cell: info => fmtDate(info.getValue()),
    }),
    // Date Created — when the row was first written to dt_orders.
    // Sortable; default sort newest-first. Shows the date + a faint
    // time underneath so the operator can scan recent activity.
    ch.accessor('createdAt', {
      header: 'Date Created', size: 130,
      cell: info => {
        const v = info.getValue() as string;
        if (!v) return <span style={{ color: theme.colors.textMuted }}>—</span>;
        const d = new Date(v);
        if (isNaN(d.getTime())) return v;
        const dateStr = d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
        const timeStr = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
        return (
          <div style={{ lineHeight: 1.2 }}>
            <div style={{ fontSize: 12 }}>{dateStr}</div>
            <div style={{ fontSize: 10, color: theme.colors.textMuted }}>{timeStr}</div>
          </div>
        );
      },
    }),
    ch.accessor('contactName', { header: 'Contact', size: 140 }),
    ch.accessor('contactCity', {
      header: 'City', size: 140,
      cell: info => {
        const r = info.row.original;
        const parts = [r.contactCity, r.contactState].filter(Boolean);
        return parts.join(', ') || '—';
      },
    }),
    ch.accessor('poNumber', {
      header: 'PO #', size: 100,
      cell: info => info.getValue() || '—',
    }),
    ch.accessor('sidemark', {
      header: 'Sidemark', size: 120,
      cell: info => info.getValue() || '—',
    }),
    ch.accessor('createdByName', {
      header: 'Submitted By', size: 180,
      cell: info => {
        const r = info.row.original;
        if (!r.createdByName && !r.createdByEmail) return <span style={{ color: theme.colors.textMuted }}>—</span>;
        return (
          <div style={{ lineHeight: 1.2 }}>
            <div style={{ fontSize: 12, fontWeight: 500 }}>{r.createdByName || r.createdByEmail}</div>
            {r.createdByName && r.createdByEmail && (
              <div style={{ fontSize: 10, color: theme.colors.textMuted }}>{r.createdByEmail}</div>
            )}
          </div>
        );
      },
    }),
    ch.accessor('source', {
      header: 'Source', size: 100,
      cell: info => info.getValue() || '—',
    }),
  ], [user?.role]);

  const table = useReactTable({
    data: filteredByStatus,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const { containerRef, virtualRows, rows, totalHeight, measureElement } = useVirtualRows(table);

  const handleRefetch = useCallback(() => {
    setRefreshing(true);
    refetch();
    setTimeout(() => setRefreshing(false), 600);
  }, [refetch]);

  // Manual DT status sync — calls dt-sync-statuses Edge Function to pull latest
  // status + last_synced_at for every pushed order from DispatchTrack.
  const handleDtSync = useCallback(async () => {
    setSyncingDt(true);
    setSyncResult(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('dt-sync-statuses', {
        body: { scope: 'active' },
      });
      if (fnErr) {
        setSyncResult(`Sync failed: ${fnErr.message}`);
      } else {
        const updated = (data as { updated?: number; checked?: number })?.updated ?? 0;
        const checked = (data as { updated?: number; checked?: number })?.checked ?? 0;
        setSyncResult(`Synced ${updated} of ${checked} orders from DispatchTrack.`);
        refetch();
      }
    } catch (e) {
      setSyncResult(`Sync failed: ${e instanceof Error ? e.message : 'Network error'}`);
    } finally {
      setSyncingDt(false);
      setTimeout(() => setSyncResult(null), 6000);
    }
  }, [refetch]);

  const tabStyle = (tab: OrdersTab) => ({
    padding: '10px 18px',
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '1.5px',
    textTransform: 'uppercase' as const,
    color: activeTab === tab ? '#fff' : '#666',
    background: activeTab === tab ? '#1C1C1C' : '#fff',
    border: activeTab === tab ? 'none' : '1px solid rgba(0,0,0,0.08)',
    borderRadius: 100,
    cursor: 'pointer',
    fontFamily: 'inherit',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  }) as React.CSSProperties;

  const chip = (active: boolean): React.CSSProperties => ({
    padding: '8px 16px', borderRadius: 100, fontSize: 11, fontWeight: 600,
    letterSpacing: '1px', textTransform: 'uppercase', cursor: 'pointer',
    border: active ? 'none' : '1px solid rgba(0,0,0,0.08)',
    background: active ? '#1C1C1C' : '#fff', color: active ? '#fff' : '#666',
    transition: 'all 0.15s', whiteSpace: 'nowrap', fontFamily: 'inherit',
  });

  const th: React.CSSProperties = {
    padding: '14px 12px', textAlign: 'left', fontWeight: 600, fontSize: 10,
    color: '#888', textTransform: 'uppercase', letterSpacing: '2px',
    borderBottom: 'none', position: 'sticky', top: 0, background: '#fff', zIndex: 2,
    cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
  };
  const td: React.CSSProperties = {
    padding: '10px 12px', borderBottom: `1px solid ${theme.colors.borderLight}`,
    fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  };

  return (
    <div style={{ background: '#F5F2EE', margin: '-28px -32px', padding: '28px 32px', minHeight: '100%', fontFamily: theme.typography.fontFamily }}>

      {/* Page title + tab bar */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '2px', color: '#1C1C1C', marginBottom: 12 }}>
          STRIDE LOGISTICS · {isAdmin ? 'ORDERS & DELIVERY' : 'DELIVERY'}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {isAdmin && (
            <button onClick={() => setActiveTab('orders')} style={tabStyle('orders')}>
              <Truck size={13} /> Orders
            </button>
          )}
          {canReview && (
            <button onClick={() => setActiveTab('review')} style={tabStyle('review')}>
              <ClipboardCheck size={13} /> Review Queue
              {pendingReviewCount > 0 && (
                <span style={{
                  background: activeTab === 'review' ? '#fff' : '#E85D2D',
                  color: activeTab === 'review' ? '#1C1C1C' : '#fff',
                  fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
                  marginLeft: 4, minWidth: 18, textAlign: 'center',
                }}>
                  {pendingReviewCount}
                </span>
              )}
            </button>
          )}
          <button onClick={() => setActiveTab('availability')} style={tabStyle('availability')}>
            <Calendar size={13} /> Availability
          </button>
          {(activeTab === 'orders' || activeTab === 'review') && (
            <button
              onClick={() => setShowCreateModal(true)}
              style={{
                marginLeft: 'auto', padding: '10px 18px', borderRadius: 100,
                border: 'none', background: '#E85D2D', color: '#fff',
                fontSize: 11, fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase',
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                fontFamily: 'inherit',
              }}
            >
              <Plus size={14} /> New Delivery
            </button>
          )}
        </div>
      </div>

      {/* Availability tab */}
      {activeTab === 'availability' && (
        <div style={{ background: '#FFFFFF', borderRadius: 20, padding: 24, border: '1px solid rgba(0,0,0,0.04)' }}>
          <AvailabilityCalendar />
        </div>
      )}

      {/* Review Queue tab (staff + admin) */}
      {activeTab === 'review' && canReview && (
        <ReviewQueueTab
          orders={orders}
          loading={loading}
          onRefetch={refetch}
          onOpenDetail={(o) => navigate(`/orders/${o.id}`)}
        />
      )}

      {/* Orders tab (admin only) */}
      {activeTab === 'orders' && isAdmin && (
        <div style={{ background: '#FFFFFF', borderRadius: 20, padding: 24, border: '1px solid rgba(0,0,0,0.04)' }}>

          <SyncBanner syncing={refreshing} label={clientFilter.length === 1 ? clientFilter[0] : clientFilter.length > 1 ? `${clientFilter.length} clients` : undefined} />

          {/* Client filter */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 12, flexWrap: 'wrap' }}>
            <MultiSelectFilter label="Client" options={dropdownClientNames} selected={clientFilter} onChange={setClientFilter} placeholder="Select client(s)..." />
          </div>

          {/* Main toolbar */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
            <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: 320 }}>
              <Search size={15} color={theme.colors.textMuted} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
              <input
                value={globalFilter}
                onChange={e => setGlobalFilter(e.target.value)}
                placeholder="Search all columns..."
                style={{ width: '100%', padding: '10px 16px 10px 36px', fontSize: 13, border: '1px solid rgba(0,0,0,0.08)', borderRadius: 100, outline: 'none', background: '#fff', fontFamily: 'inherit', boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ flex: 1 }} />
            <button onClick={handleDtSync} disabled={syncingDt} title="Pull latest statuses from DispatchTrack" style={{ padding: '7px 12px', fontSize: 12, fontWeight: 500, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: syncingDt ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'inherit', color: syncingDt ? theme.colors.orange : theme.colors.textSecondary }}>
              <CloudDownload size={14} style={syncingDt ? { animation: 'spin 1s linear infinite' } : undefined} />
              {syncingDt ? 'Syncing…' : 'DT Sync'}
            </button>
            <button onClick={() => exportCsv(rows.map(r => r.original))} style={{ padding: '7px 12px', fontSize: 12, fontWeight: 500, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'inherit', color: theme.colors.textSecondary }}>
              <Download size={14} /> Export
            </button>
            <button onClick={handleRefetch} title="Refresh data" style={{ padding: '7px 8px', fontSize: 12, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', color: (refreshing || loading) ? theme.colors.orange : theme.colors.textSecondary, transition: 'color 0.2s' }}>
              <RefreshCw size={14} style={(refreshing || loading) ? { animation: 'spin 1s linear infinite' } : undefined} />
            </button>
          </div>

          {/* Category filter pills */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8, alignItems: 'center' }}>
            <button onClick={() => setCategoryFilter('')} style={chip(!categoryFilter)}>
              All ({clientFilteredOrders.length})
            </button>
            {Object.entries(CATEGORY_CFG).map(([cat, cfg]) => {
              const count = categoryCounts[cat] ?? 0;
              if (count === 0) return null;
              const active = categoryFilter === cat;
              return (
                <button key={cat} onClick={() => setCategoryFilter(active ? '' : cat)} style={chip(active)}>
                  {cfg.label} ({count})
                </button>
              );
            })}
          </div>

          {/* Status dropdown (narrows within the selected category) */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
            <MultiSelectFilter
              label="Status"
              options={availableStatuses}
              selected={statusFilter}
              onChange={setStatusFilter}
              placeholder="All statuses"
              disabled={availableStatuses.length === 0}
            />
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 12, color: theme.colors.textMuted, alignSelf: 'center' }}>
              Showing <strong>{rows.length}</strong> of <strong>{clientFilteredOrders.length}</strong> orders
            </span>
            {(categoryFilter || statusFilter.length > 0 || globalFilter || sorting.length > 0) && (
              <button onClick={() => { setCategoryFilter(''); setStatusFilter([]); setGlobalFilter(''); setSorting([]); }} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 8, border: `1px solid ${theme.colors.border}`, background: '#fff', cursor: 'pointer', fontSize: 11, color: theme.colors.textSecondary, fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                <X size={12} />Clear filters
              </button>
            )}
          </div>

          {/* Sync result toast */}
          {syncResult && (
            <div style={{ marginBottom: 12, padding: '8px 14px', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 8, fontSize: 12, color: '#1D4ED8' }}>
              {syncResult}
            </div>
          )}

          {lastFetched && !error && (
            <div style={{ marginBottom: 8, fontSize: 11, color: theme.colors.textMuted }}>
              Last updated: {lastFetched.toLocaleTimeString()}
            </div>
          )}

          {error && (
            <div style={{ margin: '8px 0 12px', padding: '10px 14px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, fontSize: 13, color: '#DC2626' }}>
              {error}
            </div>
          )}

          {clientFilter.length === 0 && (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>
              Select one or more clients to load data.
            </div>
          )}

          {loading && !orders.length && clientFilter.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 }}>
              <div style={{ width: 32, height: 32, border: '3px solid #E5E7EB', borderTopColor: theme.colors.orange, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
              <span style={{ fontSize: 13, color: theme.colors.textMuted }}>Loading orders...</span>
            </div>
          )}

          {!loading && !error && clientFilter.length > 0 && clientFilteredOrders.length === 0 && (
            <div style={{ padding: 40, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, color: theme.colors.textMuted }}>
              <Truck size={36} opacity={0.3} />
              <div style={{ fontSize: 15, fontWeight: 600 }}>No orders for selected clients</div>
              <div style={{ fontSize: 13 }}>Create a delivery order or pick a different client.</div>
            </div>
          )}

          {/* Table */}
          {clientFilter.length > 0 && clientFilteredOrders.length > 0 && (
            <div style={{ border: `1px solid ${theme.colors.border}`, borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
              <div ref={containerRef} style={{ overflowY: 'auto', overflowX: 'auto', maxHeight: 'calc(100dvh - 360px)', WebkitOverflowScrolling: 'touch' }}>
                <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
                  <thead>{table.getHeaderGroups().map(hg => (
                    <tr key={hg.id}>
                      {hg.headers.map(h => (
                        <th
                          key={h.id}
                          style={{ ...th, width: h.getSize(), color: h.column.getIsSorted() ? theme.colors.orange : '#888' }}
                          onClick={h.column.getCanSort() ? h.column.getToggleSortingHandler() : undefined}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                            {h.column.getCanSort() && (
                              h.column.getIsSorted() === 'asc' ? <ChevronUp size={13} color={theme.colors.orange} />
                              : h.column.getIsSorted() === 'desc' ? <ChevronDown size={13} color={theme.colors.orange} />
                              : <ArrowUpDown size={13} color={theme.colors.textMuted} />
                            )}
                          </div>
                        </th>
                      ))}
                    </tr>
                  ))}</thead>
                  <tbody>
                    {virtualRows.length > 0 && virtualRows[0].start > 0 && (
                      <tr><td colSpan={columns.length} style={{ height: virtualRows[0].start }} /></tr>
                    )}
                    {virtualRows.map(vr => {
                      const row = rows[vr.index];
                      if (!row) return null;
                      return (
                        <tr
                          key={row.id}
                          ref={measureElement}
                          onClick={() => {
                            // Drafts re-open in the create modal in
                            // edit-draft mode so the operator can pick
                            // up where they left off. Real orders go
                            // to the standard detail page.
                            if (row.original.reviewStatus === 'draft') {
                              setEditDraftId(row.original.id);
                              setShowCreateModal(true);
                            } else {
                              navigate(`/orders/${row.original.id}`);
                            }
                          }}
                          style={{ cursor: 'pointer', transition: 'background 0.1s' }}
                          onMouseEnter={e => (e.currentTarget.style.background = theme.colors.bgSubtle || '#f0f7ff')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                        >
                          {row.getVisibleCells().map(cell => (
                            <td key={cell.id} style={td}>
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                    {virtualRows.length > 0 && (() => {
                      const last = virtualRows[virtualRows.length - 1];
                      const bottom = totalHeight - last.start - last.size;
                      return bottom > 0 ? <tr><td colSpan={columns.length} style={{ height: bottom }} /></tr> : null;
                    })()}
                  </tbody>
                </table>
              </div>
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '8px 16px', borderTop: `1px solid ${theme.colors.borderLight}`, fontSize: 12, color: theme.colors.textMuted }}>
                {rows.length} row{rows.length !== 1 ? 's' : ''}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Create / edit delivery order modal */}
      {showCreateModal && (
        <CreateDeliveryOrderModal
          editDraftId={editDraftId}
          onClose={() => { setShowCreateModal(false); setEditDraftId(null); }}
          onSubmit={() => {
            setShowCreateModal(false);
            setEditDraftId(null);
            refetch();
            if (canReview) setActiveTab('review');
          }}
        />
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
