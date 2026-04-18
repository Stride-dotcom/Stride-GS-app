import { useState, useMemo } from 'react';
import {
  useReactTable, getCoreRowModel, getSortedRowModel, getFilteredRowModel,
  flexRender, createColumnHelper,
  type SortingState, type FilterFn,
} from '@tanstack/react-table';
import { Search, RefreshCw, Download, Truck, Calendar } from 'lucide-react';
import { theme } from '../styles/theme';
import { useOrders } from '../hooks/useOrders';
import type { DtOrderForUI } from '../hooks/useOrders';
import { OrderDetailPanel } from '../components/shared/OrderDetailPanel';
import { useVirtualRows } from '../hooks/useVirtualRows';
import { useAuth } from '../contexts/AuthContext';
import { AvailabilityCalendar } from '../components/availability/AvailabilityCalendar';

type OrdersTab = 'orders' | 'availability';

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
  const [activeTab, setActiveTab] = useState<OrdersTab>(isAdmin ? 'orders' : 'availability');
  const { orders, loading, error, refetch, lastFetched } = useOrders();
  const [globalFilter, setGlobalFilter] = useState('');
  const [sorting, setSorting] = useState<SortingState>([{ id: 'localServiceDate', desc: true }]);
  const [selectedOrder, setSelectedOrder] = useState<DtOrderForUI | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>('');

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
    padding: '8px 18px',
    fontSize: 13,
    fontWeight: activeTab === tab ? 600 : 400,
    color: activeTab === tab ? theme.colors.primary : theme.colors.textMuted,
    background: 'none',
    border: 'none',
    borderBottom: activeTab === tab ? `2px solid ${theme.colors.primary}` : '2px solid transparent',
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
        <div style={{ display: 'flex', gap: 0 }}>
          {isAdmin && (
            <button onClick={() => setActiveTab('orders')} style={tabStyle('orders')}>
              <Truck size={14} /> Orders
            </button>
          )}
          <button onClick={() => setActiveTab('availability')} style={tabStyle('availability')}>
            <Calendar size={14} /> Availability
          </button>
        </div>
      </div>

      {/* Availability tab */}
      {activeTab === 'availability' && (
        <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
          <AvailabilityCalendar />
        </div>
      )}

      {/* Orders tab (admin only) */}
      {activeTab === 'orders' && isAdmin && <>

      {/* Header bar */}
      <div style={{ padding: '12px 20px 12px', borderBottom: `1px solid ${theme.colors.border}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {!loading && <span style={{ fontSize: 12, color: theme.colors.textMuted }}>({rows.length})</span>}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={refetch} style={{ background: 'none', border: `1px solid ${theme.colors.border}`, borderRadius: 8, padding: '6px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: theme.colors.textMuted }}>
              <RefreshCw size={14} />Refresh
            </button>
            <button onClick={() => exportCsv(rows.map(r => r.original))} style={{ background: 'none', border: `1px solid ${theme.colors.border}`, borderRadius: 8, padding: '6px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: theme.colors.textMuted }}>
              <Download size={14} />Export
            </button>
          </div>
        </div>

        {/* Category filter pills */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          <button
            onClick={() => setCategoryFilter('')}
            style={{ padding: '4px 12px', borderRadius: 16, fontSize: 12, fontWeight: 500, cursor: 'pointer', border: 'none', background: !categoryFilter ? theme.colors.primary : theme.colors.border, color: !categoryFilter ? '#fff' : theme.colors.text }}
          >
            All ({orders.length})
          </button>
          {Object.entries(CATEGORY_CFG).map(([cat, cfg]) => {
            const count = categoryCounts[cat] ?? 0;
            if (count === 0) return null;
            return (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat === categoryFilter ? '' : cat)}
                style={{ padding: '4px 12px', borderRadius: 16, fontSize: 12, fontWeight: 500, cursor: 'pointer', border: `1px solid ${cfg.color}30`, background: categoryFilter === cat ? cfg.bg : '#fff', color: cfg.color }}
              >
                {cfg.label} ({count})
              </button>
            );
          })}
        </div>

        {/* Search */}
        <div style={{ position: 'relative', maxWidth: 340 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: theme.colors.textMuted }} />
          <input
            value={globalFilter}
            onChange={e => setGlobalFilter(e.target.value)}
            placeholder="Search orders…"
            style={{ width: '100%', paddingLeft: 32, paddingRight: 10, paddingTop: 8, paddingBottom: 8, border: `1px solid ${theme.colors.border}`, borderRadius: 8, fontSize: 13, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
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
            <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: '#fff' }}>
              {table.getHeaderGroups().map(hg => (
                <tr key={hg.id}>
                  {hg.headers.map(header => (
                    <th
                      key={header.id}
                      onClick={header.column.getToggleSortingHandler()}
                      style={{
                        padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600,
                        color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em',
                        borderBottom: `2px solid ${theme.colors.border}`, cursor: header.column.getCanSort() ? 'pointer' : 'default',
                        userSelect: 'none', whiteSpace: 'nowrap', background: '#fff',
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

      {/* Detail panel */}
      {selectedOrder && (
        <OrderDetailPanel order={selectedOrder} onClose={() => setSelectedOrder(null)} />
      )}

      </>}
    </div>
  );
}
