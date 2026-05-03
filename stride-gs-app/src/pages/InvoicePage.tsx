/**
 * InvoicePage.tsx — Printable invoice view, rendered from the `billing` table.
 * Route: #/invoices/:invoiceNo?client=<spreadsheetId>
 *
 * Replaces the GAS-generated Drive Doc PDF flow for "view invoice." The user
 * clicks Print to save as PDF locally — same artifact, no Drive reformatting,
 * no GAS round-trip at invoice-commit time.
 *
 * RLS gates access: admin/staff see any invoice; client roles only see invoices
 * whose tenant_id matches their JWT. The `?client=` query param is a hint for
 * admins viewing a specific tenant's invoice (matches the email-CTA pattern
 * used elsewhere in the app).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { Loader2, Printer, ArrowLeft, AlertCircle, SearchX } from 'lucide-react';
import { theme } from '../styles/theme';
import { supabase } from '../lib/supabase';

const STRIDE_LOGO_URL =
  'https://static.wixstatic.com/media/a38fbc_a8c7a368447f4723b782c4dbd765ca0e~mv2.png';

// ─── Types ───────────────────────────────────────────────────────────────────

interface InvoiceLineRow {
  ledgerRowId: string;
  date: string;
  invoiceDate: string;
  itemId: string;
  description: string;
  itemClass: string;
  qty: number;
  rate: number;
  total: number;
  svcCode: string;
  svcName: string;
  sidemark: string;
}

interface InvoiceClient {
  name: string;
  paymentTerms: string;
  email: string;
}

type PageStatus = 'loading' | 'ready' | 'not-found' | 'error';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtMoney(n: number | null | undefined): string {
  const v = Number(n) || 0;
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDateMMDDYYYY(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    const d = new Date(String(iso).length <= 10 ? iso + 'T00:00:00' : iso);
    if (isNaN(d.getTime())) return String(iso);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${mm}/${dd}/${d.getFullYear()}`;
  } catch {
    return String(iso);
  }
}

const backBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 14px',
  borderRadius: 8,
  border: `1px solid ${theme.colors.border}`,
  background: '#fff',
  color: theme.colors.text,
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

// ─── Page ────────────────────────────────────────────────────────────────────

export function InvoicePage() {
  const { invoiceNo } = useParams<{ invoiceNo: string }>();
  const [searchParams] = useSearchParams();
  const tenantId = searchParams.get('client') || '';
  const autoPrint = searchParams.get('print') === '1';
  const navigate = useNavigate();

  const [rows, setRows] = useState<InvoiceLineRow[]>([]);
  const [client, setClient] = useState<InvoiceClient | null>(null);
  const [resolvedTenantId, setResolvedTenantId] = useState<string>(tenantId);
  const [status, setStatus] = useState<PageStatus>('loading');
  const [errMsg, setErrMsg] = useState<string>('');

  // Load billing rows for this invoice + the client info.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!invoiceNo) {
        setStatus('not-found');
        return;
      }
      setStatus('loading');
      setErrMsg('');
      try {
        let q = supabase.from('billing').select('*').eq('invoice_no', invoiceNo);
        if (tenantId) q = q.eq('tenant_id', tenantId);
        const { data: bRows, error: bErr } = await q;
        if (cancelled) return;
        if (bErr) {
          setErrMsg(bErr.message || String(bErr));
          setStatus('error');
          return;
        }
        if (!bRows || bRows.length === 0) {
          setStatus('not-found');
          return;
        }

        const tenant = String((bRows[0] as { tenant_id?: string }).tenant_id || tenantId || '');
        setResolvedTenantId(tenant);

        const { data: cData } = await supabase
          .from('clients')
          .select('name, payment_terms, email')
          .eq('spreadsheet_id', tenant)
          .maybeSingle();

        if (cancelled) return;

        const lineRows: InvoiceLineRow[] = (bRows as Record<string, unknown>[])
          .map((r) => ({
            ledgerRowId: String(r.ledger_row_id || ''),
            date: String(r.date || ''),
            invoiceDate: String(r.invoice_date || ''),
            itemId: String(r.item_id || ''),
            description: String(r.description || ''),
            itemClass: String(r.item_class || ''),
            qty: Number(r.qty) || 0,
            rate: Number(r.rate) || 0,
            total: Number(r.total) || 0,
            svcCode: String(r.svc_code || ''),
            svcName: String(r.svc_name || ''),
            sidemark: String(r.sidemark || ''),
          }))
          .sort((a, b) => {
            // Date asc, then ledger_row_id asc for stable ordering.
            if (a.date !== b.date) return a.date.localeCompare(b.date);
            return a.ledgerRowId.localeCompare(b.ledgerRowId);
          });

        const fallbackClientName = String(
          (bRows[0] as { client_name?: string }).client_name || ''
        );
        setRows(lineRows);
        setClient({
          name: String((cData?.name as string | undefined) || fallbackClientName),
          paymentTerms: String((cData?.payment_terms as string | undefined) || 'Net 30'),
          email: String((cData?.email as string | undefined) || ''),
        });
        setStatus('ready');
      } catch (e: unknown) {
        if (cancelled) return;
        setErrMsg(e instanceof Error ? e.message : String(e));
        setStatus('error');
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [invoiceNo, tenantId]);

  // Auto-trigger print dialog if landed via ?print=1 (e.g. from a "Download PDF"
  // link that pre-opens the page and immediately fires print).
  useEffect(() => {
    if (status !== 'ready' || !autoPrint) return;
    const t = setTimeout(() => window.print(), 300);
    return () => clearTimeout(t);
  }, [status, autoPrint]);

  // Derived totals + invoice header data.
  const subtotal = useMemo(
    () => rows.reduce((sum, r) => sum + (Number(r.total) || 0), 0),
    [rows]
  );
  const invoiceDate = useMemo(() => {
    const fromRow = rows.find((r) => r.invoiceDate)?.invoiceDate;
    return fmtDateMMDDYYYY(fromRow || new Date().toISOString().slice(0, 10));
  }, [rows]);
  const sidemarks = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.sidemark) set.add(r.sidemark);
    return Array.from(set).sort();
  }, [rows]);

  // ─── Loading / not-found / error states ─────────────────────────────────────

  if (status === 'loading') {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          gap: 16,
          color: theme.colors.textMuted,
        }}
      >
        <Loader2 size={32} style={{ animation: 'spin 1s linear infinite' }} />
        <div style={{ fontSize: 14 }}>
          Loading invoice {invoiceNo ? <strong>{invoiceNo}</strong> : ''}…
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    );
  }

  if (status === 'not-found') {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          gap: 16,
          padding: 32,
          textAlign: 'center',
        }}
      >
        <SearchX size={48} color={theme.colors.textMuted} />
        <div style={{ fontSize: 18, fontWeight: 600, color: theme.colors.text }}>
          Invoice Not Found
        </div>
        <div style={{ fontSize: 14, color: theme.colors.textMuted, maxWidth: 420 }}>
          No invoice numbered <strong>{invoiceNo}</strong>
          {tenantId ? ' for this client' : ''} was found. It may have been voided, or
          you may not have permission to view it.
        </div>
        <button onClick={() => navigate('/billing')} style={backBtnStyle}>
          <ArrowLeft size={14} /> Back to Billing
        </button>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          gap: 16,
          padding: 32,
          textAlign: 'center',
        }}
      >
        <AlertCircle size={48} color={theme.colors.statusRed} />
        <div style={{ fontSize: 18, fontWeight: 600, color: theme.colors.text }}>
          Error Loading Invoice
        </div>
        <div style={{ fontSize: 13, color: theme.colors.textMuted, maxWidth: 500 }}>
          {errMsg}
        </div>
        <button onClick={() => navigate('/billing')} style={backBtnStyle}>
          <ArrowLeft size={14} /> Back to Billing
        </button>
      </div>
    );
  }

  // ─── Ready: render the invoice ──────────────────────────────────────────────

  return (
    <div className="invoice-page-root">
      {/* Print stylesheet — hides everything except .invoice-paper.
          The visibility trick keeps box dimensions stable while suppressing
          rendering of nav/header/toolbar elsewhere on the page. */}
      <style>{`
        @media print {
          @page { size: letter; margin: 0.4in 0.5in; }
          body { background: #fff !important; }
          body * { visibility: hidden; }
          .invoice-paper, .invoice-paper * { visibility: visible; }
          .invoice-paper {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            box-shadow: none !important;
            padding: 0 !important;
            margin: 0 !important;
            max-width: none !important;
          }
          .invoice-toolbar { display: none !important; }
        }
      `}</style>

      {/* Toolbar — hidden on print */}
      <div
        className="invoice-toolbar"
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 24px',
          borderBottom: `1px solid ${theme.colors.border}`,
          background: '#fff',
        }}
      >
        <button onClick={() => navigate(-1)} style={backBtnStyle}>
          <ArrowLeft size={14} /> Back
        </button>
        <div style={{ fontSize: 13, color: theme.colors.textMuted }}>
          Invoice <strong>{invoiceNo}</strong>
          {client?.name ? ` · ${client.name}` : ''}
        </div>
        <button
          onClick={() => window.print()}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 16px',
            background: theme.colors.orange,
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: 13,
          }}
        >
          <Printer size={14} /> Print / Save as PDF
        </button>
      </div>

      {/* Invoice paper */}
      <div
        className="invoice-paper"
        style={{
          maxWidth: 800,
          margin: '24px auto',
          padding: '40px 48px',
          background: '#fff',
          boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
          fontFamily: 'Inter, system-ui, sans-serif',
          color: '#1F2937',
        }}
      >
        {/* Letterhead */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: 32,
          }}
        >
          <div>
            <img
              src={STRIDE_LOGO_URL}
              alt="Stride Logistics"
              style={{ height: 48, width: 'auto', objectFit: 'contain' }}
            />
            <div style={{ marginTop: 8, fontSize: 11, color: '#6B7280', lineHeight: 1.5 }}>
              Stride Logistics
              <br />
              Kent, WA
              <br />
              whse@stridenw.com
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div
              style={{
                fontSize: 28,
                fontWeight: 700,
                letterSpacing: '0.5px',
                color: theme.colors.orange,
                lineHeight: 1,
              }}
            >
              INVOICE
            </div>
            <div style={{ marginTop: 8, fontSize: 12 }}>
              <div>
                <strong>#{invoiceNo}</strong>
              </div>
              <div style={{ color: '#6B7280' }}>Date: {invoiceDate}</div>
            </div>
          </div>
        </div>

        {/* Bill To + Terms + Sidemarks */}
        <div style={{ display: 'flex', gap: 32, marginBottom: 24 }}>
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.5px',
                color: '#9CA3AF',
                textTransform: 'uppercase',
                marginBottom: 4,
              }}
            >
              Bill To
            </div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{client?.name || 'Client'}</div>
            {client?.email ? (
              <div style={{ fontSize: 12, color: '#6B7280' }}>{client.email}</div>
            ) : null}
          </div>
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.5px',
                color: '#9CA3AF',
                textTransform: 'uppercase',
                marginBottom: 4,
              }}
            >
              Payment Terms
            </div>
            <div style={{ fontSize: 13 }}>{client?.paymentTerms || 'Net 30'}</div>
          </div>
          {sidemarks.length > 0 && (
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.5px',
                  color: '#9CA3AF',
                  textTransform: 'uppercase',
                  marginBottom: 4,
                }}
              >
                Sidemark{sidemarks.length === 1 ? '' : 's'}
              </div>
              <div style={{ fontSize: 13 }}>{sidemarks.join(', ')}</div>
            </div>
          )}
        </div>

        {/* Line items */}
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 11,
            marginBottom: 24,
          }}
        >
          <thead>
            <tr
              style={{
                background: '#F9FAFB',
                borderBottom: `2px solid ${theme.colors.orange}`,
              }}
            >
              <th style={{ textAlign: 'left', padding: '8px 6px', fontWeight: 700, color: '#374151' }}>
                Date
              </th>
              <th style={{ textAlign: 'left', padding: '8px 6px', fontWeight: 700, color: '#374151' }}>
                Service
              </th>
              <th style={{ textAlign: 'left', padding: '8px 6px', fontWeight: 700, color: '#374151' }}>
                Item
              </th>
              <th style={{ textAlign: 'left', padding: '8px 6px', fontWeight: 700, color: '#374151' }}>
                Description
              </th>
              <th style={{ textAlign: 'right', padding: '8px 6px', fontWeight: 700, color: '#374151' }}>
                Qty
              </th>
              <th style={{ textAlign: 'right', padding: '8px 6px', fontWeight: 700, color: '#374151' }}>
                Rate
              </th>
              <th style={{ textAlign: 'right', padding: '8px 6px', fontWeight: 700, color: '#374151' }}>
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr key={r.ledgerRowId || `row-${idx}`} style={{ borderBottom: '1px solid #E5E7EB' }}>
                <td style={{ padding: '6px', whiteSpace: 'nowrap', color: '#6B7280' }}>
                  {fmtDateMMDDYYYY(r.date)}
                </td>
                <td style={{ padding: '6px' }}>{r.svcName || r.svcCode}</td>
                <td style={{ padding: '6px', color: '#6B7280' }}>{r.itemId}</td>
                <td style={{ padding: '6px' }}>{r.description}</td>
                <td style={{ padding: '6px', textAlign: 'right' }}>{r.qty}</td>
                <td style={{ padding: '6px', textAlign: 'right' }}>${fmtMoney(r.rate)}</td>
                <td style={{ padding: '6px', textAlign: 'right', fontWeight: 600 }}>
                  ${fmtMoney(r.total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 32 }}>
          <table style={{ minWidth: 280, fontSize: 12, borderCollapse: 'collapse' }}>
            <tbody>
              <tr>
                <td style={{ padding: '4px 12px 4px 0', color: '#6B7280' }}>Subtotal</td>
                <td style={{ padding: '4px 0', textAlign: 'right' }}>${fmtMoney(subtotal)}</td>
              </tr>
              <tr style={{ borderTop: `2px solid ${theme.colors.orange}` }}>
                <td style={{ padding: '8px 12px 4px 0', fontWeight: 700, fontSize: 14 }}>
                  Total Due
                </td>
                <td style={{ padding: '8px 0 4px 0', textAlign: 'right', fontWeight: 700, fontSize: 14 }}>
                  ${fmtMoney(subtotal)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div
          style={{
            borderTop: '1px solid #E5E7EB',
            paddingTop: 16,
            fontSize: 11,
            color: '#9CA3AF',
            textAlign: 'center',
          }}
        >
          Thank you for your business — Stride Logistics
          {resolvedTenantId ? (
            <span style={{ display: 'block', marginTop: 4, fontSize: 9 }}>
              Ref: {resolvedTenantId.slice(0, 12)}…
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
