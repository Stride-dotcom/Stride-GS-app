/**
 * BatchesTab — Payments → Batches view.
 *
 * Lists every Stax invoice batch created by Billing → Create Invoices with
 * "Send to Payments" checked. One row per batch with totals + click-to-
 * filter-Review and click-to-download-IIF. Replaces the daily friction of
 * browsing Drive's IIF folder by last-modified date.
 *
 * Data source: stax_invoice_batches table via getStaxInvoiceBatches GAS
 * endpoint. Read-only — no writes from this tab.
 *
 * On-demand IIF: regenerated from stax_invoices.line_items_json each click,
 * so old batches always exportable without storing files.
 */
import { useEffect, useState } from 'react';
import { Layers, Download, RefreshCw, AlertCircle, FileText } from 'lucide-react';
import {
  postGetStaxInvoiceBatches,
  postRegenerateIifForBatch,
  type StaxInvoiceBatchRow,
} from '../../lib/api';
import { theme } from '../../styles/theme';
import { fmtDateTime } from '../../lib/constants';

interface BatchesTabProps {
  onJumpToReview: (batchId: string) => void;
}

export function BatchesTab({ onJumpToReview }: BatchesTabProps) {
  const [batches, setBatches] = useState<StaxInvoiceBatchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadingBatchId, setDownloadingBatchId] = useState<string | null>(null);

  const refetch = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await postGetStaxInvoiceBatches(200);
      if (res.error || !res.data?.success) {
        setError(res.data?.error || res.error || 'Failed to load batches');
        setBatches([]);
      } else {
        setBatches(res.data.batches || []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBatches([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refetch(); }, []);

  const handleDownload = async (batchId: string) => {
    setDownloadingBatchId(batchId);
    try {
      const res = await postRegenerateIifForBatch(batchId);
      if (res.error || !res.data?.success || !res.data.iifContent) {
        alert(res.data?.error || res.error || 'Failed to regenerate IIF');
        return;
      }
      const blob = new Blob([res.data.iifContent], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.data.fileName || `${batchId}.iif`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(`IIF download error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDownloadingBatchId(null);
    }
  };

  const fmtCurrency = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtDate = (iso: string) => {
    if (!iso) return '—';
    try { return fmtDateTime(iso); }
    catch { return iso; }
  };

  return (
    <div style={{ background: '#FFFFFF', borderRadius: 20, padding: 24, border: '1px solid rgba(0,0,0,0.04)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
            <Layers size={16} style={{ marginRight: 8, verticalAlign: 'text-bottom' }} />
            Invoice Batches
          </div>
          <div style={{ fontSize: 12, color: theme.colors.textMuted }}>
            Every batch of invoices sent from Billing → Create Invoices. Click a row to filter Review to those invoices, or Download IIF to export the file.
          </div>
        </div>
        <button onClick={refetch} disabled={loading}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 6, border: '1px solid #D1D5DB', background: '#FFFFFF', cursor: loading ? 'progress' : 'pointer', fontSize: 13 }}>
          <RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh
        </button>
      </div>

      {error && (
        <div style={{ background: '#FEF2F2', color: '#991B1B', padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {loading && batches.length === 0 && (
        <div style={{ padding: 32, textAlign: 'center', color: theme.colors.textMuted, fontSize: 13 }}>Loading batches…</div>
      )}

      {!loading && batches.length === 0 && !error && (
        <div style={{ padding: 32, textAlign: 'center', color: theme.colors.textMuted, fontSize: 13 }}>
          <FileText size={20} style={{ display: 'block', margin: '0 auto 8px', opacity: 0.5 }} />
          No batches yet. Use Billing → Create Invoices with "Send to Payments" checked to create one.
        </div>
      )}

      {batches.length > 0 && (
        <div style={{ overflow: 'auto', border: '1px solid #E5E7EB', borderRadius: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead style={{ background: '#F9FAFB', borderBottom: '1px solid #E5E7EB' }}>
              <tr>
                <Th>Created</Th>
                <Th>Batch ID</Th>
                <Th>Created By</Th>
                <Th>Clients</Th>
                <Th align="right">Invoices</Th>
                <Th align="right">Lines</Th>
                <Th align="right">Total</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {batches.map(b => (
                <tr key={b.batchId} style={{ borderTop: '1px solid #F3F4F6' }}>
                  <Td>{fmtDate(b.createdAt)}</Td>
                  <Td style={{ fontFamily: 'monospace', fontSize: 11, color: theme.colors.textMuted }}>{b.batchId}</Td>
                  <Td>{b.createdBy || '—'}</Td>
                  <Td>{b.clientSummary || '—'}</Td>
                  <Td style={{ textAlign: 'right', fontWeight: 600 }}>{b.invoiceCount}</Td>
                  <Td style={{ textAlign: 'right' }}>{b.lineCount}</Td>
                  <Td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtCurrency(b.totalAmount)}</Td>
                  <Td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => onJumpToReview(b.batchId)}
                        style={btn(theme.colors.orange, false)}>
                        View
                      </button>
                      <button onClick={() => handleDownload(b.batchId)}
                        disabled={downloadingBatchId === b.batchId}
                        style={btn('#6B7280', downloadingBatchId === b.batchId)}>
                        <Download size={11} style={{ marginRight: 4, verticalAlign: 'text-bottom' }} />
                        {downloadingBatchId === b.batchId ? 'Generating…' : 'IIF'}
                      </button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: 'right' }) {
  return <th style={{ padding: '10px 12px', textAlign: align || 'left', fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>{children}</th>;
}

function Td({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <td style={{ padding: '10px 12px', ...style }}>{children}</td>;
}

function btn(color: string, disabled: boolean): React.CSSProperties {
  return {
    padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 6,
    border: `1px solid ${color}`, background: '#FFFFFF', color: color,
    cursor: disabled ? 'progress' : 'pointer', opacity: disabled ? 0.6 : 1,
    fontFamily: 'inherit',
  };
}
