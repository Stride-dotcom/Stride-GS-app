/**
 * BillingActivityTab — audit trail feed for the Billing page.
 *
 * Shows every invoice create / QBO push / email send / charge / exception
 * with filters for action type, status, client, and date range. Unresolved
 * failures can be marked resolved by the operator.
 *
 * Data: public.billing_activity_log (Supabase), realtime-subscribed.
 */
import { useState, useMemo } from 'react';
import { CheckCircle, AlertTriangle, Clock, RefreshCw, X, ChevronDown, ChevronRight } from 'lucide-react';
import { theme } from '../../styles/theme';
import { useBillingActivity } from '../../hooks/useBillingActivity';
import { postMarkBillingActivityResolved } from '../../lib/api';
import type { BillingActivityRow } from '../../lib/supabaseQueries';

const ACTION_LABELS: Record<string, string> = {
  invoice_create: 'Invoice Created',
  invoice_email_send: 'Invoice Emailed',
  qbo_push: 'Pushed to QBO',
  charge_stax: 'Stax Charge',
  charge_manual: 'Manual Charge',
  pay_link_send: 'Pay Link Sent',
  exception: 'Exception',
};

const ACTION_COLORS: Record<string, { bg: string; text: string }> = {
  invoice_create: { bg: '#EFF6FF', text: '#1D4ED8' },
  invoice_email_send: { bg: '#F0FDF4', text: '#15803D' },
  qbo_push: { bg: '#EDE9FE', text: '#7C3AED' },
  charge_stax: { bg: '#FCE7F3', text: '#BE185D' },
  charge_manual: { bg: '#FEF3EE', text: '#E85D2D' },
  pay_link_send: { bg: '#FEF3C7', text: '#B45309' },
  exception: { bg: '#FEF2F2', text: '#991B1B' },
};

const STATUS_COLORS: Record<string, { bg: string; text: string; icon: React.ReactNode }> = {
  success: { bg: '#F0FDF4', text: '#15803D', icon: <CheckCircle size={12} /> },
  failure: { bg: '#FEF2F2', text: '#991B1B', icon: <AlertTriangle size={12} /> },
  partial: { bg: '#FEF3C7', text: '#B45309', icon: <AlertTriangle size={12} /> },
  skipped: { bg: '#F3F4F6', text: '#6B7280', icon: <Clock size={12} /> },
};

export function BillingActivityTab({ clientNameMap }: { clientNameMap: Record<string, string> }) {
  const [filterAction, setFilterAction] = useState<string[]>([]);
  const [filterStatus, setFilterStatus] = useState<string[]>([]);
  const [filterClient, setFilterClient] = useState<string[]>([]);
  const [unresolvedOnly, setUnresolvedOnly] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);

  const tenantIds = useMemo(() => {
    if (!filterClient.length) return undefined;
    const nameToId: Record<string, string> = {};
    for (const [id, name] of Object.entries(clientNameMap)) nameToId[name] = id;
    return filterClient.map(n => nameToId[n]).filter(Boolean);
  }, [filterClient, clientNameMap]);

  const { rows, loading, error, refetch } = useBillingActivity(
    {
      tenantIds,
      actions: filterAction.length ? filterAction : undefined,
      statuses: filterStatus.length ? filterStatus : undefined,
      unresolvedOnly,
      limit: 500,
    },
    true,
  );

  const clientOptions = useMemo(() => Object.values(clientNameMap).sort(), [clientNameMap]);

  const actionOptions = Object.keys(ACTION_LABELS);
  const statusOptions = ['success', 'failure', 'partial', 'skipped'];

  const handleResolve = async (row: BillingActivityRow) => {
    const note = window.prompt(`Mark as resolved. Optional note:`, '');
    if (note === null) return;  // cancelled
    setResolving(row.id);
    try {
      const res = await postMarkBillingActivityResolved(row.id, note);
      if (res.ok && res.data?.success) {
        refetch();
      } else {
        alert('Failed to mark resolved: ' + (res.error || res.data?.error || 'Unknown'));
      }
    } finally {
      setResolving(null);
    }
  };

  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString();
  };

  // Summary counts
  const counts = useMemo(() => {
    const c = { total: rows.length, success: 0, failure: 0, partial: 0, skipped: 0, unresolved: 0 };
    for (const r of rows) {
      if (r.status === 'success') c.success++;
      else if (r.status === 'failure') { c.failure++; if (!r.resolvedAt) c.unresolved++; }
      else if (r.status === 'partial') c.partial++;
      else if (r.status === 'skipped') c.skipped++;
    }
    return c;
  }, [rows]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* KPI strip */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <KpiCard label="Total" value={counts.total} color={theme.colors.text} />
        <KpiCard label="Success" value={counts.success} color="#15803D" />
        <KpiCard label="Failures" value={counts.failure} color="#991B1B" />
        <KpiCard label="Unresolved" value={counts.unresolved} color="#991B1B" onClick={() => setUnresolvedOnly(!unresolvedOnly)} active={unresolvedOnly} />
        <KpiCard label="Partial" value={counts.partial} color="#B45309" />
        <KpiCard label="Skipped" value={counts.skipped} color="#6B7280" />
        <button
          onClick={refetch}
          disabled={loading}
          style={{
            padding: '6px 12px', fontSize: 12, fontWeight: 600, border: `1px solid ${theme.colors.border}`,
            borderRadius: 8, background: '#fff', cursor: loading ? 'not-allowed' : 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 'auto',
          }}
        >
          <RefreshCw size={12} style={{ animation: loading ? 'spin 1s linear infinite' : undefined }} /> Refresh
        </button>
      </div>

      {/* Filter row */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: 10, background: '#fff', border: `1px solid ${theme.colors.border}`, borderRadius: 8 }}>
        <MultiSelectFilter label="Action" options={actionOptions} value={filterAction} onChange={setFilterAction} labelMap={ACTION_LABELS} />
        <MultiSelectFilter label="Status" options={statusOptions} value={filterStatus} onChange={setFilterStatus} />
        <MultiSelectFilter label="Client" options={clientOptions} value={filterClient} onChange={setFilterClient} />
        <label style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', marginLeft: 'auto' }}>
          <input type="checkbox" checked={unresolvedOnly} onChange={e => setUnresolvedOnly(e.target.checked)} />
          Unresolved failures only
        </label>
      </div>

      {/* Feed */}
      {error && (
        <div style={{ padding: 10, background: '#FEF2F2', color: '#991B1B', border: '1px solid #FECACA', borderRadius: 8, fontSize: 13 }}>{error}</div>
      )}
      {loading && rows.length === 0 && (
        <div style={{ padding: 40, textAlign: 'center', color: theme.colors.textMuted, fontSize: 13 }}>Loading activity…</div>
      )}
      {!loading && rows.length === 0 && !error && (
        <div style={{ padding: 40, textAlign: 'center', color: theme.colors.textMuted, fontSize: 13, background: '#fff', border: `1px solid ${theme.colors.border}`, borderRadius: 8 }}>
          No activity matches the current filters.
        </div>
      )}

      <div style={{ background: '#fff', border: `1px solid ${theme.colors.border}`, borderRadius: 8, overflow: 'hidden' }}>
        {rows.map(r => {
          const actionLabel = ACTION_LABELS[r.action] || r.action;
          const actionColor = ACTION_COLORS[r.action] || { bg: '#F3F4F6', text: '#6B7280' };
          const statusColor = STATUS_COLORS[r.status] || { bg: '#F3F4F6', text: '#6B7280', icon: null };
          const isExpanded = expandedId === r.id;
          const needsResolve = r.status === 'failure' && !r.resolvedAt;
          return (
            <div key={r.id} style={{
              padding: '10px 14px',
              borderBottom: `1px solid ${theme.colors.borderLight}`,
              background: needsResolve ? '#FFFBFB' : '#fff',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <button
                  onClick={() => setExpandedId(isExpanded ? null : r.id)}
                  style={{ background: 'none', border: 'none', padding: 2, cursor: 'pointer', display: 'inline-flex' }}
                  title={isExpanded ? 'Collapse' : 'Expand'}
                >
                  {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
                <span style={{ fontSize: 11, color: theme.colors.textMuted, whiteSpace: 'nowrap' }}>{fmtDate(r.performedAt)}</span>
                <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: actionColor.bg, color: actionColor.text, fontWeight: 600, whiteSpace: 'nowrap' }}>{actionLabel}</span>
                <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: statusColor.bg, color: statusColor.text, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  {statusColor.icon} {r.status}
                </span>
                {r.invoiceNo && (
                  <span style={{ fontSize: 12, fontWeight: 600, fontFamily: 'monospace' }}>{r.invoiceNo}</span>
                )}
                <span style={{ fontSize: 12, flex: 1, color: theme.colors.text }}>
                  {r.summary || '(no summary)'}
                </span>
                {r.amount != null && (
                  <span style={{ fontSize: 12, fontWeight: 600, color: theme.colors.text }}>${r.amount.toFixed(2)}</span>
                )}
                {r.clientName && (
                  <span style={{ fontSize: 11, color: theme.colors.textMuted }}>{r.clientName}</span>
                )}
                {needsResolve && (
                  <button
                    onClick={() => handleResolve(r)}
                    disabled={resolving === r.id}
                    style={{
                      padding: '4px 10px', fontSize: 11, fontWeight: 600,
                      border: '1px solid #16A34A', borderRadius: 6, background: '#F0FDF4', color: '#16A34A',
                      cursor: resolving === r.id ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {resolving === r.id ? 'Resolving…' : 'Mark Resolved'}
                  </button>
                )}
                {r.resolvedAt && (
                  <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: '#F0FDF4', color: '#15803D', fontWeight: 600 }} title={`Resolved by ${r.resolvedBy || '?'} at ${fmtDate(r.resolvedAt)}`}>
                    Resolved
                  </span>
                )}
              </div>
              {isExpanded && (
                <div style={{ marginTop: 8, paddingLeft: 28, fontSize: 12, color: theme.colors.textSecondary, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {r.errorMessage && (
                    <div style={{ color: '#991B1B', fontFamily: 'monospace', fontSize: 11 }}>Error: {r.errorMessage}</div>
                  )}
                  {r.ledgerRowId && <div>Ledger Row: <span style={{ fontFamily: 'monospace' }}>{r.ledgerRowId}</span></div>}
                  {r.qboInvoiceId && <div>QBO Invoice ID: <span style={{ fontFamily: 'monospace' }}>{r.qboInvoiceId}</span></div>}
                  {r.qboDocNumber && <div>QBO Invoice #: <span style={{ fontFamily: 'monospace' }}>{r.qboDocNumber}</span></div>}
                  {r.staxInvoiceId && <div>Stax Invoice ID: <span style={{ fontFamily: 'monospace' }}>{r.staxInvoiceId}</span></div>}
                  {r.performedBy && <div>Performed by: {r.performedBy}</div>}
                  {r.resolvedAt && <div>Resolved by {r.resolvedBy} on {fmtDate(r.resolvedAt)}{r.resolvedNote ? ` — ${r.resolvedNote}` : ''}</div>}
                  {r.details && Object.keys(r.details).length > 0 && (
                    <pre style={{ background: '#F9FAFB', padding: 8, borderRadius: 4, fontSize: 10, overflow: 'auto', margin: 0 }}>
                      {JSON.stringify(r.details, null, 2)}
                    </pre>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function KpiCard({ label, value, color, onClick, active }: { label: string; value: number; color: string; onClick?: () => void; active?: boolean }) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: '8px 14px', background: active ? '#FEF3EE' : '#fff',
        border: `1px solid ${active ? theme.colors.orange : theme.colors.border}`, borderRadius: 8,
        display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, minWidth: 80,
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <span style={{ fontSize: 10, color: theme.colors.textMuted, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{label}</span>
      <span style={{ fontSize: 18, fontWeight: 700, color }}>{value}</span>
    </div>
  );
}

function MultiSelectFilter({
  label, options, value, onChange, labelMap,
}: {
  label: string; options: string[]; value: string[]; onChange: (v: string[]) => void; labelMap?: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const displayValue = value.length === 0 ? 'All' : value.length === 1 ? (labelMap?.[value[0]] || value[0]) : `${value.length} selected`;
  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          padding: '6px 10px', fontSize: 12, fontWeight: 500, border: `1px solid ${theme.colors.border}`,
          borderRadius: 6, background: value.length ? '#FEF3EE' : '#fff', cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: 4,
        }}
      >
        {label}: <span style={{ fontWeight: 600 }}>{displayValue}</span>
        <ChevronDown size={10} />
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 100 }} />
          <div style={{
            position: 'absolute', top: '100%', left: 0, marginTop: 4,
            background: '#fff', border: `1px solid ${theme.colors.border}`, borderRadius: 8,
            boxShadow: '0 4px 16px rgba(0,0,0,0.1)', minWidth: 180, maxHeight: 300, overflow: 'auto',
            zIndex: 101, padding: 6,
          }}>
            {value.length > 0 && (
              <button
                onClick={() => onChange([])}
                style={{ width: '100%', textAlign: 'left', padding: '4px 8px', fontSize: 11, border: 'none', background: 'none', cursor: 'pointer', color: theme.colors.orange, fontWeight: 600 }}
              >
                <X size={10} style={{ display: 'inline', marginRight: 4 }} /> Clear
              </button>
            )}
            {options.map(opt => (
              <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', fontSize: 12, cursor: 'pointer', borderRadius: 4 }}>
                <input
                  type="checkbox"
                  checked={value.includes(opt)}
                  onChange={() => onChange(value.includes(opt) ? value.filter(v => v !== opt) : [...value, opt])}
                />
                {labelMap?.[opt] || opt}
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
