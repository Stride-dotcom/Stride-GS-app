import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useIsMobile } from '../hooks/useIsMobile';
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
  CheckCircle, AlertTriangle, Loader2, Pencil, X, RefreshCw, Plus, Scale, CreditCard,
} from 'lucide-react';
import { ParityMonitor } from './ParityMonitor';
import { useVirtualRows } from '../hooks/useVirtualRows';
import { theme } from '../styles/theme';
import { fmtDate } from '../lib/constants';
import { WriteButton } from '../components/shared/WriteButton';
import { MultiSelectFilter } from '../components/shared/MultiSelectFilter';
import { SyncBanner } from '../components/shared/SyncBanner';
import { BatchProgress, type BatchState } from '../components/shared/BatchProgress';
import { BulkResultSummary } from '../components/shared/BulkResultSummary';
import { runBatchLoop } from '../lib/batchLoop';
import {
  isApiConfigured,
  postGenerateStorageCharges, type GenerateStorageChargesResponse,
  type UnbilledReportRow,
  postCreateInvoice, type CreateInvoiceResponse,
  postResendInvoiceEmail,
  fetchBilling,
  postPreviewStorageCharges, type PreviewStorageRow,
  postQbExport,
  postQbExcelExport,
  postUpdateBillingRow,
  postUpdateQboStatus,
} from '../lib/api';
import type { BillingFilterParams, BillingResponse, BatchMutationResult } from '../lib/api';
import {
  fetchBillingFromSupabaseFiltered,
  fetchBillingSidemarksFromSupabase,
  isSupabaseCacheAvailable,
} from '../lib/supabaseQueries';
import type { ClientNameMap } from '../lib/supabaseQueries';
import { useBilling } from '../hooks/useBilling';
import { useClients } from '../hooks/useClients';
import { usePricing } from '../hooks/usePricing';
import { BillingDetailPanel } from '../components/shared/BillingDetailPanel';
import { useTablePreferences } from '../hooks/useTablePreferences';
import { InfoTooltip } from '../components/shared/InfoTooltip';
import { QBOPushButton } from '../components/billing/QBOPushButton';
import { AddChargeModal, type ManualChargeEditTarget } from '../components/billing/AddChargeModal';
import { useQBO } from '../hooks/useQBO';
import { useAuth } from '../contexts/AuthContext';
import { postVoidManualCharge } from '../lib/api';

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

// ─── Invoice Review Mock Data ────────────────────────────────────────────────

interface InvoiceReviewRow {
  invNo: string; client: string; svcCode: string; svcName: string;
  itemId: string; description: string; qty: number; rate: number; total: number;
  action: 'pending' | 'approved' | 'voided';
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

function EditableCell({ value, onChange, type = 'text', align, currency = true }: { value: string | number; onChange: (v: string) => void; type?: 'text' | 'number'; align?: 'right'; currency?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing && inputRef.current) inputRef.current.focus(); }, [editing]);

  if (!editing) {
    return (
      <div
        onClick={() => { setDraft(String(value)); setEditing(true); }}
        style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, minHeight: 20, fontSize: 12, color: theme.colors.text, textAlign: align }}
        title="Click to edit"
      >
        {type === 'number' ? (currency ? `$${Number(value).toFixed(2)}` : String(Number(value))) : (String(value) || '\u2014')}
        <Pencil size={10} color={theme.colors.textMuted} style={{ opacity: 0.4, flexShrink: 0 }} />
      </div>
    );
  }

  return (
    <input
      ref={inputRef}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => { onChange(draft); setEditing(false); }}
      onKeyDown={e => { if (e.key === 'Enter') { onChange(draft); setEditing(false); } if (e.key === 'Escape') setEditing(false); }}
      type={type}
      step={type === 'number' ? '0.01' : undefined}
      style={{ width: '100%', padding: '2px 6px', fontSize: 12, border: `1px solid ${theme.colors.orange}`, borderRadius: 4, outline: 'none', fontFamily: 'inherit', textAlign: align, background: '#FFFBF5' }}
    />
  );
}

// ─── Invoice Review Tab ──────────────────────────────────────────────────────

function InvoiceReviewTab() {
  const [rows, setRows] = useState<InvoiceReviewRow[]>([]);
  const reviewTh: React.CSSProperties = { padding: '8px 12px', textAlign: 'left', fontWeight: 500, fontSize: 10, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: `2px solid ${theme.colors.border}`, whiteSpace: 'nowrap' };
  const reviewTd: React.CSSProperties = { padding: '10px 12px', fontSize: 12, borderBottom: `1px solid ${theme.colors.borderLight}`, verticalAlign: 'middle' };
  const ACTION_CFG: Record<string, { bg: string; text: string }> = { pending: { bg: '#FEF3C7', text: '#B45309' }, approved: { bg: '#F0FDF4', text: '#15803D' }, voided: { bg: '#F3F4F6', text: '#6B7280' } };
  const pending = rows.filter(r => r.action === 'pending');
  const approved = rows.filter(r => r.action === 'approved');
  const total = approved.reduce((s, r) => s + r.total, 0);
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 20 }}>
        {[{ label: 'Pending Review', value: pending.length, color: '#FBBF24' }, { label: 'Approved', value: approved.length, color: '#4ADE80' }, { label: 'Approved Total', value: `$${total.toFixed(2)}`, color: '#E8692A' }].map(({ label, value, color }) => (
          <div key={label} style={{ padding: '20px 22px', background: '#1C1C1C', borderRadius: 20 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '2px', marginBottom: 10 }}>{label}</div>
            <div style={{ fontSize: 28, fontWeight: 300, color, lineHeight: 1 }}>{value}</div>
          </div>
        ))}
      </div>
      <div style={{ background: '#fff', border: `1px solid ${theme.colors.border}`, borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${theme.colors.borderLight}` }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Invoice Line Items for Review</span>
          <WriteButton label="Approve All Pending" variant="primary" size="sm" onClick={async () => { setRows(prev => prev.map(r => r.action === 'pending' ? { ...r, action: 'approved' } : r)); }} />
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['Action', 'INV #', 'Client', 'Svc Code', 'Svc Name', 'Item ID', 'Description', 'Qty', 'Rate', 'Total'].map(h => <th key={h} style={{ ...reviewTh, ...(h === 'Description' ? { minWidth: 200 } : {}), ...(['Qty', 'Rate', 'Total'].includes(h) ? { textAlign: 'right' } : {}) }}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={idx} style={{ background: row.action === 'voided' ? '#FAFAFA' : 'transparent', opacity: row.action === 'voided' ? 0.6 : 1 }}>
                <td style={{ ...reviewTd, minWidth: 180 }}>
                  {row.action === 'pending' ? (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <WriteButton label="Approve" variant="secondary" size="sm" onClick={async () => setRows(prev => prev.map((r, i) => i === idx ? { ...r, action: 'approved' } : r))} />
                      <WriteButton label="Void" variant="danger" size="sm" onClick={async () => setRows(prev => prev.map((r, i) => i === idx ? { ...r, action: 'voided' } : r))} />
                    </div>
                  ) : <Badge t={row.action} c={ACTION_CFG[row.action]} />}
                </td>
                <td style={{ ...reviewTd, fontWeight: 600, fontSize: 12 }}>{row.invNo}</td>
                <td style={reviewTd}>{row.client}</td>
                <td style={reviewTd}><Badge t={row.svcCode} c={SVC_CFG[row.svcCode]} /></td>
                <td style={{ ...reviewTd, color: theme.colors.textSecondary }}>{row.svcName}</td>
                <td style={{ ...reviewTd, color: theme.colors.textSecondary }}>{row.itemId}</td>
                <td style={{ ...reviewTd, color: theme.colors.textSecondary, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.description}</td>
                <td style={{ ...reviewTd, textAlign: 'right' }}>{row.qty}</td>
                <td style={{ ...reviewTd, textAlign: 'right', color: theme.colors.textSecondary }}>${row.rate.toFixed(2)}</td>
                <td style={{ ...reviewTd, textAlign: 'right', fontWeight: 600 }}>${row.total.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
  const [activeTab, setActiveTab] = useState<'report' | 'storage' | 'review' | 'parity'>('report');

  // ─── Service list from Master Price List (dynamic, not hardcoded) ─────────
  const { priceList } = usePricing(apiConfigured);
  const ALL_SERVICES = useMemo(() => {
    if (priceList.length) {
      return priceList
        .filter(r => r.Active)
        .map(r => ({ code: String(r['Service Code'] || '').trim(), name: String(r['Service Name'] || '').trim() }))
        .filter(s => s.code);
    }
    return [
      { code: 'RCVG', name: 'Receiving' }, { code: 'INSP', name: 'Inspection' },
      { code: 'ASM', name: 'Assembly' }, { code: 'REPAIR', name: 'Repair (Flat)' },
      { code: 'PLLT', name: 'Palletize' }, { code: 'PICK', name: 'Pull Prep' },
      { code: 'LABEL', name: 'Relabeling' }, { code: 'DISP', name: 'Disposal' },
      { code: 'RSTK', name: 'Restock' }, { code: 'MNRTU', name: 'Minor Touch Up' },
      { code: 'STOR', name: 'Storage' }, { code: 'WC', name: 'Will Call Release' },
      { code: 'SIT', name: 'Sit Test' },
    ];
  }, [priceList]);

  // Non-storage services for billing report tab
  const NON_STOR_SERVICES = useMemo(() => ALL_SERVICES.filter(s => s.code !== 'STOR'), [ALL_SERVICES]);

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
  const [rptSvcFilter, setRptSvcFilter] = useState<string[]>([]);
  const [rptStatusFilter, setRptStatusFilter] = useState<string[]>(['Unbilled']);
  const [rptEndDate, setRptEndDate] = useState(today);

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
    (apiRows ?? []).map(r => ({
      ledgerRowId: r.ledgerRowId, status: r.status, invoiceNo: r.invoiceNo,
      client: r.clientName, clientSheetId: r.clientSheetId, clientName: r.clientName,
      date: r.date, svcCode: r.svcCode, svcName: r.svcName,
      itemId: r.itemId, description: r.description, itemClass: r.itemClass,
      qty: r.qty, rate: r.rate ?? 0, total: r.total ?? 0,
      taskId: r.taskId, repairId: r.repairId, shipmentNo: r.shipmentNo,
      notes: r.itemNotes, sourceSheetId: r.clientSheetId,
      sidemark: r.sidemark || '', reference: r.reference || '', category: (r as any).category || '',
      staxCustomerId: (r as any).staxCustomerId || null,
      autoCharge: (r as any).autoCharge === true,
      qboStatus: r.qboStatus || null,
      qboInvoiceId: r.qboInvoiceId || null,
      invoiceDate: r.invoiceDate || '',
    }))
  , []);

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
  }, [rptStatusFilter, rptSvcFilter, rptSidemarkFilter, rptEndDate, rptClientFilter, ALL_SERVICES, clientNameMap, mapBillingRows]);

  const clearReportFilters = useCallback(() => {
    setRptClientFilter([]);
    setRptSidemarkFilter([]);
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

  // Pre-fetch sidemarks from Supabase when storage client filter changes
  useEffect(() => {
    if (!storClientFilter.length) return;
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

  // Populate initial client/sidemark options from billing hook
  useEffect(() => {
    if (liveRows.length > 0) {
      const clients = [...new Set(liveRows.map(r => r.clientName))].filter(Boolean).sort();
      const sidemarks = [...new Set(liveRows.map(r => r.sidemark).filter(Boolean) as string[])].sort();
      setKnownClients(prev => [...new Set([...prev, ...clients])].sort());
      setKnownSidemarks(prev => [...new Set([...prev, ...sidemarks])].sort());
      setStorKnownClients(prev => [...new Set([...prev, ...clients])].sort());
      setStorKnownSidemarks(prev => [...new Set([...prev, ...sidemarks])].sort());
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
      const res = await postPreviewStorageCharges({
        startDate: storStartDate,
        endDate: storEndDate,
        clientFilter: storClientFilter.length ? storClientFilter.join(',') : undefined,
        sidemarkFilter: storSidemarkFilter.length ? storSidemarkFilter.join(',') : undefined,
      });
      if (res.error || !res.data?.success) {
        setPreviewError(res.data?.error || res.error || 'Preview failed');
        setPreviewLoading(false);
        return;
      }

      const rows = (res.data.rows ?? []).map((r: PreviewStorageRow) => ({
        ledgerRowId: r.taskId, status: 'Preview', invoiceNo: '', client: r.client,
        date: r.date.includes('-') ? r.date : r.date.slice(0,4)+'-'+r.date.slice(4,6)+'-'+r.date.slice(6,8),
        svcCode: 'STOR', svcName: 'Storage', itemId: r.itemId,
        description: r.description, itemClass: r.itemClass, qty: r.qty,
        rate: r.rate, total: r.total, taskId: r.taskId, repairId: '',
        shipmentNo: r.shipmentNo, notes: r.notes,
        sourceSheetId: r.sourceSheetId, sidemark: r.sidemark,
      }));

      setPreviewRows(rows);
      setPreviewTotalAmount(rows.reduce((s: number, r: BillingRow) => s + r.total, 0));
      setPreviewLoaded(true);
      setLastStorPreviewKey(currentStorKey);
      // Track known options
      setStorKnownClients(prev => {
        const fromRows = rows.map((r: BillingRow) => r.client);
        return [...new Set([...prev, ...fromRows])].sort();
      });
      setStorKnownSidemarks(prev => {
        const fromRows = rows.map((r: BillingRow) => r.sidemark).filter(Boolean) as string[];
        return [...new Set([...prev, ...fromRows])].sort();
      });
    } catch (err) {
      setPreviewError(`Preview error: ${err instanceof Error ? err.message : String(err)}`);
    }
    setPreviewLoading(false);
  }, [storStartDate, storEndDate, storClientFilter, storSidemarkFilter, currentStorKey]);

  const handleCommitPreview = useCallback(async () => {
    setCommitLoading(true);
    try {
      const res = await postGenerateStorageCharges({ startDate: storStartDate, endDate: storEndDate });
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
  }, [storStartDate, storEndDate, refetchBilling]);

  // QB Export state
  const [qbLoading, setQbLoading] = useState(false);
  const [qbResult, setQbResult] = useState<{ fileName?: string; fileUrl?: string; invoiceCount?: number; lineCount?: number; error?: string } | null>(null);

  // QBO Push state
  const [qboResult, setQboResult] = useState<{ success?: string; error?: string; details?: Array<{ strideInvoiceNumber: string; error?: string; success?: boolean; qboInvoiceId?: string }>; retryIds?: string[] } | null>(null);
  const [qboRetrying, setQboRetrying] = useState(false);

  // Create Invoice state
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [invOptEmail, setInvOptEmail] = useState(true);
  const [invOptQbo, setInvOptQbo] = useState(false);
  const [invOptStax, setInvOptStax] = useState(false);
  const invOptQb = false; // QB Export removed — checkbox no longer exists
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [invoiceBatch, setInvoiceBatch] = useState<{ state: BatchState; total: number; processed: number; succeeded: number; failed: number }>({
    state: 'idle', total: 0, processed: 0, succeeded: 0, failed: 0,
  });
  const [invoiceBulkResult, setInvoiceBulkResult] = useState<BatchMutationResult | null>(null);
  const [invoiceResults, setInvoiceResults] = useState<Array<CreateInvoiceResponse & { client: string }> | null>(null);
  const [invoiceError, setInvoiceError] = useState('');

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
    if (!row.clientSheetId) return;
    const payload: Record<string, unknown> = { ledgerRowId: row.ledgerRowId };
    if (field === 'sidemark') payload.sidemark = value;
    else if (field === 'description') payload.description = value;
    else if (field === 'rate') payload.rate = parseFloat(value) || 0;
    else if (field === 'qty') payload.qty = parseFloat(value) || 1;
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
    } else {
      setReportData(prev => prev.map(r => r.ledgerRowId === row.ledgerRowId ? { ...r, [field]: value } : r));
    }

    // Backend persist
    const resp = await postUpdateBillingRow(payload as any, row.clientSheetId);
    if (!resp.ok || !resp.data?.success) {
      // Revert
      setReportData(prev => prev.map(r => r.ledgerRowId === row.ledgerRowId ? oldRow : r));
      showToast('Save failed: ' + (resp.error || resp.data?.error || 'Unknown error'));
    }
  }, [showToast]);

  // ─── Columns ──────────────────────────────────────────────────────────────
  const col = createColumnHelper<BillingRow>();
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
      col.accessor('status', { header: 'Status', size: 100, filterFn: mf, cell: i => {
        const v = i.getValue();
        if (v === 'Preview') return <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: '#FFFDE7', color: '#F59E0B', border: '1.5px dashed #F59E0B', whiteSpace: 'nowrap' }}>Preview</span>;
        return <Badge t={v} c={STATUS_CFG[v]} />;
      } }),
      col.accessor('invoiceNo', { header: 'Invoice #', size: 110, cell: i => <span style={{ fontSize: 12, fontWeight: i.getValue() ? 600 : 400, color: i.getValue() ? theme.colors.text : theme.colors.textMuted }}>{i.getValue() || '\u2014'}</span> }),
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
        const canEdit = isReportTab && i.row.original.status === 'Unbilled';
        return canEdit
          ? <EditableCell value={i.getValue() || ''} onChange={v => saveReportField(i.row.original, 'sidemark', v)} />
          : <span style={{ fontSize: 12, color: theme.colors.textSecondary }}>{i.getValue() || '\u2014'}</span>;
      } }),
      col.accessor('reference', {
        header: 'Reference', size: 130, filterFn: mf,
        cell: i => <span style={{ fontSize: 12, color: theme.colors.textSecondary, fontFamily: 'monospace' }}>{i.getValue() || '\u2014'}</span>,
      }),
      col.accessor('date', { header: 'Date', size: 100, cell: i => <span style={{ fontSize: 12, color: theme.colors.textSecondary }}>{fmt(i.getValue())}</span> }),
      col.accessor('svcCode', { header: 'Svc Code', size: 90, filterFn: mf, cell: i => <Badge t={i.getValue()} c={SVC_CFG[i.getValue()]} /> }),
      col.accessor('svcName', { header: 'Service', size: 100, cell: i => <span style={{ fontSize: 12, color: theme.colors.textSecondary }}>{i.getValue()}</span> }),
      col.accessor('itemId', { header: 'Item', size: 90, cell: i => <span style={{ fontSize: 12, color: theme.colors.textSecondary }}>{i.getValue()}</span> }),
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
      col.accessor('total', { header: 'Total', size: 90, cell: i => <span style={{ fontSize: 12, fontWeight: 600, color: theme.colors.text }}>${i.getValue().toFixed(2)}</span> }),
      col.accessor('taskId', { header: 'Task', size: 90, cell: i => <span style={{ fontSize: 12, color: theme.colors.textMuted }}>{i.getValue() || '\u2014'}</span> }),
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
  }, [isPreviewMode, isReportTab, col, updatePreviewRow, saveReportField]);

  // ─── Report summary stats ─────────────────────────────────────────────────
  const reportTotal = useMemo(() => reportData.reduce((s, r) => s + r.total, 0), [reportData]);
  const reportClientCount = useMemo(() => new Set(reportData.map(r => r.client)).size, [reportData]);
  const reportRowCount = reportData.length;

  const table = useReactTable({
    data: tableData, columns,
    state: { sorting, columnFilters, globalFilter, columnVisibility: colVis, rowSelection: rowSel, columnOrder: columnOrder.length ? columnOrder : DEFAULT_COL_ORDER },
    onSortingChange: setSorting, onColumnFiltersChange: setColumnFilters, onGlobalFilterChange: setGlobalFilter, onColumnVisibilityChange: setColVis, onRowSelectionChange: setRowSel,
    onColumnOrderChange: (updater) => setColumnOrder(typeof updater === 'function' ? updater(columnOrder.length ? columnOrder : DEFAULT_COL_ORDER) : updater),
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getFilteredRowModel: getFilteredRowModel(),
    enableMultiSort: true,
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
      cell: i => <span style={{ fontSize: 12, fontWeight: 700, color: theme.colors.text }}>{i.getValue()}</span>,
    }),
    invCol.accessor('client', {
      header: 'Client', size: 200,
      cell: i => {
        const row = i.row.original;
        // Show Auto Pay badge if client has autopay enabled (autoCharge !== false + has staxCustomerId)
        const hasAutoPay = row.autoCharge !== false && !!row.staxCustomerId;
        return (
          <span style={{ fontSize: 12, fontWeight: 500, display: 'inline-flex', alignItems: 'center' }}>
            {i.getValue()}
            {hasAutoPay && (
              <span
                style={{
                  marginLeft: 6, fontSize: 9, padding: '1px 5px', borderRadius: 4,
                  background: '#F0FDF4', color: '#15803D', fontWeight: 700,
                  whiteSpace: 'nowrap',
                }}
                title="Auto Pay enabled — this invoice can be charged automatically via Stax"
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

  const invoicedTable = useReactTable({
    data: billingSections.invoicedGroups,
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

  // ─── Create Invoices from Selected Rows ────────────────────────────────────
  const handleCreateInvoices = async () => {
    const selRows = resolveSelectedRows();
    if (!selRows.length) return;

    setInvoiceLoading(true);
    setInvoiceError('');

    // Session 69 — optimistic hide: remove selected rows from the on-screen report
    // immediately so the table feels instant. Snapshot so we can restore on failure.
    // Per-group success/failure reconciliation happens below after runBatchLoop.
    const selectedIdsByGroup: Record<string, string[]> = {};
    const allHiddenIds: string[] = [];
    for (const r of selRows) {
      const key = (r.sourceSheetId || r.client) + '|' + (r.sidemark || '');
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
      // Group by client + sidemark so SEPARATE_BY_SIDEMARK clients get one invoice per sidemark
      const key = (r.sourceSheetId || r.client) + '|' + (r.sidemark || '');
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
    const results: Array<CreateInvoiceResponse & { client: string }> = [];
    for (const s of preflightSkipped) {
      results.push({ success: false, client: s.id, error: s.reason });
    }
    setInvoiceBatch({ state: 'processing', total: invokable.length, processed: 0, succeeded: 0, failed: 0 });
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
            skipEmail: !invOptEmail,
          } as any);
          if (res.data) {
            results.push({ ...res.data, client: g.client });
            if (!res.data.success) return { ok: false, error: res.data.error || 'Server returned success=false' };
            return { ok: true, data: res.data };
          }
          const err = res.error || 'Unknown error';
          results.push({ success: false, client: g.client, error: err });
          return { ok: false, error: err };
        } catch (err: unknown) {
          const msg = String(err);
          results.push({ success: false, client: g.client, error: msg });
          return { ok: false, error: msg };
        }
      },
      onProgress: (done, total) => setInvoiceBatch(prev => ({ ...prev, processed: done, total })),
      preflightSkipped,
    });
    setInvoiceBatch({ state: 'complete', total: invokable.length, processed: invokable.length, succeeded: batchResult.succeeded, failed: batchResult.failed });
    setInvoiceBulkResult(batchResult);

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
            const key = (g.sourceSheetId || g.client) + '|' + (g.sidemark || '');
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
        <button onClick={() => window.open('https://drive.google.com/drive/folders/1nN-9xm2SdR1_Sk603nmudWHhMxlaHElx', '_blank')} title="Open exports folder in Google Drive" style={{ padding: '7px 12px', fontSize: 12, fontWeight: 500, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'inherit', color: theme.colors.textSecondary }}><ExternalLink size={14} /> IIF Folder</button>
        {isReportTab && <button onClick={async () => {
          const sel = resolveSelectedRows();
          if (!sel.length) { setQbResult({ error: 'Select invoiced rows to export. Use the checkboxes to select rows first.' }); return; }
          const invoicedRows = sel.filter(r => r.status === 'Invoiced');
          if (!invoicedRows.length) { setQbResult({ error: 'None of the selected rows are Invoiced. Create invoices first, then select the invoiced rows to export.' }); return; }
          await handleStaxIifExport(invoicedRows.map(r => r.ledgerRowId));
        }} disabled={qbLoading} style={{ padding: '7px 12px', fontSize: 12, fontWeight: 600, border: '1px solid #7C3AED', borderRadius: 8, background: '#fff', cursor: qbLoading ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'inherit', color: '#7C3AED' }}><DollarSign size={14} /> {qbLoading ? 'Exporting...' : 'Stax IIF'}</button>}
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
        <button onClick={() => setActiveTab('parity')} style={tabChip(activeTab === 'parity')}><Scale size={14} /> Rate Parity</button>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          TAB: Rate Parity — MPL sheet vs Supabase service catalog diff
         ═══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'parity' && <ParityMonitor />}

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
              <MultiSelectFilter label="Service" options={NON_STOR_SERVICES.map(s => s.name)} selected={rptSvcFilter} onChange={setRptSvcFilter} placeholder="All Services" />
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
                <div style={{ display: 'flex', gap: 8 }}>
                  {commitResult ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 8, fontSize: 12, color: '#15803D', fontWeight: 600 }}>
                      <CheckCircle size={14} /> {commitResult.totalCreated} rows committed to ledger
                    </div>
                  ) : (
                    <WriteButton
                      label={commitLoading ? 'Committing...' : 'Commit to Ledger'}
                      variant="primary"
                      icon={commitLoading ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                      disabled={commitLoading || !previewRows.length}
                      onClick={handleCommitPreview}
                    />
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
                <WriteButton label="Re-send Email" variant="ghost" size="sm" onClick={async () => {
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

            {/* Create Invoice button (report tab only, for unbilled rows) */}
            {activeTab === 'report' && (
              <WriteButton
                label="Create Invoice"
                variant="ghost"
                size="sm"
                icon={<Send size={13} />}
                onClick={async () => { setInvoiceResults(null); setInvoiceError(''); setShowInvoiceModal(true); }}
              />
            )}



          </div>
        </div>,
        document.body
      )}

      {/* ─── Create Invoices Modal ────────────────────────────────────────── */}
      {showInvoiceModal && createPortal(
        <>
          <div onClick={() => !invoiceLoading && (setShowInvoiceModal(false), setInvoiceResults(null), setInvoiceError(''))} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 200 }} />
          <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 540, maxWidth: '95vw', maxHeight: '85vh', background: '#fff', borderRadius: 16, boxShadow: '0 8px 40px rgba(0,0,0,0.15)', zIndex: 201, fontFamily: theme.typography.fontFamily, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '18px 24px', borderBottom: `1px solid ${theme.colors.border}` }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>Create & Send Invoices</div>
              <div style={{ fontSize: 12, color: theme.colors.textMuted, marginTop: 2 }}>
                {selCount} selected row{selCount !== 1 ? 's' : ''} &middot; ${selectionTotal.toFixed(2)} total
              </div>
            </div>
            <div style={{ padding: '18px 24px', flex: 1, overflowY: 'auto', minHeight: 0 }}>
              {!invoiceResults && !invoiceLoading && (() => {
                const selRows = resolveSelectedRows();
                const groups: Record<string, { client: string; sidemark: string; rows: BillingRow[]; total: number }> = {};
                selRows.forEach(r => {
                  const key = (r.sourceSheetId || r.client) + '|' + (r.sidemark || '');
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

                      {/* Always-on: Create & Save */}
                      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', border: `1px solid ${theme.colors.orange}`, borderRadius: 10, marginBottom: 8, background: '#FEF3EE', cursor: 'default' }}>
                        <input type="checkbox" checked disabled style={{ accentColor: theme.colors.orange, marginTop: 2, width: 16, height: 16 }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>Create & Save Invoices <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: '#F0FDF4', color: '#15803D', fontWeight: 700, marginLeft: 6 }}>Always</span></div>
                          <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>Generate invoice PDFs and save to each client's accounting folder. Updates status to Invoiced.</div>
                        </div>
                      </label>

                      {/* Send Email */}
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

                      {/* Stax IIF Export */}
                      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', border: `1px solid ${invOptStax ? theme.colors.orange : theme.colors.border}`, borderRadius: 10, marginBottom: 8, background: invOptStax ? '#FEF3EE' : '#fff', cursor: 'pointer' }}>
                        <input type="checkbox" checked={invOptStax} onChange={() => setInvOptStax(!invOptStax)} style={{ accentColor: theme.colors.orange, marginTop: 2, width: 16, height: 16, cursor: 'pointer' }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>Export Stax IIF</div>
                          <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>Generate a Stax-compatible IIF file for payment processing.</div>
                        </div>
                      </label>

                    </div>
                  </>
                );
              })()}

              {invoiceLoading && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 20, justifyContent: 'center', color: theme.colors.textSecondary, fontSize: 13 }}>
                  <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> Creating invoices{invOptQbo ? ' & pushing to QBO' : ''}{invOptStax ? ' & exporting Stax IIF' : ''}... This may take a few minutes for large batches.
                </div>
              )}
              {invoiceError && !invoiceLoading && (
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
              <button onClick={() => { setShowInvoiceModal(false); setInvoiceResults(null); setInvoiceError(''); if (invoiceResults?.some(r => r.success)) { loadReport(); setRowSel({}); setInvoicedRowSel({}); } }} disabled={invoiceLoading} style={{ padding: '9px 18px', fontSize: 13, fontWeight: 500, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: invoiceLoading ? 'not-allowed' : 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary }}>{invoiceResults ? 'Done' : 'Cancel'}</button>
              {!invoiceResults && (
                <WriteButton
                  label={invoiceLoading ? 'Creating...' : `Create ${(() => { const s = resolveSelectedRows(); const g: Record<string, boolean> = {}; s.forEach(r => { g[(r.sourceSheetId || r.client) + '|' + (r.sidemark || '')] = true; }); return Object.keys(g).length; })()} Invoice${selCount > 0 ? 's' : ''}`}
                  variant="primary"
                  disabled={invoiceLoading || !selCount || !apiConfigured}
                  onClick={handleCreateInvoices}
                />
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
