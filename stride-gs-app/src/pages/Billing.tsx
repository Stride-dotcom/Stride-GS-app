import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useIsMobile } from '../hooks/useIsMobile';
import { useUrlState } from '../hooks/useUrlState';
import { createPortal } from 'react-dom';
import {
  useReactTable, getCoreRowModel, getSortedRowModel, getFilteredRowModel,
  flexRender, createColumnHelper,
  type ColumnFiltersState,
  type RowSelectionState, type FilterFn,
} from '@tanstack/react-table';
import {
  Search, Download, ChevronUp, ChevronDown, ChevronRight, ArrowUpDown,
  Settings2, FileText, DollarSign, Send, Eye, ExternalLink,
  CheckCircle, AlertTriangle, Loader2, X, RefreshCw, Plus, Scale, CreditCard, Clock, ShieldCheck, Ban,
} from 'lucide-react';
import { ParityMonitor } from './ParityMonitor';
import { BillingActivityTab } from '../components/billing/BillingActivityTab';
import { BillingCoverageTab } from '../components/billing/BillingCoverageTab';
import { useVirtualRows } from '../hooks/useVirtualRows';
import { theme } from '../styles/theme';
import { BtnSpinner } from '../components/ui/BtnSpinner';
import { fmtDate } from '../lib/constants';
import { tanstackGlobalFilter } from '../lib/searchFilters';
import { WriteButton } from '../components/shared/WriteButton';
import { MultiSelectFilter } from '../components/shared/MultiSelectFilter';
import { DeepLink } from '../components/shared/DeepLink';
import { SyncBanner } from '../components/shared/SyncBanner';
import { BatchProgress, type BatchState } from '../components/shared/BatchProgress';
import { BulkResultSummary } from '../components/shared/BulkResultSummary';
import { runBatchLoop } from '../lib/batchLoop';
import {
  isApiConfigured,
  type GenerateStorageChargesResponse,
  type UnbilledReportRow,
  postCreateInvoice, type CreateInvoiceResponse,
  postResendInvoiceEmail,
  fetchBilling,
  postQbExport,
  postQbExcelExport,
  postUpdateBillingRow,
  postUpdateQboStatus,
  postCommitStorageRows,
  apiPost,
} from '../lib/api';
import type { BillingFilterParams, BillingResponse, BatchMutationResult } from '../lib/api';
import {
  fetchBillingFromSupabaseFiltered,
  fetchBillingSidemarksFromSupabase,
  isSupabaseCacheAvailable,
  fetchStoragePreviewFromSupabase,
} from '../lib/supabaseQueries';
import type { ClientNameMap, StoragePreviewRow } from '../lib/supabaseQueries';
import { useBilling } from '../hooks/useBilling';
import { useClients } from '../hooks/useClients';
import { useServiceCatalog } from '../hooks/useServiceCatalog';
import { BillingDetailPanel } from '../components/shared/BillingDetailPanel';
import { useTablePreferences } from '../hooks/useTablePreferences';
import { InfoTooltip } from '../components/shared/InfoTooltip';
import { QBOPushButton } from '../components/billing/QBOPushButton';
import { AddChargeModal, type ManualChargeEditTarget } from '../components/billing/AddChargeModal';
import { useQBO } from '../hooks/useQBO';
import { useAuth } from '../contexts/AuthContext';
import { useBillingBatch, type BatchInvoiceResult } from '../contexts/BillingBatchContext';
import { postVoidManualCharge, postVoidInvoice, postVoidUnbilledRows } from '../lib/api';
import { supabase } from '../lib/supabase';
import { entityEvents } from '../lib/entityEvents';
import {
  generateInvoicePdfBlob,
  uploadInvoicePdf,
  patchInvoiceUrl,
  type InvoicePdfClient,
} from '../lib/invoicePdf';

// Drive folder for per-client IIF / billing exports. Pulled from env so
// a folder relocation doesn't require a React deploy. Fallback ID is
// the original folder this code shipped with.
const IIF_FOLDER_ID = (import.meta.env.VITE_BILLING_IIF_FOLDER_ID as string | undefined)
  || '1nN-9xm2SdR1_Sk603nmudWHhMxlaHElx';
const IIF_FOLDER_URL = `https://drive.google.com/drive/folders/${IIF_FOLDER_ID}`;

// ─── Types ──────────────────────────────────────────────────────────────────

interface BillingRow {
  ledgerRowId: string; status: string; invoiceNo: string; client: string;
  clientSheetId?: string; clientName?: string;
  date: string; svcCode: string; svcName: string; itemId: string;
  description: string; itemClass: string; qty: number; rate: number; total: number;
  taskId: string; repairId: string; shipmentNo: string; notes: string;
  sourceSheetId?: string; sidemark?: string; reference?: string; category?: string;
  staxCustomerId?: string | null;
  autoCharge?: boolean;
  qboStatus?: string | null;
  qboInvoiceId?: string | null;
  invoiceDate?: string;  // Date the invoice was created (not the service/ledger date)
}

// Aggregated invoice row for the invoice-list view (one per unique invoiceNo).
// Line items stay in `lineItems` and render in a nested subtable on expand.
interface InvoiceGroup {
  invoiceNo: string;
  status: string;
  client: string;
  sidemark: string;      // '' | single value | 'Multiple'
  date: string;          // earliest child service date (fallback only — prefer invoiceDate for display)
  invoiceDate: string;   // Date the invoice was actually created (today at create time)
  total: number;
  qboStatus: string | null;  // null | single status | 'Mixed'
  qboInvoiceId: string | null;
  sourceSheetId?: string;
  clientSheetId?: string;
  lineItems: BillingRow[];
  autoCharge?: boolean;  // Whether this invoice's client has autopay enabled — drives Stax vs QBO routing
  staxCustomerId?: string | null;  // If set, client is Stax-enabled
}

const ALL_STATUSES = ['Unbilled', 'Invoiced', 'Billed', 'Void'];

// ─── Invoice Review — types ──────────────────────────────────────────────────

interface InvoiceReviewLine {
  ledgerRowId: string;
  invoiceNo: string;
  status: string;
  clientName: string;
  clientSheetId: string;
  date: string;          // service date
  invoiceDate: string;   // when the invoice was created (preferred for display)
  svcCode: string;
  svcName: string;
  itemId: string;
  description: string;
  itemClass: string;
  qty: number;
  rate: number;
  total: number;
  taskId: string;
  repairId: string;
  shipmentNumber: string;
  notes: string;
  sidemark: string;
  reference: string;
  invoiceUrl: string;
}

interface InvoiceReviewSummary {
  invoiceNo: string;
  clientName: string;
  clientSheetId: string;
  invoiceDate: string;
  status: 'Invoiced' | 'Void' | 'Mixed';
  total: number;
  lineCount: number;
  invoiceUrl: string;
  /** Per-client Stax / autopay flags resolved from `clients` table. */
  staxCustomerId: string | null;
  autoCharge: boolean;
  /** Aggregated sidemark across all line items: '' (none), single value, or 'Multiple'. */
  sidemark: string;
  lines: InvoiceReviewLine[];
}

const STATUS_CFG: Record<string, { bg: string; text: string }> = {
  Unbilled: { bg: '#FEF3C7', text: '#B45309' },
  Invoiced: { bg: '#EFF6FF', text: '#1D4ED8' },
  Billed:   { bg: '#F0FDF4', text: '#15803D' },
  Void:     { bg: '#F3F4F6', text: '#6B7280' },
  Preview:  { bg: '#FFFDE7', text: '#F59E0B' },
};

const SVC_CFG: Record<string, { bg: string; text: string }> = {
  RCVG: { bg: '#EFF6FF', text: '#1D4ED8' }, INSP: { bg: '#FEF3EE', text: '#E85D2D' },
  ASM: { bg: '#F0FDF4', text: '#15803D' }, REPAIR: { bg: '#FEF3C7', text: '#B45309' },
  STOR: { bg: '#F3F4F6', text: '#6B7280' }, DLVR: { bg: '#EDE9FE', text: '#7C3AED' },
  WCPU: { bg: '#FCE7F3', text: '#BE185D' }, WC: { bg: '#FCE7F3', text: '#BE185D' },
  MNRTU: { bg: '#FEF3EE', text: '#E85D2D' }, PLLT: { bg: '#EDE9FE', text: '#7C3AED' },
  PICK: { bg: '#EFF6FF', text: '#1D4ED8' }, LABEL: { bg: '#F0FDF4', text: '#15803D' },
  DISP: { bg: '#FEF2F2', text: '#991B1B' }, RSTK: { bg: '#EDE9FE', text: '#7C3AED' },
  NO_ID: { bg: '#F3F4F6', text: '#6B7280' }, MULTI_INS: { bg: '#FEF3EE', text: '#E85D2D' },
  SIT: { bg: '#EFF6FF', text: '#1D4ED8' },
};

const COL_LABELS: Record<string, string> = {
  ledgerRowId: 'Ledger ID', status: 'Status', invoiceNo: 'Invoice #', client: 'Client',
  sidemark: 'Sidemark', reference: 'Reference',
  date: 'Date', svcCode: 'Svc Code', svcName: 'Service', itemId: 'Item',
  description: 'Description', itemClass: 'Class', qty: 'Qty', rate: 'Rate', total: 'Total',
  taskId: 'Task', repairId: 'Repair', shipmentNo: 'Shipment', notes: 'Notes',
};
const TOGGLEABLE = Object.keys(COL_LABELS);
const DEFAULT_COL_ORDER = ['select', 'ledgerRowId', 'status', 'invoiceNo', 'client', 'sidemark', 'reference', 'date', 'svcCode', 'svcName', 'itemId', 'description', 'itemClass', 'qty', 'rate', 'total', 'taskId', 'repairId', 'shipmentNo', 'notes', 'actions'];

const mf: FilterFn<BillingRow> = (row, _colId, val: string[]) => { if (!val || !val.length) return true; return val.includes(String(row.getValue(_colId))); };
mf.autoRemove = (v: string[]) => !v || !v.length;

const fmt = fmtDate;
function Badge({ t, c }: { t: string; c?: { bg: string; text: string } }) { const s = c || { bg: '#F3F4F6', text: '#6B7280' }; return <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: s.bg, color: s.text, whiteSpace: 'nowrap' }}>{t}</span>; }

function toCSV(rows: BillingRow[], fn: string) {
  const h = Object.values(COL_LABELS).join(',');
  const b = rows.map(r => [r.ledgerRowId, r.status, r.invoiceNo, r.client, r.sidemark || '', r.reference || '', r.date, r.svcCode, r.svcName, r.itemId, r.description, r.itemClass, r.qty, r.rate, r.total, r.taskId, r.repairId, r.shipmentNo, r.notes].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const bl = new Blob([h + '\n' + b], { type: 'text/csv' }); const a = document.createElement('a'); a.href = URL.createObjectURL(bl); a.download = fn; a.click();
}

// ─── Inline Editable Cell ───────────────────────────────────────────────────

/**
 * EditableCell — always-on inline input. No pencil toggle, no click-to-edit.
 * Just type into the field; onBlur (or Enter) fires onChange to save.
 *
 * v38.121.0 — rewritten from the toggle-based pattern which was flaky:
 *   - Pencil icon suggested something was editable but the click to enter
 *     edit mode was inconsistent (table-row click handlers sometimes ate it,
 *     and some users reported the state transition never firing).
 *   - User feedback: "I don't want the pencil, just the field to type in."
 * This version is always an <input> styled to blend in like a display cell
 * until focused (then shows orange outline). Fewer states = fewer bugs.
 */
function EditableCell({ value, onChange, type = 'text', align, currency = true }: { value: string | number; onChange: (v: string) => void; type?: 'text' | 'number'; align?: 'right'; currency?: boolean }) {
  // Local draft state so the user can type freely without the parent re-rendering
  // mid-keystroke. Resync when the upstream value changes (e.g. optimistic update).
  const [draft, setDraft] = useState(String(value));
  const [focused, setFocused] = useState(false);
  // Resync draft to incoming value when NOT actively editing. Prevents typed
  // input from being clobbered by realtime refetches while the user is typing.
  useEffect(() => {
    if (!focused) setDraft(String(value));
  }, [value, focused]);

  const formatted = type === 'number'
    ? (currency ? `$${Number(value || 0).toFixed(2)}` : String(Number(value || 0)))
    : (String(value) || '');

  // Display format when not focused (currency formatting, em-dash for empty)
  // but once focused, show the raw draft so the user can edit naturally.
  const shownValue = focused ? draft : (type === 'number' ? String(Number(value || 0)) : String(value || ''));

  const commit = () => {
    if (draft !== String(value)) onChange(draft);
  };

  return (
    <input
      value={shownValue}
      onChange={e => setDraft(e.target.value)}
      onFocus={() => { setDraft(String(value)); setFocused(true); }}
      onBlur={() => { setFocused(false); commit(); }}
      onKeyDown={e => {
        if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); }
        if (e.key === 'Escape') { setDraft(String(value)); (e.target as HTMLInputElement).blur(); }
      }}
      onClick={e => e.stopPropagation()}  // don't trigger row-click expansion
      type={type}
      step={type === 'number' ? '0.01' : undefined}
      placeholder={type === 'number' ? '0' : '—'}
      title={!focused && type !== 'number' ? formatted : undefined}
      style={{
        width: '100%',
        padding: '2px 6px',
        fontSize: 12,
        // Invisible border when unfocused — looks like plain text.
        // Orange on focus signals active edit.
        border: focused ? `1px solid ${theme.colors.orange}` : '1px solid transparent',
        borderRadius: 4,
        outline: 'none',
        fontFamily: 'inherit',
        textAlign: align,
        background: focused ? '#FFFBF5' : 'transparent',
        color: theme.colors.text,
      }}
    />
  );
}

// ─── Invoice Review Tab ──────────────────────────────────────────────────────
//
// Real implementation: queries `billing` table directly from Supabase (no GAS
// round-trip), groups by invoice_no, and renders an expandable summary list
// with search / filter / sort. Replaces the previous mock-data stub.

const REVIEW_INVOICE_STATUS_CFG: Record<string, { bg: string; text: string }> = {
  Invoiced: { bg: '#EFF6FF', text: '#1D4ED8' },
  Void:     { bg: '#F3F4F6', text: '#6B7280' },
  Mixed:    { bg: '#FEF3C7', text: '#B45309' },
};

function InvoiceReviewTab() {
  const { user } = useAuth();
  const isStaff = user?.role === 'admin' || user?.role === 'staff';
  // Per-client Stax / Auto Pay flags. Same source the Billing Report tab
  // uses (apiClients → tenant_id keyed map). Used to render the green
  // CreditCard icon + Auto Pay badge next to each invoice's client name.
  const { apiClients } = useClients();
  const clientPayInfoMap = useMemo<Record<string, { autoCharge: boolean; staxCustomerId: string }>>(() => {
    const map: Record<string, { autoCharge: boolean; staxCustomerId: string }> = {};
    for (const c of apiClients) {
      if (c.spreadsheetId) {
        map[c.spreadsheetId] = {
          autoCharge: c.autoCharge ?? false,
          staxCustomerId: c.staxCustomerId ?? '',
        };
      }
    }
    return map;
  }, [apiClients]);
  const [invoices, setInvoices] = useState<InvoiceReviewSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [clientFilter, setClientFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'Invoiced' | 'Void'>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortBy, setSortBy] = useState<'invoiceDate' | 'invoiceNo' | 'clientName' | 'total'>('invoiceDate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('billing')
      .select('ledger_row_id, invoice_no, status, client_name, tenant_id, date, invoice_date, svc_code, svc_name, item_id, description, item_class, qty, rate, total, task_id, repair_id, shipment_number, item_notes, sidemark, reference, invoice_url')
      .in('status', ['Invoiced', 'Void'])
      .not('invoice_no', 'is', null)
      .order('invoice_date', { ascending: false });
    if (err) { setError(err.message); setLoading(false); return; }
    const lines: InvoiceReviewLine[] = (data || []).map(r => ({
      ledgerRowId: String(r.ledger_row_id || ''),
      invoiceNo:   String(r.invoice_no || ''),
      status:      String(r.status || ''),
      clientName:  String(r.client_name || ''),
      clientSheetId: String(r.tenant_id || ''),
      date:         String(r.date || ''),
      invoiceDate:  String(r.invoice_date || ''),
      svcCode:      String(r.svc_code || ''),
      svcName:      String(r.svc_name || ''),
      itemId:       String(r.item_id || ''),
      description:  String(r.description || ''),
      itemClass:    String(r.item_class || ''),
      qty:          Number(r.qty || 0),
      rate:         Number(r.rate || 0),
      total:        Number(r.total || 0),
      taskId:       String(r.task_id || ''),
      repairId:     String(r.repair_id || ''),
      shipmentNumber: String(r.shipment_number || ''),
      notes:        String(r.item_notes || ''),
      sidemark:     String(r.sidemark || ''),
      reference:    String(r.reference || ''),
      invoiceUrl:   String(r.invoice_url || ''),
    }));
    // Group by invoice_no. Sidemark is aggregated separately from a parallel
    // map (Set<string> per invoice) so we can collapse to '' / single / 'Multiple'
    // after the loop without mutating the summary on every line.
    const groups = new Map<string, InvoiceReviewSummary>();
    const sidemarksByInvoice = new Map<string, Set<string>>();
    for (const ln of lines) {
      if (!ln.invoiceNo) continue;
      let g = groups.get(ln.invoiceNo);
      if (!g) {
        const payInfo = clientPayInfoMap[ln.clientSheetId];
        g = {
          invoiceNo:    ln.invoiceNo,
          clientName:   ln.clientName,
          clientSheetId: ln.clientSheetId,
          invoiceDate:  ln.invoiceDate || ln.date,
          status:       (ln.status === 'Void' ? 'Void' : 'Invoiced'),
          total:        0,
          lineCount:    0,
          invoiceUrl:   ln.invoiceUrl,
          staxCustomerId: payInfo?.staxCustomerId || null,
          autoCharge:   payInfo?.autoCharge ?? false,
          sidemark:     '',
          lines:        [],
        };
        groups.set(ln.invoiceNo, g);
        sidemarksByInvoice.set(ln.invoiceNo, new Set());
      }
      g.total += ln.total;
      g.lineCount += 1;
      g.lines.push(ln);
      if (!g.invoiceUrl && ln.invoiceUrl) g.invoiceUrl = ln.invoiceUrl;
      if (ln.sidemark) sidemarksByInvoice.get(ln.invoiceNo)!.add(ln.sidemark);
      // Mixed status: any line differing from the first defines it
      if ((g.status === 'Invoiced' && ln.status === 'Void') ||
          (g.status === 'Void' && ln.status === 'Invoiced')) {
        g.status = 'Mixed';
      }
    }
    // Collapse aggregated sidemark sets to display strings.
    for (const [invNo, set] of sidemarksByInvoice) {
      const g = groups.get(invNo);
      if (!g) continue;
      if (set.size === 0) g.sidemark = '';
      else if (set.size === 1) g.sidemark = [...set][0];
      else g.sidemark = 'Multiple';
    }
    setInvoices(Array.from(groups.values()));
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientPayInfoMap]);

  useEffect(() => { reload(); }, [reload]);

  // Subscribe to billing realtime — when Void writes propagate, refresh
  useEffect(() => {
    return entityEvents.subscribe(type => {
      if (type === 'billing') reload();
    });
  }, [reload]);

  const clientOptions = useMemo(() => {
    const set = new Set<string>();
    for (const inv of invoices) if (inv.clientName) set.add(inv.clientName);
    return Array.from(set).sort();
  }, [invoices]);

  const filteredSorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = invoices.filter(inv => {
      if (statusFilter !== 'all') {
        if (statusFilter === 'Invoiced' && inv.status === 'Void') return false;
        if (statusFilter === 'Void' && inv.status === 'Invoiced') return false;
      }
      if (clientFilter !== 'all' && inv.clientName !== clientFilter) return false;
      if (dateFrom && inv.invoiceDate && inv.invoiceDate < dateFrom) return false;
      if (dateTo && inv.invoiceDate && inv.invoiceDate > dateTo) return false;
      if (q) {
        // Search every text field on the invoice + every line-item field
        // staff might recognize: ledger ID, item ID, description, sidemark,
        // reference, notes, vendor-equivalent (svc name/code), task / repair
        // / shipment refs. Matches the spirit of the global Billing Report
        // search but operates on the invoice-grouped projection so the user
        // can find any line item that's already been invoiced (the symptom
        // Justin reported — "we currently have to open every invoice").
        const haystack = [
          inv.invoiceNo, inv.clientName, inv.invoiceDate, String(inv.total),
          ...inv.lines.flatMap(l => [
            l.ledgerRowId, l.itemId, l.description, l.sidemark, l.reference,
            l.notes, l.svcCode, l.svcName, l.itemClass,
            l.taskId, l.repairId, l.shipmentNumber,
          ]),
        ].join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
    out = [...out].sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      switch (sortBy) {
        case 'invoiceDate': return (a.invoiceDate || '').localeCompare(b.invoiceDate || '') * dir;
        case 'invoiceNo':   return a.invoiceNo.localeCompare(b.invoiceNo) * dir;
        case 'clientName':  return a.clientName.localeCompare(b.clientName) * dir;
        case 'total':       return (a.total - b.total) * dir;
        default: return 0;
      }
    });
    return out;
  }, [invoices, search, clientFilter, statusFilter, dateFrom, dateTo, sortBy, sortDir]);

  const totalSum = useMemo(() =>
    filteredSorted.filter(i => i.status !== 'Void').reduce((s, i) => s + i.total, 0),
    [filteredSorted]
  );

  const handleVoid = async (inv: InvoiceReviewSummary) => {
    if (!isStaff) return;
    const reason = window.prompt(`Void invoice ${inv.invoiceNo}? Optional reason:`, '');
    if (reason === null) return; // user cancelled

    // Optimistic — flip the summary + every child line to Void immediately
    // so the badge / counters / Total Billed update without waiting for the
    // GAS round-trip. WriteButton's spinner still indicates work in flight;
    // this just removes the "stale row sitting next to a spinning button"
    // feel. On failure we restore the prior snapshot.
    const prevInvoices = invoices;
    setInvoices(prev => prev.map(i =>
      i.invoiceNo === inv.invoiceNo
        ? { ...i, status: 'Void' as const, lines: i.lines.map(l => ({ ...l, status: 'Void' })) }
        : i
    ));

    try {
      const res = await postVoidInvoice({ invoiceNo: inv.invoiceNo, reason }, inv.clientSheetId);
      if (!res.ok || !res.data?.success) {
        setInvoices(prevInvoices); // revert
        // Throwing lets WriteButton's catch flip the button to the red ✗
        // outcome state instead of the green ✓ Done flash.
        throw new Error(res.error || res.data?.error || 'Unknown error');
      }
      // Reload from Supabase so we pick up the writeThrough echo (note text,
      // updated_at, etc). Background only — UI is already correct optimistically.
      reload();
    } catch (err) {
      setInvoices(prevInvoices);
      throw err; // re-throw so WriteButton renders the failure state
    }
  };

  const toggleExpand = (invoiceNo: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(invoiceNo)) next.delete(invoiceNo);
      else next.add(invoiceNo);
      return next;
    });
  };

  const handleSort = (field: typeof sortBy) => {
    if (sortBy === field) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortBy(field); setSortDir(field === 'invoiceDate' || field === 'total' ? 'desc' : 'asc'); }
  };

  const reviewTh: React.CSSProperties = {
    padding: '8px 12px', textAlign: 'left', fontWeight: 500, fontSize: 10,
    color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em',
    borderBottom: `2px solid ${theme.colors.border}`, whiteSpace: 'nowrap', userSelect: 'none',
  };
  const reviewTd: React.CSSProperties = {
    padding: '10px 12px', fontSize: 12,
    borderBottom: `1px solid ${theme.colors.borderLight}`, verticalAlign: 'middle',
  };

  const SortHead = ({ field, label, align }: { field: typeof sortBy; label: string; align?: 'right' | 'left' }) => (
    <th
      style={{ ...reviewTh, cursor: 'pointer', textAlign: align || 'left' }}
      onClick={() => handleSort(field)}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {label}
        {sortBy === field
          ? (sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)
          : <ArrowUpDown size={11} style={{ opacity: 0.35 }} />}
      </span>
    </th>
  );

  const summaryCards = [
    { label: 'Invoices', value: filteredSorted.length, color: '#60A5FA' },
    { label: 'Total Billed', value: `$${totalSum.toFixed(2)}`, color: '#4ADE80' },
    { label: 'Voided', value: filteredSorted.filter(i => i.status === 'Void').length, color: '#F87171' },
  ];

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 20 }}>
        {summaryCards.map(({ label, value, color }) => (
          <div key={label} style={{ padding: '20px 22px', background: '#1C1C1C', borderRadius: 20 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '2px', marginBottom: 10 }}>{label}</div>
            <div style={{ fontSize: 28, fontWeight: 300, color, lineHeight: 1 }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Filter / search bar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 12 }}>
        <div style={{ position: 'relative', flex: '1 1 240px', maxWidth: 320 }}>
          <Search size={14} color={theme.colors.textMuted} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search invoice #, client, items…"
            style={{ width: '100%', padding: '8px 12px 8px 32px', fontSize: 12, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', fontFamily: 'inherit' }}
          />
        </div>
        <select
          value={clientFilter}
          onChange={e => setClientFilter(e.target.value)}
          style={{ padding: '7px 10px', fontSize: 12, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', fontFamily: 'inherit' }}
        >
          <option value="all">All Clients</option>
          {clientOptions.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as 'all' | 'Invoiced' | 'Void')}
          style={{ padding: '7px 10px', fontSize: 12, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', fontFamily: 'inherit' }}
        >
          <option value="all">All Statuses</option>
          <option value="Invoiced">Invoiced</option>
          <option value="Void">Void</option>
        </select>
        <input
          type="date"
          value={dateFrom}
          onChange={e => setDateFrom(e.target.value)}
          title="Invoice date from"
          style={{ padding: '7px 10px', fontSize: 12, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', fontFamily: 'inherit' }}
        />
        <span style={{ fontSize: 12, color: theme.colors.textMuted }}>to</span>
        <input
          type="date"
          value={dateTo}
          onChange={e => setDateTo(e.target.value)}
          title="Invoice date to"
          style={{ padding: '7px 10px', fontSize: 12, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', fontFamily: 'inherit' }}
        />
        <button
          onClick={() => { setSearch(''); setClientFilter('all'); setStatusFilter('all'); setDateFrom(''); setDateTo(''); }}
          style={{ padding: '7px 12px', fontSize: 12, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          <X size={12} /> Clear
        </button>
        <button
          onClick={reload}
          disabled={loading}
          title="Refresh"
          style={{ padding: '7px 12px', fontSize: 12, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: loading ? 'wait' : 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          <RefreshCw size={12} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} /> Refresh
        </button>
      </div>

      <div style={{ background: '#fff', border: `1px solid ${theme.colors.border}`, borderRadius: 12, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: theme.colors.textMuted, fontSize: 13 }}>
            <Loader2 size={20} style={{ animation: 'spin 1s linear infinite', display: 'inline-block', verticalAlign: 'middle', marginRight: 8 }} />
            Loading invoices…
          </div>
        ) : error ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#B91C1C', fontSize: 13 }}>
            <AlertTriangle size={16} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 6 }} />
            Failed to load: {error}
          </div>
        ) : filteredSorted.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: theme.colors.textMuted, fontSize: 13 }}>
            No invoices match the current filters.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...reviewTh, width: 32 }}></th>
                <SortHead field="invoiceNo" label="Invoice #" />
                <SortHead field="clientName" label="Client" />
                <th style={reviewTh}>Sidemark</th>
                <SortHead field="invoiceDate" label="Invoice Date" />
                <SortHead field="total" label="Total" align="right" />
                <th style={{ ...reviewTh, textAlign: 'right' }}>Lines</th>
                <th style={reviewTh}>Status</th>
                <th style={{ ...reviewTh, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredSorted.map(inv => {
                const isOpen = expanded.has(inv.invoiceNo);
                const statusCfg = REVIEW_INVOICE_STATUS_CFG[inv.status];
                return (
                  <React.Fragment key={inv.invoiceNo}>
                    <tr
                      onClick={() => toggleExpand(inv.invoiceNo)}
                      style={{ cursor: 'pointer', background: isOpen ? '#FFF7ED' : 'transparent' }}
                    >
                      <td style={{ ...reviewTd, textAlign: 'center' }}>
                        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </td>
                      <td style={{ ...reviewTd, fontWeight: 600 }}>
                        <DeepLink kind="invoice" id={inv.invoiceNo} clientSheetId={inv.clientSheetId} showIcon={false} />
                      </td>
                      <td style={reviewTd}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          {inv.clientName || '—'}
                          {inv.staxCustomerId && (
                            <span title="Stax payment on file" style={{ display: 'inline-flex', flexShrink: 0 }}>
                              <CreditCard size={11} color="#15803D" />
                            </span>
                          )}
                          {inv.staxCustomerId && inv.autoCharge && (
                            <span
                              title="Auto Pay enabled"
                              style={{
                                marginLeft: 2, fontSize: 9, padding: '1px 5px', borderRadius: 4,
                                background: '#F0FDF4', color: '#15803D', fontWeight: 700,
                                whiteSpace: 'nowrap',
                              }}
                            >
                              Auto Pay
                            </span>
                          )}
                        </span>
                      </td>
                      <td style={{ ...reviewTd, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {inv.sidemark === 'Multiple'
                          ? <span style={{ fontStyle: 'italic', color: theme.colors.textMuted }}>Multiple</span>
                          : (inv.sidemark || '—')}
                      </td>
                      <td style={reviewTd}>{fmt(inv.invoiceDate) || '—'}</td>
                      <td style={{ ...reviewTd, textAlign: 'right', fontWeight: 600 }}>${inv.total.toFixed(2)}</td>
                      <td style={{ ...reviewTd, textAlign: 'right', color: theme.colors.textSecondary }}>{inv.lineCount}</td>
                      <td style={reviewTd}><Badge t={inv.status} c={statusCfg} /></td>
                      <td
                        style={{ ...reviewTd, textAlign: 'right' }}
                        onClick={e => e.stopPropagation()}
                      >
                        <div style={{ display: 'inline-flex', gap: 6, justifyContent: 'flex-end' }}>
                          {inv.invoiceUrl && (
                            <a
                              href={inv.invoiceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Open invoice PDF"
                              style={{ padding: '5px 10px', fontSize: 11, border: `1px solid ${theme.colors.border}`, borderRadius: 6, background: '#fff', color: theme.colors.text, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                            >
                              <ExternalLink size={11} /> PDF
                            </a>
                          )}
                          {isStaff && inv.status !== 'Void' && (
                            <WriteButton
                              label="Void"
                              loadingText="Voiding…"
                              successText="Voided"
                              variant="danger"
                              size="sm"
                              onClick={async () => handleVoid(inv)}
                            />
                          )}
                        </div>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={9} style={{ padding: 0, background: '#F8FAFC' }}>
                          <InvoiceReviewLineItems lines={inv.lines} clientSheetId={inv.clientSheetId} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function InvoiceReviewLineItems({ lines, clientSheetId }: { lines: InvoiceReviewLine[]; clientSheetId: string }) {
  const subTh: React.CSSProperties = {
    padding: '6px 10px', textAlign: 'left', fontWeight: 600, fontSize: 10,
    color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em',
    borderBottom: `1px solid ${theme.colors.borderLight}`, whiteSpace: 'nowrap', background: '#fff',
  };
  const subTd: React.CSSProperties = {
    padding: '6px 10px', fontSize: 11, color: theme.colors.textSecondary, verticalAlign: 'top',
  };
  return (
    <div style={{ padding: '8px 12px 12px 40px' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={subTh}>Svc</th>
            <th style={subTh}>Service</th>
            <th style={subTh}>Item</th>
            <th style={subTh}>Description</th>
            <th style={subTh}>Sidemark</th>
            <th style={{ ...subTh, textAlign: 'right' }}>Qty</th>
            <th style={{ ...subTh, textAlign: 'right' }}>Rate</th>
            <th style={{ ...subTh, textAlign: 'right' }}>Total</th>
            <th style={subTh}>Refs</th>
            <th style={subTh}>Notes</th>
          </tr>
        </thead>
        <tbody>
          {lines.map(ln => (
            <tr key={ln.ledgerRowId} style={{ borderTop: `1px solid ${theme.colors.borderLight}` }}>
              <td style={subTd}>{ln.svcCode ? <Badge t={ln.svcCode} c={SVC_CFG[ln.svcCode]} /> : ''}</td>
              <td style={subTd}>{ln.svcName || ''}</td>
              <td style={subTd}>
                {ln.itemId ? (
                  <DeepLink kind="inventory" id={ln.itemId} clientSheetId={clientSheetId} showIcon={false} size="sm" />
                ) : ''}
              </td>
              <td style={{ ...subTd, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {ln.description || ''}
              </td>
              <td style={{ ...subTd, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {ln.sidemark || '—'}
              </td>
              <td style={{ ...subTd, textAlign: 'right' }}>{ln.qty || ''}</td>
              <td style={{ ...subTd, textAlign: 'right' }}>{ln.rate ? `$${ln.rate.toFixed(2)}` : ''}</td>
              <td style={{ ...subTd, textAlign: 'right', fontWeight: 600, color: theme.colors.text }}>
                {ln.total ? `$${ln.total.toFixed(2)}` : ''}
              </td>
              <td style={subTd}>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {ln.taskId && <DeepLink kind="task" id={ln.taskId} showIcon={false} size="sm" />}
                  {ln.repairId && <DeepLink kind="repair" id={ln.repairId} showIcon={false} size="sm" />}
                  {ln.shipmentNumber && <DeepLink kind="shipment" id={ln.shipmentNumber} showIcon={false} size="sm" />}
                </div>
              </td>
              <td style={{ ...subTd, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {ln.notes || ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Invoice Line Items Subtable (nested inside expanded invoice summary row) ─

function InvoiceLineItemsSubtable({ items }: { items: BillingRow[] }) {
  const subTh: React.CSSProperties = {
    padding: '6px 10px',
    textAlign: 'left',
    fontWeight: 600,
    fontSize: 10,
    color: theme.colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    borderBottom: `1px solid ${theme.colors.borderLight}`,
    whiteSpace: 'nowrap',
    background: '#fff',
  };
  const subTd: React.CSSProperties = {
    padding: '6px 10px',
    fontSize: 11,
    color: theme.colors.textSecondary,
    verticalAlign: 'top',
  };
  return (
    <div style={{ padding: '8px 12px 12px 40px', background: '#F8FAFC' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={subTh}>Svc Code</th>
            <th style={subTh}>Service</th>
            <th style={subTh}>Description</th>
            <th style={subTh}>Item ID</th>
            <th style={subTh}>Sidemark</th>
            <th style={{ ...subTh, textAlign: 'right' }}>Qty</th>
            <th style={{ ...subTh, textAlign: 'right' }}>Rate</th>
            <th style={{ ...subTh, textAlign: 'right' }}>Total</th>
            <th style={subTh}>Notes</th>
          </tr>
        </thead>
        <tbody>
          {items.map(r => {
            const hasRate = typeof r.rate === 'number' && !isNaN(r.rate);
            const hasTotal = typeof r.total === 'number' && !isNaN(r.total);
            const safeRate = hasRate ? `$${r.rate.toFixed(2)}` : '';
            const safeTotal = hasTotal ? `$${r.total.toFixed(2)}` : '';
            const safeQty = r.qty != null && String(r.qty) !== '' ? r.qty : '';
            return (
              <tr key={r.ledgerRowId} style={{ borderTop: `1px solid ${theme.colors.borderLight}` }}>
                <td style={subTd}>
                  {r.svcCode ? <Badge t={r.svcCode} c={SVC_CFG[r.svcCode]} /> : ''}
                </td>
                <td style={subTd}>{r.svcName || ''}</td>
                <td style={{ ...subTd, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.description || ''}
                </td>
                <td style={subTd}>{r.itemId || ''}</td>
                <td style={{ ...subTd, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.sidemark || '—'}
                </td>
                <td style={{ ...subTd, textAlign: 'right' }}>{safeQty}</td>
                <td style={{ ...subTd, textAlign: 'right' }}>{safeRate}</td>
                <td style={{ ...subTd, textAlign: 'right', fontWeight: 600, color: theme.colors.text }}>{safeTotal}</td>
                <td style={{ ...subTd, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.notes || ''}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main Billing Component ──────────────────────────────────────────────────

export function Billing() {
  const { isMobile } = useIsMobile();
  const apiConfigured = isApiConfigured();
  const { apiClients, loading: clientsLoading } = useClients(apiConfigured);
  const { connected: qboConnected, pushInvoice: qboPushInvoice } = useQBO();

  // ─── Top-level tab state ──────────────────────────────────────────────────
  // Active tab persisted in the URL (?tab=report|storage|review|parity|activity|coverage)
  // so back/forward navigates between tab visits and shareable URLs reflect
  // the user's exact view.
  type BillingTab = 'report' | 'storage' | 'review' | 'parity' | 'activity' | 'coverage';
  const VALID_BILLING_TABS: readonly BillingTab[] = ['report','storage','review','parity','activity','coverage'] as const;
  const [tabRaw, setTabRaw] = useUrlState('tab', 'report');
  const activeTab: BillingTab = (VALID_BILLING_TABS as readonly string[]).includes(tabRaw) ? (tabRaw as BillingTab) : 'report';
  const setActiveTab = useCallback((next: BillingTab) => setTabRaw(next), [setTabRaw]);

  // ─── Service list from Master Price List (Supabase service_catalog) ─────────
  // Reads directly from Supabase (Master Price List is fully Supabase-native;
  // see Settings → Pricing). The previous implementation pulled this list
  // through GAS via apiFetch('getPricing') — a leftover from when the price
  // list was sheet-backed. Swapping to useServiceCatalog means new services
  // admins add via Settings → Pricing show up in this dropdown immediately,
  // INSURANCE (cron-billed monthly) is finally filterable, and we drop one
  // unnecessary GAS round-trip on every Billing-page load.
  const { services } = useServiceCatalog();
  const ALL_SERVICES = useMemo(
    () => services
      .filter(s => s.active && s.code)
      .map(s => ({ code: s.code, name: s.name, category: String(s.category || '') })),
    [services],
  );

  // Non-storage services for billing report tab
  const NON_STOR_SERVICES = useMemo(() => ALL_SERVICES.filter(s => s.code !== 'STOR'), [ALL_SERVICES]);

  // Distinct, non-empty service categories for the Category MultiSelectFilter.
  // Sorted A-Z; only categories that have at least one active service show up.
  const ALL_CATEGORIES = useMemo(
    () => Array.from(new Set(NON_STOR_SERVICES.map(s => s.category).filter(Boolean))).sort(),
    [NON_STOR_SERVICES],
  );

  // id → name map for Supabase query enrichment; name → id for clientFilter lookup
  const clientNameMap = useMemo<ClientNameMap>(() => {
    const map: ClientNameMap = {};
    for (const c of apiClients) { if (c.spreadsheetId && c.name) map[c.spreadsheetId] = c.name; }
    return map;
  }, [apiClients]);

  const clientNameToId = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const c of apiClients) { if (c.name && c.spreadsheetId) map[c.name] = c.spreadsheetId; }
    return map;
  }, [apiClients]);

  // Bug 6: Per-client payment info map so billing rows can show Auto Pay badge.
  // Billing rows only have tenant_id; autoCharge + staxCustomerId live on the client record.
  const clientPayInfoMap = useMemo<Record<string, { autoCharge: boolean; staxCustomerId: string }>>(() => {
    const map: Record<string, { autoCharge: boolean; staxCustomerId: string }> = {};
    for (const c of apiClients) {
      if (c.spreadsheetId) {
        map[c.spreadsheetId] = {
          autoCharge: c.autoCharge ?? false,
          staxCustomerId: c.staxCustomerId ?? '',
        };
      }
    }
    return map;
  }, [apiClients]);

  // Bug fix 2026-05-02: invoice-grouping was always splitting by sidemark,
  // even for clients with separate_by_sidemark=false. The fix: only include
  // sidemark in the group key when the client has the flag enabled.
  // sepBySidemarkBySheetId maps tenantId → boolean from apiClients. Defaults
  // to false when the client isn't in the map (safer to consolidate than to
  // split — a wrongly-consolidated invoice can be split, a wrongly-split
  // invoice can't be auto-merged).
  const sepBySidemarkBySheetId = useMemo<Record<string, boolean>>(() => {
    const map: Record<string, boolean> = {};
    for (const c of apiClients) {
      if (c.spreadsheetId) map[c.spreadsheetId] = c.separateBySidemark ?? false;
    }
    return map;
  }, [apiClients]);

  // Single helper for "what's the invoice-group key for this row?". Used by
  // every site that buckets billing rows by (client, optional sidemark) —
  // the report tab, the review tab, the create-invoices button label, and
  // the invoice-creation loop. Keeps grouping logic in one place so a
  // future schema change (e.g. add a "separate by reference" flag) only
  // touches this function.
  const invoiceGroupKey = useCallback((row: { sourceSheetId?: string | null; client: string; sidemark?: string | null }): string => {
    const tenantId = row.sourceSheetId || '';
    const tenant = tenantId || row.client;
    const sepFlag = tenantId ? (sepBySidemarkBySheetId[tenantId] ?? false) : false;
    const sidemarkPart = sepFlag ? (row.sidemark || '') : '';
    return tenant + '|' + sidemarkPart;
  }, [sepBySidemarkBySheetId]);

  // ─── Billing Report Tab State ─────────────────────────────────────────────
  // Use useBilling(false) to avoid auto-fetch. We also keep it around for
  // re-send invoice email which needs liveRows to lookup clientSheetId.
  const { rows: liveRows, loading: billingLoading, refetch: refetchBilling, hideUnbilled, revealUnbilled } = useBilling(false);

  const [reportData, setReportData] = useState<BillingRow[]>([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState('');
  const [reportLoaded, setReportLoaded] = useState(false);

  // Report filter state
  const today = new Date().toISOString().slice(0, 10);
  const [rptClientFilter, setRptClientFilter] = useState<string[]>([]);
  const [rptSidemarkFilter, setRptSidemarkFilter] = useState<string[]>([]);
  const [rptCategoryFilter, setRptCategoryFilter] = useState<string[]>([]);
  const [rptSvcFilter, setRptSvcFilter] = useState<string[]>([]);
  const [rptStatusFilter, setRptStatusFilter] = useState<string[]>(['Unbilled']);
  const [rptEndDate, setRptEndDate] = useState(today);

  // Service dropdown options reactively narrow when categories are selected.
  // Categories filter on service_catalog.category, so a chosen category like
  // "Repair" shrinks the Service options to just REPAIR-category services.
  // No selection → full NON_STOR_SERVICES list.
  const SVC_OPTIONS_FOR_FILTER = useMemo(() => {
    if (rptCategoryFilter.length === 0) return NON_STOR_SERVICES;
    const cats = new Set(rptCategoryFilter);
    return NON_STOR_SERVICES.filter(s => cats.has(s.category));
  }, [NON_STOR_SERVICES, rptCategoryFilter]);

  // When categories change, drop any service selections that are no longer
  // visible in the filtered dropdown. Keeps the filter params consistent with
  // what the user actually sees (no "selected service hidden behind category"
  // ghost selections).
  useEffect(() => {
    if (rptSvcFilter.length === 0) return;
    const visible = new Set(SVC_OPTIONS_FOR_FILTER.map(s => s.name));
    const stillValid = rptSvcFilter.filter(n => visible.has(n));
    if (stillValid.length !== rptSvcFilter.length) setRptSvcFilter(stillValid);
  }, [SVC_OPTIONS_FOR_FILTER, rptSvcFilter]);

  // Client / sidemark options for the filters (derived from loaded data + known clients)
  // We'll keep a running list so they survive clears
  const [knownClients, setKnownClients] = useState<string[]>([]);
  const [knownSidemarks, setKnownSidemarks] = useState<string[]>([]);

  // Derive from loaded data
  const reportClients = useMemo(() => {
    const fromData = [...new Set(reportData.map(r => r.client))].sort();
    const merged = [...new Set([...knownClients, ...fromData])].sort();
    return merged;
  }, [reportData, knownClients]);

  const reportSidemarks = useMemo(() => {
    const fromData = [...new Set(reportData.map(r => r.sidemark).filter(Boolean) as string[])].sort();
    const merged = [...new Set([...knownSidemarks, ...fromData])].sort();
    return merged;
  }, [reportData, knownSidemarks]);

  // Shared row mapper for both Supabase and GAS billing responses
  const mapBillingRows = useCallback((apiRows: BillingResponse['rows']): BillingRow[] =>
    (apiRows ?? []).map(r => {
      // Bug 6: Look up per-client autoCharge + staxCustomerId by tenant_id
      // since billing rows from Supabase don't carry these client-level fields.
      const payInfo = r.clientSheetId ? clientPayInfoMap[r.clientSheetId] : undefined;
      return {
        ledgerRowId: r.ledgerRowId, status: r.status, invoiceNo: r.invoiceNo,
        client: r.clientName, clientSheetId: r.clientSheetId, clientName: r.clientName,
        date: r.date, svcCode: r.svcCode, svcName: r.svcName,
        itemId: r.itemId, description: r.description, itemClass: r.itemClass,
        qty: r.qty, rate: r.rate ?? 0, total: r.total ?? 0,
        taskId: r.taskId, repairId: r.repairId, shipmentNo: r.shipmentNo,
        notes: r.itemNotes, sourceSheetId: r.clientSheetId,
        sidemark: r.sidemark || '', reference: r.reference || '', category: (r as any).category || '',
        // Prefer row-level value from GAS, fall back to client lookup (for Supabase path)
        staxCustomerId: (r as any).staxCustomerId || payInfo?.staxCustomerId || null,
        autoCharge: (r as any).autoCharge === true || payInfo?.autoCharge === true,
        qboStatus: r.qboStatus || null,
        qboInvoiceId: r.qboInvoiceId || null,
        invoiceDate: r.invoiceDate || '',
      };
    })
  , [clientPayInfoMap]);

  // forceGas=true → skip Supabase and go straight to GAS (used by Refresh button)
  const loadReport = useCallback(async (forceGas = false) => {
    setReportLoading(true);
    setReportError('');
    setRowSel({});
    try {
      const filters: BillingFilterParams = {};
      if (rptStatusFilter.length > 0) filters.statusFilter = rptStatusFilter;
      if (rptSvcFilter.length > 0) {
        // Convert service names back to codes for the filter
        const nameToCode = new Map(ALL_SERVICES.map(s => [s.name, s.code]));
        filters.svcFilter = rptSvcFilter.map(name => nameToCode.get(name) || name);
      }
      if (rptSidemarkFilter.length > 0) filters.sidemarkFilter = rptSidemarkFilter;
      if (rptCategoryFilter.length > 0) filters.categoryFilter = rptCategoryFilter;
      if (rptEndDate) filters.endDate = rptEndDate;
      if (rptClientFilter.length > 0) filters.clientFilter = rptClientFilter;

      let billingResponse: BillingResponse | null = null;

      // Supabase-first (fast ~50ms). Skipped when caller requests a live GAS verification.
      if (!forceGas && await isSupabaseCacheAvailable()) {
        billingResponse = await fetchBillingFromSupabaseFiltered(filters, clientNameMap);
      }

      // GAS fallback (authoritative, 3–30s)
      if (!billingResponse) {
        const res = await fetchBilling(undefined, undefined, filters);
        if (res.ok && res.data) {
          billingResponse = res.data;
        } else {
          setReportError(res.error || 'Failed to load billing data');
          setReportLoading(false);
          return;
        }
      }

      const rows = mapBillingRows(billingResponse.rows);
      setReportData(rows);
      setReportLoaded(true);
      // Track known client/sidemark options accumulated across loads
      setKnownClients(prev => [...new Set([...prev, ...rows.map(r => r.client)])].sort());
      setKnownSidemarks(prev => [...new Set([...prev, ...(rows.map(r => r.sidemark).filter(Boolean) as string[])])].sort());
    } catch (err) {
      setReportError(err instanceof Error ? err.message : String(err));
    }
    setReportLoading(false);
  }, [rptStatusFilter, rptSvcFilter, rptSidemarkFilter, rptCategoryFilter, rptEndDate, rptClientFilter, ALL_SERVICES, clientNameMap, mapBillingRows]);

  const clearReportFilters = useCallback(() => {
    setRptClientFilter([]);
    setRptSidemarkFilter([]);
    setRptCategoryFilter([]);
    setRptSvcFilter([]);
    setRptStatusFilter(['Unbilled']);
    setRptEndDate(today);
    setReportData([]);
    setReportLoaded(false);
    setReportError('');
    setRowSel({});
  }, [today]);

  // ─── Storage Charges Tab State ────────────────────────────────────────────
  const firstOfMonth = today.slice(0, 8) + '01';
  const [storClientFilter, setStorClientFilter] = useState<string[]>([]);
  const [storSidemarkFilter, setStorSidemarkFilter] = useState<string[]>([]);
  const [storStartDate, setStorStartDate] = useState(firstOfMonth);
  const [storEndDate, setStorEndDate] = useState(today);
  const [previewRows, setPreviewRows] = useState<BillingRow[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [previewTotalAmount, setPreviewTotalAmount] = useState(0);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [commitLoading, setCommitLoading] = useState(false);
  const [commitResult, setCommitResult] = useState<GenerateStorageChargesResponse | null>(null);

  // Storage tab known clients/sidemarks
  const [storKnownClients, setStorKnownClients] = useState<string[]>([]);
  const [storKnownSidemarks, setStorKnownSidemarks] = useState<string[]>([]);

  const storageClients = useMemo(() => {
    const fromData = [...new Set(previewRows.map(r => r.client))].sort();
    return [...new Set([...storKnownClients, ...fromData])].sort();
  }, [previewRows, storKnownClients]);

  // Pre-fetch sidemarks from Supabase when storage client filter changes.
  // 2026-05-03: also clear when the filter empties, otherwise the
  // dropdown carries stale cross-client values from the previous run
  // (matches the rptClientFilter effect below).
  useEffect(() => {
    if (!storClientFilter.length) { setStorKnownSidemarks([]); return; }
    const tenantIds = storClientFilter
      .map(name => apiClients.find(c => c.name === name)?.spreadsheetId)
      .filter(Boolean) as string[];
    if (!tenantIds.length) return;
    let cancelled = false;
    fetchBillingSidemarksFromSupabase(tenantIds).then(result => {
      if (cancelled) return;
      if (result) setStorKnownSidemarks(result);
    });
    return () => { cancelled = true; };
  }, [storClientFilter, apiClients]);

  const storageSidemarks = useMemo(() => {
    const fromData = [...new Set(previewRows.map(r => r.sidemark).filter(Boolean) as string[])].sort();
    return [...new Set([...storKnownSidemarks, ...fromData])].sort();
  }, [previewRows, storKnownSidemarks]);

  // Populate initial client options from billing hook.
  // 2026-05-03 fix: previously this also seeded `knownSidemarks` /
  // `storKnownSidemarks` from EVERY tenant in liveRows — so the
  // Sidemark filter dropdown listed every client's sidemarks, even
  // when the user had a single client selected. Sidemark options now
  // source ONLY from the per-tenant Supabase fetch below (scoped by
  // rptClientFilter) so each client sees only their own values, the
  // way the Inventory filter works.
  useEffect(() => {
    if (liveRows.length > 0) {
      const clients = [...new Set(liveRows.map(r => r.clientName))].filter(Boolean).sort();
      setKnownClients(prev => [...new Set([...prev, ...clients])].sort());
      setStorKnownClients(prev => [...new Set([...prev, ...clients])].sort());
    }
  }, [liveRows]);

  // Seed client names from the lightweight useClients hook (instant, already cached)
  useEffect(() => {
    if (apiClients.length > 0) {
      const names = apiClients.map(c => c.name).filter(Boolean).sort();
      setKnownClients(prev => [...new Set([...prev, ...names])].sort());
      setStorKnownClients(prev => [...new Set([...prev, ...names])].sort());
    }
  }, [apiClients]);

  // When client filter changes, fetch sidemarks from Supabase for the dropdown.
  // Does NOT load a full billing report — user must click "Load Report" for that.
  useEffect(() => {
    if (!rptClientFilter?.length) { setKnownSidemarks([]); return; }
    const tenantIds = rptClientFilter.map(name => clientNameToId[name]).filter(Boolean) as string[];
    if (!tenantIds.length) return;
    let cancelled = false;
    fetchBillingSidemarksFromSupabase(tenantIds).then(result => {
      if (cancelled) return;
      if (result) setKnownSidemarks(result);
    });
    return () => { cancelled = true; };
  }, [rptClientFilter, clientNameToId]);

  // Track whether storage filters changed since last preview
  const [lastStorPreviewKey, setLastStorPreviewKey] = useState('');
  const currentStorKey = useMemo(() => [storClientFilter.join(','), storSidemarkFilter.join(','), storStartDate, storEndDate].join('|'), [storClientFilter, storSidemarkFilter, storStartDate, storEndDate]);
  const storFiltersChanged = previewLoaded && currentStorKey !== lastStorPreviewKey;

  const handlePreviewStorage = useCallback(async () => {
    setPreviewLoading(true);
    setPreviewError('');
    setCommitResult(null);
    setRowSel({});

    try {
      // Pick a single tenant filter only when exactly one client is
      // selected — Postgres can scan all tenants in one shot, so we
      // fan out client-side instead of issuing N parallel RPCs for
      // a multi-select. Same for sidemark.
      const onlyTenant = storClientFilter.length === 1
        ? apiClients.find(c => c.name === storClientFilter[0])?.spreadsheetId ?? null
        : null;
      const onlySidemark = storSidemarkFilter.length === 1 ? storSidemarkFilter[0] : null;

      const sbRows = await fetchStoragePreviewFromSupabase({
        tenantId: onlyTenant,
        sidemark: onlySidemark,
        periodStart: storStartDate,
        periodEnd: storEndDate,
      });
      if (sbRows === null) {
        setPreviewError('Preview failed (Supabase RPC unavailable)');
        setPreviewLoading(false);
        return;
      }

      // Client-side filter for multi-select cases the RPC ignored.
      const clientSet = new Set(storClientFilter);
      const sidemarkSet = new Set(storSidemarkFilter);
      const filtered = sbRows.filter(r => {
        if (storClientFilter.length > 1 && !clientSet.has(r.clientName)) return false;
        if (storSidemarkFilter.length > 1 && !sidemarkSet.has(r.sidemark)) return false;
        return true;
      });

      // v38.186.0 — index apiClients by tenantId/name once so each preview
      // row can pick up the client's `autoCharge` + `staxCustomerId` and
      // the Client column renderer (line ~1686) can paint the Auto Pay
      // and CC-on-file pills. Without these the storage preview shows a
      // bare client name with no payment-method indicator, so the operator
      // can't tell at a glance who needs to be pushed to Payments vs.
      // billed manually with Net-N terms.
      const clientByTenant = new Map<string, typeof apiClients[number]>();
      const clientByName = new Map<string, typeof apiClients[number]>();
      for (const c of apiClients) {
        if (c.spreadsheetId) clientByTenant.set(c.spreadsheetId, c);
        if (c.name) clientByName.set(c.name.toLowerCase(), c);
      }
      const rows: BillingRow[] = filtered.map((r: StoragePreviewRow) => {
        const client = clientByTenant.get(r.tenantId)
          || clientByName.get((r.clientName || '').toLowerCase())
          || null;
        return {
          ledgerRowId: r.taskId,
          status: 'Preview',
          invoiceNo: '',
          client: r.clientName,
          clientSheetId: r.tenantId,
          clientName: r.clientName,
          date: r.billableEnd,             // already YYYY-MM-DD from Postgres
          svcCode: 'STOR',
          svcName: 'Storage',
          itemId: r.itemId,
          description: r.description,
          itemClass: r.itemClass,
          qty: r.billableDays,
          rate: r.dailyRate,
          total: r.totalCharge,
          taskId: r.taskId,
          repairId: '',
          shipmentNo: r.shipmentNo,
          notes: r.notes,
          sourceSheetId: r.tenantId,
          sidemark: r.sidemark,
          // Plumb client-level payment-method state. The Client column
          // renderer treats both as optional (only shows the pill when
          // truthy), so unmatched rows degrade gracefully.
          autoCharge: client?.autoCharge ?? false,
          staxCustomerId: client?.staxCustomerId ?? '',
        };
      });

      setPreviewRows(rows);
      setPreviewTotalAmount(rows.reduce((s, r) => s + r.total, 0));
      setPreviewLoaded(true);
      setLastStorPreviewKey(currentStorKey);
      setStorKnownClients(prev => {
        const fromRows = rows.map(r => r.client);
        return [...new Set([...prev, ...fromRows])].sort();
      });
      setStorKnownSidemarks(prev => {
        const fromRows = rows.map(r => r.sidemark).filter(Boolean) as string[];
        return [...new Set([...prev, ...fromRows])].sort();
      });
    } catch (err) {
      setPreviewError(`Preview error: ${err instanceof Error ? err.message : String(err)}`);
    }
    setPreviewLoading(false);
  }, [storStartDate, storEndDate, storClientFilter, storSidemarkFilter, apiClients, currentStorKey]);

  const handleCommitPreview = useCallback(async () => {
    setCommitLoading(true);
    try {
      if (!previewRows.length) {
        setPreviewError('No rows to commit. Click Preview Storage first.');
        setCommitLoading(false);
        return;
      }

      // Hand the pre-computed rows to GAS so the GS-side Billing_Ledger
      // gets the same writes (and triggers Supabase write-through). The
      // commit endpoint skips the slow read+compute phase that used to
      // time out on big clients.
      const payloadRows = previewRows.map(r => ({
        tenantId: r.sourceSheetId || r.clientSheetId || '',
        clientName: r.client || r.clientName || '',
        itemId: r.itemId,
        description: r.description,
        itemClass: r.itemClass,
        sidemark: r.sidemark || '',
        qty: r.qty,
        rate: r.rate,
        total: r.total,
        taskId: r.taskId,
        notes: r.notes,
        billableEnd: r.date,
        shipmentNo: r.shipmentNo,
      })).filter(r => r.tenantId);

      if (!payloadRows.length) {
        setPreviewError('Preview rows are missing tenant ids — re-run Preview.');
        setCommitLoading(false);
        return;
      }

      const res = await postCommitStorageRows({
        periodStart: storStartDate,
        periodEnd: storEndDate,
        rows: payloadRows,
      });
      if (res.error || !res.data?.success) {
        setPreviewError(res.data?.error || res.error || 'Commit failed');
      } else {
        setCommitResult(res.data);
        refetchBilling();
      }
    } catch (err) {
      setPreviewError(`Commit error: ${err instanceof Error ? err.message : String(err)}`);
    }
    setCommitLoading(false);
  }, [storStartDate, storEndDate, previewRows, refetchBilling]);

  // QB Export state
  const [qbLoading, setQbLoading] = useState(false);
  const [qbResult, setQbResult] = useState<{ fileName?: string; fileUrl?: string; invoiceCount?: number; lineCount?: number; error?: string } | null>(null);

  // QBO Push state
  const [qboResult, setQboResult] = useState<{ success?: string; error?: string; details?: Array<{ strideInvoiceNumber: string; error?: string; success?: boolean; qboInvoiceId?: string }>; retryIds?: string[] } | null>(null);
  const [qboRetrying, setQboRetrying] = useState(false);

  // Create Invoice state
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  // 2026-05-04 — invoiceMode lets the same Create Invoice modal serve both
  // the Report tab (invoice already-committed Unbilled rows) and the Storage
  // tab (commit preview rows to the ledger AND invoice them in one flow).
  // 'storage' mode prepends a postCommitStorageRows call before the
  // existing per-group postCreateInvoice loop. Same modal copy + result UI.
  const [invoiceMode, setInvoiceMode] = useState<'report' | 'storage'>('report');
  // 2026-05-02 — defaults flipped to false. New flow: invoice creation skips
  // the Drive Doc PDF (Drive's auto-reformatting was hurting output quality)
  // and the matching email. The invoice URL stored on the ledger now points at
  // the React /#/invoices/:invoiceNo page, which renders from `billing` rows
  // and supports browser print → save-as-PDF for downloadable reference.
  // Operators can still re-check both boxes for the legacy Drive PDF + email
  // path when needed.
  // Session 93: invOptPdf was removed — PDFs are now always generated by
  // the React side and stored in the Supabase `invoices` bucket. The
  // legacy Drive PDF flow only fires when the operator wants email
  // (skipPdf is keyed off invOptEmail in the create call).
  const [invOptEmail, setInvOptEmail] = useState(false);
  const [invOptQbo, setInvOptQbo] = useState(false);
  const [invOptStax, setInvOptStax] = useState(false);
  const invOptQb = false; // QB Export removed — checkbox no longer exists
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  // v38.184.0 — When set, the modal renders the "Started!" confirmation
  // (instead of the loading spinner) and auto-closes ~2s later. Distinct
  // from invoiceLoading which is only true during the synchronous preflight
  // (validation, group build, storage commit). Once preflight succeeds and
  // the batch is registered with billingBatch, invoiceLoading flips to
  // false and invoiceStartedAt flips to a timestamp — the modal shows the
  // green confirmation, the bottom-right toast takes over progress display.
  const [invoiceStartedAt, setInvoiceStartedAt] = useState<number | null>(null);
  const [invoiceBatch, setInvoiceBatch] = useState<{ state: BatchState; total: number; processed: number; succeeded: number; failed: number }>({
    state: 'idle', total: 0, processed: 0, succeeded: 0, failed: 0,
  });
  const [invoiceBulkResult, setInvoiceBulkResult] = useState<BatchMutationResult | null>(null);
  const [invoiceResults, setInvoiceResults] = useState<Array<CreateInvoiceResponse & { client: string }> | null>(null);
  const [invoiceError, setInvoiceError] = useState('');

  // v38.188.0 — "Void Selected" modal state. Backs the bulk-void affordance on
  // the Billing → Report tab (Unbilled rows only). Multi-tenant aware: a single
  // confirm fans out one postVoidUnbilledRows call per (sourceSheetId) group.
  const [showVoidModal, setShowVoidModal] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [voidLoading, setVoidLoading] = useState(false);
  const [voidResult, setVoidResult] = useState<{ ok: boolean; voided: number; rejected: number; notFound: number; alreadyVoid: number; perGroup: { client: string; voided: number; error?: string }[] } | null>(null);

  // ─── Table state ──────────────────────────────────────────────────────────
  const { sorting, setSorting, colVis, setColVis, columnOrder, setColumnOrder } = useTablePreferences('billing', [{ id: 'date', desc: true }], {}, DEFAULT_COL_ORDER, ['Unbilled']);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [rowSel, setRowSel] = useState<RowSelectionState>({});
  const [showCols, setShowCols] = useState(false);
  const [dragColId, setDragColId] = useState<string | null>(null);
  const [dragOverColId, setDragOverColId] = useState<string | null>(null);
  const [selectedBillingRow, setSelectedBillingRow] = useState<BillingRow | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => { if (!reportLoading && !billingLoading && refreshing) setRefreshing(false); }, [reportLoading, billingLoading, refreshing]);
  const menuRef = useRef<HTMLDivElement>(null);

  // ─── Manual charges (v38.77.0) — auth + modal state. The useCallbacks
  //     that depend on showToast / loadReport are defined further down,
  //     after those identifiers exist.
  const { user } = useAuth();
  // v38.184.0 — Background invoice batches. Modal closes ~2s after Submit
  // ("Started!" confirmation), the rest of the batch runs in JS-runtime
  // background driven by the context's state setters (which stay alive
  // even if the operator navigates to Inventory / Tasks mid-batch). The
  // bottom-right toast (in AppLayout) reads from this context. The Status
  // column's per-row "Invoicing…" badge reads `invoicingLedgerIds` from
  // the same context.
  const billingBatch = useBillingBatch();
  const canManageManualCharges = user?.role === 'admin' || user?.role === 'staff';
  const [showAddCharge, setShowAddCharge] = useState(false);
  const [editingManualCharge, setEditingManualCharge] = useState<ManualChargeEditTarget | null>(null);

  // ─── Inline edit support (storage preview tab) ────────────────────────────
  const updatePreviewRow = useCallback((ledgerRowId: string, field: keyof BillingRow, value: string) => {
    setPreviewRows(prev => {
      const updated = prev.map(r => {
        if (r.ledgerRowId !== ledgerRowId) return r;
        if (field === 'rate') { const rate = parseFloat(value) || 0; return { ...r, rate, total: rate * r.qty }; }
        if (field === 'qty') { const qty = parseFloat(value) || 0; return { ...r, qty, total: r.rate * qty }; }
        return { ...r, [field]: value };
      });
      setPreviewTotalAmount(updated.reduce((s, r) => s + r.total, 0));
      return updated;
    });
  }, []);

  // ─── Determine which data + mode the table uses ───────────────────────────
  const isStorageTab = activeTab === 'storage';
  const isReportTab = activeTab === 'report';
  const isPreviewMode = isStorageTab && previewLoaded;

  // Invoice-list view: expansion state + selection state for the invoice summary table
  const [expandedInvoices, setExpandedInvoices] = useState<Set<string>>(new Set());
  const [invoicedRowSel, setInvoicedRowSel] = useState<RowSelectionState>({});

  // Split report data into two sections: unbilled line items vs grouped invoices
  const billingSections = useMemo(() => {
    const unbilledRows: BillingRow[] = [];
    type BuilderGroup = InvoiceGroup & { _sidemarks: Set<string>; _qboStatuses: Set<string>; _dates: string[]; _invoiceDates: Set<string>; _autoCharges: Set<boolean>; _staxIds: Set<string> };
    const groupMap: Record<string, BuilderGroup> = {};
    const order: string[] = [];
    for (const r of reportData) {
      if (!r.invoiceNo) {
        unbilledRows.push(r);
        continue;
      }
      if (!groupMap[r.invoiceNo]) {
        groupMap[r.invoiceNo] = {
          invoiceNo: r.invoiceNo,
          status: r.status,
          client: r.client,
          sidemark: '',
          date: '',
          invoiceDate: '',
          total: 0,
          qboStatus: null,
          qboInvoiceId: r.qboInvoiceId || null,
          sourceSheetId: r.sourceSheetId,
          clientSheetId: r.clientSheetId,
          lineItems: [],
          autoCharge: undefined,
          staxCustomerId: null,
          _sidemarks: new Set<string>(),
          _qboStatuses: new Set<string>(),
          _dates: [],
          _invoiceDates: new Set<string>(),
          _autoCharges: new Set<boolean>(),
          _staxIds: new Set<string>(),
        };
        order.push(r.invoiceNo);
      }
      const g = groupMap[r.invoiceNo];
      g.lineItems.push(r);
      g.total += r.total;
      if (r.sidemark) g._sidemarks.add(r.sidemark);
      if (r.qboStatus) g._qboStatuses.add(r.qboStatus);
      if (r.date) g._dates.push(r.date);
      if (r.invoiceDate) g._invoiceDates.add(r.invoiceDate);
      if (r.autoCharge !== undefined) g._autoCharges.add(r.autoCharge);
      if (r.staxCustomerId) g._staxIds.add(r.staxCustomerId);
    }
    const invoicedGroups: InvoiceGroup[] = order.map(k => {
      const g = groupMap[k];
      const sidemarks = [...g._sidemarks];
      const qboStatuses = [...g._qboStatuses];
      const dates = g._dates.slice().sort();
      const invoiceDates = [...g._invoiceDates].sort();
      const autoCharges = [...g._autoCharges];
      const staxIds = [...g._staxIds];
      return {
        invoiceNo: g.invoiceNo,
        status: g.status,
        client: g.client,
        sidemark: sidemarks.length === 1 ? sidemarks[0] : (sidemarks.length > 1 ? 'Multiple' : ''),
        date: dates[0] || '',
        // Prefer invoiceDate (creation date) over service date; fall back to earliest service date
        invoiceDate: invoiceDates[0] || dates[0] || '',
        total: g.total,
        qboStatus: qboStatuses.length === 1 ? qboStatuses[0] : (qboStatuses.length > 1 ? 'Mixed' : null),
        qboInvoiceId: qboStatuses.length === 1 ? g.qboInvoiceId : null,
        sourceSheetId: g.sourceSheetId,
        clientSheetId: g.clientSheetId,
        lineItems: g.lineItems,
        // All line items in a group share a client, so autoCharge is consistent
        autoCharge: autoCharges.length > 0 ? autoCharges[0] : undefined,
        staxCustomerId: staxIds[0] || null,
      };
    });
    return { unbilledRows, invoicedGroups };
  }, [reportData]);

  // Reset expansion + both selection states whenever underlying data reloads
  useEffect(() => {
    setExpandedInvoices(new Set());
    setRowSel({});
    setInvoicedRowSel({});
  }, [reportData]);

  // Report tab shows the unbilled ledger table (invoiced rows live in the
  // separate invoice summary table below). Storage tab shows preview rows.
  const tableData = useMemo(() => {
    if (isStorageTab) return previewRows;
    return billingSections.unbilledRows;
  }, [isStorageTab, previewRows, billingSections]);

  // ─── Report tab inline edit — optimistic update + backend persist ─────────
  const [toast, setToast] = useState<string | null>(null);
  const showToast = useCallback((msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000); }, []);

  // Manual charge callbacks (defined here so they can reference showToast +
  // loadReport, which exist by this point in the component body).
  const handleManualChargeSaved = useCallback((msg: string) => {
    showToast(msg);
    if (reportLoaded) void loadReport(true);
  }, [reportLoaded, loadReport, showToast]);

  const handleVoidManualCharge = useCallback(async (row: BillingRow) => {
    if (!row.clientSheetId || !row.ledgerRowId.startsWith('MANUAL-')) return;
    const res = await postVoidManualCharge(row.ledgerRowId, row.clientSheetId);
    if (res.ok && res.data?.success) {
      showToast(`Charge voided — ${row.svcName}`);
      setSelectedBillingRow(null);
      if (reportLoaded) void loadReport(true);
    } else {
      showToast(res.error || res.data?.error || 'Void failed');
    }
  }, [reportLoaded, loadReport, showToast]);

  const openEditManualCharge = useCallback((row: BillingRow) => {
    setEditingManualCharge({
      ledgerRowId: row.ledgerRowId,
      clientSheetId: row.clientSheetId || row.sourceSheetId || '',
      clientName: row.clientName || row.client || '',
      svcCode: row.svcCode,
      svcName: row.svcName,
      itemClass: row.itemClass,
      qty: row.qty,
      rate: row.rate,
      description: row.description,
      notes: row.notes,
      sidemark: row.sidemark || '',
    });
    setSelectedBillingRow(null);
  }, []);

  const saveReportField = useCallback(async (row: BillingRow, field: string, value: string) => {
    // Resolve clientSheetId — primary path is the row itself, but Supabase-
    // sourced rows occasionally arrive without it (older mirror writes
    // before tenant_id was always populated). Fall back to looking up the
    // client by name so the save doesn't silently no-op the way it used to.
    let targetSheetId = row.clientSheetId || row.sourceSheetId || '';
    if (!targetSheetId && row.client) {
      const match = apiClients.find(c => c.name === row.client);
      if (match) targetSheetId = match.spreadsheetId;
    }
    if (!targetSheetId) {
      showToast(`Save failed: couldn't resolve client sheet for ${row.client || row.ledgerRowId} — refresh and retry`);
      return;
    }
    const payload: Record<string, unknown> = { ledgerRowId: row.ledgerRowId };
    if (field === 'sidemark') payload.sidemark = value;
    else if (field === 'reference') payload.reference = value;
    else if (field === 'description') payload.description = value;
    else if (field === 'rate') payload.rate = parseFloat(value) || 0;
    else if (field === 'qty') payload.qty = parseFloat(value) || 1;
    else if (field === 'total') payload.total = parseFloat(value) || 0;
    else if (field === 'notes') payload.notes = value;
    else return;

    // Optimistic local update
    const oldRow = { ...row };
    if (field === 'rate') {
      const newRate = parseFloat(value) || 0;
      setReportData(prev => prev.map(r => r.ledgerRowId === row.ledgerRowId ? { ...r, rate: newRate, total: newRate * r.qty } : r));
    } else if (field === 'qty') {
      const newQty = parseFloat(value) || 1;
      setReportData(prev => prev.map(r => r.ledgerRowId === row.ledgerRowId ? { ...r, qty: newQty, total: r.rate * newQty } : r));
    } else if (field === 'total') {
      // Manual override — write the typed total verbatim, leave rate/qty
      // alone. Lets staff hand-adjust an invoice line for special-case
      // pricing without touching the underlying rate/qty fields (which
      // drive other reports).
      const newTotal = parseFloat(value) || 0;
      setReportData(prev => prev.map(r => r.ledgerRowId === row.ledgerRowId ? { ...r, total: newTotal } : r));
    } else {
      setReportData(prev => prev.map(r => r.ledgerRowId === row.ledgerRowId ? { ...r, [field]: value } : r));
    }

    // Backend persist — GAS writes the sheet, then writeThrough mirrors to
    // Supabase so the next reload sees the new value. On failure we revert
    // the optimistic local edit and surface a toast (was silently dropping
    // saves when clientSheetId was missing on the row, since fixed above).
    const resp = await postUpdateBillingRow(payload as any, targetSheetId);
    if (!resp.ok || !resp.data?.success) {
      // Revert
      setReportData(prev => prev.map(r => r.ledgerRowId === row.ledgerRowId ? oldRow : r));
      showToast('Save failed: ' + (resp.error || resp.data?.error || 'Unknown error'));
    } else {
      // Echo the local mutation to entityEvents so other consumers
      // (Invoice Review tab, BatchDataContext) refetch from the now-updated
      // Supabase mirror without waiting on the realtime push.
      entityEvents.emit('billing', String(row.ledgerRowId));
    }
  }, [showToast, apiClients]);

  // ─── Columns ──────────────────────────────────────────────────────────────
  // createColumnHelper produces a fresh helper instance on every render
  // unless memoized. Without this, the columns useMemo below captures a
  // new col reference each render and any consumer that depends on
  // column identity (memo comparators, ref equality in TanStack) churns.
  const col = useMemo(() => createColumnHelper<BillingRow>(), []);
  const columns = useMemo(() => {
    const isEditable = isPreviewMode;
    return [
      col.display({
        id: 'select',
        header: ({ table }) => <input type="checkbox" checked={table.getIsAllPageRowsSelected()} onChange={table.getToggleAllPageRowsSelectedHandler()} style={{ cursor: 'pointer', accentColor: theme.colors.orange }} />,
        cell: ({ row }) => <input type="checkbox" checked={row.getIsSelected()} onChange={row.getToggleSelectedHandler()} style={{ cursor: 'pointer', accentColor: theme.colors.orange }} />,
        size: 40,
        enableSorting: false,
      }),
      col.accessor('ledgerRowId', { header: 'Ledger ID', size: 100, cell: i => <span style={{ fontWeight: 600, fontSize: 12 }}>{i.getValue()}</span> }),
      col.accessor('status', { header: 'Status', size: 110, filterFn: mf, cell: i => {
        const v = i.getValue();
        // v38.184.0 — Optimistic "Invoicing…" badge. While a batch is in
        // flight, rows whose ledger_row_id is in invoicingLedgerIds render
        // an animated pill instead of their real status. Once the per-row
        // postCreateInvoice POST returns, billingBatch.recordInvoice removes
        // the ID from the set and the row falls back to its real status
        // from the writeThrough mirror (which by then says "Invoiced").
        const lid = i.row.original.ledgerRowId;
        if (lid && billingBatch.invoicingLedgerIds.has(lid)) {
          return (
            <span
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                background: '#FFFBEB', color: '#92400E', border: '1.5px solid #FDE68A',
                whiteSpace: 'nowrap',
                animation: 'pulse 1.5s ease-in-out infinite',
              }}
              title="Invoice creation in progress — flips to Invoiced on commit"
            >
              <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} />
              Invoicing…
            </span>
          );
        }
        if (v === 'Preview') return <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: '#FFFDE7', color: '#F59E0B', border: '1.5px dashed #F59E0B', whiteSpace: 'nowrap' }}>Preview</span>;
        return <Badge t={v} c={STATUS_CFG[v]} />;
      } }),
      col.accessor('invoiceNo', { header: 'Invoice #', size: 110, cell: i => (
        <DeepLink
          kind="invoice"
          id={i.getValue()}
          clientSheetId={i.row.original.clientSheetId || i.row.original.sourceSheetId}
          size="sm"
          showIcon={false}
        />
      ) }),
      col.accessor('client', { header: 'Client', size: 160, filterFn: mf, cell: i => {
        const auto = i.row.original.autoCharge;
        const hasStax = !!i.row.original.staxCustomerId;
        return <span style={{ fontWeight: 500, fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {i.getValue()}
          {hasStax && <span title="Stax payment on file" style={{ display: 'inline-flex', flexShrink: 0 }}><CreditCard size={11} color="#15803D" /></span>}
          {auto && <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 4, background: '#F0FDF4', color: '#15803D', fontWeight: 700 }}>Auto Pay</span>}
        </span>;
      } }),
      col.accessor('sidemark', { header: 'Sidemark', size: 140, filterFn: mf, cell: i => {
        // Editable: report-tab Unbilled rows OR storage-tab preview rows.
        // Storage edits update local previewRows via updatePreviewRow so the
        // commit + invoice loop carries the operator's value through to the
        // ledger row write (matters because clients with separate_by_sidemark
        // group invoices by sidemark \u2014 picking the right value here decides
        // which invoice the row lands on).
        const canEditReport = isReportTab && i.row.original.status === 'Unbilled';
        const canEditStorage = isPreviewMode;
        if (canEditReport) return <EditableCell value={i.getValue() || ''} onChange={v => saveReportField(i.row.original, 'sidemark', v)} />;
        if (canEditStorage) return <EditableCell value={i.getValue() || ''} onChange={v => updatePreviewRow(i.row.original.ledgerRowId, 'sidemark', v)} />;
        return <span style={{ fontSize: 12, color: theme.colors.textSecondary }}>{i.getValue() || '\u2014'}</span>;
      } }),
      col.accessor('reference', {
        header: 'Reference', size: 130, filterFn: mf,
        cell: i => {
          const canEditReport = isReportTab && i.row.original.status === 'Unbilled';
          const canEditStorage = isPreviewMode;
          if (canEditReport) return <EditableCell value={i.getValue() || ''} onChange={v => saveReportField(i.row.original, 'reference', v)} />;
          if (canEditStorage) return <EditableCell value={i.getValue() || ''} onChange={v => updatePreviewRow(i.row.original.ledgerRowId, 'reference', v)} />;
          return <span style={{ fontSize: 12, color: theme.colors.textSecondary, fontFamily: 'monospace' }}>{i.getValue() || '\u2014'}</span>;
        },
      }),
      col.accessor('date', { header: 'Date', size: 100, cell: i => <span style={{ fontSize: 12, color: theme.colors.textSecondary }}>{fmt(i.getValue())}</span> }),
      col.accessor('svcCode', { header: 'Svc Code', size: 90, filterFn: mf, cell: i => <Badge t={i.getValue()} c={SVC_CFG[i.getValue()]} /> }),
      col.accessor('svcName', { header: 'Service', size: 100, cell: i => <span style={{ fontSize: 12, color: theme.colors.textSecondary }}>{i.getValue()}</span> }),
      col.accessor('itemId', { header: 'Item', size: 90, cell: i => (
        <DeepLink
          kind="inventory"
          id={i.getValue()}
          clientSheetId={i.row.original.clientSheetId || i.row.original.sourceSheetId}
          size="sm"
          showIcon={false}
        />
      ) }),
      col.accessor('description', { header: 'Description', size: 220, cell: i => {
        const canEdit = isReportTab && i.row.original.status === 'Unbilled';
        return canEdit
          ? <EditableCell value={i.getValue() || ''} onChange={v => saveReportField(i.row.original, 'description', v)} />
          : <span style={{ color: theme.colors.textSecondary, fontSize: 12, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{i.getValue()}</span>;
      } }),
      col.accessor('qty', {
        header: 'Qty', size: 70,
        cell: i => {
          if (isEditable) return <EditableCell value={i.getValue()} type="number" align="right" currency={false} onChange={v => updatePreviewRow(i.row.original.ledgerRowId, 'qty', v)} />;
          const canEdit = isReportTab && i.row.original.status === 'Unbilled';
          return canEdit
            ? <EditableCell value={i.getValue()} type="number" align="right" currency={false} onChange={v => saveReportField(i.row.original, 'qty', v)} />
            : <span style={{ fontSize: 12 }}>{i.getValue()}</span>;
        },
      }),
      col.accessor('rate', {
        header: 'Rate', size: 90,
        cell: i => {
          if (isEditable) return <EditableCell value={i.getValue()} type="number" align="right" onChange={v => updatePreviewRow(i.row.original.ledgerRowId, 'rate', v)} />;
          const canEdit = isReportTab && i.row.original.status === 'Unbilled';
          return canEdit
            ? <EditableCell value={i.getValue()} type="number" align="right" onChange={v => saveReportField(i.row.original, 'rate', v)} />
            : <span style={{ fontSize: 12, color: theme.colors.textSecondary }}>${i.getValue().toFixed(2)}</span>;
        },
      }),
      col.accessor('total', {
        header: 'Total', size: 90,
        cell: i => {
          const canEdit = isReportTab && i.row.original.status === 'Unbilled';
          return canEdit
            ? <EditableCell value={i.getValue()} type="number" align="right" onChange={v => saveReportField(i.row.original, 'total', v)} />
            : <span style={{ fontSize: 12, fontWeight: 600, color: theme.colors.text }}>${i.getValue().toFixed(2)}</span>;
        },
      }),
      col.accessor('taskId', { header: 'Task', size: 90, cell: i => {
        const v = String(i.getValue() || '').trim();
        // Task IDs in billing rows can carry an addon suffix like
        // INSP-12345-1-ADDON-2 (per the v38.143.0 task-addons feature).
        // Strip the -ADDON-N tail before linking \u2014 the parent task panel
        // shows the addon line in its Billing tab.
        const linkId = v.replace(/-ADDON-\d+$/, '');
        return (
          <DeepLink
            kind="task"
            id={linkId}
            clientSheetId={i.row.original.clientSheetId || i.row.original.sourceSheetId}
            size="sm"
            showIcon={false}
          />
        );
      } }),
      col.accessor('notes', {
        header: 'Notes', size: 180,
        cell: i => {
          if (isEditable) return <EditableCell value={i.getValue()} onChange={v => updatePreviewRow(i.row.original.ledgerRowId, 'notes', v)} />;
          const canEdit = isReportTab && i.row.original.status === 'Unbilled';
          return canEdit
            ? <EditableCell value={i.getValue() || ''} onChange={v => saveReportField(i.row.original, 'notes', v)} />
            : <span style={{ color: theme.colors.textSecondary, fontSize: 12, maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{i.getValue() || '\u2014'}</span>;
        },
      }),
      col.accessor('qboStatus', {
        header: 'QBO', size: 80,
        cell: i => {
          const qs = i.getValue();
          const qid = i.row.original.qboInvoiceId;
          if (!qs && !qid) return <span style={{ fontSize: 11, color: theme.colors.textMuted }}>{'\u2014'}</span>;
          const isPushed = qs === 'Pushed' || (!qs && qid);
          const isFailed = qs === 'Failed';
          return (
            <span
              title={isPushed ? `QBO ID: ${qid || 'unknown'}` : isFailed ? 'Push failed — click to clear and retry' : qs || ''}
              onClick={isFailed ? async () => {
                if (!confirm('Clear QBO Failed status and QBO Invoice ID so you can re-push?')) return;
                try {
                  await postUpdateQboStatus([i.row.original.ledgerRowId], '', true);
                  loadReport();
                } catch (_) {}
              } : undefined}
              style={{
                fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
                background: isPushed ? '#F0FDF4' : isFailed ? '#FEF2F2' : '#F8FAFC',
                color: isPushed ? '#15803D' : isFailed ? '#991B1B' : '#64748B',
                cursor: isFailed ? 'pointer' : 'default',
                display: 'inline-block',
              }}
            >
              {isPushed ? '✓ Pushed' : isFailed ? '✗ Failed' : qs || ''}
            </span>
          );
        },
      }),
    ];
  }, [isPreviewMode, isReportTab, col, updatePreviewRow, saveReportField, billingBatch.invoicingLedgerIds]);

  // ─── Report summary stats ─────────────────────────────────────────────────
  const reportTotal = useMemo(() => reportData.reduce((s, r) => s + r.total, 0), [reportData]);
  // Distinct-count by clientSheetId (always unique per tenant) rather than
  // display name; otherwise two distinct clients with the same name would
  // collapse into one in the count.
  const reportClientCount = useMemo(
    () => new Set(reportData.map(r => r.clientSheetId || r.client)).size,
    [reportData]
  );
  const reportRowCount = reportData.length;

  const table = useReactTable({
    data: tableData, columns,
    state: { sorting, columnFilters, globalFilter, columnVisibility: colVis, rowSelection: rowSel, columnOrder: columnOrder.length ? columnOrder : DEFAULT_COL_ORDER },
    onSortingChange: setSorting, onColumnFiltersChange: setColumnFilters, onGlobalFilterChange: setGlobalFilter, onColumnVisibilityChange: setColVis, onRowSelectionChange: setRowSel,
    onColumnOrderChange: (updater) => setColumnOrder(typeof updater === 'function' ? updater(columnOrder.length ? columnOrder : DEFAULT_COL_ORDER) : updater),
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getFilteredRowModel: getFilteredRowModel(),
    enableMultiSort: true,
    globalFilterFn: tanstackGlobalFilter as FilterFn<BillingRow>,
  });

  const { containerRef, virtualRows, rows: allRows, totalHeight } = useVirtualRows(table);

  // ─── Invoice Summary Table (second TanStack instance for invoice-list view) ─
  const invCol = createColumnHelper<InvoiceGroup>();
  const invoiceSummaryColumns = useMemo(() => [
    invCol.display({
      id: 'select',
      header: ({ table: t }) => <input type="checkbox" checked={t.getIsAllPageRowsSelected()} onChange={t.getToggleAllPageRowsSelectedHandler()} style={{ cursor: 'pointer', accentColor: theme.colors.orange }} />,
      cell: ({ row }) => {
        const invNo = row.original.invoiceNo;
        const isOpen = expandedInvoices.has(invNo);
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input
              type="checkbox"
              checked={row.getIsSelected()}
              onChange={row.getToggleSelectedHandler()}
              onClick={e => e.stopPropagation()}
              style={{ cursor: 'pointer', accentColor: theme.colors.orange }}
            />
            <span
              onClick={e => {
                e.stopPropagation();
                setExpandedInvoices(prev => {
                  const next = new Set(prev);
                  if (isOpen) next.delete(invNo); else next.add(invNo);
                  return next;
                });
              }}
              style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 18, height: 18, color: theme.colors.orange }}
              title={isOpen ? 'Collapse line items' : 'Expand line items'}
            >
              {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </span>
          </div>
        );
      },
      size: 60,
      enableSorting: false,
    }),
    invCol.accessor('status', {
      header: 'Status', size: 100,
      cell: i => <Badge t={i.getValue()} c={STATUS_CFG[i.getValue()]} />,
    }),
    invCol.accessor('invoiceNo', {
      header: 'Invoice #', size: 120,
      cell: i => (
        <DeepLink
          kind="invoice"
          id={i.getValue()}
          clientSheetId={i.row.original.clientSheetId || i.row.original.sourceSheetId}
          size="sm"
          showIcon={false}
          style={{ fontWeight: 700 }}
        />
      ),
    }),
    invCol.accessor('client', {
      header: 'Client', size: 200,
      cell: i => {
        const row = i.row.original;
        const hasStax = !!row.staxCustomerId;
        const hasAutoPay = row.autoCharge !== false && hasStax;
        return (
          <span style={{ fontSize: 12, fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {i.getValue()}
            {hasStax && (
              <span title="Stax payment on file" style={{ display: 'inline-flex', flexShrink: 0 }}>
                <CreditCard size={11} color="#15803D" />
              </span>
            )}
            {hasAutoPay && (
              <span
                style={{
                  marginLeft: 2, fontSize: 9, padding: '1px 5px', borderRadius: 4,
                  background: '#F0FDF4', color: '#15803D', fontWeight: 700,
                  whiteSpace: 'nowrap',
                }}
                title="Auto Pay enabled"
              >
                Auto Pay
              </span>
            )}
          </span>
        );
      },
    }),
    invCol.accessor('sidemark', {
      header: 'Sidemark', size: 140,
      cell: i => {
        const v = i.getValue();
        if (v === 'Multiple') return <span style={{ fontSize: 12, fontStyle: 'italic', color: theme.colors.textMuted }}>Multiple</span>;
        return <span style={{ fontSize: 12, color: theme.colors.textSecondary }}>{v || '\u2014'}</span>;
      },
    }),
    invCol.accessor('invoiceDate', {
      header: 'Invoice Date', size: 110,
      cell: i => <span style={{ fontSize: 12, color: theme.colors.textSecondary }}>{fmt(i.getValue())}</span>,
    }),
    invCol.display({
      id: 'lineItemCount',
      header: 'Line Items', size: 90,
      cell: ({ row }) => (
        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: '#F1F5F9', color: theme.colors.textSecondary, fontWeight: 600 }}>
          {row.original.lineItems.length}
        </span>
      ),
    }),
    invCol.accessor('total', {
      header: 'Total', size: 100,
      cell: i => <span style={{ fontSize: 12, fontWeight: 700, color: theme.colors.text }}>${i.getValue().toFixed(2)}</span>,
    }),
    invCol.accessor('qboStatus', {
      header: 'QBO', size: 90,
      cell: i => {
        const qs = i.getValue();
        const qid = i.row.original.qboInvoiceId;
        if (!qs && !qid) return <span style={{ fontSize: 11, color: theme.colors.textMuted }}>{'\u2014'}</span>;
        if (qs === 'Mixed') {
          return <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: '#FEF3C7', color: '#B45309', display: 'inline-block' }}>Mixed</span>;
        }
        const isPushed = qs === 'Pushed' || (!qs && qid);
        const isFailed = qs === 'Failed';
        return (
          <span
            title={isPushed ? `QBO ID: ${qid || 'unknown'}` : isFailed ? 'Push failed' : qs || ''}
            style={{
              fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
              background: isPushed ? '#F0FDF4' : isFailed ? '#FEF2F2' : '#F8FAFC',
              color: isPushed ? '#15803D' : isFailed ? '#991B1B' : '#64748B',
              display: 'inline-block',
            }}
          >
            {isPushed ? '✓ Pushed' : isFailed ? '✗ Failed' : qs || ''}
          </span>
        );
      },
    }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [expandedInvoices]);

  // The default tanstack global filter only sees the invoice-group's own
  // text fields (invoiceNo / client / etc) — NOT the line items inside it.
  // Once a row is invoiced it becomes invisible to ledger-row search even
  // though the user can clearly see the description / sidemark / reference
  // they remember. Pre-filter the groups by walking each lineItem's text
  // fields here so search behaves the same on Invoiced as on Unbilled.
  const filteredInvoicedGroups = useMemo(() => {
    const q = (globalFilter || '').trim().toLowerCase();
    if (!q) return billingSections.invoicedGroups;
    return billingSections.invoicedGroups.filter(g => {
      // Group-level fields first (cheap path).
      if (
        (g.invoiceNo && g.invoiceNo.toLowerCase().includes(q)) ||
        (g.client && g.client.toLowerCase().includes(q)) ||
        (g.sidemark && g.sidemark.toLowerCase().includes(q)) ||
        (g.invoiceDate && g.invoiceDate.toLowerCase().includes(q)) ||
        (g.qboInvoiceId && g.qboInvoiceId.toLowerCase().includes(q))
      ) return true;
      // Walk every line-item text field — what staff actually search by
      // (item ID / description / sidemark / reference / notes / svc /
      // task / repair / shipment).
      for (const li of g.lineItems) {
        if (
          (li.ledgerRowId && li.ledgerRowId.toLowerCase().includes(q)) ||
          (li.itemId      && li.itemId.toLowerCase().includes(q)) ||
          (li.description && li.description.toLowerCase().includes(q)) ||
          (li.sidemark    && li.sidemark.toLowerCase().includes(q)) ||
          (li.reference   && li.reference.toLowerCase().includes(q)) ||
          (li.notes       && li.notes.toLowerCase().includes(q)) ||
          (li.svcCode     && li.svcCode.toLowerCase().includes(q)) ||
          (li.svcName     && li.svcName.toLowerCase().includes(q)) ||
          (li.itemClass   && li.itemClass.toLowerCase().includes(q)) ||
          (li.taskId      && li.taskId.toLowerCase().includes(q)) ||
          (li.repairId    && li.repairId.toLowerCase().includes(q)) ||
          (li.shipmentNo  && li.shipmentNo.toLowerCase().includes(q))
        ) return true;
      }
      return false;
    });
  }, [billingSections.invoicedGroups, globalFilter]);

  const invoicedTable = useReactTable({
    data: filteredInvoicedGroups,
    columns: invoiceSummaryColumns,
    state: { rowSelection: invoicedRowSel },
    onRowSelectionChange: setInvoicedRowSel,
    getRowId: row => row.invoiceNo,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    enableMultiSort: true,
  });

  // Selection count: top-level selections only (NOT resolved child row count)
  const selCount =
    Object.keys(rowSel).filter(k => rowSel[k]).length +
    Object.keys(invoicedRowSel).filter(k => invoicedRowSel[k]).length;

  // Combined selection total across both tables (for the selection bar / modal)
  const selectionTotal = useMemo(() => {
    const a = table.getSelectedRowModel().rows.reduce((s, r) => s + r.original.total, 0);
    const b = invoicedTable.getSelectedRowModel().rows.reduce((s, r) => s + r.original.total, 0);
    return a + b;
  }, [table, invoicedTable, rowSel, invoicedRowSel]);

  // Resolve selected rows — expands invoice-summary selections to their real ledger rows
  const resolveSelectedRows = useCallback(() => {
    const resolved: BillingRow[] = [];
    for (const r of table.getSelectedRowModel().rows) {
      resolved.push(r.original);
    }
    for (const g of invoicedTable.getSelectedRowModel().rows) {
      resolved.push(...g.original.lineItems);
    }
    return resolved;
  }, [table, invoicedTable]);
  useEffect(() => { const h = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowCols(false); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, []);

  // ─── Stax IIF Export Handler ───────────────────────────────────────────────
  const handleStaxIifExport = async (ledgerRowIds?: string[]) => {
    setQbLoading(true);
    setQbResult(null);
    try {
      const res = await postQbExport({ source: ledgerRowIds ? 'selected' : 'invoiced', ledgerRowIds });
      if (res.error || !res.data?.success) {
        setQbResult({ error: res.data?.error || res.error || 'Export failed' });
      } else {
        setQbResult(res.data);
      }
    } catch (err) {
      setQbResult({ error: err instanceof Error ? err.message : String(err) });
    }
    setQbLoading(false);
  };

  // ─── QB Excel Export Handler (.xlsx for QBO import) ───────────────────────
  const [, setQbExcelLoading] = useState(false);
  const handleQbExcelExport = async (ledgerRowIds?: string[]) => {
    setQbExcelLoading(true);
    setQbResult(null);
    try {
      const res = await postQbExcelExport({ source: ledgerRowIds ? 'selected' : 'invoiced', ledgerRowIds });
      if (res.error || !res.data?.success) {
        setQbResult({ error: res.data?.error || res.error || 'QB Export failed' });
      } else {
        setQbResult(res.data);
      }
    } catch (err) {
      setQbResult({ error: err instanceof Error ? err.message : String(err) });
    }
    setQbExcelLoading(false);
  };

  // v38.188.0 — Void selected Unbilled rows. The selection can span multiple
  // tenants (operators commonly filter by client but it's not required), so
  // group by sourceSheetId first and fan out one postVoidUnbilledRows call
  // per group. Optimistically remove rows on success — the server-side
  // api_fullClientSync_(.., ['billing']) writes Void to Supabase, and the
  // followup loadReport(true) refetches without cache to confirm.
  const handleVoidSelected = async () => {
    const selRows = resolveSelectedRows();
    const unbilledRows = selRows.filter(r => r.status === 'Unbilled');
    if (!unbilledRows.length) return;

    setVoidLoading(true);
    setVoidResult(null);

    // Group by sourceSheetId. A selection without a sourceSheetId would be
    // a data bug, but we surface it as a per-group error rather than throwing.
    const groups: Record<string, { client: string; ids: string[] }> = {};
    for (const r of unbilledRows) {
      const sid = r.sourceSheetId || '';
      if (!groups[sid]) groups[sid] = { client: r.client, ids: [] };
      groups[sid].ids.push(r.ledgerRowId);
    }

    const reason = voidReason.trim();
    const perGroup: { client: string; voided: number; error?: string }[] = [];
    let totalVoided = 0;
    let totalRejected = 0;
    let totalNotFound = 0;
    let totalAlreadyVoid = 0;
    const successfulIds: string[] = [];

    for (const [sid, g] of Object.entries(groups)) {
      if (!sid) {
        perGroup.push({ client: g.client, voided: 0, error: 'Row missing sourceSheetId' });
        continue;
      }
      const res = await postVoidUnbilledRows(g.ids, sid, reason || undefined);
      if (res.error || !res.data?.success) {
        perGroup.push({ client: g.client, voided: 0, error: res.data?.error || res.error || 'Void failed' });
        continue;
      }
      const data = res.data;
      perGroup.push({ client: g.client, voided: data.voided });
      totalVoided += data.voided;
      totalRejected += data.rejected.length;
      totalNotFound += data.skippedNotFound;
      totalAlreadyVoid += data.skippedAlreadyVoid;
      // Only the rows that ACTUALLY flipped to Void should disappear from the
      // table — rejected rows (e.g. status drifted to Invoiced between the
      // selection and the call) need to stay visible so the operator can see
      // why the count was lower than they selected.
      const flippedSet = new Set(g.ids);
      for (const r of data.rejected) flippedSet.delete(r.ledgerRowId);
      // skippedNotFound: row not in sheet at all — not a "still Unbilled" case.
      // Server returned indices; we don't know which IDs hit that branch from
      // the response shape, so we conservatively only hide rows we know flipped.
      // For the bulk path, treat (sent - rejected - already-void) as flipped.
      // Already-Voided rows are also fine to remove (they were Void before; the
      // table already shouldn't show them under the Unbilled filter anyway).
      const aliveAfter = g.ids.filter(id => flippedSet.has(id));
      successfulIds.push(...aliveAfter);
    }

    if (successfulIds.length > 0) {
      setReportData(prev => prev.filter(r => !successfulIds.includes(r.ledgerRowId)));
      hideUnbilled(successfulIds);
      setRowSel({});
    }

    setVoidLoading(false);
    setVoidResult({
      ok: perGroup.every(g => !g.error),
      voided: totalVoided,
      rejected: totalRejected,
      notFound: totalNotFound,
      alreadyVoid: totalAlreadyVoid,
      perGroup,
    });

    // Force-refresh the report so the table reconciles with Supabase truth.
    if (reportLoaded) void loadReport(true);
  };

  // v38.185.0 — Synchronous re-submit gate. The React-state-based
  // `billingBatch.active` check below catches the common case of clicking
  // again *after* a batch is in flight, but it doesn't catch the rapid
  // double-click case where two click events fire in the same React tick
  // (≤16ms): both handlers read `billingBatch.active === false` because
  // setState is asynchronous, both pass preflight, both call startBatch,
  // and the second clobbers the first's invoicingLedgerIds + total.
  // useRef gives us a synchronously-readable flag that flips before any
  // await, closing the double-click window completely.
  const submitLockRef = useRef(false);

  // ─── Create Invoices from Selected Rows ────────────────────────────────────
  const handleCreateInvoices = async () => {
    const selRows = resolveSelectedRows();
    if (!selRows.length) return;

    // v38.185.0 — Atomic gate: flip the ref synchronously before any await.
    // If a second click hits before the first reaches its await, the second
    // bails immediately with the same error message the React-state guard
    // below shows. The ref releases in the early-return paths AND in the
    // `setTimeout` after `startBatch` succeeds (where the modal closes and
    // the batch is genuinely launched — at that point the React-state guard
    // has had time to flip and the lock can release without re-opening the
    // double-click window).
    if (submitLockRef.current) {
      setInvoiceError('Already submitting — wait for the batch to start.');
      return;
    }
    submitLockRef.current = true;

    // v38.184.0 — Block re-submit while a batch is already in flight.
    // The toast in AppLayout shows the active batch's progress; another
    // Submit click while one is running could cause overlapping optimistic
    // hides and conflicting result UIs. Surface a clear error.
    if (billingBatch.active) {
      submitLockRef.current = false;
      setInvoiceError('Another invoice batch is still processing — wait for it to finish (see the bottom-right progress toast).');
      return;
    }

    setInvoiceLoading(true);
    setInvoiceError('');

    // 2026-05-04 — Storage tab path. Preview rows haven't been written to
    // any client Billing_Ledger yet; commit them first so the createInvoice
    // calls below find rows to flip to Invoiced. The commit endpoint groups
    // by tenant + does ONE bulk setValues per client, so this stays fast
    // even on hundred-row monthly storage runs (the typical case Justin
    // flagged). Skipping this step is the entire point of the streamlined
    // workflow — replaces the old "Commit to Ledger then go to Report tab
    // then re-select then Create Invoice" 4-step dance.
    if (invoiceMode === 'storage') {
      const payloadRows = selRows.map(r => ({
        tenantId: r.sourceSheetId || r.clientSheetId || '',
        clientName: r.client || r.clientName || '',
        itemId: r.itemId,
        description: r.description,
        itemClass: r.itemClass,
        sidemark: r.sidemark || '',
        qty: r.qty,
        rate: r.rate,
        total: r.total,
        taskId: r.taskId,
        notes: r.notes,
        billableEnd: r.date,
        shipmentNo: r.shipmentNo,
      })).filter(r => r.tenantId);

      if (!payloadRows.length) {
        setInvoiceError('Selected rows are missing tenant ids — re-run Preview Storage.');
        setInvoiceLoading(false);
        submitLockRef.current = false;
        return;
      }

      try {
        const commitRes = await postCommitStorageRows({
          periodStart: storStartDate,
          periodEnd: storEndDate,
          rows: payloadRows,
        });
        if (commitRes.error || !commitRes.data?.success) {
          setInvoiceError(commitRes.data?.error || commitRes.error || 'Commit to ledger failed — invoices not created');
          setInvoiceLoading(false);
          submitLockRef.current = false;
          return;
        }
        // Stash the commit result so the storage-tab banner shows "X rows
        // committed" after the modal closes (matches the legacy two-step
        // affordance).
        setCommitResult(commitRes.data);
        if (commitRes.data?.failedClients?.length) {
          // Non-fatal — commit went through for other clients; surface the
          // partial-failure list in the modal so the operator can retry just
          // those clients via the legacy Commit to Ledger button.
          setInvoiceError(
            `Some clients failed to commit and will be skipped: ${commitRes.data.failedClients.join('; ')}`
          );
        }
      } catch (err) {
        setInvoiceError(`Commit error: ${err instanceof Error ? err.message : String(err)} — invoices not created`);
        setInvoiceLoading(false);
        submitLockRef.current = false;
        return;
      }
    }

    // Session 69 — optimistic hide: remove selected rows from the on-screen report
    // immediately so the table feels instant. Snapshot so we can restore on failure.
    // Per-group success/failure reconciliation happens below after runBatchLoop.
    const selectedIdsByGroup: Record<string, string[]> = {};
    const allHiddenIds: string[] = [];
    for (const r of selRows) {
      const key = invoiceGroupKey(r);
      if (!selectedIdsByGroup[key]) selectedIdsByGroup[key] = [];
      selectedIdsByGroup[key].push(r.ledgerRowId);
      allHiddenIds.push(r.ledgerRowId);
    }
    const reportSnapshot = reportData;
    setReportData(prev => prev.filter(r => !allHiddenIds.includes(r.ledgerRowId)));
    // Also hide at the useBilling layer so any other consumer reading `rows` sees the same optimistic state.
    hideUnbilled(allHiddenIds);

    const groups: Record<string, { client: string; sourceSheetId: string; sidemark: string; rows: UnbilledReportRow[] }> = {};
    for (const r of selRows) {
      // Group by client + (optional) sidemark via invoiceGroupKey, which only
      // includes sidemark for clients with separate_by_sidemark=true. Clients
      // without the flag get one consolidated invoice across all sidemarks.
      const key = invoiceGroupKey(r);
      if (!groups[key]) groups[key] = { client: r.client, sourceSheetId: r.sourceSheetId || '', sidemark: r.sidemark || '', rows: [] };
      groups[key].rows.push({
        client: r.client, sidemark: r.sidemark || '', date: r.date,
        svcCode: r.svcCode, svcName: r.svcName, itemId: r.itemId,
        description: r.description, itemClass: r.itemClass, qty: r.qty,
        rate: r.rate, total: r.total, notes: r.notes, taskId: r.taskId,
        repairId: r.repairId, shipmentNo: r.shipmentNo, category: r.category || '',
        ledgerRowId: r.ledgerRowId, sourceSheetId: r.sourceSheetId || '',
      });
    }

    // Separate groups missing source sheet IDs into preflight skips
    const groupList = Object.values(groups);
    const preflightSkipped: Array<{ id: string; reason: string }> = [];
    const invokable: typeof groupList = [];
    for (const g of groupList) {
      if (!g.sourceSheetId) {
        preflightSkipped.push({ id: g.client + (g.sidemark ? ` · ${g.sidemark}` : ''), reason: 'Missing client sheet ID — load live data first' });
      } else {
        invokable.push(g);
      }
    }

    // Client-side loop: each invoice generates a Drive PDF + email (~15-30s per group).
    // Server-side batch would exceed the 6-min Apps Script wall on 12+ clients.
    //
    // v38.121.0 perf optimizations:
    //   1. Each createInvoice call sends deferSupabaseSync=true so the server
    //      skips its per-invoice api_fullClientSync_ call (saves 1-5s each).
    //      After the batch completes, we call syncClientBilling ONCE per
    //      unique sourceSheetId.
    //   2. Batch size warning at 20+ invoices — UI nudges user to split if
    //      they're close to the 6-min Apps Script wall.
    const results: Array<CreateInvoiceResponse & { client: string }> = [];
    for (const s of preflightSkipped) {
      results.push({ success: false, client: s.id, error: s.reason });
    }
    setInvoiceBatch({ state: 'processing', total: invokable.length, processed: 0, succeeded: 0, failed: 0 });

    // Soft-cap warning: 20 is safe; 30-40 is tight; 50+ likely times out.
    if (invokable.length > 20) {
      const proceed = window.confirm(
        `You're about to create ${invokable.length} invoices in one batch.\n\n` +
        `For best reliability, we recommend no more than 20 at a time — ` +
        `the Apps Script backend has a 6-minute execution limit per invoice ` +
        `and large batches can time out mid-flight.\n\n` +
        `Continue anyway?`
      );
      if (!proceed) {
        setInvoiceBatch({ state: 'idle', total: 0, processed: 0, succeeded: 0, failed: 0 });
        submitLockRef.current = false;
        return;
      }
    }

    // v38.184.0 — Preflight is done. Mark the batch active in App-level
    // context so the bottom-right toast (rendered in AppLayout) takes
    // over progress display, transition the modal to its "Started!"
    // confirmation state, and schedule auto-close. The remaining work in
    // this function is async and continues running in the background even
    // if the operator navigates away — the JS runtime keeps the in-flight
    // fetches + their await chains alive, and the state setters that drive
    // the toast point at billingBatch (App-level provider, doesn't unmount).
    const allLedgerIdsForBatch: string[] = [];
    for (const g of invokable) {
      for (const r of g.rows) {
        if (r.ledgerRowId) allLedgerIdsForBatch.push(r.ledgerRowId);
      }
    }
    billingBatch.startBatch({
      total: invokable.length,
      invoicingLedgerIds: allLedgerIdsForBatch,
    });
    // v38.185.0 — Release the synchronous submit gate now that startBatch
    // has fired. From here on the React-state guard (`billingBatch.active`)
    // catches re-submits — the batch is genuinely launched, the toast is
    // showing, and the React render that flips active=true is moments
    // away. The previous double-click window (before startBatch ran) is
    // now closed by submitLockRef.
    submitLockRef.current = false;
    setInvoiceLoading(false);
    setInvoiceStartedAt(Date.now());
    setInvoiceError('');
    // Auto-close the modal after a short confirmation window so the
    // operator can immediately continue working. The actual batch work
    // continues running in the background (this async function doesn't
    // await its remaining chain from the caller's perspective — the
    // caller already moved on; the body keeps executing on its own).
    setTimeout(() => {
      setShowInvoiceModal(false);
      setInvoiceStartedAt(null);
      setInvoiceMode('report');
    }, 2000);

    // Captures inputs for the post-commit Supabase PDF generation pass
    // (session 93). Filled inside the call() closure where g.rows /
    // g.sourceSheetId are in scope; processed after syncClientBilling.
    const pdfQueue: Array<{
      tenantId: string;
      invoiceNo: string;
      invoiceDate: string;
      clientName: string;
      sidemark: string;
      rows: typeof invokable[number]['rows'];
    }> = [];

    const batchResult = await runBatchLoop<typeof invokable[0], CreateInvoiceResponse>({
      items: invokable.map(g => ({ id: g.client + (g.sidemark ? ` · ${g.sidemark}` : ''), item: g })),
      call: async (g) => {
        try {
          const res = await postCreateInvoice({
            idempotencyKey: crypto.randomUUID(),
            rows: g.rows,
            client: g.client,
            sidemark: g.sidemark || undefined,
            sourceSheetId: g.sourceSheetId,
            // Session 93: skipPdf is now always true on the GAS side. The
            // Drive Doc → PDF flow has been replaced by client-side jsPDF
            // generation that uploads to public.storage `invoices` bucket
            // and PATCHes billing.invoice_url after syncClientBilling.
            // The legacy Drive PDF only kicks in when the operator wants
            // an email attachment (skipEmail=false → server falls back
            // to its old path so MailApp has something to attach).
            skipPdf: !invOptEmail,
            skipEmail: !invOptEmail,
            deferSupabaseSync: true,  // v38.121.0 — batch sync fires once below
          } as any);
          // v38.184.0 — record per-invoice progress in the App-level
          // BillingBatchContext so the bottom-right toast updates live and
          // the optimistic "Invoicing…" badge clears on the rows we own.
          const groupLedgerIds = g.rows.map(r => r.ledgerRowId).filter(Boolean) as string[];
          if (res.data) {
            results.push({ ...res.data, client: g.client });
            if (!res.data.success) {
              billingBatch.recordInvoice({
                ok: false,
                ledgerRowIds: groupLedgerIds,
                result: { client: g.client, success: false, error: res.data.error || 'Server returned success=false' },
              });
              return { ok: false, error: res.data.error || 'Server returned success=false' };
            }
            // Capture data we need for the post-commit PDF pass.
            if (res.data.invoiceNo && g.sourceSheetId) {
              pdfQueue.push({
                tenantId: g.sourceSheetId,
                invoiceNo: res.data.invoiceNo,
                invoiceDate: new Date().toISOString().slice(0, 10),
                clientName: g.client,
                sidemark: g.sidemark || '',
                rows: g.rows,
              });
            }
            billingBatch.recordInvoice({
              ok: true,
              ledgerRowIds: groupLedgerIds,
              result: { client: g.client, success: true, invoiceNo: res.data.invoiceNo },
            });
            return { ok: true, data: res.data };
          }
          const err = res.error || 'Unknown error';
          results.push({ success: false, client: g.client, error: err });
          billingBatch.recordInvoice({
            ok: false,
            ledgerRowIds: groupLedgerIds,
            result: { client: g.client, success: false, error: err },
          });
          return { ok: false, error: err };
        } catch (err: unknown) {
          const msg = String(err);
          results.push({ success: false, client: g.client, error: msg });
          const groupLedgerIdsErr = g.rows.map(r => r.ledgerRowId).filter(Boolean) as string[];
          billingBatch.recordInvoice({
            ok: false,
            ledgerRowIds: groupLedgerIdsErr,
            result: { client: g.client, success: false, error: msg },
          });
          return { ok: false, error: msg };
        }
      },
      onProgress: (done, total) => setInvoiceBatch(prev => ({ ...prev, processed: done, total })),
      preflightSkipped,
      // 2026-05-04 (StrideAPI v38.182.0): RESTORED concurrency=3.
      // The 2026-05-03 INV-000131 duplicate (NORTON + NIPTUCK both got the
      // same number on near-simultaneous submits) was caused by the Master
      // sheet RPC's read-then-write race. v38.182.0 retires that path and
      // routes invoice numbering through `public.next_invoice_no()` — a
      // Postgres SEQUENCE that's atomic by design (nextval is concurrency-
      // safe). With the race fixed at the source, the duplicate-number bug
      // class is gone regardless of concurrency.
      //
      // Speedup expectation: handleCreateInvoice_ still uses
      // LockService.getScriptLock for the Consolidated_Ledger commit, so
      // concurrent calls queue at the GAS lock — true parallelism on the
      // sheet-write phase requires refactoring to per-tenant locks (tracked
      // for a future PR). Realistic gain at concurrency=3: ~10-30% wall-
      // time reduction from network round-trip overlap (next call starts
      // its HTTP round-trip while the prior is finishing on the server).
      // Going past 3 risks tripping the GAS commit lock's 30s tryLock
      // timeout on big batches, so 3 is the safe ceiling.
      concurrency: 3,
    });
    setInvoiceBatch({ state: 'complete', total: invokable.length, processed: invokable.length, succeeded: batchResult.succeeded, failed: batchResult.failed });
    setInvoiceBulkResult(batchResult);

    // v38.121.0 — Now that all invoices are committed, fire a single Supabase
    // billing sync per unique sourceSheetId. Saves N-1 syncs compared to
    // pre-v38.121 behavior (one per invoice).
    const uniqueSourceSheetIds = Array.from(new Set(invokable.map(g => g.sourceSheetId).filter(Boolean)));
    await Promise.all(
      uniqueSourceSheetIds.map(sid =>
        apiPost('syncClientBilling', { clientSheetId: sid }).catch(() => null)
      )
    );

    // Session 93 — Generate and store the PDF for every successful invoice in
    // the Supabase `invoices` bucket, then PATCH billing.invoice_url to the
    // long-lived signed URL so deeplinks land on the archived PDF instead of
    // the live React route. Runs AFTER syncClientBilling so our PATCH wins
    // over whatever URL the GAS sync wrote. Failures are non-fatal — invoices
    // are already committed; user can regenerate per-invoice later.
    if (pdfQueue.length > 0) {
      // Cache client info per tenant — same name/email/terms across invoices
      // belonging to one client.
      const clientCache: Record<string, InvoicePdfClient> = {};
      const fetchClientInfo = async (tenantId: string): Promise<InvoicePdfClient> => {
        if (clientCache[tenantId]) return clientCache[tenantId];
        let info: InvoicePdfClient = { name: '', paymentTerms: 'Net 30', email: '' };
        try {
          const { data } = await supabase
            .from('clients')
            .select('name, payment_terms, email')
            .eq('spreadsheet_id', tenantId)
            .maybeSingle();
          if (data) {
            info = {
              name: String((data as Record<string, unknown>).name || ''),
              paymentTerms: String((data as Record<string, unknown>).payment_terms || 'Net 30'),
              email: String((data as Record<string, unknown>).email || ''),
            };
          }
        } catch (_) { /* fall through with defaults */ }
        clientCache[tenantId] = info;
        return info;
      };

      // Concurrency 3 mirrors the create-invoice batch — keeps storage uploads
      // friendly without serializing the whole queue.
      const queue = [...pdfQueue];
      const workers = Array.from({ length: Math.min(3, queue.length) }).map(async () => {
        while (queue.length > 0) {
          const item = queue.shift();
          if (!item) break;
          try {
            const client = await fetchClientInfo(item.tenantId);
            const blob = generateInvoicePdfBlob({
              invoiceNo: item.invoiceNo,
              tenantId: item.tenantId,
              invoiceDate: item.invoiceDate,
              client: { name: client.name || item.clientName, email: client.email, paymentTerms: client.paymentTerms },
              rows: item.rows.map(r => ({
                date: r.date,
                svcCode: r.svcCode,
                svcName: r.svcName,
                itemId: r.itemId,
                description: r.description,
                qty: r.qty,
                rate: r.rate,
                total: r.total,
                sidemark: r.sidemark || item.sidemark || undefined,
              })),
            });
            const url = await uploadInvoicePdf(item.tenantId, item.invoiceNo, blob);
            if (url) await patchInvoiceUrl(item.tenantId, item.invoiceNo, url);
          } catch (err) {
            console.warn('[invoice-pdf] failed for', item.invoiceNo, err);
          }
        }
      });
      await Promise.all(workers);
    }

    // Session 69 — reveal failures: for every group that did NOT succeed, restore
    // its rows from the snapshot so the user sees the un-invoiced items return.
    // (Successful groups stay hidden; refetchBilling() repopulates them marked Invoiced.)
    const failedGroupKeys = new Set<string>();
    for (const r of results) {
      if (!r.success) {
        // r.client is the group label (client or "client · sidemark") per runBatchLoop
        // Find the matching group key via selectedIdsByGroup by reverse lookup
        for (const g of invokable) {
          const label = g.client + (g.sidemark ? ` · ${g.sidemark}` : '');
          if (label === r.client) {
            // Same key shape as the forward bucketing above (only includes
            // sidemark when the client has separate_by_sidemark=true), so
            // failed-group reconciliation matches the original group.
            const key = invoiceGroupKey(g);
            failedGroupKeys.add(key);
            break;
          }
        }
      }
    }
    if (failedGroupKeys.size > 0) {
      const idsToRestore: string[] = [];
      for (const key of failedGroupKeys) {
        const ids = selectedIdsByGroup[key] || [];
        idsToRestore.push(...ids);
      }
      // Restore those rows from the pre-submission snapshot
      const restoreSet = new Set(idsToRestore);
      const restored = reportSnapshot.filter(r => restoreSet.has(r.ledgerRowId));
      setReportData(prev => [...prev, ...restored]);
      revealUnbilled(idsToRestore);
    }

    setInvoiceResults(results);
    setInvoiceLoading(false);
    refetchBilling();
    // v38.186.0 — `refetchBilling()` only refreshes the underlying
    // `liveRows` from useBilling; the report table renders `reportData`,
    // which is populated separately by `loadReport()`. Without this call
    // the optimistic hide at line ~2219 is the ONLY thing removing
    // invoiced rows from the visible table — and if the user clicks
    // Refresh manually before the optimistic hide settles (or hits an
    // error path), the rows stay visible until they hit Refresh. Calling
    // loadReport(true) here forces a no-cache reload so the table
    // reflects the post-invoice Status='Invoiced' rows immediately
    // (which the default 'Unbilled' status filter will then filter out).
    if (reportLoaded) void loadReport(true);

    // v38.184.0 — Stamp the batch as complete in App-level context. The
    // bottom-right toast (rendered in AppLayout) reads `lastResults` and
    // shows the success / mixed-failure summary. preflightSkipped entries
    // are already in `results` (preflightSkipped pushed into `results` at
    // line ~2200). billingBatch.recordInvoice was called for each invokable
    // group inside the batch loop; finishBatch drains any stragglers in
    // invoicingLedgerIds and flips active=false.
    const batchResultsForCtx: BatchInvoiceResult[] = results.map(r => ({
      client: r.client,
      success: !!r.success,
      invoiceNo: r.invoiceNo,
      error: r.error,
    }));
    billingBatch.finishBatch(batchResultsForCtx);

    // Post-creation exports & QBO push (only if invoices succeeded)
    if (results.some(r => r.success) && (invOptQbo || invOptStax || invOptQb)) {
      // Small delay to ensure Consolidated_Ledger writes are committed
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Collect ledger row IDs from the rows that were just invoiced
      const invoicedLedgerIds = selRows.map(r => r.ledgerRowId).filter(Boolean);

      if (invOptQbo && invoicedLedgerIds.length) {
        try {
          const qboRes = await qboPushInvoice(invoicedLedgerIds);
          if (qboRes) {
            const details = (qboRes.results || []).map((r: any) => ({
              strideInvoiceNumber: r.strideInvoiceNumber || '',
              error: r.error || undefined,
              success: r.success || false,
              qboInvoiceId: r.qboInvoiceId || undefined,
            }));
            if (qboRes.success && qboRes.failedCount === 0) {
              setQboResult({ success: `${qboRes.pushedCount} invoice(s) pushed to QBO`, details });
            } else {
              // Include retryIds so user can retry without re-selecting
              setQboResult({
                error: qboRes.error || `${qboRes.failedCount} invoice(s) failed to push to QBO`,
                details,
                retryIds: invoicedLedgerIds,
              });
            }
          }
        } catch (e) {
          setQboResult({ error: 'QBO Push failed: ' + String(e), retryIds: invoicedLedgerIds });
        }
      }
      if (invOptStax) {
        try {
          await handleStaxIifExport(invoicedLedgerIds.length ? invoicedLedgerIds : undefined);
        } catch (e) {
          showToast('Stax IIF Export failed: ' + String(e));
        }
      }
      if (invOptQb) {
        try {
          await handleQbExcelExport(invoicedLedgerIds.length ? invoicedLedgerIds : undefined);
        } catch (e) {
          showToast('QB Export failed: ' + String(e));
        }
      }
    }
  };

  // ─── Styles ────────────────────────────────────────────────────────────────
  const th: React.CSSProperties = { padding: '14px 12px', textAlign: 'left', fontWeight: 600, fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '2px', borderBottom: 'none', position: 'sticky', top: 0, background: '#F5F2EE', zIndex: 2, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { padding: '10px 12px', borderBottom: `1px solid ${theme.colors.borderLight}`, fontSize: 13, whiteSpace: 'nowrap' };
  const tabChip = (active: boolean): React.CSSProperties => ({ padding: '8px 16px', borderRadius: 100, fontSize: 11, fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', cursor: 'pointer', border: active ? 'none' : '1px solid rgba(0,0,0,0.08)', background: active ? '#1C1C1C' : '#fff', color: active ? '#fff' : '#666', transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit' });

  // ─── Filter panel style ───────────────────────────────────────────────────
  const filterPanelStyle: React.CSSProperties = { padding: '16px 20px', background: '#fff', border: `1px solid ${theme.colors.border}`, borderRadius: 12, marginBottom: 16 };
  const filterGridStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, alignItems: 'end' };
  const dateInputStyle: React.CSSProperties = { width: '100%', padding: '7px 10px', fontSize: 12, border: `1px solid ${theme.colors.border}`, borderRadius: 8, outline: 'none', fontFamily: 'inherit', minHeight: 34 };
  const dateLabelStyle: React.CSSProperties = { fontSize: 10, fontWeight: 600, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3, display: 'block' };

  // ─── Render shared table section ──────────────────────────────────────────
  const renderTable = (borderColor: string, emptyMsg: string) => (
    <>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: 320 }}><Search size={15} color={theme.colors.textMuted} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} /><input value={globalFilter} onChange={e => setGlobalFilter(e.target.value)} placeholder="Search rows..." style={{ width: '100%', padding: '7px 10px 7px 32px', fontSize: 13, border: `1px solid ${theme.colors.border}`, borderRadius: 8, outline: 'none', background: theme.colors.bgSubtle, fontFamily: 'inherit' }} /></div>
        <div style={{ flex: 1 }} />
        <div style={{ position: 'relative' }} ref={menuRef}>
          <button onClick={() => setShowCols(v => !v)} style={{ padding: '7px 12px', fontSize: 12, fontWeight: 500, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'inherit', color: theme.colors.textSecondary }}><Settings2 size={14} /> Columns</button>
          {showCols && <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, background: '#fff', border: `1px solid ${theme.colors.border}`, borderRadius: 10, padding: 8, zIndex: 50, boxShadow: '0 4px 20px rgba(0,0,0,0.1)', minWidth: 180 }}>{TOGGLEABLE.map(id => <label key={id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', fontSize: 12, cursor: 'pointer' }}><input type="checkbox" checked={colVis[id] !== false} onChange={() => setColVis(v => ({ ...v, [id]: v[id] === false }))} style={{ accentColor: theme.colors.orange }} />{COL_LABELS[id]}</label>)}</div>}
        </div>
        <button onClick={() => toCSV(isStorageTab ? previewRows : reportData, isStorageTab ? 'stride-storage-preview.csv' : 'stride-billing-report.csv')} style={{ padding: '7px 12px', fontSize: 12, fontWeight: 500, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'inherit', color: theme.colors.textSecondary }}><Download size={14} /> Export xlsx</button>
        <button onClick={() => window.open(IIF_FOLDER_URL, '_blank')} title="Open exports folder in Google Drive" style={{ padding: '7px 12px', fontSize: 12, fontWeight: 500, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'inherit', color: theme.colors.textSecondary }}><ExternalLink size={14} /> IIF Folder</button>
        {isReportTab && <button onClick={async () => {
          const sel = resolveSelectedRows();
          if (!sel.length) { setQbResult({ error: 'Select invoiced rows to export. Use the checkboxes to select rows first.' }); return; }
          const invoicedRows = sel.filter(r => r.status === 'Invoiced');
          if (!invoicedRows.length) { setQbResult({ error: 'None of the selected rows are Invoiced. Create invoices first, then select the invoiced rows to export.' }); return; }
          await handleStaxIifExport(invoicedRows.map(r => r.ledgerRowId));
        }} disabled={qbLoading} style={{ padding: '7px 12px', fontSize: 12, fontWeight: 600, border: '1px solid #7C3AED', borderRadius: 8, background: '#fff', cursor: qbLoading ? 'progress' : 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'inherit', color: '#7C3AED', opacity: qbLoading ? 0.7 : 1 }}>{qbLoading ? <BtnSpinner size={12} /> : <DollarSign size={14} />} {qbLoading ? 'Exporting…' : 'Stax IIF'}</button>}
        {isReportTab && <QBOPushButton
          getSelectedLedgerRowIds={() => {
            const sel = resolveSelectedRows();
            const invoicedRows = sel.filter(r => r.status === 'Invoiced');
            return {
              ledgerRowIds: invoicedRows.map(r => r.ledgerRowId),
              hasSelection: sel.length > 0,
              hasInvoicedRows: invoicedRows.length > 0,
            };
          }}
          onResult={(msg) => setQboResult(msg)}
        />}
        {isReportTab && (() => {
          // v38.188.0 — Void Selected button. Surfaces only when at least one
          // Unbilled row is selected. Invoiced rows in the same selection are
          // ignored (the existing per-invoice Void button handles those).
          const sel = resolveSelectedRows();
          const unbilledCount = sel.filter(r => r.status === 'Unbilled').length;
          const disabled = unbilledCount === 0;
          return (
            <button
              onClick={() => { setVoidReason(''); setVoidResult(null); setShowVoidModal(true); }}
              disabled={disabled}
              title={disabled ? 'Select one or more Unbilled rows to void' : `Void ${unbilledCount} Unbilled row${unbilledCount !== 1 ? 's' : ''}`}
              style={{
                padding: '7px 12px', fontSize: 12, fontWeight: 600,
                border: `1px solid ${disabled ? theme.colors.border : '#DC2626'}`,
                borderRadius: 8,
                background: '#fff',
                cursor: disabled ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', gap: 4,
                fontFamily: 'inherit',
                color: disabled ? theme.colors.textMuted : '#DC2626',
                opacity: disabled ? 0.6 : 1,
              }}
            >
              <Ban size={14} /> Void Selected{unbilledCount > 0 ? ` (${unbilledCount})` : ''}
            </button>
          );
        })()}
      </div>

      {/* Row count */}
      {(tableData.length > 0 || (isReportTab && billingSections.invoicedGroups.length > 0)) && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: theme.colors.textMuted }}>
            {isReportTab ? (
              <>
                Showing <strong>{billingSections.invoicedGroups.length}</strong> invoice{billingSections.invoicedGroups.length !== 1 ? 's' : ''}
                {' '}&middot;{' '}
                <strong>{table.getRowModel().rows.length}</strong> unbilled row{table.getRowModel().rows.length !== 1 ? 's' : ''}
              </>
            ) : (
              <>Showing <strong>{table.getRowModel().rows.length}</strong> of <strong>{tableData.length}</strong> rows</>
            )}
          </span>
          {isPreviewMode && <span style={{ fontSize: 11, color: '#F59E0B', marginLeft: 8 }}>Rate, Qty, and Notes are editable -- click any cell to edit</span>}
        </div>
      )}

      {/* ─── Invoice Summary Section (report tab only, when invoiced rows exist) ── */}
      {isReportTab && billingSections.invoicedGroups.length > 0 && (
        <section style={{ marginBottom: billingSections.unbilledRows.length > 0 ? 20 : 0 }}>
          {billingSections.unbilledRows.length > 0 && (
            <h3 style={{ fontSize: 13, fontWeight: 600, margin: '4px 0 8px', color: theme.colors.textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Invoices ({billingSections.invoicedGroups.length})
            </h3>
          )}
          <div style={{ border: `1px solid ${borderColor}`, borderRadius: isMobile ? 8 : 12, overflow: 'hidden', background: '#fff' }}>
            <div style={{ overflowY: 'auto', overflowX: 'auto', maxHeight: isMobile ? 'calc(60dvh)' : 'calc(70dvh)', WebkitOverflowScrolling: 'touch' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: isMobile ? 700 : undefined }}>
                <thead>{invoicedTable.getHeaderGroups().map(hg => (
                  <tr key={hg.id}>
                    {hg.headers.map(h => (
                      <th
                        key={h.id}
                        style={{ ...th, width: h.getSize(), color: h.column.getIsSorted() ? theme.colors.orange : theme.colors.textMuted, cursor: h.column.getCanSort() ? 'pointer' : 'default' }}
                        onClick={h.column.getCanSort() ? (e: React.MouseEvent) => h.column.toggleSorting(undefined, e.shiftKey) : undefined}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                          {h.column.getCanSort() && (
                            h.column.getIsSorted() === 'asc' ? <ChevronUp size={13} color={theme.colors.orange} /> :
                            h.column.getIsSorted() === 'desc' ? <ChevronDown size={13} color={theme.colors.orange} /> :
                            <ArrowUpDown size={13} color={theme.colors.textMuted} />
                          )}
                        </div>
                      </th>
                    ))}
                  </tr>
                ))}</thead>
                <tbody>
                  {invoicedTable.getRowModel().rows.map(row => {
                    const grp = row.original;
                    const isExpanded = expandedInvoices.has(grp.invoiceNo);
                    const isSelected = row.getIsSelected();
                    const rowBg = isSelected ? theme.colors.orangeLight : 'transparent';
                    return (
                      <React.Fragment key={row.id}>
                        <tr
                          style={{
                            cursor: 'pointer',
                            background: rowBg,
                            borderLeft: isSelected ? `3px solid ${theme.colors.orange}` : '3px solid transparent',
                            transition: 'background 0.1s',
                          }}
                          onClick={e => {
                            if ((e.target as HTMLElement).closest('input[type="checkbox"]')) return;
                            if ((e.target as HTMLElement).closest('span[title]')) return;
                            setExpandedInvoices(prev => {
                              const next = new Set(prev);
                              if (next.has(grp.invoiceNo)) next.delete(grp.invoiceNo); else next.add(grp.invoiceNo);
                              return next;
                            });
                          }}
                          onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = theme.colors.bgSubtle; }}
                          onMouseLeave={e => { e.currentTarget.style.background = rowBg; }}
                        >
                          {row.getVisibleCells().map(cell => (
                            <td key={cell.id} style={td}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                          ))}
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td colSpan={invoicedTable.getVisibleFlatColumns().length} style={{ padding: 0, background: '#F8FAFC', borderLeft: `3px solid ${theme.colors.orange}` }}>
                              <InvoiceLineItemsSubtable items={grp.lineItems} />
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '8px 16px', borderTop: `1px solid ${theme.colors.borderLight}`, fontSize: 12, color: theme.colors.textMuted }}>
              {billingSections.invoicedGroups.length} invoice{billingSections.invoicedGroups.length !== 1 ? 's' : ''}
            </div>
          </div>
        </section>
      )}

      {/* ─── Ledger Table (unbilled rows for report tab, or storage preview) ── */}
      {(isStorageTab || !isReportTab || billingSections.unbilledRows.length > 0 || billingSections.invoicedGroups.length === 0) && (
        <section>
          {isReportTab && billingSections.invoicedGroups.length > 0 && billingSections.unbilledRows.length > 0 && (
            <h3 style={{ fontSize: 13, fontWeight: 600, margin: '4px 0 8px', color: theme.colors.textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Unbilled Line Items ({billingSections.unbilledRows.length})
            </h3>
          )}
          <div style={{ border: `1px solid ${borderColor}`, borderRadius: isMobile ? 8 : 12, overflow: 'hidden', background: '#fff' }}>
            {tableData.length === 0 ? (
              <div style={{ padding: '60px 24px', textAlign: 'center', color: theme.colors.textMuted }}>
                <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>{emptyMsg}</div>
                <div style={{ fontSize: 12 }}>Use the filters above and click the button to load data.</div>
              </div>
            ) : (
              <>
                <div ref={containerRef} style={{ overflowY: 'auto', overflowX: 'auto', maxHeight: isMobile ? 'calc(100dvh - 200px)' : 'calc(100dvh - 340px)', minHeight: isMobile ? 200 : undefined, WebkitOverflowScrolling: 'touch' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: isMobile ? 700 : undefined }}>
                    <thead>{table.getHeaderGroups().map(hg => <tr key={hg.id}>{hg.headers.map(h => {
                      const isDragTarget = dragOverColId === h.id && dragColId !== h.id;
                      return <th key={h.id}
                        draggable={h.id !== 'select' && h.id !== 'actions'}
                        onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', h.id); setDragColId(h.id); }}
                        onDragOver={e => { e.preventDefault(); setDragOverColId(h.id); }}
                        onDragEnd={() => {
                          if (dragColId && dragOverColId && dragColId !== dragOverColId) {
                            const cur = columnOrder.length ? [...columnOrder] : [...DEFAULT_COL_ORDER];
                            const from = cur.indexOf(dragColId); const to = cur.indexOf(dragOverColId);
                            if (from !== -1 && to !== -1) { cur.splice(from, 1); cur.splice(to, 0, dragColId); setColumnOrder(cur); }
                          }
                          setDragColId(null); setDragOverColId(null);
                        }}
                        style={{ ...th, width: h.getSize(), color: h.column.getIsSorted() ? theme.colors.orange : theme.colors.textMuted, cursor: h.id !== 'select' && h.id !== 'actions' ? 'grab' : 'default', background: isDragTarget ? theme.colors.orangeLight : '#fff', borderLeft: isDragTarget ? `2px solid ${theme.colors.orange}` : undefined }}
                        onClick={h.column.getCanSort() ? (e: React.MouseEvent) => h.column.toggleSorting(undefined, e.shiftKey) : undefined}
                      ><div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}{h.column.getCanSort() && (h.column.getIsSorted() === 'asc' ? <ChevronUp size={13} color={theme.colors.orange} /> : h.column.getIsSorted() === 'desc' ? <ChevronDown size={13} color={theme.colors.orange} /> : <ArrowUpDown size={13} color={theme.colors.textMuted} />)}</div></th>;
                    })}</tr>)}</thead>
                    <tbody>
                      {virtualRows.length > 0 && <tr style={{ height: virtualRows[0].start }}><td colSpan={table.getVisibleFlatColumns().length} /></tr>}
                      {virtualRows.map(vRow => {
                        const row = allRows[vRow.index];
                        const isActivePanel = selectedBillingRow?.ledgerRowId === row.original.ledgerRowId;
                        const isPreview = row.original.status === 'Preview';
                        const rowBg = row.getIsSelected() ? theme.colors.orangeLight : isActivePanel ? '#FEF3EE' : isPreview ? '#FFFEF5' : 'transparent';
                        return (
                          <tr
                            key={row.id}
                            style={{
                              transition: 'background 0.1s',
                              background: rowBg,
                              cursor: 'pointer',
                              borderLeft: isActivePanel ? `3px solid ${theme.colors.orange}` : isPreview ? '3px solid #F59E0B' : '3px solid transparent',
                            }}
                            onClick={e => {
                              if ((e.target as HTMLElement).closest('input[type="checkbox"]')) return;
                              if (!isPreviewMode) setSelectedBillingRow(row.original);
                            }}
                            onMouseEnter={e => { if (!row.getIsSelected() && !isActivePanel) e.currentTarget.style.background = isPreview ? '#FFFDE7' : theme.colors.bgSubtle; }}
                            onMouseLeave={e => { e.currentTarget.style.background = rowBg; }}
                          >
                            {row.getVisibleCells().map(cell => <td key={cell.id} style={td}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}
                          </tr>
                        );
                      })}
                      {virtualRows.length > 0 && <tr style={{ height: totalHeight - (virtualRows[virtualRows.length - 1].end) }}><td colSpan={table.getVisibleFlatColumns().length} /></tr>}
                    </tbody>
                  </table>
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '8px 16px', borderTop: `1px solid ${theme.colors.borderLight}`, fontSize: 12, color: theme.colors.textMuted }}>
                  {allRows.length} row{allRows.length !== 1 ? 's' : ''}
                </div>
              </>
            )}
          </div>
        </section>
      )}
    </>
  );

  return (
    <div style={{ background: '#F5F2EE', margin: '-28px -32px', padding: '28px 32px', minHeight: '100%' }}>
      {invoiceBatch.state !== 'idle' && (
        <div style={{ position: 'sticky', top: 0, zIndex: 10, marginBottom: 12 }}>
          <BatchProgress
            state={invoiceBatch.state}
            total={invoiceBatch.total}
            processed={invoiceBatch.processed}
            succeeded={invoiceBatch.succeeded}
            failed={invoiceBatch.failed}
            actionLabel="Creating invoices"
          />
          {invoiceBatch.state === 'complete' && (
            <button onClick={() => setInvoiceBatch({ state: 'idle', total: 0, processed: 0, succeeded: 0, failed: 0 })} style={{ marginTop: 4, fontSize: 11, border: 'none', background: 'none', cursor: 'pointer', color: theme.colors.textMuted, padding: 0 }}>Dismiss</button>
          )}
        </div>
      )}
      <BulkResultSummary open={!!invoiceBulkResult} actionLabel="Create Invoices" result={invoiceBulkResult} onClose={() => setInvoiceBulkResult(null)} />
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '2px', color: '#1C1C1C' }}>
          STRIDE LOGISTICS · BILLING
        </div>
        <button
          onClick={() => { setRefreshing(true); refetchBilling(); loadReport(true); }}
          title="Refresh billing data from source (bypasses Supabase cache)"
          style={{ padding: '7px 8px', fontSize: 12, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', color: (refreshing || reportLoading || billingLoading) ? theme.colors.orange : theme.colors.textSecondary, transition: 'color 0.2s' }}
        >
          <RefreshCw size={14} style={(refreshing || reportLoading || billingLoading) ? { animation: 'spin 1s linear infinite' } : undefined} />
        </button>
      </div>
      <div style={{ background: '#FFFFFF', borderRadius: 20, padding: 24, border: '1px solid rgba(0,0,0,0.04)' }}>

      <SyncBanner syncing={refreshing || reportLoading} />

      {/* Tab Nav */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button onClick={() => setActiveTab('report')} style={tabChip(activeTab === 'report')}><FileText size={14} /> Billing Report</button>
        <button onClick={() => setActiveTab('storage')} style={tabChip(activeTab === 'storage')}><Eye size={14} /> Storage Charges</button>
        <button onClick={() => setActiveTab('review')} style={tabChip(activeTab === 'review')}><DollarSign size={14} /> Invoice Review</button>
        <button onClick={() => setActiveTab('activity')} style={tabChip(activeTab === 'activity')}><Clock size={14} /> Activity</button>
        <button onClick={() => setActiveTab('parity')} style={tabChip(activeTab === 'parity')}><Scale size={14} /> Rate Parity</button>
        <button onClick={() => setActiveTab('coverage')} style={tabChip(activeTab === 'coverage')}><ShieldCheck size={14} /> Coverage Audit</button>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          TAB: Coverage Audit — every billable event vs the ledger
         ═══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'coverage' && <BillingCoverageTab />}

      {/* ═══════════════════════════════════════════════════════════════════════
          TAB: Rate Parity — MPL sheet vs Supabase service catalog diff
         ═══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'parity' && <ParityMonitor />}

      {/* ═══════════════════════════════════════════════════════════════════════
          TAB: Activity — audit trail of billing actions
         ═══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'activity' && <BillingActivityTab clientNameMap={clientNameMap} />}

      {/* ═══════════════════════════════════════════════════════════════════════
           TAB: Invoice Review
         ═══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'review' && <InvoiceReviewTab />}

      {/* ═══════════════════════════════════════════════════════════════════════
           TAB: Billing Report
         ═══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'report' && (
        <>
          {/* Filters + Load Report — all in one panel so user sets everything before loading */}
          <div style={filterPanelStyle}>
            <div style={filterGridStyle}>
              <MultiSelectFilter label="Client" options={reportClients} selected={rptClientFilter} onChange={setRptClientFilter} placeholder={clientsLoading ? 'Loading clients…' : 'Select a client…'} />
              <MultiSelectFilter label="Sidemark" options={reportSidemarks} selected={rptSidemarkFilter} onChange={setRptSidemarkFilter} placeholder="All Sidemarks" />
              <MultiSelectFilter label="Category" options={ALL_CATEGORIES} selected={rptCategoryFilter} onChange={setRptCategoryFilter} placeholder="All Categories" />
              <MultiSelectFilter label="Service" options={SVC_OPTIONS_FOR_FILTER.map(s => s.name)} selected={rptSvcFilter} onChange={setRptSvcFilter} placeholder="All Services" />
              <MultiSelectFilter label="Status" options={ALL_STATUSES} selected={rptStatusFilter} onChange={setRptStatusFilter} placeholder="All Statuses" />
              <div>
                <span style={dateLabelStyle}>End Date</span>
                <input type="date" value={rptEndDate} onChange={e => setRptEndDate(e.target.value)} style={dateInputStyle} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
              <WriteButton
                label={reportLoading ? 'Loading...' : 'Load Report'}
                variant="primary"
                icon={reportLoading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <FileText size={14} />}
                disabled={reportLoading || !apiConfigured}
                onClick={loadReport}
              />
              <button onClick={clearReportFilters} style={{ padding: '7px 14px', fontSize: 12, fontWeight: 500, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary, minHeight: 34 }}>Clear Filters</button>
              {canManageManualCharges && (
                <button
                  onClick={() => setShowAddCharge(true)}
                  title="Add a one-off billing charge for a client"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '7px 16px', fontSize: 12, fontWeight: 600, letterSpacing: '0.5px',
                    border: 'none', borderRadius: 100,
                    background: theme.colors.orange, color: '#fff',
                    cursor: 'pointer', fontFamily: 'inherit', minHeight: 34,
                  }}
                >
                  <Plus size={14} /> Add Charge
                </button>
              )}
              {reportData.length > 0 && (
                <span style={{ fontSize: 12, color: theme.colors.textMuted }}>
                  {reportData.length} row{reportData.length !== 1 ? 's' : ''} loaded
                </span>
              )}
            </div>
            {reportError && (
              <div style={{ marginTop: 12, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 12px', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <AlertTriangle size={15} color="#dc2626" style={{ flexShrink: 0, marginTop: 1 }} />
                <span style={{ fontSize: 13, color: '#dc2626' }}>{reportError}</span>
              </div>
            )}
          </div>

          {/* Loading overlay */}
          {reportLoading && (
            <div style={{ padding: '32px 24px', background: '#fff', border: `2px solid ${theme.colors.orange}`, borderRadius: 16, marginBottom: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, boxShadow: '0 4px 24px rgba(232,93,45,0.12)' }}>
              <div style={{ width: 40, height: 40, border: `4px solid #FED7AA`, borderTopColor: theme.colors.orange, borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
              <div style={{ fontSize: 16, fontWeight: 700, color: theme.colors.orange }}>Loading billing report...</div>
              <div style={{ fontSize: 13, color: theme.colors.textSecondary }}>Scanning billing ledgers with the selected filters</div>
            </div>
          )}

          {/* Summary cards (only when data loaded) */}
          {reportLoaded && !reportLoading && reportData.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 20 }}>
              <div style={{ padding: '20px 22px', background: '#1C1C1C', borderRadius: 20 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '2px', marginBottom: 10 }}>Rows</div>
                <div style={{ fontSize: 28, fontWeight: 300, color: '#fff', lineHeight: 1 }}>{reportRowCount}</div>
              </div>
              <div style={{ padding: '20px 22px', background: '#1C1C1C', borderRadius: 20 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '2px', marginBottom: 10 }}>Clients</div>
                <div style={{ fontSize: 28, fontWeight: 300, color: '#60A5FA', lineHeight: 1 }}>{reportClientCount}</div>
              </div>
              <div style={{ padding: '20px 22px', background: '#1C1C1C', borderRadius: 20 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '2px', marginBottom: 10 }}>Total</div>
                <div style={{ fontSize: 28, fontWeight: 300, color: '#E8692A', lineHeight: 1 }}>${reportTotal.toFixed(2)}</div>
              </div>
            </div>
          )}

          {renderTable(theme.colors.border, 'No billing data loaded yet')}
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
           TAB: Storage Charges
         ═══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'storage' && (
        <>
          {/* Filter Panel */}
          <div style={{ ...filterPanelStyle, borderColor: previewLoaded ? '#F59E0B' : theme.colors.border }}>
            <div style={filterGridStyle}>
              <MultiSelectFilter label="Client" options={storageClients} selected={storClientFilter} onChange={setStorClientFilter} placeholder="All Clients" />
              <MultiSelectFilter label="Sidemark" options={storageSidemarks} selected={storSidemarkFilter} onChange={setStorSidemarkFilter} placeholder="All Sidemarks" />
              <div>
                <span style={{ ...dateLabelStyle, display: 'flex', alignItems: 'center' }}>
                  <span>Period Start</span>
                  <InfoTooltip text="The first day of the storage billing period. Usually the 1st of the month you're billing for." />
                </span>
                <input type="date" value={storStartDate} onChange={e => setStorStartDate(e.target.value)} disabled={previewLoading} style={dateInputStyle} />
              </div>
              <div>
                <span style={{ ...dateLabelStyle, display: 'flex', alignItems: 'center' }}>
                  <span>Period End</span>
                  <InfoTooltip text="The last day of the storage billing period. Usually the last day of the month." />
                </span>
                <input type="date" value={storEndDate} onChange={e => setStorEndDate(e.target.value)} disabled={previewLoading} style={dateInputStyle} />
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'end', paddingBottom: 1, flexWrap: 'wrap' }}>
                <WriteButton
                  label={previewLoading ? 'Calculating...' : storFiltersChanged ? 'Preview (Filters Changed)' : 'Preview Storage Charges'}
                  variant="primary"
                  icon={previewLoading ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
                  disabled={previewLoading || !storStartDate || !storEndDate || !apiConfigured}
                  onClick={handlePreviewStorage}
                  style={storFiltersChanged ? { background: '#F59E0B' } : undefined}
                />
              </div>
            </div>
            {previewError && (
              <div style={{ marginTop: 12, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 12px', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <AlertTriangle size={15} color="#dc2626" style={{ flexShrink: 0, marginTop: 1 }} />
                <span style={{ fontSize: 13, color: '#dc2626' }}>{previewError}</span>
              </div>
            )}
          </div>

          {/* Loading overlay */}
          {previewLoading && (
            <div style={{ padding: '32px 24px', background: '#fff', border: `2px solid #F59E0B`, borderRadius: 16, marginBottom: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, boxShadow: '0 4px 24px rgba(245,158,11,0.12)' }}>
              <div style={{ width: 40, height: 40, border: '4px solid #FEF3C7', borderTopColor: '#F59E0B', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
              <div style={{ fontSize: 16, fontWeight: 700, color: '#F59E0B' }}>Calculating storage preview...</div>
              <div style={{ fontSize: 13, color: theme.colors.textSecondary }}>Reading inventory + rates from all clients -- no data is being written</div>
            </div>
          )}

          {/* Preview mode banner with commit button */}
          {previewLoaded && !previewLoading && previewRows.length > 0 && (
            <div style={{ padding: '12px 18px', background: '#FFFDE7', border: `1.5px dashed #F59E0B`, borderRadius: 12, marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Eye size={18} color="#F59E0B" />
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#B45309' }}>Storage Preview</div>
                    <div style={{ fontSize: 12, color: '#92400E' }}>
                      {storClientFilter.length ? storClientFilter.join(', ') : 'All Clients'} &middot; {storStartDate} to {storEndDate} &middot; {previewRows.length} items &middot; ${previewTotalAmount.toFixed(2)}
                      {' '} &middot; <strong>These charges are NOT in the ledger yet</strong>
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {commitResult ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 8, fontSize: 12, color: '#15803D', fontWeight: 600 }}>
                      <CheckCircle size={14} /> {commitResult.totalCreated} rows committed to ledger
                    </div>
                  ) : (
                    <>
                      {/* 2026-05-04 — Streamlined "Create Invoice" path. Same
                          modal as the Report tab; the storage-mode flag in
                          handleCreateInvoices triggers postCommitStorageRows
                          before the per-group postCreateInvoice loop, so one
                          click does both steps. Replaces the legacy
                          "commit then re-select on Report tab" 4-step flow. */}
                      <WriteButton
                        label="Create Invoice"
                        variant="primary"
                        icon={<Send size={13} />}
                        disabled={!previewRows.length || invoiceLoading || commitLoading}
                        onClick={() => {
                          // Use ALL preview rows by default. If the user has a
                          // subset selected we honor that — the modal subtitle
                          // shows the count. Use the table API so the selection
                          // tracks the current sort/filter view (a manual
                          // rowSel = {0:true,...} would diverge if sort/filter
                          // changed the underlying TanStack row ids).
                          const haveSelection = table.getSelectedRowModel().rows.length > 0;
                          if (!haveSelection) {
                            table.toggleAllRowsSelected(true);
                          }
                          setInvoiceMode('storage');
                          setInvoiceResults(null);
                          setInvoiceError('');
                          setShowInvoiceModal(true);
                        }}
                      />
                      <WriteButton
                        label={commitLoading ? 'Committing...' : 'Commit to Ledger'}
                        variant="ghost"
                        icon={commitLoading ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                        disabled={commitLoading || !previewRows.length}
                        onClick={handleCommitPreview}
                      />
                    </>
                  )}
                  <button onClick={() => { setPreviewLoaded(false); setPreviewRows([]); setRowSel({}); setCommitResult(null); setPreviewError(''); }} style={{ padding: '6px 14px', fontSize: 12, fontWeight: 600, border: 'none', borderRadius: 8, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary, display: 'flex', alignItems: 'center', gap: 4, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}><X size={13} /> Dismiss</button>
                </div>
              </div>
            </div>
          )}

          {renderTable(previewLoaded ? '#F59E0B' : theme.colors.border, 'No storage preview loaded yet')}
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
           Selection Bar (shared — shows on report + storage tabs)
         ═══════════════════════════════════════════════════════════════════════ */}
      {selCount > 0 && (activeTab === 'report' || activeTab === 'storage') && createPortal(
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100, background: '#1A1A1A', borderTop: '1px solid #333', padding: '12px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>{selCount} row{selCount !== 1 ? 's' : ''} selected</span>
            <span style={{ color: '#999', fontSize: 12 }}>${selectionTotal.toFixed(2)}</span>
            <button onClick={() => { setRowSel({}); setInvoicedRowSel({}); }} style={{ background: 'transparent', border: '1px solid #555', borderRadius: 6, color: '#999', padding: '4px 10px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Clear</button>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {/* Re-send Email: only for a single invoice selected from the invoice summary table */}
            {activeTab === 'report' && (() => {
              const selInvoiceGroups = invoicedTable.getSelectedRowModel().rows.map(r => r.original);
              const selLedgerRows = table.getSelectedRowModel().rows.map(r => r.original);
              // Only show if exactly one invoice summary is selected AND no unbilled ledger rows are selected
              if (selInvoiceGroups.length !== 1 || selLedgerRows.length > 0) return null;
              const grp = selInvoiceGroups[0];
              if (grp.status !== 'Invoiced') return null;
              return (
                <WriteButton label="Re-send Email" loadingText="Sending..." variant="ghost" size="sm" onClick={async () => {
                  const invNo = grp.invoiceNo;
                  const sheetId = grp.clientSheetId
                    || grp.sourceSheetId
                    || (liveRows as Array<{ invoiceNo?: string; clientSheetId?: string }>).find((r) => r.invoiceNo === invNo)?.clientSheetId
                    || '';
                  if (!sheetId) { setInvoiceError('Missing client sheet ID for invoice ' + invNo); return; }
                  try {
                    const res = await postResendInvoiceEmail({ invoiceNo: invNo, clientSheetId: sheetId });
                    if (!res.data?.success) setInvoiceError(res.error || res.data?.error || 'Re-send failed');
                  } catch (err) { setInvoiceError(String(err)); }
                }} />
              );
            })()}

            {/* Create Invoice button — Report tab uses 'report' mode (rows
                already on the ledger, just flip to Invoiced). Storage tab
                uses 'storage' mode which commits the preview rows to the
                ledger before invoicing — one click replaces the legacy
                two-step flow. */}
            {(activeTab === 'report' || activeTab === 'storage') && (
              <WriteButton
                label="Create Invoice"
                variant="ghost"
                size="sm"
                icon={<Send size={13} />}
                onClick={async () => {
                  setInvoiceMode(activeTab === 'storage' ? 'storage' : 'report');
                  setInvoiceResults(null);
                  setInvoiceError('');
                  setShowInvoiceModal(true);
                }}
              />
            )}



          </div>
        </div>,
        document.body
      )}

      {/* ─── Create Invoices Modal ────────────────────────────────────────── */}
      {showInvoiceModal && createPortal(
        <>
          <div onClick={() => !invoiceLoading && (setShowInvoiceModal(false), setInvoiceResults(null), setInvoiceError(''), setInvoiceMode('report'))} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 200 }} />
          <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 540, maxWidth: '95vw', maxHeight: '85vh', background: '#fff', borderRadius: 16, boxShadow: '0 8px 40px rgba(0,0,0,0.15)', zIndex: 201, fontFamily: theme.typography.fontFamily, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '18px 24px', borderBottom: `1px solid ${theme.colors.border}` }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>Create & Send Invoices</div>
              <div style={{ fontSize: 12, color: theme.colors.textMuted, marginTop: 2 }}>
                {selCount} {invoiceMode === 'storage' ? 'storage' : 'selected'} row{selCount !== 1 ? 's' : ''} &middot; ${selectionTotal.toFixed(2)} total
              </div>
              {invoiceMode === 'storage' && (
                <div style={{ marginTop: 8, padding: '6px 10px', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 6, fontSize: 11, color: '#92400E' }}>
                  Storage rows will be committed to each client&apos;s ledger and invoiced in one step.
                </div>
              )}
            </div>
            <div style={{ padding: '18px 24px', flex: 1, overflowY: 'auto', minHeight: 0 }}>
              {!invoiceResults && !invoiceLoading && (() => {
                const selRows = resolveSelectedRows();
                const groups: Record<string, { client: string; sidemark: string; rows: BillingRow[]; total: number }> = {};
                selRows.forEach(r => {
                  // Review-tab grouping mirrors the create-invoice grouping
                  // — clients without separate_by_sidemark see one row per
                  // tenant; clients with it set see one row per (tenant, sidemark).
                  const key = invoiceGroupKey(r);
                  if (!groups[key]) groups[key] = { client: r.client, sidemark: r.sidemark || '', rows: [], total: 0 };
                  groups[key].rows.push(r);
                  groups[key].total += r.total;
                });
                const groupList = Object.values(groups);
                return (
                  <>
                    <div style={{ marginBottom: 14, padding: 14, background: theme.colors.bgSubtle, borderRadius: 10, border: `1px solid ${theme.colors.border}`, fontSize: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}><span style={{ color: theme.colors.textSecondary }}>Invoices to create:</span><span style={{ fontWeight: 700 }}>{groupList.length}</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}><span style={{ color: theme.colors.textSecondary }}>Total line items:</span><span style={{ fontWeight: 600 }}>{selRows.length}</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: theme.colors.textSecondary }}>Grand total:</span><span style={{ fontWeight: 700, color: theme.colors.orange }}>${selRows.reduce((s, r) => s + r.total, 0).toFixed(2)}</span></div>
                    </div>
                    <div style={{ maxHeight: 150, overflowY: 'auto', borderRadius: 8, border: groupList.length > 3 ? `1px solid ${theme.colors.border}` : 'none', padding: groupList.length > 3 ? 4 : 0 }}>
                      {groupList.map((g, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: theme.colors.bgSubtle, borderRadius: 8, marginBottom: 6, fontSize: 12 }}>
                          <span style={{ fontWeight: 600 }}>{g.client}{g.sidemark ? ` — ${g.sidemark}` : ''}</span>
                          <span style={{ color: theme.colors.textSecondary }}>{g.rows.length} rows &middot; <strong>${g.total.toFixed(2)}</strong></span>
                        </div>
                      ))}
                    </div>
                    {groupList.some(g => !g.rows[0]?.sourceSheetId) && (
                      <div style={{ marginTop: 10, padding: '8px 12px', background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: 8, fontSize: 11, color: '#92400E' }}>
                        Some rows are missing sourceSheetId -- these were loaded from mock data and cannot be invoiced.
                      </div>
                    )}

                    <div style={{ borderTop: `1px solid ${theme.colors.border}`, margin: '16px 0', paddingTop: 16 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Actions to perform:</div>

                      {/* Always-on: Create & Save.
                          Session 93: PDF generation is now part of this
                          always-on path — no separate "Generate PDF Invoice"
                          checkbox. Every invoice gets a Supabase-stored PDF
                          and a deep link from billing.invoice_url. */}
                      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', border: `1px solid ${theme.colors.orange}`, borderRadius: 10, marginBottom: 8, background: '#FEF3EE', cursor: 'default' }}>
                        <input type="checkbox" checked disabled style={{ accentColor: theme.colors.orange, marginTop: 2, width: 16, height: 16 }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>Create & Save Invoices <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: '#F0FDF4', color: '#15803D', fontWeight: 700, marginLeft: 6 }}>Always</span></div>
                          <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>Mark rows Invoiced, generate the PDF, store it in Supabase, and deep-link <code>invoice_url</code> to the archived file.</div>
                        </div>
                      </label>

                      {/* Send Email — no longer gated on a PDF checkbox; the
                          PDF is always generated. */}
                      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', border: `1px solid ${invOptEmail ? theme.colors.orange : theme.colors.border}`, borderRadius: 10, marginBottom: 8, background: invOptEmail ? '#FEF3EE' : '#fff', cursor: 'pointer' }}>
                        <input type="checkbox" checked={invOptEmail} onChange={() => setInvOptEmail(!invOptEmail)} style={{ accentColor: theme.colors.orange, marginTop: 2, width: 16, height: 16, cursor: 'pointer' }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>Send Email to Client</div>
                          <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>Email the invoice PDF to the client's email on file.</div>
                        </div>
                      </label>

                      {/* Push to QBO */}
                      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', border: `1px solid ${invOptQbo ? '#16A34A' : theme.colors.border}`, borderRadius: 10, marginBottom: 8, background: invOptQbo ? '#F0FDF4' : '#fff', cursor: qboConnected ? 'pointer' : 'not-allowed', opacity: qboConnected ? 1 : 0.5 }}>
                        <input type="checkbox" checked={invOptQbo} onChange={() => { if (qboConnected) setInvOptQbo(!invOptQbo); }} disabled={!qboConnected} style={{ accentColor: '#16A34A', marginTop: 2, width: 16, height: 16, cursor: qboConnected ? 'pointer' : 'not-allowed' }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>Push to QuickBooks Online {!qboConnected && <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: '#FEF2F2', color: '#991B1B', fontWeight: 700, marginLeft: 6 }}>Not Connected</span>}</div>
                          <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>{qboConnected ? 'Push invoices directly to QBO with auto customer/sub-job creation.' : 'Connect QBO in Settings → Integrations to enable.'}</div>
                        </div>
                      </label>

                      {/* Send to Payments (queues invoices in Stax for auto-charge) */}
                      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', border: `1px solid ${invOptStax ? theme.colors.orange : theme.colors.border}`, borderRadius: 10, marginBottom: 8, background: invOptStax ? '#FEF3EE' : '#fff', cursor: 'pointer' }}>
                        <input type="checkbox" checked={invOptStax} onChange={() => setInvOptStax(!invOptStax)} style={{ accentColor: theme.colors.orange, marginTop: 2, width: 16, height: 16, cursor: 'pointer' }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>Send to Payments</div>
                          <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>Queue invoices in Stax for auto-charge. Appears on Payments &rarr; Batches within seconds.</div>
                        </div>
                      </label>

                    </div>
                  </>
                );
              })()}

              {invoiceLoading && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 20, justifyContent: 'center', color: theme.colors.textSecondary, fontSize: 13 }}>
                  <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> Preparing batch{invoiceMode === 'storage' ? ' (committing storage rows to ledgers)' : ''}…
                </div>
              )}
              {/* v38.184.0 — "Started!" confirmation. The modal stays open
                  for ~2s so the operator sees a clear acknowledgement, then
                  auto-closes; the bottom-right toast in AppLayout takes
                  over progress display. The remaining batch work runs in
                  the JS background and continues even if the operator
                  navigates away. */}
              {invoiceStartedAt !== null && !invoiceLoading && (
                <div style={{ padding: 20, background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, textAlign: 'center' }}>
                  <CheckCircle size={28} color="#16A34A" style={{ animation: 'pulse 1.5s ease-in-out infinite' }} />
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#166534' }}>Invoice batch started!</div>
                  <div style={{ fontSize: 12, color: '#166534', maxWidth: 380 }}>
                    Processing in the background. You can continue working — the bottom-right toast will track progress, and the rows you selected will show <strong>Invoicing&hellip;</strong> until each invoice commits.
                  </div>
                </div>
              )}
              {invoiceError && !invoiceLoading && invoiceStartedAt === null && (
                <div style={{ padding: 12, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, fontSize: 12, color: '#991B1B', marginBottom: 12 }}><AlertTriangle size={14} style={{ marginRight: 6 }} />{invoiceError}</div>
              )}
              {invoiceResults && !invoiceLoading && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, color: '#15803D', fontSize: 13, fontWeight: 600 }}><CheckCircle size={16} />{invoiceResults.filter(r => r.success).length} invoice(s) created</div>
                  {invoiceResults.map((r, idx) => (
                    <div key={idx} style={{ padding: '10px 14px', borderRadius: 10, border: `1px solid ${r.success ? '#BBF7D0' : '#FECACA'}`, background: r.success ? '#F0FDF4' : '#FEF2F2', marginBottom: 8, fontSize: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ fontWeight: 700 }}>{r.client}</span>
                        {r.success && r.invoiceNo && <a href={r.invoiceUrl || '#'} target="_blank" rel="noreferrer" style={{ color: theme.colors.orange, fontWeight: 600 }}>{r.invoiceNo}</a>}
                      </div>
                      {r.success ? (
                        <div style={{ color: '#374151' }}>
                          ${r.grandTotal?.toFixed(2)} &middot; {r.lineItemCount} items &middot; Email: {r.emailStatus}
                          {r.warnings?.map((w, wi) => <div key={wi} style={{ color: '#B45309', marginTop: 3 }}>Warning: {w}</div>)}
                        </div>
                      ) : <div style={{ color: '#991B1B' }}>{r.error}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={{ padding: '14px 24px', borderTop: `1px solid ${theme.colors.border}`, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => {
                const wasStorage = invoiceMode === 'storage';
                const anySuccess = invoiceResults?.some(r => r.success);
                setShowInvoiceModal(false);
                setInvoiceResults(null);
                setInvoiceError('');
                setInvoiceMode('report');
                if (anySuccess) {
                  loadReport();
                  setRowSel({});
                  setInvoicedRowSel({});
                  if (wasStorage) {
                    // Storage path: those preview rows are now committed +
                    // invoiced. Clear the preview banner so the user sees a
                    // clean slate; the Storage tab list will repopulate on
                    // the next Preview Storage click (the Postgres
                    // calculate_storage_charges RPC excludes already-
                    // invoiced periods).
                    setPreviewLoaded(false);
                    setPreviewRows([]);
                    setCommitResult(null);
                  }
                }
              }} disabled={invoiceLoading} style={{ padding: '9px 18px', fontSize: 13, fontWeight: 500, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: invoiceLoading ? 'not-allowed' : 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary }}>{invoiceResults ? 'Done' : 'Cancel'}</button>
              {!invoiceResults && invoiceStartedAt === null && (
                <WriteButton
                  label={invoiceLoading
                    ? 'Preparing…'
                    : billingBatch.active
                      ? 'Batch in progress — wait'
                      : `Create ${(() => { const s = resolveSelectedRows(); const g: Record<string, boolean> = {}; s.forEach(r => { g[invoiceGroupKey(r)] = true; }); return Object.keys(g).length; })()} Invoice${selCount > 0 ? 's' : ''}`}
                  variant="primary"
                  disabled={invoiceLoading || !selCount || !apiConfigured || billingBatch.active}
                  onClick={handleCreateInvoices}
                />
              )}
            </div>
          </div>
        </>,
        document.body
      )}

      {/* v38.188.0 — Void Selected confirmation modal */}
      {showVoidModal && createPortal(
        <>
          <div
            onClick={() => !voidLoading && (setShowVoidModal(false), setVoidResult(null), setVoidReason(''))}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 200 }}
          />
          <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 520, maxWidth: '95vw', maxHeight: '85vh', background: '#fff', borderRadius: 16, boxShadow: '0 8px 40px rgba(0,0,0,0.15)', zIndex: 201, fontFamily: theme.typography.fontFamily, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '18px 24px', borderBottom: `1px solid ${theme.colors.border}` }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#991B1B', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Ban size={18} /> Void Selected Rows
              </div>
              {!voidResult && (() => {
                const sel = resolveSelectedRows();
                const unbilledRows = sel.filter(r => r.status === 'Unbilled');
                const ignoredCount = sel.length - unbilledRows.length;
                const total = unbilledRows.reduce((s, r) => s + r.total, 0);
                return (
                  <div style={{ fontSize: 12, color: theme.colors.textMuted, marginTop: 4 }}>
                    {unbilledRows.length} Unbilled row{unbilledRows.length !== 1 ? 's' : ''} &middot; ${total.toFixed(2)} total
                    {ignoredCount > 0 && <span style={{ marginLeft: 6, color: '#B45309' }}>({ignoredCount} non-Unbilled row{ignoredCount !== 1 ? 's' : ''} will be ignored)</span>}
                  </div>
                );
              })()}
            </div>

            <div style={{ padding: '18px 24px', flex: 1, overflowY: 'auto', minHeight: 0 }}>
              {!voidResult && !voidLoading && (
                <>
                  <div style={{ fontSize: 13, color: theme.colors.textSecondary, lineHeight: 1.5, marginBottom: 14 }}>
                    Voided rows are flagged on the client&apos;s Billing_Ledger and removed from the Unbilled report. They can&apos;t be invoiced. This action is reversible only by editing the sheet directly.
                  </div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: theme.colors.textSecondary, marginBottom: 6 }}>Reason (optional)</label>
                  <input
                    type="text"
                    value={voidReason}
                    onChange={(e) => setVoidReason(e.target.value)}
                    placeholder="e.g. duplicate intake, billed elsewhere"
                    maxLength={200}
                    style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: `1px solid ${theme.colors.border}`, borderRadius: 8, outline: 'none', fontFamily: 'inherit' }}
                  />
                  <div style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: 6 }}>Appended to each row&apos;s Item Notes for the audit trail.</div>
                </>
              )}

              {voidLoading && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 0', color: theme.colors.textSecondary, fontSize: 13 }}>
                  <Loader2 size={18} style={{ marginRight: 8 }} className="spin" /> Voiding rows…
                </div>
              )}

              {voidResult && (
                <>
                  <div style={{ fontSize: 13, fontWeight: 600, color: voidResult.ok ? '#15803D' : '#B45309', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {voidResult.ok ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
                    {voidResult.voided} row{voidResult.voided !== 1 ? 's' : ''} voided
                    {voidResult.rejected > 0 && <span>&middot; {voidResult.rejected} rejected</span>}
                    {voidResult.alreadyVoid > 0 && <span>&middot; {voidResult.alreadyVoid} already void</span>}
                    {voidResult.notFound > 0 && <span>&middot; {voidResult.notFound} not found</span>}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {voidResult.perGroup.map((g, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', background: g.error ? '#FEF2F2' : '#F9FAFB', borderRadius: 6, fontSize: 12 }}>
                        <span style={{ fontWeight: 500 }}>{g.client}</span>
                        <span style={{ color: g.error ? '#991B1B' : theme.colors.textSecondary }}>
                          {g.error ? g.error : `${g.voided} voided`}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div style={{ padding: '14px 24px', borderTop: `1px solid ${theme.colors.border}`, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              {!voidResult ? (
                <>
                  <button
                    onClick={() => { setShowVoidModal(false); setVoidReason(''); }}
                    disabled={voidLoading}
                    style={{ padding: '7px 14px', fontSize: 13, fontWeight: 500, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: voidLoading ? 'not-allowed' : 'pointer', color: theme.colors.textSecondary, fontFamily: 'inherit' }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleVoidSelected}
                    disabled={voidLoading}
                    style={{ padding: '7px 14px', fontSize: 13, fontWeight: 600, border: '1px solid #DC2626', borderRadius: 8, background: '#DC2626', cursor: voidLoading ? 'progress' : 'pointer', color: '#fff', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6 }}
                  >
                    {voidLoading ? <Loader2 size={13} className="spin" /> : <Ban size={13} />}
                    {voidLoading ? 'Voiding…' : 'Void Rows'}
                  </button>
                </>
              ) : (
                <button
                  onClick={() => { setShowVoidModal(false); setVoidResult(null); setVoidReason(''); }}
                  style={{ padding: '7px 14px', fontSize: 13, fontWeight: 600, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', color: theme.colors.textPrimary, fontFamily: 'inherit' }}
                >
                  Close
                </button>
              )}
            </div>
          </div>
        </>,
        document.body
      )}

      {/* QB Export Result Toast */}
      {qbResult && createPortal(
        <div style={{ position: 'fixed', bottom: selCount > 0 ? 70 : 24, right: 24, zIndex: 300, minWidth: 340, maxWidth: 440, background: '#fff', borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.15)', border: `1px solid ${qbResult.error ? '#FECACA' : '#BBF7D0'}`, fontFamily: theme.typography.fontFamily, overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <div>
              {qbResult.error ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#991B1B', fontSize: 13, fontWeight: 600 }}><AlertTriangle size={16} /> QB Export Failed</div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#15803D', fontSize: 13, fontWeight: 600 }}><CheckCircle size={16} /> Export Complete</div>
              )}
              {qbResult.error ? (
                <div style={{ fontSize: 12, color: '#991B1B', marginTop: 4 }}>{qbResult.error}</div>
              ) : (
                <div style={{ fontSize: 12, color: theme.colors.textSecondary, marginTop: 4 }}>
                  {qbResult.invoiceCount} invoice{qbResult.invoiceCount !== 1 ? 's' : ''} &middot; {qbResult.lineCount} line items &middot; <a href={qbResult.fileUrl || '#'} target="_blank" rel="noreferrer" style={{ color: theme.colors.orange, fontWeight: 600 }}>{qbResult.fileName}</a>
                </div>
              )}
            </div>
            <button onClick={() => setQbResult(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}><X size={14} color={theme.colors.textMuted} /></button>
          </div>
        </div>,
        document.body
      )}

      {/* QBO Push Result Toast */}
      {qboResult && createPortal(
        <div style={{ position: 'fixed', bottom: selCount > 0 ? 130 : 84, right: 24, zIndex: 300, minWidth: 360, maxWidth: 540, background: '#fff', borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.15)', border: `1px solid ${qboResult.error ? '#FECACA' : '#BBF7D0'}`, fontFamily: theme.typography.fontFamily, overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <div style={{ flex: 1 }}>
                {qboResult.error ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#991B1B', fontSize: 13, fontWeight: 600 }}><AlertTriangle size={16} /> QBO Push Failed</div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#15803D', fontSize: 13, fontWeight: 600 }}><CheckCircle size={16} /> QBO Push Complete</div>
                )}
                <div style={{ fontSize: 12, color: qboResult.error ? '#991B1B' : theme.colors.textSecondary, marginTop: 4 }}>
                  {qboResult.error || qboResult.success}
                </div>
              </div>
              <button onClick={() => setQboResult(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, flexShrink: 0 }}><X size={14} color={theme.colors.textMuted} /></button>
            </div>
            {qboResult.details && qboResult.details.length > 0 && (
              <div style={{ marginTop: 10, maxHeight: 200, overflowY: 'auto', border: `1px solid ${theme.colors.border}`, borderRadius: 8 }}>
                {qboResult.details.map((d, i) => (
                  <div key={i} style={{ padding: '6px 10px', fontSize: 11, borderBottom: i < qboResult.details!.length - 1 ? `1px solid ${theme.colors.borderLight}` : undefined, display: 'flex', justifyContent: 'space-between', gap: 8, background: d.success ? '#F0FDF4' : d.error ? '#FEF2F2' : '#fff' }}>
                    <span style={{ fontWeight: 600, flexShrink: 0 }}>{d.strideInvoiceNumber}</span>
                    <span style={{ color: d.success ? '#15803D' : '#991B1B', textAlign: 'right', wordBreak: 'break-word' }}>
                      {d.success ? `QBO #${d.qboInvoiceId || 'OK'}` : (d.error || 'Failed')}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {/* Retry buttons — no need to re-select rows */}
            {qboResult.retryIds && qboResult.retryIds.length > 0 && (
              <div style={{ marginTop: 10, display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <button
                  onClick={async () => {
                    const ids = qboResult.retryIds!;
                    setQboRetrying(true);
                    setQboResult(null);
                    try {
                      const qboRes = await qboPushInvoice(ids);
                      if (qboRes) {
                        const details = (qboRes.results || []).map((r: any) => ({
                          strideInvoiceNumber: r.strideInvoiceNumber || '',
                          error: r.error || undefined,
                          success: r.success || false,
                          qboInvoiceId: r.qboInvoiceId || undefined,
                        }));
                        if (qboRes.success && qboRes.failedCount === 0) {
                          setQboResult({ success: `${qboRes.pushedCount} invoice(s) pushed to QBO`, details });
                        } else {
                          setQboResult({
                            error: qboRes.error || `${qboRes.failedCount} invoice(s) failed to push to QBO`,
                            details,
                            retryIds: ids,
                          });
                        }
                      }
                    } catch (e) {
                      setQboResult({ error: 'QBO Push failed: ' + String(e), retryIds: ids });
                    } finally {
                      setQboRetrying(false);
                    }
                  }}
                  disabled={qboRetrying}
                  style={{
                    padding: '6px 14px', fontSize: 12, fontWeight: 600,
                    border: '1px solid #16A34A', borderRadius: 8,
                    background: '#F0FDF4', cursor: qboRetrying ? 'not-allowed' : 'pointer',
                    fontFamily: 'inherit', color: '#16A34A',
                    display: 'flex', alignItems: 'center', gap: 4,
                  }}
                >
                  {qboRetrying ? <><Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> Retrying...</> : <><RefreshCw size={12} /> Retry QBO Push</>}
                </button>
                {/* Force Push with QBO auto-assign — rescue for "Duplicate Document Number" errors */}
                <button
                  onClick={async () => {
                    const ids = qboResult.retryIds!;
                    const confirmed = window.confirm(
                      'Force Push with QBO Auto-Assign?\n\n' +
                      'QBO will assign its own invoice number (not using Stride INV#).\n' +
                      'Stride INV# will be stored in QBO\'s private memo for reference.\n' +
                      'QBO\'s assigned number will be saved in a new "QBO Invoice #" column.\n\n' +
                      'Use this only when a normal push fails with "Duplicate Document Number Error".\n\n' +
                      'Continue?'
                    );
                    if (!confirmed) return;
                    setQboRetrying(true);
                    setQboResult(null);
                    try {
                      const qboRes = await qboPushInvoice(ids, true, true);
                      if (qboRes) {
                        const details = (qboRes.results || []).map((r: any) => ({
                          strideInvoiceNumber: r.strideInvoiceNumber || '',
                          error: r.error || undefined,
                          success: r.success || false,
                          qboInvoiceId: r.qboInvoiceId || undefined,
                        }));
                        if (qboRes.success && qboRes.failedCount === 0) {
                          setQboResult({ success: `${qboRes.pushedCount} invoice(s) force-pushed to QBO (auto-assigned)`, details });
                        } else {
                          setQboResult({
                            error: qboRes.error || `${qboRes.failedCount} invoice(s) failed to force-push`,
                            details,
                            retryIds: ids,
                          });
                        }
                      }
                    } catch (e) {
                      setQboResult({ error: 'Force Push failed: ' + String(e), retryIds: ids });
                    } finally {
                      setQboRetrying(false);
                    }
                  }}
                  disabled={qboRetrying}
                  style={{
                    padding: '6px 14px', fontSize: 12, fontWeight: 600,
                    border: '1px solid #D97706', borderRadius: 8,
                    background: '#FFFBEB', cursor: qboRetrying ? 'not-allowed' : 'pointer',
                    fontFamily: 'inherit', color: '#92400E',
                    display: 'flex', alignItems: 'center', gap: 4,
                  }}
                  title="Force push — QBO assigns its own invoice number. Use when you get duplicate number errors."
                >
                  <AlertTriangle size={12} /> Force Push (QBO Auto-#)
                </button>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
      {/* QBO Retrying overlay toast */}
      {qboRetrying && !qboResult && createPortal(
        <div style={{ position: 'fixed', bottom: selCount > 0 ? 130 : 84, right: 24, zIndex: 300, minWidth: 340, background: '#fff', borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.15)', border: `1px solid ${theme.colors.border}`, fontFamily: theme.typography.fontFamily, padding: '14px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: theme.colors.textSecondary, fontSize: 13 }}>
            <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Retrying QBO Push...
          </div>
        </div>,
        document.body
      )}

      {/* Billing Detail Panel */}
      {selectedBillingRow && (
        <BillingDetailPanel
          row={selectedBillingRow}
          onClose={() => setSelectedBillingRow(null)}
          canManageManual={canManageManualCharges}
          onEditManual={() => openEditManualCharge(selectedBillingRow)}
          onVoidManual={() => handleVoidManualCharge(selectedBillingRow)}
          onNavigate={(type, id) => {
            setSelectedBillingRow(null);
            if (type === 'task') window.location.hash = `#/tasks?highlight=${id}`;
            else if (type === 'repair') window.location.hash = `#/repairs?highlight=${id}`;
            else if (type === 'shipment') window.location.hash = `#/receiving?highlight=${id}`;
            else if (type === 'item') window.location.hash = `#/inventory?highlight=${id}`;
          }}
        />
      )}

      {/* Add / Edit Manual Charge modal */}
      {showAddCharge && (
        <AddChargeModal
          defaultClientSheetId={rptClientFilter.length === 1 ? (clientNameMap && Object.entries(clientNameMap).find(([, name]) => name === rptClientFilter[0])?.[0]) || '' : ''}
          onClose={() => setShowAddCharge(false)}
          onSaved={handleManualChargeSaved}
        />
      )}
      {editingManualCharge && (
        <AddChargeModal
          editing={editingManualCharge}
          onClose={() => setEditingManualCharge(null)}
          onSaved={handleManualChargeSaved}
        />
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      {toast && createPortal(<div style={{ position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)', background: '#1A1A1A', color: '#fff', padding: '10px 20px', borderRadius: 10, fontSize: 13, fontWeight: 600, zIndex: 9999, boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }}>{toast}</div>, document.body)}
      </div>
    </div>
  );
}
