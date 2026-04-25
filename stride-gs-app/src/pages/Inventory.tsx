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
import { useScrollRestoration } from '../hooks/useScrollRestoration';
import { theme } from '../styles/theme';
import { fmtDate } from '../lib/constants';
import { ItemDetailPanel } from '../components/shared/ItemDetailPanel';
import { ItemIdBadges } from '../components/shared/ItemIdBadges';
import { CreateWillCallModal } from '../components/shared/CreateWillCallModal';
import { CreateDeliveryOrderModal } from '../components/shared/CreateDeliveryOrderModal';
import { TransferItemsModal } from '../components/shared/TransferItemsModal';
import { ReleaseItemsModal } from '../components/shared/ReleaseItemsModal';
import { CreateTaskModal } from '../components/shared/CreateTaskModal';
import { AddToWillCallModal } from '../components/shared/AddToWillCallModal';
import type { InventoryItem, InventoryStatus } from '../lib/types';
import { WriteButton } from '../components/shared/WriteButton';
import { BatchGuard, checkBatchClientGuard } from '../components/shared/BatchGuard';
import { useNavigate, useLocation } from 'react-router-dom';
import { isApiConfigured, postBatchRequestRepairQuote, type BatchMutationResult } from '../lib/api';
import { useInventory } from '../hooks/useInventory';
import { useClients } from '../hooks/useClients';
import { useItemNotes } from '../hooks/useItemNotes';
import { useAutocomplete } from '../hooks/useAutocomplete';
import { InlineEditableCell } from '../components/shared/InlineEditableCell';
import { useClientFilterUrlSync } from '../hooks/useClientFilterUrlSync';
import { useClientFilterPersisted } from '../hooks/useClientFilterPersisted';
import { useTasks } from '../hooks/useTasks';
import { useRepairs } from '../hooks/useRepairs';
import { useWillCalls } from '../hooks/useWillCalls';
import { useOrders } from '../hooks/useOrders';
import { entityEvents } from '../lib/entityEvents';
import { useShipments } from '../hooks/useShipments';
import { useBilling } from '../hooks/useBilling';
import { useLocations } from '../hooks/useLocations';
import { usePricing } from '../hooks/usePricing';
import { useAuth } from '../contexts/AuthContext';
import { useBatchData } from '../contexts/BatchDataContext';
import { MultiSelectFilter } from '../components/shared/MultiSelectFilter';
import { SyncBanner } from '../components/shared/SyncBanner';
import { BulkResultSummary } from '../components/shared/BulkResultSummary';
import { mergePreflightSkips } from '../lib/batchLoop';
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

/** Normalize a sidemark string so "CRAMER", " CRAMER", "Cramer" all collapse to one key. */
export function normSidemark(s: string | null | undefined): string {
  return String(s ?? '').trim().toLocaleUpperCase();
}

/** Build a deterministic sidemark → color map from visible data.
 *  Keys are normalized (trim + upper) so whitespace/case variants share a color. */
function buildSidemarkColorMap(items: InventoryItem[]): Map<string, string> {
  const unique = [...new Set(
    items.map(i => normSidemark(i.sidemark)).filter(Boolean)
  )].sort();
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


function exportVisibleToCSV(tableRows: { getValue: (id: string) => unknown }[], visibleCols: { id: string; columnDef: { header?: unknown } }[], filename: string): void {
  const SKIP = new Set(['select', 'actions']);
  const cols = visibleCols.filter(c => !SKIP.has(c.id));
  const headerLine = cols.map(c => {
    const h = typeof c.columnDef.header === 'string' ? c.columnDef.header : c.id;
    return `"${h.replace(/"/g, '""')}"`;
  }).join(',');
  const body = tableRows.map(row =>
    cols.map(col => {
      const val = row.getValue(col.id);
      return `"${String(val ?? '').replace(/"/g, '""')}"`;
    }).join(',')
  ).join('\n');
  const blob = new Blob([headerLine + '\n' + body], { type: 'text/csv;charset=utf-8;' });
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
  // Persists across navigation: hydrates from URL ?client= (deep-link), then
  // localStorage (last-used scope), then falls through to the role-default
  // effect below. Page key 'inventory' scopes the localStorage entry.
  const [clientFilter, setClientFilter] = useClientFilterPersisted('inventory', apiClients);

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
  // v38.72.0 Phase 3 — pre-fetch Autocomplete DB + locations at page level so
  // the first inline-edit click on a Vendor/Sidemark/Description/Location cell
  // already has suggestions ready (no loading flash). Multi-client view: this
  // warms up the first selected client; other clients populate lazily as
  // cells render.
  const autocompletePrefetchSheetId = Array.isArray(selectedSheetId)
    ? (selectedSheetId.length >= 1 ? selectedSheetId[0] : undefined)
    : selectedSheetId;
  useAutocomplete(autocompletePrefetchSheetId);
  useLocations(apiConfigured);
  const { tasks, refetch: refetchTasks, addOptimisticTask, removeOptimisticTask } = useTasks(apiConfigured && clientFilter.length > 0, selectedSheetId);
  const { repairs, addOptimisticRepair, removeOptimisticRepair } = useRepairs(apiConfigured && clientFilter.length > 0, selectedSheetId);
  const { willCalls, addOptimisticWc, removeOptimisticWc } = useWillCalls(apiConfigured && clientFilter.length > 0, selectedSheetId);
  const { orders } = useOrders();
  const { apiShipments } = useShipments(apiConfigured && clientFilter.length > 0, selectedSheetId);
  // Inventory only uses billing rows to show "this item has billing" hints; single tenant only
  const billingSheetId = Array.isArray(selectedSheetId) ? (selectedSheetId.length === 1 ? selectedSheetId[0] : undefined) : selectedSheetId;
  const { rows: billingRows } = useBilling(apiConfigured && clientFilter.length > 0, billingSheetId);
  const { locationNames } = useLocations(apiConfigured);
  const { classNames } = usePricing(apiConfigured);
  const { user } = useAuth();
  const navigate = useNavigate();
  // v38.72.0 Phase 3 — inline cell editing is admin/staff only (client-role
  // users see their own data but shouldn't mutate it from the table).
  const canEditInventory = user?.role === 'admin' || user?.role === 'staff';

  // Client-role users only see their own accounts in the dropdown — admin/staff see all.
  const dropdownClientNames = useMemo(() => {
    if (user?.role === 'client' && user.accessibleClientNames?.length) {
      const allowed = new Set(user.accessibleClientNames);
      return clientNames.filter(n => allowed.has(n));
    }
    return clientNames;
  }, [clientNames, user?.role, user?.accessibleClientNames]);

  // Session 77: auto-select every accessible client on mount so the
  // page auto-loads data without a manual dropdown pick.
  //   - client-portal users get their own accessibleClientNames (they
  //     usually only have 1-2 anyway).
  //   - admin/staff get the full dropdown list. They can still narrow.
  useEffect(() => {
    if (clientFilter.length > 0) return;
    if (user?.role === 'client' && user.accessibleClientNames?.length) {
      setClientFilter(user.accessibleClientNames);
    } else if ((user?.role === 'admin' || user?.role === 'staff') && clientNames.length > 0) {
      setClientFilter(clientNames);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role, user?.accessibleClientNames?.length, clientNames.length]);
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
  // Session 70 fix #3: dedupe sidemarks on normalized key so case/whitespace variants
  // (e.g. "CRAMER" vs " CRAMER" vs "Cramer") collapse to one filter option and share a color.
  const ALL_SIDEMARKS = useMemo(() => {
    const seen = new Map<string, string>(); // normKey -> first-seen canonical display value
    for (const i of inventoryItems) {
      const raw = i.sidemark;
      if (!raw) continue;
      const key = normSidemark(raw);
      if (!seen.has(key)) seen.set(key, raw);
    }
    return [...seen.values()].sort();
  }, [inventoryItems]);
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
  const [showDeliveryModal, setShowDeliveryModal] = useState(false);

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

  // Effect 1: read URL params / route state on mount.
  // ?open=ITEM_ID → navigate immediately to ItemPage (fetches its own data from Supabase).
  // { shipmentFilter } route state → filter table to that shipment number.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const openId = params.get('open');
    if (openId) {
      navigate(`/inventory/${openId}`, { replace: true });
      return;
    }
    // Route state: { shipmentFilter } → filter table to that shipment number
    const state = location.state as { shipmentFilter?: string } | null;
    if (state?.shipmentFilter) {
      setShipmentFilter(state.shipmentFilter);
      window.history.replaceState({}, '');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refs so deep-link + URL-sync effects read the latest values without
  // those values being deps that re-trigger effects and cause React #300.
  const clientFilterRef = useRef(clientFilter);
  useEffect(() => { clientFilterRef.current = clientFilter; }, [clientFilter]);
  const apiClientsRef = useRef(apiClients);
  useEffect(() => { apiClientsRef.current = apiClients; }, [apiClients]);

  // Keep URL's ?client= param in sync with the dropdown (bookmarkable state)
  useClientFilterUrlSync(clientFilter, apiClients);

  // Retry deep-link client resolution once apiClients loads (handles cold start
  // where Supabase returns tenant_id before useClients has populated).
  // Deps: apiClients.length (a number, stable once loaded — unlike the array
  // reference which can change identity on every render and cause #300).
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

  // Effect 2: fallback — if pendingOpenRef was set before Effect 1 could navigate, finish it.
  // In practice Effect 1 navigates immediately, so this fires only on hot-reload edge cases.
  useEffect(() => {
    if (pendingOpenRef.current && inventoryItems.length > 0) {
      const id = pendingOpenRef.current;
      pendingOpenRef.current = null;
      navigate(`/inventory/${id}`, { replace: true });
    }
  }, [inventoryItems, navigate]);

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
  // Session 72: hoveredRowId state REMOVED. Row-hover action-button visibility
  // is handled by pure CSS (.inv-row:hover .inv-row-actions { opacity: 1 }) so
  // moving the cursor over rows doesn't trigger React state updates, columns
  // useMemo rebuild, or TanStack cell re-render (which was causing per-cell
  // hook re-runs and residual network activity).
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

  // v38.58.0 — Bulk Request Repair Quote uses server-side batch endpoint (safe against tab close)
  const [repairQuoteBulkResult, setRepairQuoteBulkResult] = useState<BatchMutationResult | null>(null);
  const handleBulkRequestRepairQuote = useCallback(async (items: Array<{ itemId: string; clientId?: string }>) => {
    if (!items.length) return;
    const csId = items[0].clientId || '';
    if (!apiConfigured || !csId) { showToast('API not configured'); return; }
    const preflightSkipped: Array<{ id: string; reason: string }> = [];
    const eligible: typeof items = [];
    for (const it of items) {
      if (!it.itemId) preflightSkipped.push({ id: 'blank', reason: 'Missing itemId' });
      else eligible.push(it);
    }
    if (!eligible.length) { setRepairQuoteBulkResult({ success: true, processed: preflightSkipped.length, succeeded: 0, failed: 0, skipped: preflightSkipped, errors: [], message: 'All items skipped' }); return; }

    // Optimistic: add a temp Pending Quote repair row per item so Inventory / Repairs views see it immediately.
    // Temp IDs (REPAIR-TEMP-...) are replaced by real IDs on refetch.
    const now = Date.now();
    const tempIds: string[] = [];
    for (const it of eligible) {
      const tempId = `REPAIR-TEMP-${it.itemId}-${now}`;
      tempIds.push(tempId);
      addOptimisticRepair({
        repairId: tempId,
        itemId: it.itemId,
        clientId: csId,
        clientSheetId: csId,
        clientName: '',
        description: '',
        status: 'Pending Quote',
        created: new Date().toISOString(),
      } as any);
    }

    try {
      const resp = await postBatchRequestRepairQuote({ itemIds: eligible.map(i => i.itemId) }, csId);
      const serverResult: BatchMutationResult = resp.ok && resp.data ? resp.data : {
        success: false, processed: eligible.length, succeeded: 0, failed: eligible.length,
        skipped: [], errors: eligible.map(i => ({ id: i.itemId, reason: resp.error || 'Request failed' })),
        message: resp.error || 'Batch request failed',
      };
      // Clear all temps — real repairs come from refetch
      for (const tid of tempIds) removeOptimisticRepair(tid);
      setRepairQuoteBulkResult(mergePreflightSkips(serverResult, preflightSkipped));
      refetch();
      // Session 74: emit a repair entity event per affected item so the
      // Repairs page's useRepairs hook force-refetches from GAS (bypassing
      // stale Supabase cache) on its next mount/subscriber tick. Without
      // this, newly-created repairs didn't show on /repairs until manual
      // refresh.
      for (const it of eligible) entityEvents.emit('repair', it.itemId);
    } catch (err) {
      for (const tid of tempIds) removeOptimisticRepair(tid);
      throw err;
    }
  }, [apiConfigured, showToast, refetch, addOptimisticRepair, removeOptimisticRepair]);

  // Session 71+: Build item-level task/repair/WC/DT indicator sets from already-loaded data
  const { inspOpenItems, inspDoneItems, asmOpenItems, asmDoneItems, repairOpenItems, repairDoneItems, wcOpenItems, wcDoneItems, dtOpenItems, dtDoneItems } = useMemo(() => {
    const inspOpen = new Set<string>();
    const inspDone = new Set<string>();
    const asmOpen = new Set<string>();
    const asmDone = new Set<string>();
    const repOpen = new Set<string>();
    const repDone = new Set<string>();
    for (const t of tasks) {
      if (!t.itemId) continue;
      const code = (t.svcCode || t.type || '').toUpperCase();
      const done = t.status === 'Completed';
      if (code === 'INSP') {
        if (done) { if (!inspOpen.has(t.itemId)) inspDone.add(t.itemId); }
        else { inspOpen.add(t.itemId); inspDone.delete(t.itemId); }
      } else if (code === 'ASM') {
        if (done) { if (!asmOpen.has(t.itemId)) asmDone.add(t.itemId); }
        else { asmOpen.add(t.itemId); asmDone.delete(t.itemId); }
      }
    }
    for (const r of repairs) {
      if (!r.itemId) continue;
      const done = r.status === 'Complete';
      if (done) { if (!repOpen.has(r.itemId)) repDone.add(r.itemId); }
      else { repOpen.add(r.itemId); repDone.delete(r.itemId); }
    }

    // Will call indicators — Released → green, everything else → orange
    const wcOpen = new Set<string>();
    const wcDone = new Set<string>();
    for (const wc of willCalls) {
      for (const item of wc.items ?? []) {
        if (!item.itemId) continue;
        if (wc.status === 'Released') {
          if (!wcOpen.has(item.itemId)) wcDone.add(item.itemId);
        } else {
          wcOpen.add(item.itemId);
          wcDone.delete(item.itemId);
        }
      }
    }

    // DT delivery order indicators — completed → green, everything else → orange
    const dtOpen = new Set<string>();
    const dtDone = new Set<string>();
    for (const order of orders) {
      for (const item of order.items) {
        const id = item.dtItemCode;
        if (!id) continue;
        if (order.statusCategory === 'completed') {
          if (!dtOpen.has(id)) dtDone.add(id);
        } else {
          dtOpen.add(id);
          dtDone.delete(id);
        }
      }
    }

    return { inspOpenItems: inspOpen, inspDoneItems: inspDone, asmOpenItems: asmOpen, asmDoneItems: asmDone, repairOpenItems: repOpen, repairDoneItems: repDone, wcOpenItems: wcOpen, wcDoneItems: wcDone, dtOpenItems: dtOpen, dtDoneItems: dtDone };
  }, [tasks, repairs, willCalls, orders]);

  // Latest public entity_note per visible item, batched so the Notes
  // column can show collaborative notes without per-row queries. Falls
  // back to the legacy inventory.item_notes value when no entity_note
  // exists for an item yet (migration covered most rows on 2026-04-21).
  // Derives itemIds from the live items list AFTER all other hooks so
  // the fragile hook-order invariant above is preserved.
  const visibleItemIds = useMemo(
    () => liveItems.map(i => i.itemId).filter(Boolean),
    [liveItems],
  );
  const { notesByItemId } = useItemNotes(visibleItemIds, apiConfigured && clientFilter.length > 0);

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

    // Item ID with I/A/R indicators
    ch.accessor('itemId', {
      header: 'Item ID', size: 120,
      cell: i => {
        const id = i.getValue();
        return (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
            <span style={{
              fontFamily: 'monospace', fontSize: 12,
              fontWeight: theme.typography.weights.semibold,
              color: theme.colors.textPrimary,
            }}>{id}</span>
            <ItemIdBadges itemId={id} inspOpenItems={inspOpenItems} inspDoneItems={inspDoneItems} asmOpenItems={asmOpenItems} asmDoneItems={asmDoneItems} repairOpenItems={repairOpenItems} repairDoneItems={repairDoneItems} wcOpenItems={wcOpenItems} wcDoneItems={wcDoneItems} dtOpenItems={dtOpenItems} dtDoneItems={dtDoneItems} />
          </div>
        );
      },
    }),

    // Client
    ch.accessor('clientName', {
      header: 'Client', size: 170,
      filterFn: multiSelectFilter,
      cell: i => <span style={{ fontSize: theme.typography.sizes.sm }}>{i.getValue()}</span>,
    }),

    // Reference — inline-editable free text
    ch.accessor('reference', {
      header: 'Reference', size: 120,
      cell: i => (
        <InlineEditableCell
          value={i.getValue() || ''}
          itemId={i.row.original.itemId}
          clientSheetId={i.row.original.clientId}
          fieldKey="reference"
          variant="text"
          applyItemPatch={applyItemPatch as (id: string, patch: Record<string, unknown>) => void}
          mergeItemPatch={mergeItemPatch as (id: string, patch: Record<string, unknown>) => void}
          disabled={!canEditInventory}
          renderValue={v => <span style={{ fontSize: theme.typography.sizes.sm, color: theme.colors.textSecondary }}>{v || '—'}</span>}
        />
      ),
    }),

    // Vendor — inline-editable autocomplete from client Autocomplete_DB
    ch.accessor('vendor', {
      header: 'Vendor', size: 130,
      cell: i => (
        <InlineEditableCell
          value={i.getValue() || ''}
          itemId={i.row.original.itemId}
          clientSheetId={i.row.original.clientId}
          fieldKey="vendor"
          variant="autocomplete-db"
          dbField="vendors"
          applyItemPatch={applyItemPatch as (id: string, patch: Record<string, unknown>) => void}
          mergeItemPatch={mergeItemPatch as (id: string, patch: Record<string, unknown>) => void}
          disabled={!canEditInventory}
          renderValue={v => <span style={{ fontSize: theme.typography.sizes.sm }}>{v || '—'}</span>}
        />
      ),
    }),

    // Description — inline-editable autocomplete from client Autocomplete_DB
    ch.accessor('description', {
      header: 'Description', size: 260,
      cell: i => (
        <InlineEditableCell
          value={i.getValue() || ''}
          itemId={i.row.original.itemId}
          clientSheetId={i.row.original.clientId}
          fieldKey="description"
          variant="autocomplete-db"
          dbField="descriptions"
          applyItemPatch={applyItemPatch as (id: string, patch: Record<string, unknown>) => void}
          mergeItemPatch={mergeItemPatch as (id: string, patch: Record<string, unknown>) => void}
          disabled={!canEditInventory}
          renderValue={v => (
            <span style={{
              fontSize: theme.typography.sizes.sm, display: 'block',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{v || '—'}</span>
          )}
        />
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

    // Location — inline-editable autocomplete from Supabase locations (warehouse-wide)
    ch.accessor('location', {
      header: 'Location', size: 120,
      cell: i => (
        <InlineEditableCell
          value={i.getValue() || ''}
          itemId={i.row.original.itemId}
          clientSheetId={i.row.original.clientId}
          fieldKey="location"
          variant="autocomplete-locations"
          applyItemPatch={applyItemPatch as (id: string, patch: Record<string, unknown>) => void}
          mergeItemPatch={mergeItemPatch as (id: string, patch: Record<string, unknown>) => void}
          disabled={!canEditInventory}
          renderValue={v => v ? (
            <span style={{
              fontSize: 11, fontFamily: 'monospace', fontWeight: 500,
              background: theme.colors.bgSubtle,
              border: `1px solid ${theme.colors.borderSubtle}`,
              borderRadius: theme.radii.sm, padding: '1px 6px',
              display: 'inline-block',
            }}>{v}</span>
          ) : <span style={{ color: theme.colors.textMuted }}>—</span>}
        />
      ),
    }),

    // Sidemark — inline-editable autocomplete from client Autocomplete_DB
    ch.accessor('sidemark', {
      header: 'Sidemark', size: 190,
      filterFn: multiSelectFilter,
      cell: i => {
        const val = i.getValue() || '';
        const bg = val ? sidemarkColorMap.get(normSidemark(val)) : undefined;
        return (
          <InlineEditableCell
            value={val}
            itemId={i.row.original.itemId}
            clientSheetId={i.row.original.clientId}
            fieldKey="sidemark"
            variant="autocomplete-db"
            dbField="sidemarks"
            applyItemPatch={applyItemPatch as (id: string, patch: Record<string, unknown>) => void}
            mergeItemPatch={mergeItemPatch as (id: string, patch: Record<string, unknown>) => void}
            disabled={!canEditInventory}
            renderValue={v => (
              <span style={{
                fontSize: theme.typography.sizes.sm, display: 'block',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                color: theme.colors.textSecondary,
                ...(bg ? { background: bg, borderRadius: 3, padding: '1px 6px', margin: '-1px -6px' } : {}),
              }}>{v || '—'}</span>
            )}
          />
        );
      },
    }),

    // Room — inline-editable free text (sourced from actual Inventory Room column,
    // not derived from sidemark as in pre-v38.72.0 builds)
    ch.accessor('room', {
      id: 'room', header: 'Room', size: 130,
      cell: i => (
        <InlineEditableCell
          value={i.getValue() || ''}
          itemId={i.row.original.itemId}
          clientSheetId={i.row.original.clientId}
          fieldKey="room"
          variant="text"
          applyItemPatch={applyItemPatch as (id: string, patch: Record<string, unknown>) => void}
          mergeItemPatch={mergeItemPatch as (id: string, patch: Record<string, unknown>) => void}
          disabled={!canEditInventory}
          renderValue={v => <span style={{ fontSize: theme.typography.sizes.sm }}>{v || '—'}</span>}
        />
      ),
    }),

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

    // Notes — now reads the latest public entity_notes body first, falling
    // back to the legacy inventory.item_notes string for rows that haven't
    // been migrated (backwards compat). Long bodies truncated with ellipsis
    // and a title tooltip so the full text is still discoverable.
    ch.accessor('notes', {
      header: 'Notes', size: 200,
      cell: i => {
        const itemId = i.row.original.itemId;
        const latest = itemId ? notesByItemId[itemId] : undefined;
        const legacy = i.getValue();
        const display = latest || legacy || '';
        if (!display) return <span style={{ color: theme.colors.textMuted }}>—</span>;
        const truncated = display.length > 80 ? display.slice(0, 80) + '…' : display;
        return (
          <span
            title={display}
            style={{
              fontSize: theme.typography.sizes.sm, color: theme.colors.textSecondary,
              display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
          >{truncated}</span>
        );
      },
    }),

    // Actions (hover reveal)
    ch.display({
      id: 'actions',
      size: 96, minSize: 96, maxSize: 96,
      enableResizing: false, enableSorting: false,
      header: () => null,
      cell: ({ row }) => (
        <div className="inv-row-actions" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 2,
          opacity: 0,
          transition: 'opacity 0.1s',
        }}>
          {[
            { Icon: Eye, label: 'View detail', action: () => navigate(`/inventory/${row.original.itemId}`) },
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [showToast, inspOpenItems, inspDoneItems, asmOpenItems, asmDoneItems, repairOpenItems, repairDoneItems, applyItemPatch, mergeItemPatch, canEditInventory, notesByItemId]);

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
  // Restore scroll position when navigating back from /inventory/:id.
  useScrollRestoration('inventory', containerRef, allVirtualRows.length > 0);

  // Session 72: row-display selector. Replaces the flaky drag-to-resize.
  // 'default' = viewport-fit (~10 rows). 'all' = render all rows unvirtualized
  // and let the whole PAGE scroll (sticky headers keep column labels frozen).
  // Fixed numbers (50/100) set an explicit container height.
  type RowDisplay = 'default' | 50 | 100 | 'all';
  const [rowDisplay, setRowDisplay] = useState<RowDisplay>('default');

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
    exportVisibleToCSV(table.getFilteredRowModel().rows, table.getVisibleLeafColumns(), buildExportFilename('export'));
  }

  function doExportSelected() {
    exportVisibleToCSV(table.getSelectedRowModel().rows, table.getVisibleLeafColumns(), buildExportFilename('selected'));
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
    padding: '0 12px',
    height: 44,
    borderBottom: 'none',
    borderRight: colId === 'actions' ? `1px solid ${theme.colors.borderSubtle}` : undefined,
    textAlign: colId === 'qty' ? 'center' : 'left',
    userSelect: 'none',
    cursor: colId === 'select' || colId === 'actions' ? 'default' : 'grab',
    background: dragOverColId === colId ? theme.colors.primaryLight : '#F5F2EE',
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

  // Build print title — MUST be declared BEFORE the early return below to keep
  // hook count stable across renders (React error #300 otherwise).
  const printTitle = useMemo(() => {
    const parts = ['Inventory'];
    if (clientFilter.length === 1) parts.push(clientFilter[0]);
    else if (clientFilter.length > 1) parts.push(`${clientFilter.length} clients`);
    if (sidemarkFilterValue.length > 0) parts.push('Sidemarks: ' + sidemarkFilterValue.join(', '));
    return parts.join(' — ');
  }, [clientFilter, sidemarkFilterValue]);

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

  return (
    <div style={{ fontFamily: theme.typography.fontFamily, display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: '#F5F2EE', margin: isMobile ? '-14px -12px' : '-28px -32px', padding: isMobile ? '12px' : '28px 32px' }}>

      {/* Print + hover styles */}
      <style>{`
        /* Session 72: row-hover actions via pure CSS — no React state,
           no useMemo rebuild, no per-hover cell re-renders. */
        .inv-row:hover .inv-row-actions { opacity: 1 !important; }

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

      {/* ── Page Title (v2 small inline branding) ── */}
      <div className="no-print" style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '2px', color: '#1C1C1C' }}>
          STRIDE LOGISTICS · INVENTORY
        </div>
      </div>
      <div className="no-print" style={{ background: '#FFFFFF', borderRadius: 20, padding: 24, border: '1px solid rgba(0,0,0,0.04)', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>

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
                padding: '8px 16px', borderRadius: 100,
                border: isActive ? 'none' : '1px solid rgba(0,0,0,0.08)',
                background: isActive ? '#1C1C1C' : '#fff',
                color: isActive ? '#fff' : '#666',
                fontSize: 11,
                fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase',
                cursor: 'pointer', transition: 'all 0.15s', fontFamily: 'inherit', whiteSpace: 'nowrap',
              }}
            >
              {s ?? 'All'} <span style={{ opacity: 0.65 }}>({count})</span>
            </button>
          );
        })}

        {!isMobile && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14, fontSize: theme.typography.sizes.sm, color: theme.colors.textMuted }}>
            {/* Row-display selector — controls how many rows are visible at once */}
            <div className="no-print" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', color: theme.colors.textMuted }}>Show</span>
              {([
                { key: 'default' as RowDisplay, label: '10' },
                { key: 50 as RowDisplay, label: '50' },
                { key: 100 as RowDisplay, label: '100' },
                { key: 'all' as RowDisplay, label: 'All' },
              ]).map(opt => {
                const active = rowDisplay === opt.key;
                return (
                  <button
                    key={String(opt.key)}
                    onClick={() => setRowDisplay(opt.key)}
                    style={{
                      padding: '4px 10px', borderRadius: 100,
                      border: active ? 'none' : '1px solid rgba(0,0,0,0.08)',
                      background: active ? '#1C1C1C' : '#fff',
                      color: active ? '#fff' : '#666',
                      fontSize: 11, fontWeight: 600, letterSpacing: '0.5px',
                      cursor: 'pointer', transition: 'all 0.15s', fontFamily: 'inherit',
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <div>
              Showing <strong style={{ color: theme.colors.textPrimary }}>{pageRows.length}</strong> of{' '}
              <strong style={{ color: theme.colors.textPrimary }}>{filteredCount}</strong> items
              {filteredCount !== totalCount && <span> (filtered from {totalCount})</span>}
            </div>
          </div>
        )}
      </div>

      {/* ── Empty state when no clients selected ── */}
      {clientFilter.length === 0 && <div style={{ padding: '40px 20px', textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>Select one or more clients to load data.</div>}

      {/* ── Table wrapper ── */}
      <div ref={containerRef} style={{
        // Session 72 row-display modes — ALL use internal container scroll
        // with sticky thead for consistent Google-Sheets-style frozen
        // headers. Page-scroll approach was abandoned because asymmetric
        // overflow (x:visible + y:visible) broke sticky anchoring AND let
        // the 1941px-wide table bleed past page margins.
        //  • printing: full expand, no scroll (browser paginates).
        //  • 'all' (desktop): container fills near-full viewport, internal
        //    scroll, all rows rendered unvirtualized (Ctrl+F works).
        //  • 50 / 100: container height = N*40 + 60, capped at viewport.
        //  • default: flex:1 + viewport-fit (~10 rows).
        ...(isPrinting
          ? { flex: 1 }
          : !isMobile && rowDisplay === 'all'
          ? { flex: '0 0 auto', height: 'calc(100dvh - 180px)', maxHeight: 'calc(100dvh - 180px)' }
          : !isMobile && typeof rowDisplay === 'number'
          ? { flex: '0 0 auto',
              height: `min(${rowDisplay * 40 + 60}px, calc(100dvh - 180px))`,
              maxHeight: `min(${rowDisplay * 40 + 60}px, calc(100dvh - 180px))` }
          : { flex: 1, minHeight: isMobile ? 200 : 0,
              maxHeight: isMobile ? 'calc(100dvh - 180px)' : 'calc(100dvh - 280px)' }),
        overflowX: isPrinting ? 'visible' : 'auto',
        overflowY: isPrinting ? 'visible' : 'auto',
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
          {/* Session 72: sticky applied at THREE levels (<thead>, <tr>, <th>)
              because browsers disagree about which anchor wins inside
              table-layout:fixed + border-collapse:collapse. Solid bg on each
              layer prevents row bleed-through when stuck. */}
          <thead style={{ position: 'sticky', top: 0, zIndex: 5, background: '#F5F2EE' }}>
            {table.getHeaderGroups().map(hg => (
              <tr key={hg.id} style={{ position: 'sticky', top: 0, background: '#F5F2EE' }}>
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
                        background: isDragOver ? '#EBF0FF' : '#F5F2EE',
                        outline: isDragOver ? `2px solid ${theme.colors.primary}` : undefined,
                        outlineOffset: -2,
                        width: header.getSize(),
                        boxSizing: 'border-box',
                        position: 'sticky',
                        top: 0,
                        zIndex: 4,
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
                              fontSize: 10,
                              fontWeight: 600,
                              color: sorted ? theme.colors.orange : '#888',
                              textTransform: 'uppercase', letterSpacing: '2px',
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
            ) : (isPrinting || (rowDisplay === 'all' && !isMobile)) ? (
              /* De-virtualized: render ALL rows (print OR "Show: All" mode).
                 In user-expanded mode we still attach row-level handlers so
                 clicking rows / double-click-to-open-detail still works. */
              allVirtualRows.map((row, idx) => {
                const isSelected = row.getIsSelected();
                const isActivePanel = selectedItem?.itemId === row.original.itemId;
                const smColor = colorSidemarks && row.original.sidemark ? sidemarkColorMap.get(normSidemark(row.original.sidemark)) : undefined;
                const rowBg = isSelected ? '#FFF7F4' : isActivePanel ? '#FEF3EE' : smColor ? smColor + '30' : (isPrinting ? (idx % 2 === 0 ? '#fff' : '#FAFAFA') : 'transparent');
                return (
                  <tr
                    key={row.id}
                    className={isPrinting ? undefined : 'inv-row'}
                    onClick={isPrinting ? undefined : (e => {
                      // Match Tasks/Repairs/WillCalls/Shipments: single click
                      // on row body navigates; clicks on checkbox or action
                      // buttons keep their own behavior. Shift-click on the
                      // row still range-selects via the checkbox column.
                      const t = e.target as HTMLElement;
                      if (t.closest('input[type="checkbox"]') || t.closest('.row-actions')) return;
                      if (e.shiftKey) { handleRowClick(e, row, idx); return; }
                      navigate(`/inventory/${row.original.itemId}`);
                    })}
                    style={{
                      background: rowBg,
                      cursor: isPrinting ? undefined : 'pointer',
                      transition: isPrinting ? undefined : 'background 0.08s',
                      borderLeft: !isPrinting && isActivePanel ? `3px solid ${theme.colors.orange}` : '3px solid transparent',
                    }}
                  >
                    {row.getVisibleCells().map(cell => (
                      <td key={cell.id} style={tdStyle(cell.column.id, isSelected)}>
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
                const smColor = colorSidemarks && row.original.sidemark ? sidemarkColorMap.get(normSidemark(row.original.sidemark)) : undefined;
                const rowBg = isSelected ? '#FFF7F4' : isActivePanel ? '#FEF3EE' : smColor ? smColor + '30' : 'transparent';
                return (
                  <tr
                    key={row.id}
                    className="inv-row"
                    onClick={e => {
                      // Match Tasks/Repairs/WillCalls/Shipments: single click
                      // on row body navigates; clicks on checkbox or action
                      // buttons keep their own behavior. Shift-click still
                      // range-selects (via existing handleRowClick flow).
                      const t = e.target as HTMLElement;
                      if (t.closest('input[type="checkbox"]') || t.closest('.row-actions')) return;
                      if (e.shiftKey) { handleRowClick(e, row, vRow.index); return; }
                      navigate(`/inventory/${row.original.itemId}`);
                    }}
                    style={{
                      background: rowBg,
                      cursor: 'pointer',
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
      {selectedRows.length > 0 && !isMobile && !selectedItem && (
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
          {user?.role !== 'staff' && (
            <WriteButton label="Create Delivery" variant="ghost" size="sm" onClick={async () => { const guard = checkBatchClientGuard(selectedRows.map(r => r.original)); if (guard) { setBatchGuardClients(guard); setBatchGuardAction('Create Delivery'); return; } setShowDeliveryModal(true); }} />
          )}
          <WriteButton label="Create Task" variant="ghost" size="sm" onClick={async () => { const guard = checkBatchClientGuard(selectedRows.map(r => r.original)); if (guard) { setBatchGuardClients(guard); setBatchGuardAction('Create Task'); return; } setShowCreateTaskModal(true); }} />
          {(user?.role === 'staff' || user?.role === 'admin' || user?.isParent) && (
            <WriteButton label="Transfer" variant="ghost" size="sm" onClick={async () => { const guard = checkBatchClientGuard(selectedRows.map(r => r.original)); if (guard) { setBatchGuardClients(guard); setBatchGuardAction('Transfer'); return; } setShowTransferModal(true); }} />
          )}
          <WriteButton label="Request Repair Quote" variant="ghost" size="sm" onClick={async () => { const items = selectedRows.map(r => r.original); const guard = checkBatchClientGuard(items); if (guard) { setBatchGuardClients(guard); setBatchGuardAction('Request Repair Quote'); return; } await handleBulkRequestRepairQuote(items.map(i => ({ itemId: i.itemId, clientId: i.clientId }))); setRowSelection({}); }} />
          {(user?.role === 'staff' || user?.role === 'admin') && (
            <WriteButton label="Release Items" variant="ghost" size="sm" onClick={async () => { const items = selectedRows.map(r => r.original); const activeItems = items.filter(i => i.status === 'Active'); if (!activeItems.length) { showToast('No active items selected — only Active items can be released'); return; } const guard = checkBatchClientGuard(activeItems); if (guard) { setBatchGuardClients(guard); setBatchGuardAction('Release Items'); return; } setShowReleaseModal(true); }} />
          )}
          {(user?.role === 'staff' || user?.role === 'admin') && (
            <WriteButton
              label="Print Labels"
              variant="ghost"
              size="sm"
              onClick={async () => {
                const ids = selectedRows.map(r => r.original.itemId).filter(Boolean);
                if (!ids.length) { showToast('Select at least one item to print labels'); return; }
                navigate(`/labels?ids=${encodeURIComponent(ids.join(','))}`);
              }}
            />
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
      <BulkResultSummary open={!!repairQuoteBulkResult} actionLabel="Request Repair Quotes" result={repairQuoteBulkResult} onClose={() => setRepairQuoteBulkResult(null)} />

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
          onSubmit={(data) => {
            showToast(`Will Call created for ${data.items.length} items`);
            setRowSelection({});
            setDetailActionItem(null);
            refetch();
            // Session 74: emit a will_call entity event so the Will Calls
            // page's useWillCalls hook bypasses Supabase cache on its next
            // fetch (shouldSkipSupabase('will_call') → true once) and also
            // any mounted subscribers (e.g. Dashboard) refetch immediately.
            // Without this, navigating to /will-calls shows stale data
            // until the Supabase write-through Realtime event arrives.
            entityEvents.emit('will_call', (data as any).wcNumber || '');
          }}
        />
      )}

      {/* ── Create Delivery Order Modal (Phase 2b) ── */}
      {showDeliveryModal && (
        <CreateDeliveryOrderModal
          preSelectedItemIds={detailActionItem ? [detailActionItem.itemId] : selectedRows.map(r => r.original.itemId)}
          liveItems={apiConfigured ? inventoryItems as any : undefined}
          onClose={() => { setShowDeliveryModal(false); setDetailActionItem(null); }}
          onSubmit={(data) => {
            showToast(data.reviewStatus === 'approved'
              ? `Delivery order ${data.dtIdentifier} approved — pushing to DT`
              : `Delivery request ${data.dtIdentifier} submitted for review`);
            setRowSelection({});
            setDetailActionItem(null);
            setShowDeliveryModal(false);
          }}
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
            // Session 74: emit for cross-page subscribers + set the skip-cache
            // flag so a fresh Tasks-page mount bypasses stale Supabase data.
            for (const tid of taskIds) entityEvents.emit('task', tid);
          }}
        />
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <FloatingActionMenu
        show={isMobile}
        actions={[
          { label: 'Create Task', icon: <ClipboardList size={16} />, onClick: () => setShowCreateTaskModal(true) },
          { label: 'Create Will Call', icon: <Package size={16} />, onClick: () => setShowWCModal(true) },
          ...(user?.role !== 'staff' ? [{ label: 'Create Delivery', icon: <Truck size={16} />, onClick: () => setShowDeliveryModal(true) }] : []),
          { label: 'Request Repair', icon: <Wrench size={16} />, onClick: async () => {
            const sel = table.getSelectedRowModel().rows;
            if (sel.length === 0) { showToast('Select items first'); return; }
            const items = sel.map(r => r.original);
            await handleBulkRequestRepairQuote(items.map(i => ({ itemId: i.itemId, clientId: i.clientId })));
          }},
          { label: 'Transfer', icon: <Truck size={16} />, onClick: () => setShowTransferModal(true) },
        ] satisfies FABAction[]}
      />
      </div>
    </div>
  );
}
