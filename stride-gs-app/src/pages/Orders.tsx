import { useState, useMemo } from 'react';
import {
  useReactTable, getCoreRowModel, getSortedRowModel, getFilteredRowModel,
  flexRender, createColumnHelper,
  type SortingState, type FilterFn,
} from '@tanstack/react-table';
import { Search, RefreshCw, Download, Truck, Calendar, Plus, ClipboardCheck } from 'lucide-react';
import { theme } from '../styles/theme';
import { useOrders } from '../hooks/useOrders';
import type { DtOrderForUI } from '../hooks/useOrders';
import { OrderDetailPanel } from '../components/shared/OrderDetailPanel';
import { CreateDeliveryOrderModal } from '../components/shared/CreateDeliveryOrderModal';
import { ReviewQueueTab } from '../components/shared/ReviewQueueTab';
import { useVirtualRows } from '../hooks/useVirtualRows';
import { useAuth } from '../contexts/AuthContext';
import { AvailabilityCalendar } from '../components/availability/AvailabilityCalendar';

type OrdersTab = 'orders' | 'review' | 'availability';

// ─── Status chip ─────────────────────────────────────────────────────────────

const CATEGORY_CFG: Record<string, { bg: string; color: string; label: string }> = {
  open:        { bg: '#EFF6FF', color: '#1D4ED8', label: 'Open' },
  in_progress: { bg: '#EDE9FE', color: '#7C3AED', label: 'In Progress' },
  completed:   { bg: '#F0FDF4', color: '#15803D', label: 'Completed' },
  exception:   { bg: '#FEF2F2', color: '#DC2626', label: 'Exception' },
  cancelled:   { bg: '#F3F4F6', color: '#6B7280', label: 'Cancelled' },
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
  return [r.dtIdentifier, r.contactName, r.contactAddress, r.contactCity, r.poNumber, r.sidemark, r.clientReference, r.clientName, r.statusName, r.source]
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
  const headers = ['ID', 'Client', 'Status', 'Service Date', 'Contact', 'Address', 'City', 'State', 'PO #', 'Sidemark', 'Source', 'Last Synced'];
  const data = rows.map(r => [
    r.dtIdentifier, r.clientName, r.statusName, r.localServiceDate,
    r.contactName, r.contactAddress, r.contactCity, r.contactState,
    r.poNumber, r.sidemark, r.source, r.lastSyncedAt,
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
  const isAdmin = user?.role === 'admin';
  const isStaff = user?.role === 'staff' || user?.role === 'admin';
  const canReview = isStaff;

  // Read ?tab=review from hash on mount so email deep links auto-switch to the review tab
  const initialTab = (() => {
    try {
      const hash = window.location.hash; // e.g. "#/orders?tab=review"
      if (hash.includes('tab=review') && isStaff) return 'review' as OrdersTab;
    } catch (_) {}
    return (isAdmin ? 'orders' : 'availability') as OrdersTab;
  })();

  const [activeTab, setActiveTab] = useState<OrdersTab>(initialTab);
  const { orders, loading, error, refetch, lastFetched } = useOrders();
  const [globalFilter, setGlobalFilter] = useState('');
  const [sorting, setSorting] = useState<SortingState>([{ id: 'localServiceDate', desc: true }]);
  const [selectedOrder, setSelectedOrder] = useState<DtOrderForUI | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Count of orders pending review (for the tab badge)
  const pendingReviewCount = useMemo(
    () => orders.filter(o => o.reviewStatus === 'pending_review' || o.reviewStatus === 'revision_requested').length,
    [orders]
  );

  const filteredByCategory = useMemo(() => {
    if (!categoryFilter) return orders;
    return orders.filter(o => o.statusCategory === categoryFilter);
  }, [orders, categoryFilter]);

  // Category counts for filter pills
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const o of orders) {
      counts[o.statusCategory] = (counts[o.statusCategory] ?? 0) + 1;
    }
    return counts;
  }, [orders]);

  const columns = useMemo(() => [
    ch.accessor('dtIdentifier', {
      header: 'Order ID',
      cell: info => <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 600, color: theme.colors.primary }}>{info.getValue()}</span>,
    }),
    ...(user?.role !== 'client' ? [ch.accessor('clientName', { header: 'Client' })] : []),
    ch.accessor('statusCategory', {
      header: 'Status',
      cell: info => <StatusChip order={info.row.original} />,
    }),
    ch.accessor('localServiceDate', {
      header: 'Service Date',
      cell: info => fmtDate(info.getValue()),
    }),
    ch.accessor('contactName', { header: 'Contact' }),
    ch.accessor('contactCity', {
      header: 'City',
      cell: info => {
        const r = info.row.original;
        const parts = [r.contactCity, r.contactState].filter(Boolean);
        return parts.join(', ') || '—';
      },
    }),
    ch.accessor('poNumber', {
      header: 'PO #',
      cell: info => info.getValue() || '—',
    }),
    ch.accessor('sidemark', {
      header: 'Sidemark',
      cell: info => info.getValue() || '—',
    }),
    ch.accessor('source', {
      header: 'Source',
      cell: info => info.getValue() || '—',
    }),
  ], [user?.role]);

  const table = useReactTable({
    data: filteredByCategory,
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#F5F2EE', margin: '-28px -32px', padding: '28px 32px', fontFamily: theme.typography.fontFamily }}>

      {/* Page title + tab bar */}
      <div style={{ flexShrink: 0, marginBottom: 16 }}>
        <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '2px', color: '#1C1C1C', marginBottom: 12 }}>
          STRIDE LOGISTICS · {isAdmin ? 'ORDERS & DELIVERY' : 'DELIVERY'}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
          {/* Create Delivery Order — visible on Orders or Review tabs */}
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
        <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
          <AvailabilityCalendar />
        </div>
      )}

      {/* Review Queue tab (staff + admin) */}
      {activeTab === 'review' && canReview && (
        <ReviewQueueTab
          orders={orders}
          loading={loading}
          onRefetch={refetch}
          onOpenDetail={(o) => setSelectedOrder(o)}
        />
      )}

      {/* Orders tab (admin only) */}
      {activeTab === 'orders' && isAdmin && <>

      {/* Dark KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 20, flexShrink: 0 }}>
        {[
          { label: 'Total Orders', value: orders.length, color: '#fff' },
          { label: 'Open', value: categoryCounts.open ?? 0, color: '#60A5FA' },
          { label: 'In Progress', value: categoryCounts.in_progress ?? 0, color: '#C084FC' },
          { label: 'Completed', value: categoryCounts.completed ?? 0, color: '#4ADE80' },
        ].map(c => (
          <div key={c.label} style={{ background: '#1C1C1C', borderRadius: 20, padding: '20px 22px' }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '2px', marginBottom: 10 }}>{c.label}</div>
            <div style={{ fontSize: 28, fontWeight: 300, color: c.color, lineHeight: 1 }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Header bar */}
      <div style={{ flexShrink: 0, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {!loading && <span style={{ fontSize: 11, fontWeight: 600, color: '#888', letterSpacing: '1px', textTransform: 'uppercase' }}>{rows.length} shown</span>}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={refetch} style={{ background: '#fff', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 100, padding: '10px 18px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase', color: '#666' }}>
              <RefreshCw size={13} />Refresh
            </button>
            <button onClick={() => exportCsv(rows.map(r => r.original))} style={{ background: '#fff', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 100, padding: '10px 18px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase', color: '#666' }}>
              <Download size={13} />Export
            </button>
          </div>
        </div>

        {/* Category filter pills */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <button
            onClick={() => setCategoryFilter('')}
            style={{ padding: '8px 16px', borderRadius: 100, fontSize: 11, fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', cursor: 'pointer', border: !categoryFilter ? 'none' : '1px solid rgba(0,0,0,0.08)', background: !categoryFilter ? '#1C1C1C' : '#fff', color: !categoryFilter ? '#fff' : '#666' }}
          >
            All ({orders.length})
          </button>
          {Object.entries(CATEGORY_CFG).map(([cat, cfg]) => {
            const count = categoryCounts[cat] ?? 0;
            if (count === 0) return null;
            const active = categoryFilter === cat;
            return (
              <button
                key={cat}
                onClick={() => setCategoryFilter(active ? '' : cat)}
                style={{ padding: '8px 16px', borderRadius: 100, fontSize: 11, fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', cursor: 'pointer', border: active ? 'none' : '1px solid rgba(0,0,0,0.08)', background: active ? '#1C1C1C' : '#fff', color: active ? '#fff' : '#666' }}
              >
                {cfg.label} ({count})
              </button>
            );
          })}
        </div>

        {/* Search */}
        <div style={{ position: 'relative', maxWidth: 340 }}>
          <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#888' }} />
          <input
            value={globalFilter}
            onChange={e => setGlobalFilter(e.target.value)}
            placeholder="Search orders…"
            style={{ width: '100%', padding: '10px 16px 10px 36px', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 100, background: '#fff', fontSize: 13, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
          />
        </div>
      </div>

      {/* Last fetched info */}
      {lastFetched && (
        <div style={{ padding: '4px 20px', fontSize: 11, color: theme.colors.textMuted, borderBottom: `1px solid ${theme.colors.border}`, flexShrink: 0, background: '#fafafa' }}>
          Last updated: {lastFetched.toLocaleTimeString()}
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ margin: '16px 20px', padding: '10px 14px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, fontSize: 13, color: '#DC2626' }}>
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && !orders.length && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.colors.textMuted, fontSize: 14 }}>
          Loading orders…
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && orders.length === 0 && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: theme.colors.textMuted }}>
          <Truck size={36} opacity={0.3} />
          <div style={{ fontSize: 15, fontWeight: 600 }}>No orders yet</div>
          <div style={{ fontSize: 13 }}>Orders will appear here once DispatchTrack webhook sync is configured.</div>
        </div>
      )}

      {/* Table */}
      {orders.length > 0 && (
        <div ref={containerRef} style={{ flex: 1, overflowY: 'auto', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: 700 }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: '#F5F2EE' }}>
              {table.getHeaderGroups().map(hg => (
                <tr key={hg.id}>
                  {hg.headers.map(header => (
                    <th
                      key={header.id}
                      onClick={header.column.getToggleSortingHandler()}
                      style={{
                        padding: '14px 12px', textAlign: 'left', fontSize: 10, fontWeight: 600,
                        color: '#888', textTransform: 'uppercase', letterSpacing: '2px',
                        borderBottom: 'none', cursor: header.column.getCanSort() ? 'pointer' : 'default',
                        userSelect: 'none', whiteSpace: 'nowrap', background: '#F5F2EE',
                      }}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {header.column.getIsSorted() === 'asc' ? ' ↑' : header.column.getIsSorted() === 'desc' ? ' ↓' : ''}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody style={{ position: 'relative' }}>
              {/* Virtual spacer top */}
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
                    onClick={() => setSelectedOrder(row.original)}
                    style={{
                      cursor: 'pointer', borderBottom: `1px solid ${theme.colors.border}`,
                      background: vr.index % 2 === 0 ? '#ffffff' : '#fafafa',
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#f0f7ff')}
                    onMouseLeave={e => (e.currentTarget.style.background = vr.index % 2 === 0 ? '#ffffff' : '#fafafa')}
                  >
                    {row.getVisibleCells().map(cell => (
                      <td key={cell.id} style={{ padding: '10px 12px', fontSize: 13, color: theme.colors.text, verticalAlign: 'middle', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                );
              })}
              {/* Virtual spacer bottom */}
              {virtualRows.length > 0 && (() => {
                const last = virtualRows[virtualRows.length - 1];
                const bottom = totalHeight - last.start - last.size;
                return bottom > 0 ? <tr><td colSpan={columns.length} style={{ height: bottom }} /></tr> : null;
              })()}
            </tbody>
          </table>
        </div>
      )}

      </>}

      {/* Detail panel — available from ALL tabs (orders, review, availability) */}
      {selectedOrder && (
        <OrderDetailPanel
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onUpdated={() => { refetch(); setSelectedOrder(null); }}
        />
      )}

      {/* Create delivery order modal */}
      {showCreateModal && (
        <CreateDeliveryOrderModal
          onClose={() => setShowCreateModal(false)}
          onSubmit={() => {
            setShowCreateModal(false);
            refetch();
            // After creating, flip to Review Queue so the new order is visible
            if (canReview) setActiveTab('review');
          }}
        />
      )}
    </div>
  );
}
