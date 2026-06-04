/**
 * Invoices.tsx — client-facing invoice portal at #/invoices.
 *
 * Lists a client's own invoices from public.invoice_tracking (RLS-scoped) with
 * invoice #, date, total, and payment status. Each row links to the archived
 * PDF in the `invoices` storage bucket — the client mints its own RLS-scoped
 * signed URL on demand from invoice_tracking.pdf_path. Falls back to the
 * printable React invoice route when no PDF has been generated yet.
 *
 * Sidebar item is client-only (see Sidebar CLIENT_NAV); the route also allows
 * admins for support/preview — admins additionally get a one-time "Backfill
 * PDFs" action for historical invoices that predate React-side PDF archiving.
 */
import { useEffect, useMemo, useState } from 'react';
import { Download, ExternalLink, FileText, Loader2, RefreshCw } from 'lucide-react';
import { theme } from '../styles/theme';
import { useAuth } from '../contexts/AuthContext';
import { useInvoices, type InvoiceRecord } from '../hooks/useInvoices';
import { DataTable, type Column } from '../components/shared/DataTable';
import { supabase } from '../lib/supabase';
import {
  backfillInvoicePdfs,
  countInvoicesMissingPdf,
  type BackfillProgress,
} from '../lib/invoiceBackfill';

type StatusFilter = 'all' | 'paid' | 'unpaid';
type SortDir = 'asc' | 'desc';

function fmtMoney(n: number): string {
  return (Number(n) || 0).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  });
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(String(iso).length <= 10 ? iso + 'T00:00:00' : iso);
  if (isNaN(d.getTime())) return String(iso);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}/${d.getFullYear()}`;
}

function StatusPill({ paid }: { paid: boolean }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 10px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        color: paid ? theme.colors.statusGreen : theme.colors.statusAmber,
        background: paid ? theme.colors.statusGreenBg : theme.colors.statusAmberBg,
      }}
    >
      {paid ? 'Paid' : 'Unpaid'}
    </span>
  );
}

export function Invoices() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { invoices, loading, error, refetch } = useInvoices(true);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [openingNo, setOpeningNo] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  // Admin-only PDF backfill state.
  const [missingCount, setMissingCount] = useState<number | null>(null);
  const [backfilling, setBackfilling] = useState(false);
  const [progress, setProgress] = useState<BackfillProgress | null>(null);
  const [backfillSummary, setBackfillSummary] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    countInvoicesMissingPdf().then(setMissingCount).catch(() => setMissingCount(null));
  }, [isAdmin, invoices.length]);

  const filtered = useMemo(() => {
    let rows = invoices;
    if (statusFilter === 'paid') rows = rows.filter(r => r.qboPaid);
    else if (statusFilter === 'unpaid') rows = rows.filter(r => !r.qboPaid);
    const sorted = [...rows].sort((a, b) => {
      const av = a.invoiceDate || '';
      const bv = b.invoiceDate || '';
      const cmp = av.localeCompare(bv);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [invoices, statusFilter, sortDir]);

  // Open or download the archived PDF for a row. Mints a fresh short-lived
  // signed URL from the storage path (RLS scopes it to the client's tenant);
  // falls back to the printable React route when no PDF exists yet.
  async function openPdf(row: InvoiceRecord, download: boolean) {
    setOpenError(null);
    if (!row.pdfPath) {
      const fallback = `#/invoices/${encodeURIComponent(row.invoiceNo)}?client=${encodeURIComponent(row.tenantId)}${download ? '&print=1' : ''}`;
      window.open(fallback, '_blank', 'noopener');
      return;
    }
    setOpeningNo(row.invoiceNo);
    try {
      const { data, error: sErr } = await supabase
        .storage
        .from('invoices')
        .createSignedUrl(row.pdfPath, 60 * 5, download ? { download: `${row.invoiceNo}.pdf` } : undefined);
      if (sErr || !data?.signedUrl) {
        throw new Error(sErr?.message || 'Could not create a link to this invoice.');
      }
      window.open(data.signedUrl, '_blank', 'noopener');
    } catch (e) {
      setOpenError(e instanceof Error ? e.message : String(e));
    } finally {
      setOpeningNo(null);
    }
  }

  async function runBackfill() {
    if (backfilling) return;
    setBackfilling(true);
    setBackfillSummary(null);
    setProgress({ total: 0, done: 0, succeeded: 0, failed: 0 });
    try {
      const res = await backfillInvoicePdfs(setProgress);
      let msg = res.total === 0
        ? 'All invoices already have PDFs.'
        : `Backfill complete: ${res.succeeded} generated, ${res.failed} failed of ${res.total}.`;
      if (res.failures.length > 0) {
        msg += ` First failure: ${res.failures[0].invoiceNo} — ${res.failures[0].reason}`;
      }
      setBackfillSummary(msg);
      await refetch();
      countInvoicesMissingPdf().then(setMissingCount).catch(() => {});
    } catch (e) {
      setBackfillSummary(`Backfill error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBackfilling(false);
    }
  }

  const columns: Column<InvoiceRecord>[] = [
    {
      key: 'invoiceNo',
      header: 'Invoice #',
      width: '160px',
      render: (r) => <span style={{ fontWeight: 600, color: theme.colors.text }}>{r.invoiceNo}</span>,
    },
    ...(isAdmin
      ? [{
          key: 'clientName',
          header: 'Client',
          render: (r: InvoiceRecord) => <span style={{ color: theme.colors.textSecondary }}>{r.clientName || '—'}</span>,
        } as Column<InvoiceRecord>]
      : []),
    {
      key: 'invoiceDate',
      header: 'Date',
      width: '120px',
      render: (r) => <span style={{ color: theme.colors.textSecondary }}>{fmtDate(r.invoiceDate)}</span>,
    },
    {
      key: 'total',
      header: 'Total',
      width: '130px',
      render: (r) => <span style={{ fontWeight: 600 }}>{fmtMoney(r.total)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      width: '110px',
      render: (r) => <StatusPill paid={r.qboPaid} />,
    },
    {
      key: 'actions',
      header: 'Invoice',
      width: '180px',
      render: (r) => (
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => openPdf(r, false)}
            disabled={openingNo === r.invoiceNo}
            style={actionBtnStyle(false)}
            title="View invoice PDF"
          >
            {openingNo === r.invoiceNo
              ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
              : <ExternalLink size={13} />}
            View
          </button>
          <button
            onClick={() => openPdf(r, true)}
            disabled={openingNo === r.invoiceNo}
            style={actionBtnStyle(true)}
            title="Download invoice PDF"
          >
            <Download size={13} />
            Download
          </button>
        </div>
      ),
    },
  ];

  return (
    <div style={{ padding: '24px 28px', fontFamily: theme.typography.fontFamily }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <FileText size={22} color={theme.colors.primary} />
          <h1 style={{ fontSize: 22, fontWeight: 700, color: theme.colors.text, margin: 0 }}>Invoices</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            style={selectStyle}
          >
            <option value="all">All statuses</option>
            <option value="paid">Paid</option>
            <option value="unpaid">Unpaid</option>
          </select>
          {/* Date sort */}
          <select
            value={sortDir}
            onChange={(e) => setSortDir(e.target.value as SortDir)}
            style={selectStyle}
          >
            <option value="desc">Newest first</option>
            <option value="asc">Oldest first</option>
          </select>
          <button onClick={() => refetch()} style={iconBtnStyle} title="Refresh">
            <RefreshCw size={15} />
          </button>
        </div>
      </div>

      {/* Admin backfill bar */}
      {isAdmin && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          padding: '10px 14px', marginBottom: 16, borderRadius: theme.radii.md,
          background: theme.colors.bgSubtle, border: `1px solid ${theme.colors.border}`,
        }}>
          <span style={{ fontSize: 13, color: theme.colors.textSecondary }}>
            {missingCount === null
              ? 'Admin tools'
              : missingCount === 0
                ? 'All invoices have archived PDFs.'
                : `${missingCount} invoice${missingCount === 1 ? '' : 's'} missing a PDF.`}
          </span>
          <button
            onClick={runBackfill}
            disabled={backfilling || missingCount === 0}
            style={{ ...actionBtnStyle(true), opacity: (backfilling || missingCount === 0) ? 0.6 : 1 }}
          >
            {backfilling
              ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
              : <FileText size={13} />}
            {backfilling ? 'Backfilling…' : 'Backfill PDFs'}
          </button>
          {backfilling && progress && (
            <span style={{ fontSize: 12, color: theme.colors.textMuted }}>
              {progress.done}/{progress.total} ({progress.succeeded} ok, {progress.failed} failed)
              {progress.current ? ` · ${progress.current}` : ''}
            </span>
          )}
          {backfillSummary && !backfilling && (
            <span style={{ fontSize: 12, color: theme.colors.textSecondary }}>{backfillSummary}</span>
          )}
        </div>
      )}

      {openError && (
        <div style={{
          padding: '10px 14px', marginBottom: 16, borderRadius: theme.radii.md,
          background: theme.colors.statusRedBg, color: theme.colors.statusRed, fontSize: 13,
        }}>
          {openError}
        </div>
      )}

      {/* Body */}
      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: theme.colors.textMuted, padding: 32 }}>
          <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> Loading invoices…
        </div>
      ) : error ? (
        <div style={{
          padding: '12px 16px', borderRadius: theme.radii.md,
          background: theme.colors.statusRedBg, color: theme.colors.statusRed, fontSize: 13,
        }}>
          Failed to load invoices: {error}
        </div>
      ) : (
        <>
          <div style={{ fontSize: 12, color: theme.colors.textMuted, marginBottom: 8 }}>
            {filtered.length} invoice{filtered.length === 1 ? '' : 's'}
          </div>
          <DataTable
            columns={columns}
            data={filtered}
            getRowKey={(r) => r.invoiceNo}
            emptyMessage="No invoices yet. New invoices appear here once they're created."
          />
        </>
      )}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  padding: '7px 10px',
  borderRadius: 8,
  border: `1px solid ${theme.colors.border}`,
  background: '#fff',
  color: theme.colors.text,
  fontSize: 13,
  fontFamily: 'inherit',
  cursor: 'pointer',
};

const iconBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '7px 9px',
  borderRadius: 8,
  border: `1px solid ${theme.colors.border}`,
  background: '#fff',
  color: theme.colors.textSecondary,
  cursor: 'pointer',
};

function actionBtnStyle(primary: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '6px 12px',
    borderRadius: 8,
    border: primary ? 'none' : `1px solid ${theme.colors.border}`,
    background: primary ? theme.colors.primary : '#fff',
    color: primary ? '#fff' : theme.colors.text,
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  };
}
