/**
 * BillingCoverageTab — every billable event vs the billing ledger.
 *
 * Each row is a "potentially billable event" — a completed task, complete
 * repair, released will call, or received item. The Postgres view
 * `billable_event_coverage` left-joins each event source against `billing`
 * and classifies the result as BILLED / MISSING / PARTIAL / SKIPPED.
 *
 * Three views:
 *   - by event:   one row per event with status + skip reason
 *   - by client:  rollup with coverage % and missing-revenue indicator
 *   - skipped:    drill-in to the SKIPPED rows so an operator can audit
 *                 the assumptions (COD-flagged-by-mistake, IMP- shipments
 *                 that were actually live receivings, etc.)
 *
 * Read-only — no writes from this tab. Backfilling is handled by the
 * runBackfill* admin entries on a per-bug basis.
 */
import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, RefreshCw, Filter } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { theme } from '../../styles/theme';

type CoverageRow = {
  source: 'task' | 'repair' | 'will_call' | 'inventory';
  tenant_id: string;
  client_name: string | null;
  event_id: string;
  svc_code: string | null;
  item_id: string | null;
  event_date: string | null;
  result: string | null;
  shipment_number: string | null;
  expected_ledger_id: string | null;
  expected_count: number;
  billed_count: number;
  event_status: 'BILLED' | 'MISSING' | 'PARTIAL' | 'SKIPPED';
  ledger_row_id: string | null;
  billing_status: string | null;
  invoice_no: string | null;
  billed_total: number | null;
  skip_reason: string | null;
};

type ViewMode = 'event' | 'client' | 'skipped';

const STATUS_COLORS: Record<CoverageRow['event_status'], { bg: string; text: string }> = {
  BILLED: { bg: '#F0FDF4', text: '#15803D' },
  MISSING: { bg: '#FEF2F2', text: '#991B1B' },
  PARTIAL: { bg: '#FEF3C7', text: '#B45309' },
  SKIPPED: { bg: '#F3F4F6', text: '#6B7280' },
};

const SOURCE_LABELS: Record<CoverageRow['source'], string> = {
  task: 'Task',
  repair: 'Repair',
  will_call: 'Will Call',
  inventory: 'Receiving',
};

const selectStyle: React.CSSProperties = {
  padding: '6px 10px',
  borderRadius: 6,
  border: '1px solid #D1D5DB',
  background: '#FFFFFF',
  fontSize: 13,
  cursor: 'pointer',
};

export function BillingCoverageTab() {
  const [rows, setRows] = useState<CoverageRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>('event');
  const [filterSource, setFilterSource] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('non-billed');
  const [filterClient, setFilterClient] = useState<string>('all');

  const refetch = async () => {
    setLoading(true);
    setError(null);
    try {
      // Pull everything; client-side filter. ~5500 rows currently which is
      // well within memory. If we ever cross ~50k we'd push filters server-
      // side (PostgREST query params on the view).
      const { data, error: err } = await supabase
        .from('billable_event_coverage')
        .select('*')
        .order('event_date', { ascending: false, nullsFirst: false })
        .limit(20000);
      if (err) throw err;
      setRows((data || []) as CoverageRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refetch(); }, []);

  const clientOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach(r => { if (r.client_name) set.add(r.client_name); });
    return Array.from(set).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (filterSource !== 'all' && r.source !== filterSource) return false;
      if (filterClient !== 'all' && r.client_name !== filterClient) return false;
      if (filterStatus === 'non-billed' && r.event_status === 'BILLED') return false;
      if (filterStatus === 'missing' && r.event_status !== 'MISSING' && r.event_status !== 'PARTIAL') return false;
      if (filterStatus === 'billed' && r.event_status !== 'BILLED') return false;
      if (filterStatus === 'skipped' && r.event_status !== 'SKIPPED') return false;
      return true;
    });
  }, [rows, filterSource, filterStatus, filterClient]);

  // ─── View: by client ───────────────────────────────────────────────────────
  const clientRollup = useMemo(() => {
    const map: Record<string, {
      client: string;
      total: number; billed: number; missing: number; partial: number; skipped: number;
      missingRevenue: number;
    }> = {};
    rows.forEach(r => {
      const k = r.client_name || '(unknown)';
      if (!map[k]) map[k] = { client: k, total: 0, billed: 0, missing: 0, partial: 0, skipped: 0, missingRevenue: 0 };
      const m = map[k];
      m.total += r.expected_count;
      if (r.event_status === 'BILLED') m.billed += r.billed_count;
      else if (r.event_status === 'MISSING') m.missing += r.expected_count;
      else if (r.event_status === 'PARTIAL') {
        m.billed += r.billed_count;
        m.partial += (r.expected_count - r.billed_count);
      }
      else if (r.event_status === 'SKIPPED') m.skipped += r.expected_count;
    });
    return Object.values(map)
      .map(m => ({ ...m, coveragePct: m.total - m.skipped > 0 ? (m.billed / (m.total - m.skipped)) * 100 : 100 }))
      .sort((a, b) => (a.missing + a.partial) === (b.missing + b.partial)
        ? a.client.localeCompare(b.client)
        : (b.missing + b.partial) - (a.missing + a.partial));
  }, [rows]);

  // ─── View: skipped reasons ─────────────────────────────────────────────────
  const skippedRollup = useMemo(() => {
    const map: Record<string, { reason: string; count: number; sources: Set<string> }> = {};
    rows.forEach(r => {
      if (r.event_status !== 'SKIPPED') return;
      const k = r.skip_reason || 'unknown';
      if (!map[k]) map[k] = { reason: k, count: 0, sources: new Set() };
      map[k].count += r.expected_count;
      map[k].sources.add(r.source);
    });
    return Object.values(map)
      .map(m => ({ reason: m.reason, count: m.count, sources: Array.from(m.sources).join(', ') }))
      .sort((a, b) => b.count - a.count);
  }, [rows]);

  // ─── Top-line summary ──────────────────────────────────────────────────────
  const summary = useMemo(() => {
    let billed = 0, missing = 0, partial = 0, skipped = 0;
    rows.forEach(r => {
      if (r.event_status === 'BILLED') billed += r.billed_count;
      else if (r.event_status === 'MISSING') missing += r.expected_count;
      else if (r.event_status === 'PARTIAL') {
        billed += r.billed_count;
        partial += (r.expected_count - r.billed_count);
      }
      else if (r.event_status === 'SKIPPED') skipped += r.expected_count;
    });
    return { billed, missing, partial, skipped, total: billed + missing + partial + skipped };
  }, [rows]);

  return (
    <div>
      {/* ─── Summary cards ────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        <SummaryCard label="Billed" value={summary.billed} bg={STATUS_COLORS.BILLED.bg} text={STATUS_COLORS.BILLED.text} icon={<CheckCircle2 size={18} />} />
        <SummaryCard label="Missing" value={summary.missing} bg={STATUS_COLORS.MISSING.bg} text={STATUS_COLORS.MISSING.text} icon={<AlertCircle size={18} />} />
        <SummaryCard label="Partial" value={summary.partial} bg={STATUS_COLORS.PARTIAL.bg} text={STATUS_COLORS.PARTIAL.text} icon={<AlertCircle size={18} />} />
        <SummaryCard label="Skipped" value={summary.skipped} bg={STATUS_COLORS.SKIPPED.bg} text={STATUS_COLORS.SKIPPED.text} icon={<Filter size={18} />} />
      </div>

      {/* ─── View toggle + filters + refresh ───────────────────────────────── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 4, background: '#F3F4F6', padding: 4, borderRadius: 8 }}>
          <ToggleBtn active={view === 'event'} onClick={() => setView('event')}>By Event</ToggleBtn>
          <ToggleBtn active={view === 'client'} onClick={() => setView('client')}>By Client</ToggleBtn>
          <ToggleBtn active={view === 'skipped'} onClick={() => setView('skipped')}>Skipped Reasons</ToggleBtn>
        </div>

        {view === 'event' && (
          <>
            <select value={filterSource} onChange={e => setFilterSource(e.target.value)} style={selectStyle}>
              <option value="all">All sources</option>
              <option value="task">Tasks</option>
              <option value="repair">Repairs</option>
              <option value="will_call">Will Calls</option>
              <option value="inventory">Receiving</option>
            </select>

            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={selectStyle}>
              <option value="non-billed">Show non-billed</option>
              <option value="missing">Missing only</option>
              <option value="billed">Billed only</option>
              <option value="skipped">Skipped only</option>
              <option value="all">All</option>
            </select>

            <select value={filterClient} onChange={e => setFilterClient(e.target.value)} style={selectStyle}>
              <option value="all">All clients</option>
              {clientOptions.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </>
        )}

        <button onClick={refetch} disabled={loading}
          style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 6, border: '1px solid #D1D5DB', background: '#FFFFFF', cursor: 'pointer', fontSize: 13 }}>
          <RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh
        </button>
      </div>

      {error && (
        <div style={{ background: STATUS_COLORS.MISSING.bg, color: STATUS_COLORS.MISSING.text, padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 13 }}>
          {error}
        </div>
      )}

      {loading && rows.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: theme.v2.colors.textMuted }}>Loading…</div>}

      {/* ─── View: events ─────────────────────────────────────────────────── */}
      {view === 'event' && !loading && (
        <div style={{ overflow: 'auto', maxHeight: '70vh', border: '1px solid #E5E7EB', borderRadius: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead style={{ position: 'sticky', top: 0, background: '#F9FAFB', zIndex: 1 }}>
              <tr>
                <Th>Status</Th>
                <Th>Source</Th>
                <Th>Client</Th>
                <Th>Event</Th>
                <Th>Svc</Th>
                <Th>Item</Th>
                <Th>Date</Th>
                <Th>Items</Th>
                <Th>Billed $</Th>
                <Th>Note</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 2000).map((r, i) => (
                <tr key={`${r.source}-${r.tenant_id}-${r.event_id}-${i}`} style={{ borderTop: '1px solid #F3F4F6' }}>
                  <Td><StatusPill status={r.event_status} /></Td>
                  <Td>{SOURCE_LABELS[r.source]}</Td>
                  <Td>{r.client_name || '—'}</Td>
                  <Td style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.event_id}</Td>
                  <Td>{r.svc_code || '—'}</Td>
                  <Td style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.item_id || '—'}</Td>
                  <Td>{r.event_date || '—'}</Td>
                  <Td>{r.expected_count > 1 ? `${r.billed_count}/${r.expected_count}` : (r.billed_count ? '✓' : '—')}</Td>
                  <Td style={{ textAlign: 'right' }}>{r.billed_total != null ? `$${Number(r.billed_total).toFixed(2)}` : '—'}</Td>
                  <Td style={{ color: theme.v2.colors.textMuted, fontSize: 12 }}>{r.skip_reason || (r.result ? `${r.result}` : '—')}</Td>
                </tr>
              ))}
              {filtered.length > 2000 && (
                <tr><td colSpan={10} style={{ padding: 12, textAlign: 'center', color: theme.v2.colors.textMuted, fontSize: 12 }}>
                  Showing first 2,000 of {filtered.length.toLocaleString()} rows. Narrow filters to see more.
                </td></tr>
              )}
              {filtered.length === 0 && (
                <tr><td colSpan={10} style={{ padding: 24, textAlign: 'center', color: theme.v2.colors.textMuted }}>No events match the current filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ─── View: by client ──────────────────────────────────────────────── */}
      {view === 'client' && !loading && (
        <div style={{ overflow: 'auto', maxHeight: '70vh', border: '1px solid #E5E7EB', borderRadius: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead style={{ position: 'sticky', top: 0, background: '#F9FAFB', zIndex: 1 }}>
              <tr>
                <Th>Client</Th>
                <Th align="right">Billable</Th>
                <Th align="right">Billed</Th>
                <Th align="right">Missing</Th>
                <Th align="right">Partial</Th>
                <Th align="right">Skipped</Th>
                <Th align="right">Coverage</Th>
              </tr>
            </thead>
            <tbody>
              {clientRollup.map(c => {
                const billable = c.total - c.skipped;
                return (
                  <tr key={c.client} style={{ borderTop: '1px solid #F3F4F6' }}>
                    <Td>{c.client}</Td>
                    <Td style={{ textAlign: 'right' }}>{billable.toLocaleString()}</Td>
                    <Td style={{ textAlign: 'right', color: STATUS_COLORS.BILLED.text }}>{c.billed.toLocaleString()}</Td>
                    <Td style={{ textAlign: 'right', color: c.missing > 0 ? STATUS_COLORS.MISSING.text : undefined, fontWeight: c.missing > 0 ? 600 : undefined }}>
                      {c.missing.toLocaleString()}
                    </Td>
                    <Td style={{ textAlign: 'right', color: c.partial > 0 ? STATUS_COLORS.PARTIAL.text : undefined }}>{c.partial.toLocaleString()}</Td>
                    <Td style={{ textAlign: 'right', color: theme.v2.colors.textMuted }}>{c.skipped.toLocaleString()}</Td>
                    <Td style={{ textAlign: 'right', fontWeight: 600 }}>
                      {billable === 0 ? '—' : `${c.coveragePct.toFixed(1)}%`}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ─── View: skipped reasons ────────────────────────────────────────── */}
      {view === 'skipped' && !loading && (
        <div style={{ overflow: 'auto', maxHeight: '70vh', border: '1px solid #E5E7EB', borderRadius: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead style={{ position: 'sticky', top: 0, background: '#F9FAFB', zIndex: 1 }}>
              <tr>
                <Th>Reason</Th>
                <Th>Sources</Th>
                <Th align="right">Count</Th>
              </tr>
            </thead>
            <tbody>
              {skippedRollup.map(r => (
                <tr key={r.reason} style={{ borderTop: '1px solid #F3F4F6' }}>
                  <Td>{r.reason}</Td>
                  <Td style={{ color: theme.v2.colors.textMuted }}>{r.sources}</Td>
                  <Td style={{ textAlign: 'right' }}>{r.count.toLocaleString()}</Td>
                </tr>
              ))}
              {skippedRollup.length === 0 && (
                <tr><td colSpan={3} style={{ padding: 24, textAlign: 'center', color: theme.v2.colors.textMuted }}>No skipped events.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Subcomponents ───────────────────────────────────────────────────────────

function SummaryCard({ label, value, bg, text, icon }: { label: string; value: number; bg: string; text: string; icon: React.ReactNode }) {
  return (
    <div style={{ background: bg, color: text, borderRadius: 10, padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
        {icon} {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 700 }}>{value.toLocaleString()}</div>
    </div>
  );
}

function StatusPill({ status }: { status: CoverageRow['event_status'] }) {
  const c = STATUS_COLORS[status];
  return (
    <span style={{ display: 'inline-block', background: c.bg, color: c.text, padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600 }}>
      {status}
    </span>
  );
}

function ToggleBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      style={{
        padding: '6px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
        background: active ? '#FFFFFF' : 'transparent',
        color: active ? '#111827' : '#6B7280',
        boxShadow: active ? '0 1px 2px rgba(0,0,0,0.06)' : undefined,
      }}>
      {children}
    </button>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: 'right' }) {
  return <th style={{ padding: '8px 10px', textAlign: align || 'left', fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid #E5E7EB' }}>{children}</th>;
}

function Td({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <td style={{ padding: '8px 10px', ...style }}>{children}</td>;
}
