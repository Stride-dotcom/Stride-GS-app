import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useReactTable, getCoreRowModel, getSortedRowModel, getFilteredRowModel,
  flexRender, createColumnHelper,
  type SortingState,
} from '@tanstack/react-table';
import {
  ClipboardList, Wrench, Truck, RefreshCw, Settings2, X,
  ChevronUp, ChevronDown, ArrowUpDown,
} from 'lucide-react';
import { useVirtualRows } from '../hooks/useVirtualRows';
import { Card } from '../components/ui/Card';
import { theme } from '../styles/theme';
import { isApiConfigured } from '../lib/api';
import { useDashboardSummary } from '../hooks/useDashboardSummary';
import type { SummaryTask, SummaryRepair, SummaryWillCall } from '../hooks/useDashboardSummary';
import { useTablePreferences } from '../hooks/useTablePreferences';
import { fmtDate } from '../lib/constants';
import { useIsMobile } from '../hooks/useIsMobile';
import { useAuth } from '../contexts/AuthContext';
import { FolderButton } from '../components/shared/FolderButton';

// ─── Types ───────────────────────────────────────────────────────────────────

type DashTab = 'tasks' | 'repairs' | 'willcalls';

// ─── Constants ───────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 10_000;

const DEFAULT_TASK_STATUSES = ['Open', 'In Progress'];
const DEFAULT_REPAIR_STATUSES = ['Pending Quote', 'Quote Sent', 'Approved', 'In Progress'];
const DEFAULT_WC_STATUSES = ['Pending', 'Scheduled', 'Partial'];

const STATUS_CFG: Record<string, { bg: string; text: string }> = {
  Open: { bg: '#EFF6FF', text: '#1D4ED8' },
  Completed: { bg: '#F0FDF4', text: '#15803D' },
  Cancelled: { bg: '#F3F4F6', text: '#6B7280' },
  'Pending Quote': { bg: '#FEF3C7', text: '#B45309' },
  'Quote Sent': { bg: '#FEF3EE', text: '#E85D2D' },
  Approved: { bg: '#F0FDF4', text: '#15803D' },
  Declined: { bg: '#FEF2F2', text: '#991B1B' },
  'In Progress': { bg: '#EDE9FE', text: '#7C3AED' },
  Complete: { bg: '#F0FDF4', text: '#15803D' },
  Pending: { bg: '#FEF3C7', text: '#B45309' },
  Scheduled: { bg: '#EFF6FF', text: '#1D4ED8' },
  Released: { bg: '#F0FDF4', text: '#15803D' },
  Partial: { bg: '#FEF3EE', text: '#E85D2D' },
};

/** All service types — matches Billing page service list from Master Price List */
const ALL_SERVICE_TYPES: { code: string; name: string }[] = [
  { code: 'RCVG', name: 'Receiving' },
  { code: 'INSP', name: 'Inspection' },
  { code: 'ASM', name: 'Assembly' },
  { code: 'REPAIR', name: 'Repair (Flat)' },
  { code: 'PLLT', name: 'Palletize' },
  { code: 'PICK', name: 'Pull Prep' },
  { code: 'LABEL', name: 'Relabeling' },
  { code: 'DISP', name: 'Disposal' },
  { code: 'RSTK', name: 'Restock' },
  { code: 'MNRTU', name: 'Minor Touch Up' },
  { code: 'STOR', name: 'Storage' },
  { code: 'WC', name: 'Will Call Release' },
  { code: 'WCPU', name: 'Will Call Pickup' },
  { code: 'SIT', name: 'Sit Test' },
  { code: 'DLVR', name: 'Delivery' },
  { code: 'NO_ID', name: 'No ID' },
  { code: 'MULTI_INS', name: 'Multi-Piece Inspection' },
  { code: 'RUSH', name: 'Rush' },
  { code: 'OTHER', name: 'Other' },
];

const TASK_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  ALL_SERVICE_TYPES.map(s => [s.code, s.name])
);

// ─── Small helpers ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_CFG[status] || { bg: '#F3F4F6', text: '#6B7280' };
  return (
    <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: c.bg, color: c.text, whiteSpace: 'nowrap' }}>
      {status}
    </span>
  );
}

// ─── StatCard ─────────────────────────────────────────────────────────────────

function StatCard({ icon, label, value, sub, color, onClick }: {
  icon: React.ReactNode; label: string; value: number; sub?: string; color: string; onClick?: () => void;
}) {
  return (
    <Card onClick={onClick} style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: '1 1 0', minWidth: 140, cursor: onClick ? 'pointer' : undefined, transition: 'box-shadow 0.15s' }}>
      <div style={{ width: 34, height: 34, borderRadius: 10, background: color + '1A', display: 'flex', alignItems: 'center', justifyContent: 'center', color }}>{icon}</div>
      <div>
        <div style={{ fontSize: 28, fontWeight: 700, color: theme.colors.textPrimary, lineHeight: 1 }}>{value}</div>
        <div style={{ fontSize: 12, color: theme.colors.textSecondary, marginTop: 3 }}>{label}</div>
        {sub && <div style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: 1 }}>{sub}</div>}
      </div>
    </Card>
  );
}

// ─── Shared table styles ──────────────────────────────────────────────────────

const thStyle: React.CSSProperties = {
  padding: '10px 12px', textAlign: 'left', fontWeight: 500, fontSize: 11,
  color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em',
  borderBottom: `1px solid ${theme.colors.borderLight}`, position: 'sticky', top: 0,
  background: '#fff', zIndex: 2, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
};
const tdStyle: React.CSSProperties = {
  padding: '9px 12px', borderBottom: `1px solid ${theme.colors.borderLight}`, fontSize: 12, whiteSpace: 'nowrap',
};

function chip(active: boolean): React.CSSProperties {
  return {
    padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: 'pointer',
    border: `1px solid ${active ? theme.colors.orange : theme.colors.border}`,
    background: active ? theme.colors.orangeLight : 'transparent',
    color: active ? theme.colors.orange : theme.colors.textSecondary,
    transition: 'all 0.15s', whiteSpace: 'nowrap',
  };
}

function DragHeader({ h, dragColId, dragOverColId, onDragStart, onDragOver, onDragEnd, sorted }: {
  h: any; dragColId: string | null; dragOverColId: string | null;
  onDragStart: () => void; onDragOver: () => void; onDragEnd: () => void; sorted: false | 'asc' | 'desc';
}) {
  const isDragTarget = dragOverColId === h.id && dragColId !== h.id;
  return (
    <th
      key={h.id} draggable
      onDragStart={onDragStart} onDragOver={e => { e.preventDefault(); onDragOver(); }} onDragEnd={onDragEnd}
      onClick={h.column.getCanSort() ? (e: React.MouseEvent) => h.column.toggleSorting(undefined, e.shiftKey) : undefined}
      style={{ ...thStyle, width: h.getSize(), color: sorted ? theme.colors.orange : theme.colors.textMuted, cursor: 'grab', background: isDragTarget ? theme.colors.orangeLight : '#fff', borderLeft: isDragTarget ? `2px solid ${theme.colors.orange}` : undefined }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
        {h.column.getCanSort() && (sorted === 'asc' ? <ChevronUp size={13} color={theme.colors.orange} /> : sorted === 'desc' ? <ChevronDown size={13} color={theme.colors.orange} /> : <ArrowUpDown size={13} color={theme.colors.textMuted} />)}
      </div>
    </th>
  );
}

// ─── Tasks Tab ───────────────────────────────────────────────────────────────

const TASK_DEFAULT_ORDER = ['taskId', 'taskType', 'taskStatus', 'taskItem', 'taskDesc', 'taskLocation', 'taskVendor', 'taskAssigned', 'taskClient', 'taskSidemark', 'taskCreated', 'taskFolder'];
const TASK_COL_LABELS: Record<string, string> = { taskId: 'Task ID', taskType: 'Type', taskStatus: 'Status', taskItem: 'Item', taskDesc: 'Description', taskLocation: 'Location', taskVendor: 'Vendor', taskAssigned: 'Assigned', taskClient: 'Client', taskSidemark: 'Sidemark', taskCreated: 'Created', taskFolder: 'Folder' };

function TasksTab({ tasks, onNavigate }: { tasks: SummaryTask[]; onNavigate: (task: SummaryTask) => void }) {
  const colT = createColumnHelper<SummaryTask>();
  const { sorting, setSorting, colVis, setColVis, columnOrder, setColumnOrder } = useTablePreferences('dashboard-tasks', [{ id: 'taskCreated', desc: true }], {}, TASK_DEFAULT_ORDER);
  const [statusFilters, setStatusFilters] = useState<string[]>(DEFAULT_TASK_STATUSES);
  const [showCols, setShowCols] = useState(false);
  const [dragColId, setDragColId] = useState<string | null>(null);
  const [dragOverColId, setDragOverColId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => { const h = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowCols(false); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, []);

  const allStatuses = useMemo(() => [...new Set(tasks.map(t => t.status))].sort(), [tasks]);

  const filtered = useMemo(() => statusFilters.length === 0 ? tasks : tasks.filter(t => statusFilters.includes(t.status)), [tasks, statusFilters]);

  const columns = useMemo(() => [
    colT.accessor('taskId', { id: 'taskId', header: 'Task ID', size: 110, cell: i => <span style={{ fontWeight: 600, fontSize: 12, fontFamily: 'monospace', color: theme.colors.orange }}>{i.getValue()}</span> }),
    colT.accessor('taskType', { id: 'taskType', header: 'Type', size: 100, cell: i => <span style={{ fontSize: 12 }}>{TASK_TYPE_LABELS[i.getValue()] || i.getValue() || '—'}</span> }),
    colT.accessor('status', { id: 'taskStatus', header: 'Status', size: 115, cell: i => <StatusBadge status={i.getValue()} /> }),
    colT.accessor('itemId', { id: 'taskItem', header: 'Item', size: 90, cell: i => <span style={{ fontSize: 12, color: theme.colors.textSecondary }}>{i.getValue() || '—'}</span> }),
    colT.accessor('description', { id: 'taskDesc', header: 'Description', size: 200, cell: i => <span style={{ fontSize: 12, maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis', display: 'block', color: theme.colors.textSecondary }}>{i.getValue() || '—'}</span> }),
    colT.accessor('location', { id: 'taskLocation', header: 'Location', size: 90, cell: i => <span style={{ fontSize: 12, fontFamily: 'monospace', color: theme.colors.textSecondary }}>{i.getValue() || '—'}</span> }),
    colT.accessor('vendor', { id: 'taskVendor', header: 'Vendor', size: 120, cell: i => <span style={{ fontSize: 12, color: theme.colors.textSecondary }}>{i.getValue() || '—'}</span> }),
    colT.accessor('assignedTo', { id: 'taskAssigned', header: 'Assigned', size: 110, cell: i => <span style={{ fontSize: 12, color: i.getValue() ? theme.colors.text : theme.colors.textMuted }}>{i.getValue() || '—'}</span> }),
    colT.accessor('clientName', { id: 'taskClient', header: 'Client', size: 140, cell: i => <span style={{ fontSize: 12, fontWeight: 500 }}>{i.getValue()}</span> }),
    colT.accessor('sidemark', { id: 'taskSidemark', header: 'Sidemark', size: 120, cell: i => <span style={{ fontSize: 12, color: theme.colors.textSecondary }}>{i.getValue() || '—'}</span> }),
    colT.accessor('created', { id: 'taskCreated', header: 'Created', size: 90, cell: i => <span style={{ fontSize: 12, color: theme.colors.textSecondary }}>{fmtDate(i.getValue())}</span> }),
    colT.display({ id: 'taskFolder', header: 'Folder', size: 90, cell: i => <FolderButton label="Task" url={i.row.original.taskFolderUrl} disabledTooltip="Start task to create folder" /> }),
  ], [colT]);

  const table = useReactTable({
    data: filtered, columns,
    state: { sorting, columnVisibility: colVis, columnOrder: columnOrder.length ? columnOrder : TASK_DEFAULT_ORDER },
    onSortingChange: setSorting, onColumnVisibilityChange: setColVis,
    onColumnOrderChange: (upd: React.SetStateAction<SortingState> | any) => setColumnOrder(typeof upd === 'function' ? upd(columnOrder.length ? columnOrder : TASK_DEFAULT_ORDER) : upd),
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getFilteredRowModel: getFilteredRowModel(),
    enableMultiSort: true,
  });

  const { containerRef, virtualRows, rows: allRows, totalHeight } = useVirtualRows(table);

  const toggleStatus = (s: string) => setStatusFilters(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ fontSize: 12, color: theme.colors.textMuted, fontWeight: 500 }}>Status:</div>
        {allStatuses.map(s => (
          <button key={s} onClick={() => toggleStatus(s)} style={chip(statusFilters.includes(s))}>{s}</button>
        ))}
        {statusFilters.length > 0 && (
          <button onClick={() => setStatusFilters([])} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 500, border: `1px solid ${theme.colors.border}`, background: 'transparent', cursor: 'pointer', color: theme.colors.textMuted }}>
            <X size={11} /> Clear
          </button>
        )}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: theme.colors.textMuted }}>{filtered.length} task{filtered.length !== 1 ? 's' : ''}</span>
        <div style={{ position: 'relative' }} ref={menuRef}>
          <button onClick={() => setShowCols(v => !v)} style={{ padding: '6px 10px', fontSize: 12, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'inherit', color: theme.colors.textSecondary }}>
            <Settings2 size={13} /> Columns
          </button>
          {showCols && (
            <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, background: '#fff', border: `1px solid ${theme.colors.border}`, borderRadius: 10, padding: 8, zIndex: 50, boxShadow: '0 4px 20px rgba(0,0,0,0.1)', minWidth: 170 }}>
              {TASK_DEFAULT_ORDER.map(id => (
                <label key={id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', fontSize: 12, cursor: 'pointer' }}>
                  <input type="checkbox" checked={colVis[id] !== false} onChange={() => setColVis(v => ({ ...v, [id]: v[id] === false }))} style={{ accentColor: theme.colors.orange }} />
                  {TASK_COL_LABELS[id]}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Table */}
      <div style={{ border: `1px solid ${theme.colors.border}`, borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
        <div ref={containerRef} style={{ overflowY: 'auto', overflowX: 'auto', maxHeight: 'calc(100dvh - 380px)', WebkitOverflowScrolling: 'touch' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              {table.getHeaderGroups().map(hg => (
                <tr key={hg.id}>
                  {hg.headers.map(h => (
                    <DragHeader key={h.id} h={h} dragColId={dragColId} dragOverColId={dragOverColId}
                      onDragStart={() => setDragColId(h.id)} onDragOver={() => setDragOverColId(h.id)}
                      onDragEnd={() => {
                        if (dragColId && dragOverColId && dragColId !== dragOverColId) {
                          const cur = columnOrder.length ? [...columnOrder] : [...TASK_DEFAULT_ORDER];
                          const from = cur.indexOf(dragColId); const to = cur.indexOf(dragOverColId);
                          if (from !== -1 && to !== -1) { cur.splice(from, 1); cur.splice(to, 0, dragColId); setColumnOrder(cur); }
                        }
                        setDragColId(null); setDragOverColId(null);
                      }}
                      sorted={h.column.getIsSorted()}
                    />
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {virtualRows.length > 0 && <tr style={{ height: virtualRows[0].start }}><td colSpan={table.getVisibleFlatColumns().length} /></tr>}
              {virtualRows.map(vRow => {
                const row = allRows[vRow.index];
                return (
                  <tr key={row.id} onClick={() => onNavigate(row.original)}
                    style={{ cursor: 'pointer', transition: 'background 0.1s' }}
                    onMouseEnter={e => { e.currentTarget.style.background = theme.colors.bgSubtle; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    {row.getVisibleCells().map(cell => <td key={cell.id} style={tdStyle}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}
                  </tr>
                );
              })}
              {virtualRows.length > 0 && <tr style={{ height: totalHeight - (virtualRows[virtualRows.length - 1]?.end ?? 0) }}><td colSpan={table.getVisibleFlatColumns().length} /></tr>}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div style={{ padding: 32, textAlign: 'center', color: theme.colors.textMuted, fontSize: 13 }}>
              {tasks.length === 0 ? 'No tasks found' : 'No tasks match the selected status filters'}
            </div>
          )}
        </div>
        <div style={{ padding: '6px 16px', borderTop: `1px solid ${theme.colors.borderLight}`, fontSize: 12, color: theme.colors.textMuted }}>
          {allRows.length} row{allRows.length !== 1 ? 's' : ''}
        </div>
      </div>
    </div>
  );
}

// ─── Repairs Tab ──────────────────────────────────────────────────────────────

const REPAIR_DEFAULT_ORDER = ['repairId', 'repairStatus', 'repairItem', 'repairDesc', 'repairItemVendor', 'repairTech', 'repairQuote', 'repairClient', 'repairCreated', 'repairFolder'];
const REPAIR_COL_LABELS: Record<string, string> = { repairId: 'Repair ID', repairStatus: 'Status', repairItem: 'Item', repairDesc: 'Description', repairItemVendor: 'Vendor', repairTech: 'Repair Tech', repairQuote: 'Quote', repairClient: 'Client', repairCreated: 'Created', repairFolder: 'Folder' };

function RepairsTab({ repairs, onNavigate, userRole }: { repairs: SummaryRepair[]; onNavigate: (repair: SummaryRepair) => void; userRole?: string }) {
  const colR = createColumnHelper<SummaryRepair>();
  const { sorting, setSorting, colVis, setColVis, columnOrder, setColumnOrder } = useTablePreferences('dashboard-repairs', [{ id: 'repairCreated', desc: true }], {}, REPAIR_DEFAULT_ORDER);
  const [statusFilters, setStatusFilters] = useState<string[]>(DEFAULT_REPAIR_STATUSES);
  const [showCols, setShowCols] = useState(false);
  const [dragColId, setDragColId] = useState<string | null>(null);
  const [dragOverColId, setDragOverColId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => { const h = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowCols(false); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, []);

  const allStatuses = useMemo(() => [...new Set(repairs.map(r => r.status))].sort(), [repairs]);
  const filtered = useMemo(() => statusFilters.length === 0 ? repairs : repairs.filter(r => statusFilters.includes(r.status)), [repairs, statusFilters]);

  const columns = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cols: any[] = [
      colR.accessor('repairId', { id: 'repairId', header: 'Repair ID', size: 120, cell: i => <span style={{ fontWeight: 600, fontSize: 12, fontFamily: 'monospace', color: theme.colors.orange }}>{i.getValue()}</span> }),
      colR.accessor('status', { id: 'repairStatus', header: 'Status', size: 130, cell: i => <StatusBadge status={i.getValue()} /> }),
      colR.accessor('itemId', { id: 'repairItem', header: 'Item', size: 90, cell: i => <span style={{ fontSize: 12, color: theme.colors.textSecondary }}>{i.getValue() || '—'}</span> }),
      colR.accessor('description', { id: 'repairDesc', header: 'Description', size: 200, cell: i => <span style={{ fontSize: 12, maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis', display: 'block', color: theme.colors.textSecondary }}>{i.getValue() || '—'}</span> }),
      colR.accessor('vendor', { id: 'repairItemVendor', header: 'Vendor', size: 130, cell: i => <span style={{ fontSize: 12, color: theme.colors.textSecondary }}>{i.getValue() || '—'}</span> }),
      colR.accessor('repairVendor', { id: 'repairTech', header: 'Repair Tech', size: 130, cell: i => <span style={{ fontSize: 12, color: theme.colors.textSecondary }}>{i.getValue() || '—'}</span> }),
    ];
    // Quote visible to admin only — hide from staff and repair techs
    if (userRole === 'admin') {
      cols.push(colR.accessor('quoteAmount', { id: 'repairQuote', header: 'Quote', size: 80, cell: i => <span style={{ fontSize: 12 }}>{i.getValue() != null ? `$${Number(i.getValue()).toFixed(2)}` : '—'}</span> }));
    }
    cols.push(
      colR.accessor('clientName', { id: 'repairClient', header: 'Client', size: 140, cell: i => <span style={{ fontSize: 12, fontWeight: 500 }}>{i.getValue()}</span> }),
      colR.accessor('createdDate', { id: 'repairCreated', header: 'Created', size: 90, cell: i => <span style={{ fontSize: 12, color: theme.colors.textSecondary }}>{fmtDate(i.getValue())}</span> }),
      colR.display({ id: 'repairFolder', header: 'Folder', size: 90, cell: i => <FolderButton label="Repair" url={i.row.original.repairFolderUrl} disabledTooltip="Start repair to create folder" /> }),
    );
    return cols;
  }, [colR, userRole]);

  const table = useReactTable({
    data: filtered, columns,
    state: { sorting, columnVisibility: colVis, columnOrder: columnOrder.length ? columnOrder : REPAIR_DEFAULT_ORDER },
    onSortingChange: setSorting, onColumnVisibilityChange: setColVis,
    onColumnOrderChange: (upd: any) => setColumnOrder(typeof upd === 'function' ? upd(columnOrder.length ? columnOrder : REPAIR_DEFAULT_ORDER) : upd),
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getFilteredRowModel: getFilteredRowModel(),
    enableMultiSort: true,
  });

  const { containerRef, virtualRows, rows: allRows, totalHeight } = useVirtualRows(table);
  const toggleStatus = (s: string) => setStatusFilters(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ fontSize: 12, color: theme.colors.textMuted, fontWeight: 500 }}>Status:</div>
        {allStatuses.map(s => <button key={s} onClick={() => toggleStatus(s)} style={chip(statusFilters.includes(s))}>{s}</button>)}
        {statusFilters.length > 0 && (
          <button onClick={() => setStatusFilters([])} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 500, border: `1px solid ${theme.colors.border}`, background: 'transparent', cursor: 'pointer', color: theme.colors.textMuted }}>
            <X size={11} /> Clear
          </button>
        )}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: theme.colors.textMuted }}>{filtered.length} repair{filtered.length !== 1 ? 's' : ''}</span>
        <div style={{ position: 'relative' }} ref={menuRef}>
          <button onClick={() => setShowCols(v => !v)} style={{ padding: '6px 10px', fontSize: 12, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'inherit', color: theme.colors.textSecondary }}>
            <Settings2 size={13} /> Columns
          </button>
          {showCols && (
            <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, background: '#fff', border: `1px solid ${theme.colors.border}`, borderRadius: 10, padding: 8, zIndex: 50, boxShadow: '0 4px 20px rgba(0,0,0,0.1)', minWidth: 170 }}>
              {REPAIR_DEFAULT_ORDER.map(id => (
                <label key={id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', fontSize: 12, cursor: 'pointer' }}>
                  <input type="checkbox" checked={colVis[id] !== false} onChange={() => setColVis(v => ({ ...v, [id]: v[id] === false }))} style={{ accentColor: theme.colors.orange }} />
                  {REPAIR_COL_LABELS[id]}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>
      <div style={{ border: `1px solid ${theme.colors.border}`, borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
        <div ref={containerRef} style={{ overflowY: 'auto', overflowX: 'auto', maxHeight: 'calc(100dvh - 380px)', WebkitOverflowScrolling: 'touch' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>{table.getHeaderGroups().map(hg => <tr key={hg.id}>{hg.headers.map(h => <DragHeader key={h.id} h={h} dragColId={dragColId} dragOverColId={dragOverColId} onDragStart={() => setDragColId(h.id)} onDragOver={() => setDragOverColId(h.id)} onDragEnd={() => { if (dragColId && dragOverColId && dragColId !== dragOverColId) { const cur = columnOrder.length ? [...columnOrder] : [...REPAIR_DEFAULT_ORDER]; const from = cur.indexOf(dragColId); const to = cur.indexOf(dragOverColId); if (from !== -1 && to !== -1) { cur.splice(from, 1); cur.splice(to, 0, dragColId); setColumnOrder(cur); } } setDragColId(null); setDragOverColId(null); }} sorted={h.column.getIsSorted()} />)}</tr>)}</thead>
            <tbody>
              {virtualRows.length > 0 && <tr style={{ height: virtualRows[0].start }}><td colSpan={table.getVisibleFlatColumns().length} /></tr>}
              {virtualRows.map(vRow => { const row = allRows[vRow.index]; return (<tr key={row.id} onClick={() => onNavigate(row.original)} style={{ cursor: 'pointer', transition: 'background 0.1s' }} onMouseEnter={e => { e.currentTarget.style.background = theme.colors.bgSubtle; }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>{row.getVisibleCells().map(cell => <td key={cell.id} style={tdStyle}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}</tr>); })}
              {virtualRows.length > 0 && <tr style={{ height: totalHeight - (virtualRows[virtualRows.length - 1]?.end ?? 0) }}><td colSpan={table.getVisibleFlatColumns().length} /></tr>}
            </tbody>
          </table>
          {filtered.length === 0 && <div style={{ padding: 32, textAlign: 'center', color: theme.colors.textMuted, fontSize: 13 }}>{repairs.length === 0 ? 'No repairs found' : 'No repairs match the selected status filters'}</div>}
        </div>
        <div style={{ padding: '6px 16px', borderTop: `1px solid ${theme.colors.borderLight}`, fontSize: 12, color: theme.colors.textMuted }}>{allRows.length} row{allRows.length !== 1 ? 's' : ''}</div>
      </div>
    </div>
  );
}

// ─── Will Calls Tab ───────────────────────────────────────────────────────────

const WC_DEFAULT_ORDER = ['wcNumber', 'wcStatus', 'wcContact', 'wcItems', 'wcClient', 'wcScheduled', 'wcCreated', 'wcFolder'];
const WC_COL_LABELS: Record<string, string> = { wcNumber: 'WC #', wcStatus: 'Status', wcContact: 'Contact', wcItems: 'Items', wcClient: 'Client', wcScheduled: 'Scheduled', wcCreated: 'Created', wcFolder: 'Folder' };

function WillCallsTab({ willCalls, onNavigate }: { willCalls: SummaryWillCall[]; onNavigate: (wc: SummaryWillCall) => void }) {
  const colW = createColumnHelper<SummaryWillCall>();
  const { sorting, setSorting, colVis, setColVis, columnOrder, setColumnOrder } = useTablePreferences('dashboard-willcalls', [{ id: 'wcScheduled', desc: false }], {}, WC_DEFAULT_ORDER);
  const [statusFilters, setStatusFilters] = useState<string[]>(DEFAULT_WC_STATUSES);
  const [showCols, setShowCols] = useState(false);
  const [dragColId, setDragColId] = useState<string | null>(null);
  const [dragOverColId, setDragOverColId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => { const h = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowCols(false); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, []);

  const allStatuses = useMemo(() => [...new Set(willCalls.map(w => w.status))].sort(), [willCalls]);
  const filtered = useMemo(() => statusFilters.length === 0 ? willCalls : willCalls.filter(w => statusFilters.includes(w.status)), [willCalls, statusFilters]);

  const columns = useMemo(() => [
    colW.accessor('wcNumber', { id: 'wcNumber', header: 'WC #', size: 110, cell: i => <span style={{ fontWeight: 600, fontSize: 12, fontFamily: 'monospace', color: theme.colors.orange }}>{i.getValue()}</span> }),
    colW.accessor('status', { id: 'wcStatus', header: 'Status', size: 110, cell: i => <StatusBadge status={i.getValue()} /> }),
    colW.accessor('pickupParty', { id: 'wcContact', header: 'Contact', size: 140, cell: i => <span style={{ fontSize: 12, fontWeight: 500 }}>{i.getValue() || '—'}</span> }),
    colW.accessor('itemCount', { id: 'wcItems', header: 'Items', size: 70, cell: i => <span style={{ fontSize: 12 }}>{i.getValue() ?? '—'}</span> }),
    colW.accessor('clientName', { id: 'wcClient', header: 'Client', size: 140, cell: i => <span style={{ fontSize: 12, fontWeight: 500 }}>{i.getValue()}</span> }),
    colW.accessor('estPickupDate', { id: 'wcScheduled', header: 'Scheduled', size: 100, cell: i => <span style={{ fontSize: 12, color: theme.colors.textSecondary }}>{fmtDate(i.getValue())}</span> }),
    colW.accessor('createdDate', { id: 'wcCreated', header: 'Created', size: 90, cell: i => <span style={{ fontSize: 12, color: theme.colors.textSecondary }}>{fmtDate(i.getValue())}</span> }),
    colW.display({ id: 'wcFolder', header: 'Folder', size: 90, cell: i => <FolderButton label="WC" url={i.row.original.wcFolderUrl} disabledTooltip="No folder yet" /> }),
  ], [colW]);

  const table = useReactTable({
    data: filtered, columns,
    state: { sorting, columnVisibility: colVis, columnOrder: columnOrder.length ? columnOrder : WC_DEFAULT_ORDER },
    onSortingChange: setSorting, onColumnVisibilityChange: setColVis,
    onColumnOrderChange: (upd: any) => setColumnOrder(typeof upd === 'function' ? upd(columnOrder.length ? columnOrder : WC_DEFAULT_ORDER) : upd),
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getFilteredRowModel: getFilteredRowModel(),
    enableMultiSort: true,
  });

  const { containerRef, virtualRows, rows: allRows, totalHeight } = useVirtualRows(table);
  const toggleStatus = (s: string) => setStatusFilters(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ fontSize: 12, color: theme.colors.textMuted, fontWeight: 500 }}>Status:</div>
        {allStatuses.map(s => <button key={s} onClick={() => toggleStatus(s)} style={chip(statusFilters.includes(s))}>{s}</button>)}
        {statusFilters.length > 0 && (
          <button onClick={() => setStatusFilters([])} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 500, border: `1px solid ${theme.colors.border}`, background: 'transparent', cursor: 'pointer', color: theme.colors.textMuted }}>
            <X size={11} /> Clear
          </button>
        )}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: theme.colors.textMuted }}>{filtered.length} will call{filtered.length !== 1 ? 's' : ''}</span>
        <div style={{ position: 'relative' }} ref={menuRef}>
          <button onClick={() => setShowCols(v => !v)} style={{ padding: '6px 10px', fontSize: 12, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'inherit', color: theme.colors.textSecondary }}>
            <Settings2 size={13} /> Columns
          </button>
          {showCols && (
            <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, background: '#fff', border: `1px solid ${theme.colors.border}`, borderRadius: 10, padding: 8, zIndex: 50, boxShadow: '0 4px 20px rgba(0,0,0,0.1)', minWidth: 160 }}>
              {WC_DEFAULT_ORDER.map(id => (
                <label key={id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', fontSize: 12, cursor: 'pointer' }}>
                  <input type="checkbox" checked={colVis[id] !== false} onChange={() => setColVis(v => ({ ...v, [id]: v[id] === false }))} style={{ accentColor: theme.colors.orange }} />
                  {WC_COL_LABELS[id]}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>
      <div style={{ border: `1px solid ${theme.colors.border}`, borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
        <div ref={containerRef} style={{ overflowY: 'auto', overflowX: 'auto', maxHeight: 'calc(100dvh - 380px)', WebkitOverflowScrolling: 'touch' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>{table.getHeaderGroups().map(hg => <tr key={hg.id}>{hg.headers.map(h => <DragHeader key={h.id} h={h} dragColId={dragColId} dragOverColId={dragOverColId} onDragStart={() => setDragColId(h.id)} onDragOver={() => setDragOverColId(h.id)} onDragEnd={() => { if (dragColId && dragOverColId && dragColId !== dragOverColId) { const cur = columnOrder.length ? [...columnOrder] : [...WC_DEFAULT_ORDER]; const from = cur.indexOf(dragColId); const to = cur.indexOf(dragOverColId); if (from !== -1 && to !== -1) { cur.splice(from, 1); cur.splice(to, 0, dragColId); setColumnOrder(cur); } } setDragColId(null); setDragOverColId(null); }} sorted={h.column.getIsSorted()} />)}</tr>)}</thead>
            <tbody>
              {virtualRows.length > 0 && <tr style={{ height: virtualRows[0].start }}><td colSpan={table.getVisibleFlatColumns().length} /></tr>}
              {virtualRows.map(vRow => { const row = allRows[vRow.index]; return (<tr key={row.id} onClick={() => onNavigate(row.original)} style={{ cursor: 'pointer', transition: 'background 0.1s' }} onMouseEnter={e => { e.currentTarget.style.background = theme.colors.bgSubtle; }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>{row.getVisibleCells().map(cell => <td key={cell.id} style={tdStyle}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}</tr>); })}
              {virtualRows.length > 0 && <tr style={{ height: totalHeight - (virtualRows[virtualRows.length - 1]?.end ?? 0) }}><td colSpan={table.getVisibleFlatColumns().length} /></tr>}
            </tbody>
          </table>
          {filtered.length === 0 && <div style={{ padding: 32, textAlign: 'center', color: theme.colors.textMuted, fontSize: 13 }}>{willCalls.length === 0 ? 'No will calls found' : 'No will calls match the selected status filters'}</div>}
        </div>
        <div style={{ padding: '6px 16px', borderTop: `1px solid ${theme.colors.borderLight}`, fontSize: 12, color: theme.colors.textMuted }}>{allRows.length} row{allRows.length !== 1 ? 's' : ''}</div>
      </div>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

/** ⚠️  FRAGILE HOOK ORDER — see Inventory.tsx for full warning. Do not reorder/add/remove hooks. */
export function Dashboard() {
  const { isMobile, isExtraSmall } = useIsMobile();
  const apiConfigured = isApiConfigured();

  // Active tab — sessionStorage, default 'tasks' on fresh login
  const [activeTab, setActiveTab] = useState<DashTab>(() => {
    const saved = sessionStorage.getItem('dash_active_tab');
    return (saved as DashTab) || 'tasks';
  });

  // Lazy-load: only fetch data for tabs that have been visited
  const [tabsLoaded, setTabsLoaded] = useState<Record<DashTab, boolean>>({
    tasks: true, repairs: false, willcalls: false,
  });

  const handleTabChange = useCallback((tab: DashTab) => {
    setActiveTab(tab);
    setTabsLoaded(prev => ({ ...prev, [tab]: true }));
    sessionStorage.setItem('dash_active_tab', tab);
  }, []);

  // Single hook fetches all three tab datasets
  const { tasks, repairs, willCalls, loading, error, refetch, lastFetched } = useDashboardSummary(apiConfigured);

  // ── 10-second polling ────────────────────────────────────────────────────────
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!apiConfigured) return;
    const poll = setInterval(() => {
      if (document.hidden) return; // skip background tabs
      refetch(false); // hits server cache when warm (~2–4s)
    }, POLL_INTERVAL_MS);
    return () => clearInterval(poll);
  }, [apiConfigured, refetch]);

  // Resume polling when tab becomes visible again
  useEffect(() => {
    const handleVisible = () => {
      if (!document.hidden && apiConfigured) refetch(false);
    };
    document.addEventListener('visibilitychange', handleVisible);
    return () => document.removeEventListener('visibilitychange', handleVisible);
  }, [apiConfigured, refetch]);

  // Manual sync — bypasses server cache
  const handleManualSync = useCallback(() => {
    setRefreshing(true);
    refetch(true); // noCache=true → bypasses 60s server-side CacheService
    setTimeout(() => setRefreshing(false), 3000);
  }, [refetch]);

  // Relative time display
  const [_tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const lastSyncedLabel = useMemo(() => {
    if (!lastFetched) return null;
    const sec = Math.round((Date.now() - lastFetched.getTime()) / 1000);
    if (sec < 60) return `${sec}s ago`;
    return `${Math.round(sec / 60)}m ago`;
  }, [lastFetched, _tick]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Stat cards ───────────────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    openTasks: tasks.filter(t => t.status === 'Open' || t.status === 'In Progress').length,
    openRepairs: repairs.filter(r => !['Complete', 'Cancelled', 'Declined'].includes(r.status)).length,
    pendingWCs: willCalls.filter(w => ['Pending', 'Scheduled', 'Partial'].includes(w.status)).length,
  }), [tasks, repairs, willCalls]);

  // ── Row click navigation (deep links → list page with detail panel auto-open) ─
  const nav = useNavigate();
  const handleTaskNav = useCallback((task: SummaryTask) => {
    nav(`/tasks?open=${encodeURIComponent(task.taskId)}&client=${encodeURIComponent(task.clientSheetId)}`);
  }, [nav]);

  const handleRepairNav = useCallback((repair: SummaryRepair) => {
    nav(`/repairs?open=${encodeURIComponent(repair.repairId)}&client=${encodeURIComponent(repair.clientSheetId)}`);
  }, [nav]);

  const handleWcNav = useCallback((wc: SummaryWillCall) => {
    nav(`/will-calls?open=${encodeURIComponent(wc.wcNumber)}&client=${encodeURIComponent(wc.clientSheetId)}`);
  }, [nav]);

  // ── Task type filter (dropdown on tab button, persisted per user) ─────────────
  const { user } = useAuth();
  const typeFilterKey = user?.email ? `stride_dashboard_typeFilter_${user.email}` : 'stride_dashboard_typeFilter';
  const [taskTypeFilters, setTaskTypeFiltersRaw] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(typeFilterKey);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  const setTaskTypeFilters = useCallback((updater: string[] | ((prev: string[]) => string[])) => {
    setTaskTypeFiltersRaw(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      try { localStorage.setItem(typeFilterKey, JSON.stringify(next)); } catch { /* quota */ }
      return next;
    });
  }, [typeFilterKey]);
  const [showTypeDropdown, setShowTypeDropdown] = useState(false);
  const typeDropdownRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (typeDropdownRef.current && !typeDropdownRef.current.contains(e.target as Node)) setShowTypeDropdown(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const allTypeCodes = useMemo(() => ALL_SERVICE_TYPES.map(s => s.code), []);
  const filteredTasks = useMemo(() => taskTypeFilters.length === 0 ? tasks : tasks.filter(t => taskTypeFilters.includes(t.taskType)), [tasks, taskTypeFilters]);
  const isAllSelected = taskTypeFilters.length === 0;

  const toggleTaskType = useCallback((type: string) => {
    setTaskTypeFilters(prev => {
      // If currently "all" (empty), start with all codes MINUS the toggled one
      if (prev.length === 0) return allTypeCodes.filter(t => t !== type);
      const next = prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type];
      // If result includes all types, reset to empty (= show all)
      if (next.length >= allTypeCodes.length) return [];
      return next;
    });
  }, [allTypeCodes]);

  const toggleSelectAll = useCallback(() => {
    setTaskTypeFilters([]);
  }, []);

  // ── Loading / error states ────────────────────────────────────────────────────
  if (loading && tasks.length === 0 && repairs.length === 0 && willCalls.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: 14 }}>
        <div style={{ width: 32, height: 32, border: `3px solid #E5E7EB`, borderTopColor: theme.colors.orange, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: theme.colors.textPrimary }}>Loading Dashboard</div>
          <div style={{ fontSize: 12, color: theme.colors.textMuted, marginTop: 4 }}>{user?.role === 'client' ? 'Loading…' : 'Fetching open jobs across all clients…'}</div>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  const TAB_DEFS: { id: DashTab; label: string; icon: React.ReactNode; count: number }[] = [
    { id: 'tasks', label: 'Tasks', icon: <ClipboardList size={14} />, count: filteredTasks.filter(t => t.status === 'Open' || t.status === 'In Progress').length },
    { id: 'repairs', label: 'Repairs', icon: <Wrench size={14} />, count: repairs.filter(r => !['Complete', 'Cancelled', 'Declined'].includes(r.status)).length },
    { id: 'willcalls', label: 'Will Calls', icon: <Truck size={14} />, count: willCalls.filter(w => ['Pending', 'Scheduled', 'Partial'].includes(w.status)).length },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.3px', margin: 0 }}>Dashboard</h1>
          <p style={{ fontSize: 13, color: theme.colors.textMuted, marginTop: 2, marginBottom: 0 }}>Open jobs across all clients</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {lastSyncedLabel && <span style={{ fontSize: 11, color: theme.colors.textMuted }}>Updated {lastSyncedLabel}</span>}
          <button onClick={handleManualSync} title="Force refresh (bypass cache)" style={{ padding: '6px 10px', fontSize: 12, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit', color: refreshing ? theme.colors.orange : theme.colors.textSecondary }}>
            <RefreshCw size={13} style={refreshing ? { animation: 'spin 1s linear infinite' } : undefined} />
            {!isMobile && 'Sync'}
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#DC2626' }}>
          {error}
        </div>
      )}

      {/* Stat Cards */}
      <div style={{ display: 'grid', gap: 14, gridTemplateColumns: isExtraSmall ? '1fr' : isMobile ? '1fr 1fr' : 'repeat(3, 1fr)' }}>
        <StatCard icon={<ClipboardList size={18} />} label="Open Tasks" value={stats.openTasks} sub="Open + In Progress" color={theme.colors.orange} onClick={() => handleTabChange('tasks')} />
        <StatCard icon={<Wrench size={18} />} label="Active Repairs" value={stats.openRepairs} sub="Pending quote or approved" color="#7C3AED" onClick={() => handleTabChange('repairs')} />
        <StatCard icon={<Truck size={18} />} label="Pending Will Calls" value={stats.pendingWCs} sub="Pending · Scheduled · Partial" color="#1D4ED8" onClick={() => handleTabChange('willcalls')} />
      </div>

      {/* Tabs */}
      <div>
        {/* Tab bar */}
        <div style={{ display: 'flex', gap: 0, borderBottom: `2px solid ${theme.colors.border}`, marginBottom: 16 }}>
          {TAB_DEFS.map(tab => {
            const active = activeTab === tab.id;
            const isTasksTab = tab.id === 'tasks';
            const tabStyle: React.CSSProperties = {
              display: 'flex', alignItems: 'center', gap: 6, padding: '10px 18px',
              fontSize: 13, fontWeight: active ? 600 : 400, fontFamily: 'inherit',
              background: 'none', border: 'none', cursor: 'pointer',
              borderBottom: active ? `2px solid ${theme.colors.orange}` : '2px solid transparent',
              marginBottom: -2,
              color: active ? theme.colors.orange : theme.colors.textSecondary,
              transition: 'color 0.15s',
            };
            return (
              <div key={tab.id} style={{ position: 'relative' }} ref={isTasksTab ? typeDropdownRef : undefined}>
                <button onClick={() => handleTabChange(tab.id)} style={tabStyle}>
                  {tab.icon}
                  {tab.label}
                  <span style={{
                    fontSize: 11, fontWeight: 600, padding: '1px 7px', borderRadius: 10,
                    background: active ? theme.colors.orangeLight : theme.colors.bgSubtle,
                    color: active ? theme.colors.orange : theme.colors.textMuted,
                  }}>
                    {tab.count}
                  </span>
                  {isTasksTab && (
                    <ChevronDown size={12} onClick={e => { e.stopPropagation(); setShowTypeDropdown(v => !v); }} style={{ marginLeft: -2, opacity: 0.6 }} />
                  )}
                </button>
                {/* Task type dropdown */}
                {isTasksTab && showTypeDropdown && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, marginTop: 4, background: '#fff',
                    border: `1px solid ${theme.colors.border}`, borderRadius: 10, padding: 6,
                    zIndex: 50, boxShadow: '0 4px 20px rgba(0,0,0,0.1)', minWidth: 190,
                  }}>
                    {/* Select All */}
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', fontSize: 12, cursor: 'pointer', fontWeight: 600, borderBottom: `1px solid ${theme.colors.border}`, marginBottom: 2, paddingBottom: 8 }}>
                      <input type="checkbox" checked={isAllSelected} onChange={toggleSelectAll} style={{ accentColor: theme.colors.orange }} />
                      Select All
                    </label>
                    {ALL_SERVICE_TYPES.map(svc => {
                      const checked = isAllSelected || taskTypeFilters.includes(svc.code);
                      return (
                        <label key={svc.code} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', fontSize: 12, cursor: 'pointer' }}>
                          <input type="checkbox" checked={checked} onChange={() => toggleTaskType(svc.code)} style={{ accentColor: theme.colors.orange }} />
                          {svc.name}
                        </label>
                      );
                    })}
                    {!isAllSelected && (
                      <div style={{ borderTop: `1px solid ${theme.colors.border}`, marginTop: 4, paddingTop: 4 }}>
                        <button onClick={() => setTaskTypeFilters([])} style={{ width: '100%', padding: '5px 8px', fontSize: 11, border: 'none', background: 'none', cursor: 'pointer', color: theme.colors.orange, fontWeight: 500, textAlign: 'left', fontFamily: 'inherit' }}>
                          Reset to all types
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          <div style={{ flex: 1 }} />
          {loading && <div style={{ display: 'flex', alignItems: 'center', paddingRight: 8 }}><div style={{ width: 14, height: 14, border: `2px solid #E5E7EB`, borderTopColor: theme.colors.orange, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} /></div>}
        </div>

        {/* Tab content — render all but hide inactive (preserves scroll/filter state) */}
        <div style={{ display: activeTab === 'tasks' ? 'block' : 'none' }}>
          {tabsLoaded.tasks && <TasksTab tasks={filteredTasks} onNavigate={handleTaskNav} />}
        </div>
        <div style={{ display: activeTab === 'repairs' ? 'block' : 'none' }}>
          {tabsLoaded.repairs && <RepairsTab repairs={repairs} onNavigate={handleRepairNav} userRole={user?.role} />}
        </div>
        <div style={{ display: activeTab === 'willcalls' ? 'block' : 'none' }}>
          {tabsLoaded.willcalls && <WillCallsTab willCalls={willCalls} onNavigate={handleWcNav} />}
        </div>
      </div>
    </div>
  );
}
