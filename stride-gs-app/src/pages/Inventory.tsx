import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useTablePreferences } from '../hooks/useTablePreferences';
import { createPortal } from 'react-dom';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  createColumnHelper,
  type ColumnFiltersState,
  type VisibilityState,
  type RowSelectionState,
  type ColumnSizingState,
  type FilterFn,
} from '@tanstack/react-table';
import {
  Eye,
  ClipboardList,
  Truck,
  Search,
  Download,
  ChevronUp,
  ChevronDown,
  ArrowUpDown,
  X,
  Settings2,
  SlidersHorizontal,
  Palette,
  RefreshCw,
  Printer,
  Filter,
  Package,
  Wrench,
} from 'lucide-react';
import { useVirtualRows } from '../hooks/useVirtualRows';
import { theme } from '../styles/theme';
import { fmtDate } from '../lib/constants';
import { ItemDetailPanel } from '../components/shared/ItemDetailPanel';
import { CreateWillCallModal } from '../components/shared/CreateWillCallModal';
import { TransferItemsModal } from '../components/shared/TransferItemsModal';
import { ReleaseItemsModal } from '../components/shared/ReleaseItemsModal';
import { CreateTaskModal } from '../components/shared/CreateTaskModal';
import { AddToWillCallModal } from '../components/shared/AddToWillCallModal';
import type { InventoryItem, InventoryStatus } from '../lib/types';
import { WriteButton } from '../components/shared/WriteButton';
import { BatchGuard, checkBatchClientGuard } from '../components/shared/BatchGuard';
import { useNavigate, useLocation } from 'react-router-dom';
import { isApiConfigured, postRequestRepairQuote } from '../lib/api';
import { supabase } from '../lib/supabase';
import { useInventory } from '../hooks/useInventory';
import { useClients } from '../hooks/useClients';
import { useClientFilterUrlSync } from '../hooks/useClientFilterUrlSync';
import { useTasks } from '../hooks/useTasks';
import { useRepairs } from '../hooks/useRepairs';
import { useWillCalls } from '../hooks/useWillCalls';
import { useShipments } from '../hooks/useShipments';
import { useBilling } from '../hooks/useBilling';
import { useLocations } from '../hooks/useLocations';
import { usePricing } from '../hooks/usePricing';
import { useAuth } from '../contexts/AuthContext';
import { useBatchData } from '../contexts/BatchDataContext';
import { MultiSelectFilter } from '../components/shared/MultiSelectFilter';
import { SyncBanner } from '../components/shared/SyncBanner';
import type { LinkedRecord } from '../components/shared/ItemDetailPanel';
import { useIsMobile } from '../hooks/useIsMobile';
import { FloatingActionMenu, type FABAction } from '../components/shared/FloatingActionMenu';
import { mobileChipsRow } from '../styles/mobileTable';

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<InventoryStatus, { bg: string; text: string }> = {
  Active:      { bg: theme.colors.statusGreenBg,  text: theme.colors.statusGreen },
  Released:    { bg: theme.colors.statusBlueBg,   text: theme.colors.statusBlue },
  'On Hold':   { bg: theme.colors.statusAmberBg,  text: theme.colors.statusAmber },
  Transferred: { bg: theme.colors.statusGrayBg,   text: theme.colors.statusGray },
};

const ALL_STATUSES: InventoryStatus[] = ['Active', 'On Hold', 'Released', 'Transferred'];

const DEFAULT_COL_ORDER = [
  'select', 'itemId', 'clientName', 'reference', 'vendor', 'description',
  'itemClass', 'qty', 'location', 'sidemark', 'room',
  'status', 'receiveDate', 'releaseDate', 'notes', 'actions',
];

// Columns the user can toggle (exclude select + actions)
const TOGGLEABLE_COLS = [
  'itemId', 'clientName', 'reference', 'vendor', 'description', 'itemClass',
  'qty', 'location', 'sidemark', 'room', 'status',
  'receiveDate', 'releaseDate', 'notes',
];

const COL_LABELS: Record<string, string> = {
  itemId: 'Item ID', clientName: 'Client', reference: 'Reference',
  vendor: 'Vendor', description: 'Description', itemClass: 'Class', qty: 'Qty',
  location: 'Location', sidemark: 'Sidemark', room: 'Room',
  status: 'Status', receiveDate: 'Rcv Date', releaseDate: 'Rel Date',
  notes: 'Notes',
};

// Pastel colors for sidemark highlighting
const SIDEMARK_PALETTE = [
  '#DBEAFE', // light blue
  '#D1FAE5', // light green
  '#E9D5FF', // light purple
  '#FEF3C7', // light yellow
  '#FCE7F3', // light pink
  '#FFEDD5', // light orange
  '#CCFBF1', // light teal
  '#FEE2E2', // light red
  '#E0E7FF', // light indigo
  '#D1FAEA', // light emerald
  '#FDE68A', // light amber
  '#FFE4E6', // light rose
  '#CFFAFE', // light cyan
  '#ECFCCB', // light lime
];

/** Build a deterministic sidemark → color map from visible data */
function buildSidemarkColorMap(items: InventoryItem[]): Map<string, string> {
  const unique = [...new Set(items.map(i => i.sidemark).filter(Boolean))].sort();
  const map = new Map<string, string>();
  unique.forEach((sm, idx) => map.set(sm, SIDEMARK_PALETTE[idx % SIDEMARK_PALETTE.length]));
  return map;
}

// Columns with multi-select filters (clientName list is dynamic, set in component)
const BASE_MULTISELECT_COLS: Record<string, string[]> = {
  status: ALL_STATUSES,
};

// ─── Custom Filter ────────────────────────────────────────────────────────────

const multiSelectFilter: FilterFn<InventoryItem> = (row, columnId, value: string[]) => {
  if (!value || value.length === 0) return true;
  return value.includes(String(row.getValue(columnId)));
};
multiSelectFilter.autoRemove = (val: string[]) => !val || val.length === 0;

// ─── Utilities ────────────────────────────────────────────────────────────────

const formatDate = (iso: string) => fmtDate(iso);

function exportToCSV(rows: InventoryItem[], filename: string): void {
  const headers = 'Item ID,Client,Vendor,Description,Class,Qty,Location,Sidemark,Status,Receive Date,Release Date,Notes';
  const body = rows.map(r =>
    [r.itemId, r.clientName, r.vendor, r.description, r.itemClass,
      r.qty, r.location, r.sidemark, r.status,
      r.receiveDate, r.releaseDate ?? '', r.notes ?? '']
      .map(v => `"${String(v).replace(/"/g, '""')}"`)
      .join(',')
  ).join('\n');
  const blob = new Blob([headers + '\n' + body], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

// ─── StatusBadge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: InventoryStatus }) {
  const c = STATUS_CONFIG[status];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: theme.radii.full,
      background: c.bg, color: c.text,
      fontSize: theme.typography.sizes.xs,
      fontWeight: theme.typography.weights.medium,
      whiteSpace: 'nowrap',
    }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: c.text, flexShrink: 0 }} />
      {status}
    </span>
  );
}

// ─── FilterPopover ────────────────────────────────────────────────────────────

interface FilterPopoverProps {
  columnId: string;
  anchorRect: DOMRect;
  value: unknown;
  onChange: (v: unknown) => void;
  onClose: () => void;
  multiselectCols?: Record<string, string[]>;
}

function FilterPopover({ columnId, anchorRect, value, onChange, onClose, multiselectCols }: FilterPopoverProps) {
  const MULTISELECT_COLS = multiselectCols || BASE_MULTISELECT_COLS;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  const isMulti = columnId in MULTISELECT_COLS;
  const options = MULTISELECT_COLS[columnId] ?? [];
  const multiVal = (value as string[] | undefined) ?? [];

  return createPortal(
    <div
      ref={ref}
      style={{
        position: 'fixed',
        top: anchorRect.bottom + 4,
        left: Math.min(anchorRect.left, window.innerWidth - 220),
        background: theme.colors.bgBase,
        border: `1px solid ${theme.colors.borderDefault}`,
        borderRadius: theme.radii.lg,
        boxShadow: theme.shadows.lg,
        padding: '12px',
        zIndex: 9000,
        minWidth: 200,
        fontFamily: theme.typography.fontFamily,
      }}
    >
      {isMulti ? (
        <div>
          <div style={{
            fontSize: theme.typography.sizes.xs, color: theme.colors.textMuted,
            textTransform: 'uppercase', letterSpacing: '0.06em',
            fontWeight: theme.typography.weights.semibold, marginBottom: 8,
          }}>
            Filter by {COL_LABELS[columnId] ?? columnId}
          </div>
          {options.map(opt => {
            const checked = multiVal.includes(opt);
            return (
              <label key={opt} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '4px 0', cursor: 'pointer',
                fontSize: theme.typography.sizes.sm, color: theme.colors.textPrimary,
              }}>
                <span style={{
                  width: 15, height: 15, borderRadius: theme.radii.sm, flexShrink: 0,
                  border: `2px solid ${checked ? theme.colors.primary : theme.colors.borderDefault}`,
                  background: checked ? theme.colors.primary : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {checked && <span style={{ width: 7, height: 7, borderRadius: 1, background: '#fff' }} />}
                </span>
                <input
                  type="checkbox" checked={checked}
                  onChange={() => {
                    const next = checked ? multiVal.filter(v => v !== opt) : [...multiVal, opt];
                    onChange(next.length > 0 ? next : undefined);
                  }}
                  style={{ display: 'none' }}
                />
                {columnId === 'status' ? <StatusBadge status={opt as InventoryStatus} /> : opt}
              </label>
            );
          })}
          {multiVal.length > 0 && (
            <button onClick={() => onChange(undefined)} style={{
              marginTop: 8, fontSize: 11, color: theme.colors.textSecondary,
              background: 'none', border: 'none', cursor: 'pointer', padding: 0,
            }}>Clear all</button>
          )}
        </div>
      ) : (
        <div>
          <input
            autoFocus
            placeholder={`Search ${COL_LABELS[columnId] ?? columnId}…`}
            value={String(value ?? '')}
            onChange={e => onChange(e.target.value || undefined)}
            style={{
              width: '100%', boxSizing: 'border-box',
              border: `1px solid ${theme.colors.borderDefault}`,
              borderRadius: theme.radii.md, padding: '6px 10px',
              fontSize: theme.typography.sizes.sm, outline: 'none',
              fontFamily: theme.typography.fontFamily,
            }}
            onFocus={e => (e.target.style.borderColor = theme.colors.primary)}
            onBlur={e => (e.target.style.borderColor = theme.colors.borderDefault)}
          />
          {!!value && (
            <button onClick={() => onChange(undefined)} style={{
              marginTop: 8, fontSize: 11, color: theme.colors.textSecondary,
              background: 'none', border: 'none', cursor: 'pointer', padding: 0,
            }}>Clear</button>
          )}
        </div>
      )}
    </div>,
    document.body
  );
}

// ─── SidemarkFilterPopover ────────────────────────────────────────────────────

interface SidemarkFilterPopoverProps {
  anchorRect: DOMRect;
  allSidemarks: string[];
  selectedSidemarks: string[];
  inventoryItems: InventoryItem[];
  onChange: (val: string[]) => void;
  onClose: () => void;
}

function SidemarkFilterPopover({ anchorRect, allSidemarks, selectedSidemarks, inventoryItems, onChange, onClose }: SidemarkFilterPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  // Count items per sidemark
  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const item of inventoryItems) {
      if (item.sidemark) map[item.sidemark] = (map[item.sidemark] || 0) + 1;
    }
    return map;
  }, [inventoryItems]);

  const filtered = search
    ? allSidemarks.filter(s => s.toLowerCase().includes(search.toLowerCase()))
    : allSidemarks;

  const allSelected = selectedSidemarks.length === allSidemarks.length;

  return createPortal(
    <div
      ref={ref}
      style={{
        position: 'fixed',
        top: anchorRect.bottom + 4,
        left: Math.min(anchorRect.left, window.innerWidth - 280),
        background: theme.colors.bgBase,
        border: `1px solid ${theme.colors.borderDefault}`,
        borderRadius: theme.radii.lg,
        boxShadow: theme.shadows.lg,
        padding: '12px',
        zIndex: 9000,
        minWidth: 260,
        maxWidth: 320,
        maxHeight: 420,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: theme.typography.fontFamily,
      }}
    >
      <div style={{
        fontSize: theme.typography.sizes.xs, color: theme.colors.textMuted,
        textTransform: 'uppercase', letterSpacing: '0.06em',
        fontWeight: 600, marginBottom: 8,
      }}>
        Filter by Sidemark
      </div>

      {/* Search */}
      <input
        autoFocus
        placeholder="Search sidemarks..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{
          width: '100%', boxSizing: 'border-box',
          border: `1px solid ${theme.colors.borderDefault}`,
          borderRadius: theme.radii.md, padding: '6px 10px',
          fontSize: theme.typography.sizes.sm, outline: 'none',
          fontFamily: theme.typography.fontFamily, marginBottom: 8,
        }}
        onFocus={e => (e.target.style.borderColor = theme.colors.primary)}
        onBlur={e => (e.target.style.borderColor = theme.colors.borderDefault)}
      />

      {/* Select All / Clear All */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
        <button
          onClick={() => onChange(allSelected ? [] : [...allSidemarks])}
          style={{
            fontSize: 11, color: theme.colors.primary,
            background: 'none', border: 'none', cursor: 'pointer', padding: 0,
            fontWeight: 500, fontFamily: theme.typography.fontFamily,
          }}
        >
          {allSelected ? 'Clear All' : 'Select All'}
        </button>
        {selectedSidemarks.length > 0 && !allSelected && (
          <button
            onClick={() => onChange([])}
            style={{
              fontSize: 11, color: theme.colors.textSecondary,
              background: 'none', border: 'none', cursor: 'pointer', padding: 0,
              fontFamily: theme.typography.fontFamily,
            }}
          >
            Clear
          </button>
        )}
      </div>

      {/* Checkbox list */}
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {filtered.map(sm => {
          const checked = selectedSidemarks.includes(sm);
          return (
            <label key={sm} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '4px 0', cursor: 'pointer',
              fontSize: theme.typography.sizes.sm, color: theme.colors.textPrimary,
            }}>
              <span style={{
                width: 15, height: 15, borderRadius: theme.radii.sm, flexShrink: 0,
                border: `2px solid ${checked ? theme.colors.primary : theme.colors.borderDefault}`,
                background: checked ? theme.colors.primary : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {checked && <span style={{ width: 7, height: 7, borderRadius: 1, background: '#fff' }} />}
              </span>
              <input
                type="checkbox" checked={checked}
                onChange={() => {
                  const next = checked
                    ? selectedSidemarks.filter(s => s !== sm)
                    : [...selectedSidemarks, sm];
                  onChange(next);
                }}
                style={{ display: 'none' }}
              />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sm}</span>
              <span style={{ fontSize: 10, color: theme.colors.textMuted, flexShrink: 0 }}>{counts[sm] ?? 0}</span>
            </label>
          );
        })}
        {filtered.length === 0 && (
          <div style={{ fontSize: 12, color: theme.colors.textMuted, padding: '8px 0' }}>No sidemarks match</div>
        )}
      </div>
    </div>,
    document.body
  );
}

// ─── ColumnToggleMenu ─────────────────────────────────────────────────────────

interface ColumnToggleMenuProps {
  anchorRect: DOMRect;
  visibility: VisibilityState;
  onToggle: (id: string) => void;
  onClose: () => void;
}

function ColumnToggleMenu({ anchorRect, visibility, onToggle, onClose }: ColumnToggleMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      style={{
        position: 'fixed',
        top: anchorRect.bottom + 4,
        right: Math.max(window.innerWidth - anchorRect.right, 0),
        background: theme.colors.bgBase,
        border: `1px solid ${theme.colors.borderDefault}`,
        borderRadius: theme.radii.lg,
        boxShadow: theme.shadows.lg,
        padding: '8px 0',
        zIndex: 9000,
        minWidth: 160,
        fontFamily: theme.typography.fontFamily,
      }}
    >
      <div style={{
        fontSize: theme.typography.sizes.xs, color: theme.colors.textMuted,
        textTransform: 'uppercase', letterSpacing: '0.06em',
        fontWeight: theme.typography.weights.semibold,
        padding: '4px 14px 8px',
      }}>
        Columns
      </div>
      {TOGGLEABLE_COLS.map(colId => {
        const visible = visibility[colId] !== false;
        return (
          <button key={colId} onClick={() => onToggle(colId)} style={{
            display: 'flex', alignItems: 'center', gap: 8, width: '100%',
            padding: '6px 14px', background: 'none', border: 'none', cursor: 'pointer',
            fontSize: theme.typography.sizes.sm, color: theme.colors.textPrimary,
            textAlign: 'left',
          }}
            onMouseEnter={e => (e.currentTarget.style.background = theme.colors.bgSubtle)}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
          >
            <span style={{
              width: 15, height: 15, borderRadius: theme.radii.sm, flexShrink: 0,
              border: `2px solid ${visible ? theme.colors.primary : theme.colors.borderDefault}`,
              background: visible ? theme.colors.primary : 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {visible && <span style={{ width: 7, height: 7, borderRadius: 1, background: '#fff' }} />}
            </span>
            {COL_LABELS[colId]}
          </button>
        );
      })}
    </div>,
    document.body
  );
}

// ─── ToastBar ─────────────────────────────────────────────────────────────────

function ToastBar({ message }: { message: string }) {
  return createPortal(
    <div style={{
      position: 'fixed', bottom: 88, left: '50%', transform: 'translateX(-50%)',
      background: theme.colors.textPrimary, color: '#fff',
      padding: '9px 18px', borderRadius: theme.radii.lg,
      fontSize: theme.typography.sizes.sm, fontWeight: theme.typography.weights.medium,
      boxShadow: theme.shadows.lg, zIndex: 9999, whiteSpace: 'nowrap',
      fontFamily: theme.typography.fontFamily,
    }}>
      {message}
    </div>,
    document.body
  );
}

// ─── Column helper ────────────────────────────────────────────────────────────

const ch = createColumnHelper<InventoryItem>();

// ─── Main Component ──────────────────────────────────────────────────────────

/**
 * ⚠️  FRAGILE HOOK ORDER — DO NOT reorder, add, or remove hook calls (useState,
 * useMemo, useEffect, useCallback, useRef, useAuth, useNavigate, or any custom
 * hook) in this component without verifying the TOTAL hook count stays identical
 * across every render path. React error #300 ("Rendered more hooks than during
 * the previous render") has broken this page multiple times. If you must add a
 * hook, append it AFTER all existing hooks and BEFORE any early return. Never
 * put a hook inside a conditional block.
 */
export function Inventory() {
  const { isMobile } = useIsMobile();
  const apiConfigured = isApiConfigured();
  useBatchData();

  // Client list for MultiSelectFilter — declared before data hooks so clientFilter gates fetching
  const { apiClients, clients } = useClients(apiConfigured);
  const clientNames = useMemo(() => clients.map(c => c.name).sort(), [clients]);
  const [clientFilter, setClientFilter] = useState<string[]>([]);

  // Resolve selected client names → sheet IDs (string for single, string[] for multi)
  const selectedSheetId = useMemo<string | string[] | undefined>(() => {
    if (clientFilter.length === 0) return undefined;
    const ids = clientFilter
      .map(n => apiClients.find(c => c.name === n)?.spreadsheetId)
      .filter((x): x is string => !!x);
    if (ids.length === 0) return undefined;
    return ids.length === 1 ? ids[0] : ids;
  }, [clientFilter, apiClients]);

  const { items: liveItems, loading: inventoryLoading, refetch, applyItemPatch, mergeItemPatch, clearItemPatch } = useInventory(apiConfigured && clientFilter.length > 0, selectedSheetId);
  const { tasks, refetch: refetchTasks, addOptimisticTask, removeOptimisticTask } = useTasks(apiConfigured && clientFilter.length > 0, selectedSheetId);
  const { repairs } = useRepairs(apiConfigured && clientFilter.length > 0, selectedSheetId);
  const { willCalls, addOptimisticWc, removeOptimisticWc } = useWillCalls(apiConfigured && clientFilter.length > 0, selectedSheetId);
  const { apiShipments } = useShipments(apiConfigured && clientFilter.length > 0, selectedSheetId);
  // Inventory only uses billing rows to show "this item has billing" hints; single tenant only
  const billingSheetId = Array.isArray(selectedSheetId) ? (selectedSheetId.length === 1 ? selectedSheetId[0] : undefined) : selectedSheetId;
  const { rows: billingRows } = useBilling(apiConfigured && clientFilter.length > 0, billingSheetId);
  const { locationNames } = useLocations(apiConfigured);
  const { classNames } = usePricing(apiConfigured);
  const { user } = useAuth();
  const navigate = useNavigate();

  // Client-role users only see their own accounts in the dropdown — admin/staff see all.
  const dropdownClientNames = useMemo(() => {
    if (user?.role === 'client' && user.accessibleClientNames?.length) {
      const allowed = new Set(user.accessibleClientNames);
      return clientNames.filter(n => allowed.has(n));
    }
    return clientNames;
  }, [clientNames, user?.role, user?.accessibleClientNames]);

  // Auto-select clients for client-portal users (they only have 1-2 clients)
  useEffect(() => {
    if (user?.role === 'client' && user.accessibleClientNames?.length && clientFilter.length === 0) {
      setClientFilter(user.accessibleClientNames);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role, user?.accessibleClientNames?.length]);
  const location = useLocation();
  const pendingOpenRef = useRef<string | null>(null);
  const inventoryItems: InventoryItem[] = useMemo(() => {
    if (clientFilter.length === 0) return [];
    return liveItems.filter(i => clientFilter.includes(i.clientName));
  }, [liveItems, clientFilter]);

  // Client-filter change is already handled by useInventory (cacheKeyScope change
  // triggers useApiData refetch via Supabase-first path). A manual refetch() here
  // would force GAS (skipSupabaseCacheOnce) and hang the spinner on multi-client.

  // Dynamic multiselect columns (client names change with live data)
  const ALL_CLIENTS = useMemo(() => [...new Set(inventoryItems.map(i => i.clientName))].sort(), [inventoryItems]);
  const ALL_SIDEMARKS = useMemo(() => [...new Set(inventoryItems.map(i => i.sidemark).filter(Boolean))].sort(), [inventoryItems]);
  const MULTISELECT_COLS = useMemo(() => ({
    ...BASE_MULTISELECT_COLS,
    clientName: ALL_CLIENTS,
    sidemark: ALL_SIDEMARKS,
  }), [ALL_CLIENTS, ALL_SIDEMARKS]);

  // Shipment folder URL map (shipmentNumber → folderUrl)
  const shipmentFolderMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const s of apiShipments) {
      if (s.folderUrl) map[s.shipmentNumber] = s.folderUrl;
    }
    return map;
  }, [apiShipments]);

  // Detail panel & modals
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const selectedItem = useMemo(() => liveItems.find(i => i.itemId === selectedItemId) ?? null, [liveItems, selectedItemId]);

  // Linked records for the selected item
  const selectedLinkedTasks = useMemo<LinkedRecord[]>(() => {
    if (!selectedItem) return [];
    return tasks.filter(t => t.itemId === selectedItem.itemId).map(t => ({ id: t.taskId, type: 'task' as const, status: t.status }));
  }, [selectedItem, tasks]);

  const selectedLinkedRepairs = useMemo<LinkedRecord[]>(() => {
    if (!selectedItem) return [];
    return repairs.filter(r => r.itemId === selectedItem.itemId).map(r => ({ id: r.repairId, type: 'repair' as const, status: r.status }));
  }, [selectedItem, repairs]);

  const selectedLinkedWillCalls = useMemo<LinkedRecord[]>(() => {
    if (!selectedItem) return [];
    return willCalls.filter(w => w.items?.some(i => i.itemId === selectedItem.itemId)).map(w => ({ id: w.wcNumber, type: 'willcall' as const, status: w.status }));
  }, [selectedItem, willCalls]);

  // Prefer the URL baked directly into the item (from batch endpoint), fall back to shipments hook map
  const selectedShipmentFolderUrl = selectedItem?.shipmentFolderUrl ||
    (selectedItem?.shipmentNumber ? shipmentFolderMap[selectedItem.shipmentNumber] : undefined);

  // History data for selected item
  const selectedItemTasks = useMemo(() => {
    if (!selectedItem) return [];
    return tasks.filter(t => t.itemId === selectedItem.itemId);
  }, [selectedItem, tasks]);

  const selectedItemRepairs = useMemo(() => {
    if (!selectedItem) return [];
    return repairs.filter(r => r.itemId === selectedItem.itemId);
  }, [selectedItem, repairs]);

  const selectedItemWillCalls = useMemo(() => {
    if (!selectedItem) return [];
    return willCalls.filter(w => w.items?.some(i => i.itemId === selectedItem.itemId));
  }, [selectedItem, willCalls]);

  const selectedItemBilling = useMemo(() => {
    if (!selectedItem) return [];
    return billingRows.filter(b => b.itemId === selectedItem.itemId);
  }, [selectedItem, billingRows]);

  const handleNavigateToRecord = useCallback((type: 'task' | 'repair' | 'willcall' | 'shipment', id: string) => {
    const csId = selectedItem?.clientId;
    if (type === 'task') {
      navigate('/tasks', { state: id ? { openTaskId: id, clientSheetId: csId } : undefined });
    } else if (type === 'repair') {
      navigate('/repairs', { state: id ? { openRepairId: id, clientSheetId: csId } : undefined });
    } else if (type === 'shipment') {
      navigate('/shipments', { state: id ? { openShipmentId: id, clientSheetId: csId } : undefined });
    } else {
      navigate('/will-calls', { state: id ? { openWcId: id, clientSheetId: csId } : undefined });
    }
  }, [navigate, selectedItem]);

  const [showWCModal, setShowWCModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showCreateTaskModal, setShowCreateTaskModal] = useState(false);
  const [showAddToWCModal, setShowAddToWCModal] = useState(false);
  const [showReleaseModal, setShowReleaseModal] = useState(false);

  // Detail panel action items — when user triggers action from detail panel, we use these
  const [detailActionItem, setDetailActionItem] = useState<InventoryItem | null>(null);

  const handleDetailCreateTask = useCallback(() => {
    if (!selectedItem) return;
    setDetailActionItem(selectedItem);
    setShowCreateTaskModal(true);
  }, [selectedItem]);

  const handleDetailCreateWillCall = useCallback(() => {
    if (!selectedItem) return;
    setDetailActionItem(selectedItem);
    setShowWCModal(true);
  }, [selectedItem]);

  const handleDetailTransfer = useCallback(() => {
    if (!selectedItem) return;
    setDetailActionItem(selectedItem);
    setShowTransferModal(true);
  }, [selectedItem]);

  // Deep link: ?open=ITEM_ID auto-opens that item's detail panel
  // Route state: { shipmentFilter: 'SHP-xxxxx' } from Shipments page "View in Inventory"
  const [shipmentFilter, setShipmentFilter] = useState<string | null>(null);

  // Ref for deferred deep-link client resolution (declared before first effect that uses it)
  const deepLinkPendingTenantRef = useRef<string | null>(null);

  // Effect 1: read URL params / route state on mount — auto-load if deep link present
  useEffect(() => {
    let needsAutoLoad = false;
    // ?open=ITEM_ID[&client=<sheetId>] → open that item's detail panel when
    // data loads. DeepLink components pass `client` from the calling panel so
    // the target page can scope the filter without a Supabase round-trip.
    // Supabase fallback kicks in when `client` is absent (older callers).
    const params = new URLSearchParams(location.search);
    const openId = params.get('open');
    const clientIdParam = params.get('client');
    if (openId) {
      pendingOpenRef.current = openId;
      needsAutoLoad = true;
      window.history.replaceState({}, '', window.location.pathname + window.location.hash.split('?')[0]);

      if (clientIdParam) {
        // Cheap synchronous path — we already know the client. Stash and let
        // the apiClients-loaded effect set the filter (it runs as soon as
        // apiClients populates, which may be after this mount effect).
        deepLinkPendingTenantRef.current = clientIdParam;
      } else {
        // Fallback: resolve tenant_id via Supabase by item_id.
        (async () => {
          try {
            const { data } = await supabase
              .from('inventory')
              .select('tenant_id')
              .eq('item_id', openId)
              .limit(1)
              .maybeSingle();
            const tid = (data as { tenant_id?: string } | null)?.tenant_id;
            if (tid) deepLinkPendingTenantRef.current = tid;
          } catch { /* user can pick manually */ }
        })();
      }
    }
    // Route state: { shipmentFilter } → filter table to that shipment number
    const state = location.state as { shipmentFilter?: string } | null;
    if (state?.shipmentFilter) {
      setShipmentFilter(state.shipmentFilter);
      needsAutoLoad = true;
      window.history.replaceState({}, '');
    }
    // Do NOT call refetch() here. refetch() in useApiData bypasses the
    // Supabase cache and forces an unscoped GAS call (session 62 root cause).
    // The data hook auto-fetches when cacheKeyScope changes via
    // clientFilter → clientSheetId in the retry effect below, which goes
    // through the Supabase-first path (~50ms). Deep links: fast. GAS: never.
    void needsAutoLoad;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ref so the deep-link effect can read the latest clientFilter without it
  // being a dep that re-triggers the effect and causes a setState loop.
  const clientFilterRef = useRef(clientFilter);
  useEffect(() => { clientFilterRef.current = clientFilter; }, [clientFilter]);

  // Keep URL's ?client= param in sync with the dropdown (bookmarkable state)
  useClientFilterUrlSync(clientFilter, apiClients);

  // Retry deep-link client resolution once apiClients loads (handles cold start
  // where Supabase returns tenant_id before useClients has populated).
  // clientFilter is intentionally read via ref — not a dep — to avoid the
  // apiClients-change → setClientFilter → clientFilter-change → re-trigger loop.
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

  // Effect 2: when items load, open the pending item
  useEffect(() => {
    if (pendingOpenRef.current && inventoryItems.length > 0) {
      const match = inventoryItems.find(i => i.itemId === pendingOpenRef.current);
      if (match) { setSelectedItemId(match.itemId); pendingOpenRef.current = null; }
    }
  }, [inventoryItems]);

  // Table state — column order persisted per user via useTablePreferences
  const { colVis: columnVisibility, setColVis: setColumnVisibility, sorting, setSorting, columnOrder, setColumnOrder, statusFilter: persistedStatusFilter, toggleStatus: togglePersistedStatus, clearStatusFilter: clearPersistedStatus } = useTablePreferences('inventory', [], {}, DEFAULT_COL_ORDER);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});

  // UI state
  const [openFilterCol, setOpenFilterCol] = useState<string | null>(null);
  const [filterAnchorRect, setFilterAnchorRect] = useState<DOMRect | null>(null);
  const [showColToggle, setShowColToggle] = useState(false);
  const [colToggleRect, setColToggleRect] = useState<DOMRect | null>(null);
  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [batchGuardClients, setBatchGuardClients] = useState<string[] | null>(null);
  const [batchGuardAction, setBatchGuardAction] = useState('');
  const [dragColId, setDragColId] = useState<string | null>(null);
  const [dragOverColId, setDragOverColId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => { if (!inventoryLoading && refreshing) setRefreshing(false); }, [inventoryLoading, refreshing]);
  const [colorSidemarks, setColorSidemarks] = useState(() => localStorage.getItem('stride_colorSidemarks') === 'true');
  const [showSidemarkFilter, setShowSidemarkFilter] = useState(false);
  const [sidemarkFilterRect, setSidemarkFilterRect] = useState<DOMRect | null>(null);
  const [isPrinting, setIsPrinting] = useState(false);

  // Sidemark → background color map (recomputed when data or toggle changes)
  const sidemarkColorMap = useMemo(
    () => colorSidemarks ? buildSidemarkColorMap(inventoryItems) : new Map<string, string>(),
    [colorSidemarks, inventoryItems]
  );

  // Refs
  const lastSelectedIdx = useRef<number>(-1);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }, []);

  const handleRequestRepairQuote = useCallback(async (itemId?: string, sourceTaskId?: string) => {
    const item = itemId ? inventoryItems.find(i => i.itemId === itemId) : selectedItem;
    if (!item) return;
    const csId = item.clientId || '';
    if (!apiConfigured || !csId) { showToast('API not configured'); return; }
    const resp = await postRequestRepairQuote({ itemId: item.itemId, sourceTaskId }, csId);
    if (resp.ok && resp.data?.success) {
      showToast(`Repair ${resp.data.repairId} created — Pending Quote`);
      refetch();
    } else {
      showToast(resp.error || resp.data?.error || 'Failed to create repair');
    }
  }, [selectedItem, inventoryItems, apiConfigured, showToast, refetch]);

  // Column definitions
  const columns = useMemo(() => [
    // Select
    ch.display({
      id: 'select',
      size: 40, minSize: 40, maxSize: 40,
      enableResizing: false, enableSorting: false,
      header: ({ table }) => (
        <input
          type="checkbox"
          ref={el => { if (el) el.indeterminate = table.getIsSomePageRowsSelected() && !table.getIsAllPageRowsSelected(); }}
          checked={table.getIsAllPageRowsSelected()}
          onChange={table.getToggleAllPageRowsSelectedHandler()}
          style={{ cursor: 'pointer', accentColor: theme.colors.primary, margin: 0 }}
        />
      ),
      cell: ({ row }) => (
        <input
          type="checkbox"
          checked={row.getIsSelected()}
          onChange={row.getToggleSelectedHandler()}
          onClick={e => e.stopPropagation()}
          style={{ cursor: 'pointer', accentColor: theme.colors.primary, margin: 0 }}
        />
      ),
    }),

    // Item ID
    ch.accessor('itemId', {
      header: 'Item ID', size: 100,
      cell: i => (
        <span style={{
          fontFamily: 'monospace', fontSize: 12,
          fontWeight: theme.typography.weights.semibold,
          color: theme.colors.textPrimary,
        }}>{i.getValue()}</span>
      ),
    }),

    // Client
    ch.accessor('clientName', {
      header: 'Client', size: 170,
      filterFn: multiSelectFilter,
      cell: i => <span style={{ fontSize: theme.typography.sizes.sm }}>{i.getValue()}</span>,
    }),

    // Vendor
    ch.accessor('reference', {
      header: 'Reference', size: 120,
      cell: i => <span style={{ fontSize: theme.typography.sizes.sm, color: theme.colors.textSecondary }}>{i.getValue() || '—'}</span>,
    }),

    ch.accessor('vendor', {
      header: 'Vendor', size: 130,
      cell: i => <span style={{ fontSize: theme.typography.sizes.sm }}>{i.getValue()}</span>,
    }),

    // Description
    ch.accessor('description', {
      header: 'Description', size: 260,
      cell: i => (
        <span style={{
          fontSize: theme.typography.sizes.sm, display: 'block',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{i.getValue()}</span>
      ),
    }),

    // Class
    ch.accessor('itemClass', {
      id: 'itemClass', header: 'Class', size: 110,
      cell: i => <span style={{ fontSize: theme.typography.sizes.sm }}>{i.getValue()}</span>,
    }),

    // Qty
    ch.accessor('qty', {
      header: 'Qty', size: 55,
      cell: i => (
        <span style={{
          fontSize: theme.typography.sizes.sm, textAlign: 'center',
          display: 'block', fontVariantNumeric: 'tabular-nums',
        }}>{i.getValue()}</span>
      ),
    }),

    // Location
    ch.accessor('location', {
      header: 'Location', size: 100,
      cell: i => (
        <span style={{
          fontSize: 11, fontFamily: 'monospace', fontWeight: 500,
          background: theme.colors.bgSubtle,
          border: `1px solid ${theme.colors.borderSubtle}`,
          borderRadius: theme.radii.sm, padding: '1px 6px',
          display: 'inline-block',
        }}>{i.getValue()}</span>
      ),
    }),

    // Sidemark
    ch.accessor('sidemark', {
      header: 'Sidemark', size: 190,
      filterFn: multiSelectFilter,
      cell: i => {
        const val = i.getValue();
        const bg = val ? sidemarkColorMap.get(val) : undefined;
        return (
          <span style={{
            fontSize: theme.typography.sizes.sm, display: 'block',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            color: theme.colors.textSecondary,
            ...(bg ? { background: bg, borderRadius: 3, padding: '1px 6px', margin: '-1px -6px' } : {}),
          }}>{val}</span>
        );
      },
    }),

    // Room (derived from sidemark)
    ch.accessor(
      row => { const p = row.sidemark.split(' / '); return p.length > 1 ? p[1] : ''; },
      {
        id: 'room', header: 'Room', size: 130,
        cell: i => <span style={{ fontSize: theme.typography.sizes.sm }}>{i.getValue() || '—'}</span>,
      }
    ),

    // Status
    ch.accessor('status', {
      header: 'Status', size: 120,
      filterFn: multiSelectFilter,
      cell: i => <StatusBadge status={i.getValue()} />,
    }),

    // Receive Date
    ch.accessor('receiveDate', {
      header: 'Rcv Date', size: 95,
      cell: i => (
        <span style={{ fontSize: theme.typography.sizes.sm, color: theme.colors.textSecondary, fontVariantNumeric: 'tabular-nums' }}>
          {formatDate(i.getValue())}
        </span>
      ),
    }),

    // Release Date
    ch.accessor('releaseDate', {
      header: 'Rel Date', size: 95,
      cell: i => {
        const v = i.getValue();
        return v
          ? <span style={{ fontSize: theme.typography.sizes.sm, color: theme.colors.textSecondary, fontVariantNumeric: 'tabular-nums' }}>{formatDate(v)}</span>
          : <span style={{ color: theme.colors.textMuted }}>—</span>;
      },
    }),

    // Notes
    ch.accessor('notes', {
      header: 'Notes', size: 200,
      cell: i => {
        const v = i.getValue();
        return v
          ? <span style={{
            fontSize: theme.typography.sizes.sm, color: theme.colors.textSecondary,
            display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{v}</span>
          : <span style={{ color: theme.colors.textMuted }}>—</span>;
      },
    }),

    // Actions (hover reveal)
    ch.display({
      id: 'actions',
      size: 96, minSize: 96, maxSize: 96,
      enableResizing: false, enableSorting: false,
      header: () => null,
      cell: ({ row }) => (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 2,
          opacity: hoveredRowId === row.id ? 1 : 0,
          transition: 'opacity 0.1s',
        }}>
          {[
            { Icon: Eye, label: 'View detail', action: () => setSelectedItemId(row.original.itemId) },
            { Icon: ClipboardList, label: 'Create task', action: () => { setRowSelection({ [row.id]: true }); setShowCreateTaskModal(true); } },
            { Icon: Truck, label: 'Add to will call', action: async () => { /* Phase 7B: wire to API */ } },
          ].map(({ Icon, label, action }) => (
            <button
              key={label}
              title={label}
              onClick={action}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 28, height: 28, borderRadius: theme.radii.md,
                border: `1px solid ${theme.colors.borderDefault}`,
                background: theme.colors.bgBase, cursor: 'pointer',
                color: theme.colors.textSecondary, transition: 'all 0.1s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = theme.colors.primaryLight;
                e.currentTarget.style.borderColor = theme.colors.primary;
                e.currentTarget.style.color = theme.colors.primary;
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = theme.colors.bgBase;
                e.currentTarget.style.borderColor = theme.colors.borderDefault;
                e.currentTarget.style.color = theme.colors.textSecondary;
              }}
            >
              <Icon size={13} />
            </button>
          ))}
        </div>
      ),
    }),
  ], [hoveredRowId, showToast]);

  // When navigating from Shipments page, filter table to that shipment
  const tableData = useMemo(() => {
    if (!shipmentFilter) return inventoryItems;
    return inventoryItems.filter(i => i.shipmentNumber === shipmentFilter);
  }, [inventoryItems, shipmentFilter]);

  // Table instance
  const table = useReactTable({
    data: tableData,
    columns,
    state: { sorting, columnFilters, globalFilter, columnVisibility, rowSelection, columnOrder, columnSizing },
    enableRowSelection: true,
    enableMultiSort: true,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onColumnOrderChange: setColumnOrder,
    onColumnSizingChange: setColumnSizing,
    columnResizeMode: 'onChange',
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: 'includesString',
  });

  // Restore persisted status filter on mount
  const statusFilterRestored = useRef(false);
  useEffect(() => {
    if (!statusFilterRestored.current && persistedStatusFilter.length > 0 && table.getColumn('status')) {
      table.getColumn('status')!.setFilterValue(persistedStatusFilter);
      statusFilterRestored.current = true;
    }
  }, [persistedStatusFilter, table]);

  const { containerRef, virtualRows, rows: allVirtualRows, totalHeight } = useVirtualRows(table);

  // Derived
  const selectedRows = table.getSelectedRowModel().rows;
  const filteredCount = table.getFilteredRowModel().rows.length;
  const totalCount = inventoryItems.length;
  const pageRows = table.getRowModel().rows;

  // Status chip filter helper
  const statusFilterValue = (table.getColumn('status')?.getFilterValue() as string[] | undefined) ?? [];
  const sidemarkFilterValue = (table.getColumn('sidemark')?.getFilterValue() as string[] | undefined) ?? [];

  function setStatusChip(status: InventoryStatus | null) {
    if (status === null) {
      table.getColumn('status')?.setFilterValue(undefined);
      clearPersistedStatus();
    } else {
      // Toggle: add or remove from the multi-select
      togglePersistedStatus(status);
      const current = statusFilterValue.includes(status)
        ? statusFilterValue.filter(s => s !== status)
        : [...statusFilterValue, status];
      table.getColumn('status')?.setFilterValue(current.length ? current : undefined);
    }
  }

  // Column drag handlers
  function onHeaderDragStart(e: React.DragEvent, colId: string) {
    if (colId === 'select' || colId === 'actions') { e.preventDefault(); return; }
    setDragColId(colId);
    e.dataTransfer.effectAllowed = 'move';
  }

  function onHeaderDragOver(e: React.DragEvent, colId: string) {
    if (!dragColId || colId === 'select' || colId === 'actions' || colId === dragColId) return;
    e.preventDefault();
    setDragOverColId(colId);
  }

  function onHeaderDrop(e: React.DragEvent, targetColId: string) {
    e.preventDefault();
    if (!dragColId || targetColId === dragColId) return;
    const order = [...columnOrder];
    const from = order.indexOf(dragColId);
    const to = order.indexOf(targetColId);
    if (from === -1 || to === -1) return;
    order.splice(from, 1);
    order.splice(to, 0, dragColId);
    setColumnOrder(order);
    setDragColId(null);
    setDragOverColId(null);
  }

  // Row shift+click selection
  function handleRowClick(e: React.MouseEvent, row: typeof pageRows[0], rowIdx: number) {
    if (e.shiftKey && lastSelectedIdx.current !== -1) {
      const lo = Math.min(lastSelectedIdx.current, rowIdx);
      const hi = Math.max(lastSelectedIdx.current, rowIdx);
      const update: RowSelectionState = { ...rowSelection };
      for (let i = lo; i <= hi; i++) {
        update[pageRows[i].id] = true;
      }
      setRowSelection(update);
    } else {
      row.toggleSelected();
      lastSelectedIdx.current = rowIdx;
    }
  }

  // Export helpers
  function buildExportFilename(suffix = '') {
    const parts = ['inventory'];
    const clientFilter = (table.getColumn('clientName')?.getFilterValue() as string[] | undefined);
    if (clientFilter?.length === 1) parts.push(clientFilter[0].replace(/[^a-zA-Z0-9]/g, '-'));
    const smFilter = (table.getColumn('sidemark')?.getFilterValue() as string[] | undefined);
    if (smFilter?.length) parts.push(smFilter.map(s => s.replace(/[^a-zA-Z0-9]/g, '-')).join('_'));
    if (suffix) parts.push(suffix);
    return parts.join('-') + '.csv';
  }

  function doExportAll() {
    exportToCSV(table.getFilteredRowModel().rows.map(r => r.original), buildExportFilename('export'));
  }

  function doExportSelected() {
    exportToCSV(selectedRows.map(r => r.original), buildExportFilename('selected'));
  }

  // Print handler — de-virtualizes table, prints, re-virtualizes
  function handlePrint() {
    setIsPrinting(true);
    // Allow React to re-render with all rows before printing
    requestAnimationFrame(() => {
      setTimeout(() => {
        window.print();
        setIsPrinting(false);
      }, 100);
    });
  }

  // Active filter count (non-global)
  const activeFilterCount = columnFilters.length;
  const hasAnyFilter = activeFilterCount > 0 || globalFilter.length > 0;

  // ── Styles ─────────────────────────────────────────────────────────────────

  const headerCellStyle = (colId: string): React.CSSProperties => ({
    position: colId === 'actions' ? 'sticky' : 'relative',
    right: colId === 'actions' ? 0 : undefined,
    zIndex: colId === 'actions' ? 3 : 2,
    padding: '0 10px',
    height: 36,
    borderBottom: `2px solid ${theme.colors.borderDefault}`,
    borderRight: colId === 'actions' ? `1px solid ${theme.colors.borderSubtle}` : undefined,
    textAlign: colId === 'qty' ? 'center' : 'left',
    userSelect: 'none',
    cursor: colId === 'select' || colId === 'actions' ? 'default' : 'grab',
    background: dragOverColId === colId ? theme.colors.primaryLight : '#F4F5F7',
    verticalAlign: 'middle',
    whiteSpace: 'nowrap',
    boxSizing: 'border-box',
    outline: dragOverColId === colId ? `2px solid ${theme.colors.primary}` : undefined,
  });

  const tdStyle = (colId: string, isSelected: boolean): React.CSSProperties => ({
    position: colId === 'actions' ? 'sticky' : 'relative',
    right: colId === 'actions' ? 0 : undefined,
    background: isSelected
      ? '#FFF7F4'
      : colId === 'actions'
        ? 'inherit'
        : 'transparent',
    zIndex: colId === 'actions' ? 2 : undefined,
    padding: '0 10px',
    height: 36,
    borderBottom: `1px solid ${theme.colors.borderSubtle}`,
    verticalAlign: 'middle',
    overflow: colId === 'actions' ? 'visible' : 'hidden',
    maxWidth: colId === 'description' || colId === 'sidemark' || colId === 'notes' ? 1 : undefined,
    boxSizing: 'border-box',
  });

  // ── Render ─────────────────────────────────────────────────────────────────

  if (apiConfigured && inventoryLoading && liveItems.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 300, gap: 12 }}>
        <div style={{ width: 32, height: 32, border: '3px solid #E5E7EB', borderTopColor: theme.colors.orange, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <span style={{ fontSize: 13, color: theme.colors.textMuted }}>Loading inventory...</span>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // Build print title
  const printTitle = useMemo(() => {
    const parts = ['Inventory'];
    if (clientFilter.length === 1) parts.push(clientFilter[0]);
    else if (clientFilter.length > 1) parts.push(`${clientFilter.length} clients`);
    if (sidemarkFilterValue.length > 0) parts.push('Sidemarks: ' + sidemarkFilterValue.join(', '));
    return parts.join(' — ');
  }, [clientFilter, sidemarkFilterValue]);

  return (
    <div style={{ fontFamily: theme.typography.fontFamily, display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>

      {/* Print styles */}
      <style>{`
        @media print {
          aside, .no-print, [data-no-print] { display: none !important; }
          body { margin: 0; padding: 0; }
          @page { size: landscape; margin: 0.4in; }
          .print-header { display: block !important; }
          table { font-size: 10px !important; }
          thead { display: table-header-group; }
          tr { page-break-inside: avoid; }
          td, th { padding: 3px 6px !important; border: 1px solid #ddd !important; }
        }
      `}</style>

      {/* Print header — hidden on screen, visible in print */}
      <div className="print-header" style={{ display: 'none', marginBottom: 12 }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>{printTitle}</div>
        <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
          Printed {new Date().toLocaleDateString('en-US')} — {filteredCount} items
        </div>
      </div>

      {/* ── Page Title ── */}
      <div className="no-print" style={{ marginBottom: 12 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.3px', margin: 0 }}>Inventory</h1>
        <p style={{ fontSize: 13, color: theme.colors.textMuted, margin: '2px 0 0' }}>All stored items across clients</p>
      </div>

      <SyncBanner syncing={refreshing} label={clientFilter.length === 1 ? clientFilter[0] : clientFilter.length > 1 ? `${clientFilter.length} clients` : undefined} />

      {/* Client Filter */}
      <div className="no-print" style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 12, flexWrap: 'wrap' }}>
        <MultiSelectFilter label="Client" options={dropdownClientNames} selected={clientFilter} onChange={setClientFilter} placeholder="Select client(s)..." />
      </div>

      {/* ── Toolbar ── */}
      <div className="no-print" style={{
        display: 'flex', alignItems: 'center', gap: isMobile ? 6 : 8,
        marginBottom: isMobile ? 8 : 12, flexWrap: 'wrap',
      }}>
        {/* Global search */}
        <div style={{ position: 'relative', flex: isMobile ? '1 1 100%' : '1 1 220px', maxWidth: isMobile ? undefined : 320 }}>
          <Search size={14} style={{
            position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
            color: theme.colors.textMuted, pointerEvents: 'none',
          }} />
          <input
            placeholder="Search all columns…"
            value={globalFilter}
            onChange={e => setGlobalFilter(e.target.value)}
            style={{
              width: '100%', boxSizing: 'border-box',
              paddingLeft: 32, paddingRight: globalFilter ? 28 : 10,
              paddingTop: 7, paddingBottom: 7,
              border: `1px solid ${globalFilter ? theme.colors.primary : theme.colors.borderDefault}`,
              borderRadius: theme.radii.md,
              fontSize: theme.typography.sizes.sm,
              outline: 'none', background: theme.colors.bgBase,
            }}
            onFocus={e => (e.target.style.borderColor = theme.colors.primary)}
            onBlur={e => (e.target.style.borderColor = globalFilter ? theme.colors.primary : theme.colors.borderDefault)}
          />
          {globalFilter && (
            <button onClick={() => setGlobalFilter('')} style={{
              position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', cursor: 'pointer', padding: 0,
              color: theme.colors.textMuted, display: 'flex', alignItems: 'center',
            }}>
              <X size={13} />
            </button>
          )}
        </div>


        {/* Sidemark filter — hidden on mobile */}
        {!isMobile && ALL_SIDEMARKS.length > 0 && (
          <button
            onClick={e => {
              setSidemarkFilterRect((e.currentTarget as HTMLElement).getBoundingClientRect());
              setShowSidemarkFilter(v => !v);
            }}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '7px 12px', borderRadius: theme.radii.md,
              border: `1px solid ${sidemarkFilterValue.length > 0 ? theme.colors.primary : theme.colors.borderDefault}`,
              background: sidemarkFilterValue.length > 0 ? theme.colors.primaryLight : theme.colors.bgBase,
              cursor: 'pointer', fontSize: theme.typography.sizes.sm,
              color: sidemarkFilterValue.length > 0 ? theme.colors.primary : theme.colors.textSecondary,
              fontWeight: sidemarkFilterValue.length > 0 ? 600 : 400,
              position: 'relative',
            }}
          >
            <Filter size={14} />
            {sidemarkFilterValue.length > 0 ? `Sidemarks (${sidemarkFilterValue.length})` : 'Sidemarks'}
          </button>
        )}

        {/* Sidemark filter popover */}
        {showSidemarkFilter && sidemarkFilterRect && (
          <SidemarkFilterPopover
            anchorRect={sidemarkFilterRect}
            allSidemarks={ALL_SIDEMARKS}
            selectedSidemarks={sidemarkFilterValue}
            inventoryItems={inventoryItems}
            onChange={(val) => table.getColumn('sidemark')?.setFilterValue(val.length > 0 ? val : undefined)}
            onClose={() => setShowSidemarkFilter(false)}
          />
        )}

        <div style={{ flex: 1 }} />

        {/* Clear filters */}
        {hasAnyFilter && (
          <button
            onClick={() => {
              setColumnFilters([]);
              setGlobalFilter('');
            }}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '7px 12px', borderRadius: theme.radii.md,
              border: `1px solid ${theme.colors.borderDefault}`,
              background: theme.colors.bgBase, cursor: 'pointer',
              fontSize: theme.typography.sizes.sm, color: theme.colors.textSecondary,
            }}
          >
            <X size={13} /> Clear filters
          </button>
        )}

        {/* Color sidemarks toggle — hidden on mobile */}
        {!isMobile && (
          <button
            onClick={() => {
              const next = !colorSidemarks;
              setColorSidemarks(next);
              localStorage.setItem('stride_colorSidemarks', String(next));
            }}
            title="Color-code sidemark values"
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '7px 12px', borderRadius: theme.radii.md,
              border: `1px solid ${colorSidemarks ? theme.colors.primary : theme.colors.borderDefault}`,
              background: colorSidemarks ? theme.colors.primaryLight : theme.colors.bgBase,
              cursor: 'pointer', fontSize: theme.typography.sizes.sm,
              color: colorSidemarks ? theme.colors.primary : theme.colors.textSecondary,
            }}
          >
            <Palette size={14} /> Sidemarks
          </button>
        )}

        {/* Column toggle — hidden on mobile */}
        {!isMobile && (
          <button
            onClick={e => {
              setColToggleRect((e.currentTarget as HTMLElement).getBoundingClientRect());
              setShowColToggle(v => !v);
            }}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '7px 12px', borderRadius: theme.radii.md,
              border: `1px solid ${theme.colors.borderDefault}`,
              background: showColToggle ? theme.colors.primaryLight : theme.colors.bgBase,
              cursor: 'pointer', fontSize: theme.typography.sizes.sm,
              color: showColToggle ? theme.colors.primary : theme.colors.textSecondary,
            }}
          >
            <Settings2 size={14} /> Columns
          </button>
        )}

        {/* Export — hidden on mobile */}
        {!isMobile && (
          <button
            onClick={doExportAll}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '7px 12px', borderRadius: theme.radii.md,
              border: `1px solid ${theme.colors.borderDefault}`,
              background: theme.colors.bgBase, cursor: 'pointer',
              fontSize: theme.typography.sizes.sm, color: theme.colors.textSecondary,
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = theme.colors.primary; e.currentTarget.style.color = theme.colors.primary; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = theme.colors.borderDefault; e.currentTarget.style.color = theme.colors.textSecondary; }}
          >
            <Download size={14} /> Export
          </button>
        )}

        {/* Print — hidden on mobile */}
        {!isMobile && (
          <button
            onClick={handlePrint}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '7px 12px', borderRadius: theme.radii.md,
              border: `1px solid ${theme.colors.borderDefault}`,
              background: theme.colors.bgBase, cursor: 'pointer',
              fontSize: theme.typography.sizes.sm, color: theme.colors.textSecondary,
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = theme.colors.primary; e.currentTarget.style.color = theme.colors.primary; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = theme.colors.borderDefault; e.currentTarget.style.color = theme.colors.textSecondary; }}
          >
            <Printer size={14} /> Print
          </button>
        )}

        {/* Refresh */}
        <button
          onClick={() => { setRefreshing(true); refetch(); }}
          title="Refresh data"
          style={{
            display: 'flex', alignItems: 'center',
            padding: '7px 8px', borderRadius: theme.radii.md,
            border: `1px solid ${theme.colors.borderDefault}`,
            background: theme.colors.bgBase, cursor: 'pointer',
            color: (refreshing || inventoryLoading) ? theme.colors.orange : theme.colors.textSecondary,
            transition: 'color 0.2s',
          }}
        >
          <RefreshCw size={14} style={(refreshing || inventoryLoading) ? { animation: 'spin 1s linear infinite' } : undefined} />
        </button>
      </div>

      {/* ── Shipment filter banner (when navigated from Shipments page) ── */}
      {shipmentFilter && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8,
          padding: '6px 12px', background: '#EFF6FF', border: '1px solid #BFDBFE',
          borderRadius: 8, fontSize: 12,
        }}>
          <span style={{ color: '#1D4ED8', fontWeight: 600 }}>📦 Filtered to shipment {shipmentFilter}</span>
          <button
            onClick={() => setShipmentFilter(null)}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280', fontSize: 11, padding: '2px 6px' }}
          >
            ✕ Clear
          </button>
        </div>
      )}

      {/* ── Status chips ── */}
      <div className="no-print" style={{ ...mobileChipsRow(isMobile), alignItems: 'center', gap: 6, marginBottom: 10 }}>
        {[null, ...ALL_STATUSES].map(s => {
          const isActive = s === null
            ? statusFilterValue.length === 0
            : statusFilterValue.includes(s);
          const count = s === null
            ? filteredCount
            : inventoryItems.filter(i => i.status === s).length;
          return (
            <button
              key={s ?? 'all'}
              onClick={() => setStatusChip(s)}
              style={{
                padding: '4px 12px', borderRadius: theme.radii.full,
                border: `1px solid ${isActive ? theme.colors.primary : theme.colors.borderDefault}`,
                background: isActive ? theme.colors.primaryLight : theme.colors.bgBase,
                color: isActive ? theme.colors.primary : theme.colors.textSecondary,
                fontSize: theme.typography.sizes.sm,
                fontWeight: isActive ? theme.typography.weights.semibold : theme.typography.weights.normal,
                cursor: 'pointer', transition: 'all 0.1s',
              }}
            >
              {s ?? 'All'} <span style={{ opacity: 0.65 }}>({count})</span>
            </button>
          );
        })}

        {!isMobile && (
          <div style={{ marginLeft: 'auto', fontSize: theme.typography.sizes.sm, color: theme.colors.textMuted }}>
            Showing <strong style={{ color: theme.colors.textPrimary }}>{pageRows.length}</strong> of{' '}
            <strong style={{ color: theme.colors.textPrimary }}>{filteredCount}</strong> items
            {filteredCount !== totalCount && <span> (filtered from {totalCount})</span>}
          </div>
        )}
      </div>

      {/* ── Empty state when no clients selected ── */}
      {clientFilter.length === 0 && <div style={{ padding: '40px 20px', textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>Select one or more clients to load data.</div>}

      {/* ── Table wrapper ── */}
      <div ref={containerRef} style={{
        flex: 1, minHeight: isMobile ? 200 : 0,
        overflowX: isPrinting ? 'visible' : 'auto',
        overflowY: isPrinting ? 'visible' : 'auto',
        maxHeight: isPrinting ? 'none' : isMobile ? 'calc(100dvh - 180px)' : 'calc(100dvh - 280px)',
        border: `1px solid ${theme.colors.borderDefault}`,
        borderRadius: isMobile ? theme.radii.md : theme.radii.lg,
        background: theme.colors.bgBase,
        boxShadow: theme.shadows.sm,
        WebkitOverflowScrolling: 'touch',
      }}>
        <table style={{
          width: '100%',
          borderCollapse: 'collapse',
          tableLayout: 'fixed',
          minWidth: isMobile ? 600 : table.getTotalSize(),
        }}>
          {/* ── Colgroup ── */}
          <colgroup>
            {table.getVisibleLeafColumns().map(col => (
              <col key={col.id} style={{ width: col.getSize() }} />
            ))}
          </colgroup>

          {/* ── Header ── */}
          <thead style={{ position: 'sticky', top: 0, zIndex: 4 }}>
            {table.getHeaderGroups().map(hg => (
              <tr key={hg.id}>
                {hg.headers.map(header => {
                  const colId = header.column.id;
                  const sorted = header.column.getIsSorted();
                  const sortIdx = header.column.getSortIndex();
                  const hasFilter = columnFilters.some(f => f.id === colId);
                  const isDragOver = dragOverColId === colId;

                  return (
                    <th
                      key={header.id}
                      style={{
                        ...headerCellStyle(colId),
                        background: isDragOver ? '#EBF0FF' : '#F4F5F7',
                        outline: isDragOver ? `2px solid ${theme.colors.primary}` : undefined,
                        outlineOffset: -2,
                        width: header.getSize(),
                        boxSizing: 'border-box',
                      }}
                      draggable={colId !== 'select' && colId !== 'actions'}
                      onDragStart={e => onHeaderDragStart(e, colId)}
                      onDragOver={e => onHeaderDragOver(e, colId)}
                      onDrop={e => onHeaderDrop(e, colId)}
                      onDragEnd={() => { setDragColId(null); setDragOverColId(null); }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, height: '100%' }}>
                        {/* Sort click target */}
                        {colId !== 'select' && colId !== 'actions' ? (
                          <button
                            onClick={e => header.column.toggleSorting(undefined, e.shiftKey)}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 4,
                              background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                              fontSize: theme.typography.sizes.xs,
                              fontWeight: theme.typography.weights.semibold,
                              color: sorted ? theme.colors.orange : theme.colors.textSecondary,
                              textTransform: 'uppercase', letterSpacing: '0.05em',
                              flex: 1, minWidth: 0,
                            }}
                          >
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {flexRender(header.column.columnDef.header, header.getContext())}
                            </span>
                            {sorted === 'asc' ? (
                              <ChevronUp size={12} style={{ flexShrink: 0, color: theme.colors.orange }} />
                            ) : sorted === 'desc' ? (
                              <ChevronDown size={12} style={{ flexShrink: 0, color: theme.colors.orange }} />
                            ) : (
                              <ArrowUpDown size={11} style={{ flexShrink: 0, opacity: 0.3 }} />
                            )}
                            {sorting.length > 1 && sorted && (
                              <span style={{
                                fontSize: 10, color: theme.colors.orange,
                                background: theme.colors.orangeLight,
                                borderRadius: '50%', width: 14, height: 14,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontWeight: theme.typography.weights.bold, flexShrink: 0,
                              }}>{sortIdx + 1}</span>
                            )}
                          </button>
                        ) : (
                          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: colId === 'select' ? 'center' : 'flex-end' }}>
                            {flexRender(header.column.columnDef.header, header.getContext())}
                          </div>
                        )}

                        {/* Filter icon */}
                        {colId !== 'select' && colId !== 'actions' && (
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                              if (openFilterCol === colId) {
                                setOpenFilterCol(null);
                              } else {
                                setOpenFilterCol(colId);
                                setFilterAnchorRect(rect);
                              }
                            }}
                            style={{
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              width: 20, height: 20, borderRadius: theme.radii.sm,
                              border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0,
                              background: hasFilter ? theme.colors.primaryLight : 'transparent',
                              color: hasFilter ? theme.colors.primary : theme.colors.textMuted,
                            }}
                          >
                            <SlidersHorizontal size={11} />
                          </button>
                        )}
                      </div>

                      {/* Resize handle */}
                      {header.column.getCanResize() && (
                        <div
                          onMouseDown={header.getResizeHandler()}
                          onTouchStart={header.getResizeHandler()}
                          style={{
                            position: 'absolute', right: 0, top: 0,
                            height: '100%', width: 4, cursor: 'col-resize',
                            background: header.column.getIsResizing() ? theme.colors.primary : 'transparent',
                            zIndex: 1,
                          }}
                          onMouseEnter={e => (e.currentTarget.style.background = theme.colors.borderDefault)}
                          onMouseLeave={e => { if (!header.column.getIsResizing()) e.currentTarget.style.background = 'transparent'; }}
                        />
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>

          {/* ── Body ── */}
          <tbody>
            {allVirtualRows.length === 0 ? (
              <tr>
                <td colSpan={table.getVisibleLeafColumns().length} style={{
                  textAlign: 'center', padding: '48px 20px',
                  color: theme.colors.textMuted, fontSize: theme.typography.sizes.md,
                }}>
                  No items match your filters.
                </td>
              </tr>
            ) : isPrinting ? (
              /* De-virtualized: render ALL rows for print */
              allVirtualRows.map((row, idx) => {
                const smColor = colorSidemarks && row.original.sidemark ? sidemarkColorMap.get(row.original.sidemark) : undefined;
                return (
                  <tr key={row.id} style={{ background: smColor ? smColor + '30' : idx % 2 === 0 ? '#fff' : '#FAFAFA' }}>
                    {row.getVisibleCells().map(cell => (
                      <td key={cell.id} style={tdStyle(cell.column.id, false)}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                );
              })
            ) : (<>
              {virtualRows.length > 0 && <tr style={{ height: virtualRows[0].start }}><td colSpan={table.getVisibleLeafColumns().length} /></tr>}
              {virtualRows.map(vRow => {
                const row = allVirtualRows[vRow.index];
                const isSelected = row.getIsSelected();
                const isActivePanel = selectedItem?.itemId === row.original.itemId;
                const smColor = colorSidemarks && row.original.sidemark ? sidemarkColorMap.get(row.original.sidemark) : undefined;
                const rowBg = isSelected ? '#FFF7F4' : isActivePanel ? '#FEF3EE' : smColor ? smColor + '30' : 'transparent';
                return (
                  <tr
                    key={row.id}
                    onClick={e => handleRowClick(e, row, vRow.index)}
                    onDoubleClick={() => setSelectedItemId(row.original.itemId)}
                    onMouseEnter={() => setHoveredRowId(row.id)}
                    onMouseLeave={() => setHoveredRowId(null)}
                    style={{
                      background: rowBg,
                      cursor: 'default',
                      transition: 'background 0.08s',
                      borderLeft: isActivePanel ? `3px solid ${theme.colors.orange}` : '3px solid transparent',
                    }}
                    onMouseOver={e => {
                      if (!isSelected && !isActivePanel) (e.currentTarget as HTMLElement).style.background = '#FAFAFA';
                    }}
                    onMouseOut={e => {
                      (e.currentTarget as HTMLElement).style.background = rowBg;
                    }}
                  >
                    {row.getVisibleCells().map(cell => {
                      const colId = cell.column.id;
                      return (
                        <td key={cell.id} style={tdStyle(colId, isSelected)}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {virtualRows.length > 0 && <tr style={{ height: totalHeight - (virtualRows[virtualRows.length - 1].end) }}><td colSpan={table.getVisibleLeafColumns().length} /></tr>}
            </>)}
          </tbody>
        </table>
      </div>

      {/* ── Row count ── */}
      <div className="no-print" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '8px 0 0', fontSize: theme.typography.sizes.sm, color: theme.colors.textMuted,
      }}>
        {filteredCount} row{filteredCount !== 1 ? 's' : ''}
      </div>

      {/* ── Floating Action Bar ── */}
      {selectedRows.length > 0 && !isMobile && (
        <div className="no-print" style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: theme.colors.textPrimary,
          borderRadius: theme.radii['2xl'],
          boxShadow: theme.shadows.xl,
          padding: '10px 16px',
          display: 'flex', alignItems: 'center', gap: 12,
          zIndex: 1000, whiteSpace: 'nowrap',
        }}>
          {/* Left: count + clear */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              fontSize: theme.typography.sizes.sm,
              color: '#fff',
              fontWeight: theme.typography.weights.semibold,
            }}>
              {selectedRows.length} selected
            </span>
            <button
              onClick={() => setRowSelection({})}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 22, height: 22, borderRadius: '50%',
                border: '1px solid rgba(255,255,255,0.25)',
                background: 'rgba(255,255,255,0.1)',
                cursor: 'pointer', color: '#fff', padding: 0,
              }}
            >
              <X size={12} />
            </button>
          </div>

          <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.15)' }} />

          {/* Right: action buttons */}
          <WriteButton label="Create Will Call" variant="ghost" size="sm" onClick={async () => { const guard = checkBatchClientGuard(selectedRows.map(r => r.original)); if (guard) { setBatchGuardClients(guard); setBatchGuardAction('Create Will Call'); return; } setShowWCModal(true); }} />
          <WriteButton label="Add to Will Call" variant="ghost" size="sm" onClick={async () => { const guard = checkBatchClientGuard(selectedRows.map(r => r.original)); if (guard) { setBatchGuardClients(guard); setBatchGuardAction('Add to Will Call'); return; } setShowAddToWCModal(true); }} />
          <WriteButton label="Create Task" variant="ghost" size="sm" onClick={async () => { const guard = checkBatchClientGuard(selectedRows.map(r => r.original)); if (guard) { setBatchGuardClients(guard); setBatchGuardAction('Create Task'); return; } setShowCreateTaskModal(true); }} />
          {(user?.role === 'staff' || user?.role === 'admin' || user?.isParent) && (
            <WriteButton label="Transfer" variant="ghost" size="sm" onClick={async () => { const guard = checkBatchClientGuard(selectedRows.map(r => r.original)); if (guard) { setBatchGuardClients(guard); setBatchGuardAction('Transfer'); return; } setShowTransferModal(true); }} />
          )}
          <WriteButton label="Request Repair Quote" variant="ghost" size="sm" onClick={async () => { const items = selectedRows.map(r => r.original); const guard = checkBatchClientGuard(items); if (guard) { setBatchGuardClients(guard); setBatchGuardAction('Request Repair Quote'); return; } for (const item of items) { await handleRequestRepairQuote(item.itemId); } setRowSelection({}); }} />
          {(user?.role === 'staff' || user?.role === 'admin') && (
            <WriteButton label="Release Items" variant="ghost" size="sm" onClick={async () => { const items = selectedRows.map(r => r.original); const activeItems = items.filter(i => i.status === 'Active'); if (!activeItems.length) { showToast('No active items selected — only Active items can be released'); return; } const guard = checkBatchClientGuard(activeItems); if (guard) { setBatchGuardClients(guard); setBatchGuardAction('Release Items'); return; } setShowReleaseModal(true); }} />
          )}

          <button
            onClick={doExportSelected}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '6px 14px', borderRadius: theme.radii.md,
              border: 'none',
              background: theme.colors.primary,
              color: '#fff', cursor: 'pointer',
              fontSize: theme.typography.sizes.sm,
              fontWeight: theme.typography.weights.semibold,
            }}
            onMouseEnter={e => (e.currentTarget.style.background = theme.colors.primaryHover)}
            onMouseLeave={e => (e.currentTarget.style.background = theme.colors.primary)}
          >
            <Download size={13} /> Export Selected
          </button>
        </div>
      )}

      {/* ── Filter popover ── */}
      {openFilterCol && filterAnchorRect && (
        <FilterPopover
          columnId={openFilterCol}
          anchorRect={filterAnchorRect}
          value={table.getColumn(openFilterCol)?.getFilterValue()}
          onChange={v => table.getColumn(openFilterCol)?.setFilterValue(v)}
          onClose={() => setOpenFilterCol(null)}
          multiselectCols={MULTISELECT_COLS}
        />
      )}

      {/* ── Column toggle menu ── */}
      {showColToggle && colToggleRect && (
        <ColumnToggleMenu
          anchorRect={colToggleRect}
          visibility={columnVisibility}
          onToggle={colId => {
            setColumnVisibility(prev => ({
              ...prev,
              [colId]: prev[colId] === false ? true : false,
            }));
          }}
          onClose={() => setShowColToggle(false)}
        />
      )}

      {/* ── Batch Guard ── */}
      {batchGuardClients && <BatchGuard selectedClients={batchGuardClients} actionName={batchGuardAction} onDismiss={() => setBatchGuardClients(null)} />}

      {/* ── Toast ── */}
      {toast && <ToastBar message={toast} />}

      {/* ── Item Detail Panel ── */}
      {selectedItem && (
        <ItemDetailPanel
          item={selectedItem}
          onClose={() => setSelectedItemId(null)}
          photosFolderId={apiClients.find(c => c.spreadsheetId === selectedItem.clientId)?.photosFolderId}
          shipmentFolderUrl={selectedShipmentFolderUrl}
          linkedTasks={selectedLinkedTasks}
          linkedRepairs={selectedLinkedRepairs}
          linkedWillCalls={selectedLinkedWillCalls}
          onNavigateToRecord={handleNavigateToRecord}
          onCreateTask={handleDetailCreateTask}
          onCreateWillCall={handleDetailCreateWillCall}
          onTransfer={(user?.role === 'staff' || user?.role === 'admin' || user?.isParent) ? handleDetailTransfer : undefined}
          itemTasks={selectedItemTasks}
          itemRepairs={selectedItemRepairs}
          itemWillCalls={selectedItemWillCalls}
          itemBilling={selectedItemBilling}
          userRole={user?.role}
          classNames={classNames}
          locationNames={locationNames}
          clientSheetId={selectedItem.clientId}
          onItemUpdated={refetch}
          applyItemPatch={applyItemPatch}
          mergeItemPatch={mergeItemPatch}
          clearItemPatch={clearItemPatch}
        />
      )}

      {/* ── Create Will Call Modal ── */}
      {showWCModal && (
        <CreateWillCallModal
          preSelectedItemIds={detailActionItem ? [detailActionItem.itemId] : selectedRows.map(r => r.original.itemId)}
          liveItems={apiConfigured ? inventoryItems as any : undefined}
          addOptimisticWc={addOptimisticWc}
          removeOptimisticWc={removeOptimisticWc}
          existingWillCalls={willCalls}
          onClose={() => { setShowWCModal(false); setDetailActionItem(null); }}
          onSubmit={(data) => { showToast(`Will Call created for ${data.items.length} items`); setRowSelection({}); setDetailActionItem(null); refetch(); }}
        />
      )}

      {/* ── Add to Will Call Modal ── */}
      {showAddToWCModal && (
        <AddToWillCallModal
          itemIds={detailActionItem ? [detailActionItem.itemId] : selectedRows.map(r => r.original.itemId)}
          clientName={detailActionItem?.clientName || selectedRows[0]?.original.clientName || ''}
          clientSheetId={detailActionItem?.clientId || selectedRows[0]?.original.clientId || ''}
          willCalls={willCalls}
          onClose={() => { setShowAddToWCModal(false); setDetailActionItem(null); }}
          onSuccess={() => { showToast('Items added to will call'); setRowSelection({}); setDetailActionItem(null); refetch(); }}
        />
      )}

      {/* ── Release Items Modal ── */}
      {showReleaseModal && (detailActionItem || selectedRows.length > 0) && (
        <ReleaseItemsModal
          itemIds={detailActionItem ? [detailActionItem.itemId] : selectedRows.map(r => r.original).filter(i => i.status === 'Active').map(i => i.itemId)}
          clientName={detailActionItem?.clientName || selectedRows[0]?.original.clientName || ''}
          clientSheetId={detailActionItem?.clientId || selectedRows[0]?.original.clientId || ''}
          onClose={() => { setShowReleaseModal(false); setDetailActionItem(null); }}
          onSuccess={() => { showToast('Items released'); setRowSelection({}); setDetailActionItem(null); refetch(); }}
        />
      )}

      {/* ── Transfer Items Modal ── */}
      {showTransferModal && (detailActionItem || selectedRows.length > 0) && (
        <TransferItemsModal
          sourceClientName={detailActionItem?.clientName || selectedRows[0]?.original.clientName || ''}
          sourceClientSheetId={detailActionItem?.clientId || selectedRows[0]?.original.clientId || ''}
          preSelectedItemIds={detailActionItem ? [detailActionItem.itemId] : selectedRows.map(r => r.original.itemId)}
          preSelectedItem={detailActionItem ?? undefined}
          onClose={() => { setShowTransferModal(false); setDetailActionItem(null); }}
          onSuccess={() => { showToast('Items transferred successfully'); setRowSelection({}); setDetailActionItem(null); refetch(); }}
          applyItemPatch={applyItemPatch}
          clearItemPatch={clearItemPatch}
        />
      )}

      {/* ── Create Task Modal ── */}
      {showCreateTaskModal && (detailActionItem || selectedRows.length > 0) && (
        <CreateTaskModal
          items={detailActionItem ? [detailActionItem] : selectedRows.map(r => r.original)}
          clientSheetId={detailActionItem?.clientId || selectedRows[0]?.original.clientId || ''}
          clientName={apiClients.find(c => c.spreadsheetId === (detailActionItem?.clientId || selectedRows[0]?.original.clientId))?.name || ''}
          addOptimisticTask={addOptimisticTask}
          removeOptimisticTask={removeOptimisticTask}
          existingTasks={tasks}
          onClose={() => { setShowCreateTaskModal(false); setDetailActionItem(null); }}
          onSuccess={(taskIds) => {
            showToast(`${taskIds.length} task${taskIds.length !== 1 ? 's' : ''} created`);
            setRowSelection({});
            setDetailActionItem(null);
            refetch();        // refresh inventory data
            refetchTasks();   // refresh tasks so they appear on the Tasks page immediately
          }}
        />
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <FloatingActionMenu
        show={isMobile}
        actions={[
          { label: 'Create Task', icon: <ClipboardList size={16} />, onClick: () => setShowCreateTaskModal(true) },
          { label: 'Create Will Call', icon: <Package size={16} />, onClick: () => setShowWCModal(true) },
          { label: 'Request Repair', icon: <Wrench size={16} />, onClick: () => {
            const sel = table.getSelectedRowModel().rows;
            if (sel.length > 0) { for (const r of sel) { handleRequestRepairQuote(r.original.itemId); } }
            else { showToast('Select items first'); }
          }},
          { label: 'Transfer', icon: <Truck size={16} />, onClick: () => setShowTransferModal(true) },
        ] satisfies FABAction[]}
      />
    </div>
  );
}
