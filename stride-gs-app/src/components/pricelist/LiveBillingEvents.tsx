/**
 * LiveBillingEvents — renders at the bottom of ParityMonitor. Reads the
 * event-level parity log (public.billing_parity_log) and shows every
 * billing rate lookup with both the sheet rate and the Supabase rate
 * side by side. Mismatches are highlighted red.
 *
 * Powers the operator's Phase 5 sign-off: once this feed shows zero
 * mismatches across a week of real billing activity, we can flip
 * api_lookupRate_ to Supabase-primary.
 */
import { useMemo, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, RefreshCw, Loader2 } from 'lucide-react';
import { theme } from '../../styles/theme';
import { useBillingParityLog } from '../../hooks/useBillingParityLog';
import { fmtDateTime } from '../../lib/constants';

type Filter = 'all' | 'mismatched';

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return '—';
  return `$${Number(n).toFixed(2)}`;
}

function fmtDelta(n: number | null | undefined): string {
  if (n == null) return '—';
  const v = Number(n);
  if (Math.abs(v) < 0.001) return '$0.00';
  return `${v > 0 ? '+' : ''}$${v.toFixed(2)}`;
}

export function LiveBillingEvents() {
  const { events, loading, error, refetch } = useBillingParityLog(200);
  const [filter, setFilter] = useState<Filter>('all');

  const stats = useMemo(() => {
    let matched = 0;
    let mismatched = 0;
    let totalDelta = 0;
    for (const e of events) {
      if (e.match === true) matched++;
      else if (e.match === false) mismatched++;
      if (e.delta != null) totalDelta += e.delta;
    }
    return { total: events.length, matched, mismatched, totalDelta };
  }, [events]);

  const filtered = useMemo(() => {
    if (filter === 'mismatched') return events.filter(e => e.match === false);
    return events;
  }, [events, filter]);

  return (
    <section style={{
      background: '#fff',
      border: `1px solid ${theme.colors.border}`,
      borderRadius: 12,
      padding: 16,
      marginTop: 16,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Activity size={16} color={theme.colors.orange} />
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: theme.colors.text }}>Live Billing Events</h2>
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase',
            padding: '2px 8px', borderRadius: 100,
            background: theme.colors.bgSubtle, color: theme.colors.textMuted,
          }}>
            Shadow mode
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <FilterPill active={filter === 'all'} onClick={() => setFilter('all')}>All ({stats.total})</FilterPill>
          <FilterPill active={filter === 'mismatched'} onClick={() => setFilter('mismatched')} accent="danger">
            Mismatched ({stats.mismatched})
          </FilterPill>
          <button
            onClick={() => { void refetch(); }}
            disabled={loading}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '6px 12px', fontSize: 11, fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase',
              background: '#fff', color: theme.colors.textSecondary,
              border: `1px solid ${theme.colors.border}`, borderRadius: 100,
              cursor: loading ? 'wait' : 'pointer', fontFamily: 'inherit',
            }}
          >
            {loading ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={12} />}
            Refresh
          </button>
        </div>
      </div>

      {/* Stat row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 12 }}>
        <Stat label="Events" value={String(stats.total)} />
        <Stat label="Matched" value={String(stats.matched)} accent="#15803D" icon={<CheckCircle2 size={12} color="#15803D" />} />
        <Stat label="Mismatched" value={String(stats.mismatched)} accent={stats.mismatched > 0 ? '#B91C1C' : theme.colors.textMuted} icon={stats.mismatched > 0 ? <AlertTriangle size={12} color="#B91C1C" /> : undefined} />
        <Stat label="Total Delta" value={fmtDelta(stats.totalDelta)} accent={Math.abs(stats.totalDelta) < 0.01 ? theme.colors.textMuted : '#B91C1C'} />
      </div>

      {/* Error */}
      {error && (
        <div role="alert" style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '8px 12px', marginBottom: 10,
          background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#B91C1C',
          borderRadius: 8, fontSize: 12,
        }}>
          <AlertTriangle size={12} /> {error}
        </div>
      )}

      {/* Table */}
      {loading && events.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', color: theme.colors.textMuted, fontSize: 12 }}>
          Loading events…
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', color: theme.colors.textMuted, fontSize: 12 }}>
          {filter === 'mismatched' ? 'No mismatches. Phase 5 cutover is clean for the visible window.' : 'No billing events logged yet. Complete a shipment / task / repair / WC release and the feed will populate.'}
        </div>
      ) : (
        <div style={{ overflowX: 'auto', border: `1px solid ${theme.colors.borderLight}`, borderRadius: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: theme.colors.bgSubtle }}>
                <th style={thStyle}>Time</th>
                <th style={thStyle}>Client</th>
                <th style={thStyle}>Item</th>
                <th style={thStyle}>Event</th>
                <th style={thStyle}>Service</th>
                <th style={thStyle}>Class</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Sheet</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>SB</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>Match</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Delta</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(e => {
                const isMismatch = e.match === false;
                return (
                  <tr
                    key={e.id}
                    style={{
                      background: isMismatch ? '#FEF2F2' : '#fff',
                      borderBottom: `1px solid ${theme.colors.borderLight}`,
                    }}
                  >
                    <td style={{ ...tdStyle, color: theme.colors.textMuted, whiteSpace: 'nowrap' }}>{fmtDateTime(e.createdAt)}</td>
                    <td style={tdStyle}>{e.clientName || <span style={{ color: theme.colors.textMuted }}>—</span>}</td>
                    <td style={{ ...tdStyle, fontVariantNumeric: 'tabular-nums' }}>{e.itemId || '—'}</td>
                    <td style={{ ...tdStyle, color: theme.colors.textSecondary, fontSize: 11 }}>{e.eventSource || '—'}</td>
                    <td style={tdStyle}>{e.svcCode || '—'}</td>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{e.itemClass || '—'}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(e.sheetRate)}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(e.supabaseRate)}</td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      {e.match === true
                        ? <CheckCircle2 size={14} color="#15803D" />
                        : e.match === false
                          ? <AlertTriangle size={14} color="#B91C1C" />
                          : <span style={{ color: theme.colors.textMuted }}>—</span>}
                    </td>
                    <td style={{
                      ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                      color: isMismatch ? '#B91C1C' : theme.colors.textMuted,
                      fontWeight: isMismatch ? 600 : 400,
                    }}>{fmtDelta(e.delta)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────

function Stat({ label, value, accent, icon }: { label: string; value: string; accent?: string; icon?: React.ReactNode }) {
  return (
    <div style={{
      background: '#1C1C1C', color: '#fff',
      borderRadius: 10, padding: '12px 14px',
      borderLeft: `4px solid ${accent ?? theme.colors.orange}`,
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <div style={{
        fontSize: 9, fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase',
        color: 'rgba(255,255,255,0.5)',
      }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6, fontVariantNumeric: 'tabular-nums' }}>
        {icon}{value}
      </div>
    </div>
  );
}

function FilterPill({ active, accent, onClick, children }: {
  active: boolean;
  accent?: 'danger';
  onClick: () => void;
  children: React.ReactNode;
}) {
  const bg = active
    ? (accent === 'danger' ? '#FEE2E2' : '#1C1C1C')
    : '#fff';
  const fg = active
    ? (accent === 'danger' ? '#B91C1C' : '#fff')
    : theme.colors.textSecondary;
  const borderC = active
    ? (accent === 'danger' ? '#FCA5A5' : '#1C1C1C')
    : theme.colors.border;
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '1px',
        textTransform: 'uppercase', borderRadius: 100,
        background: bg, color: fg, border: `1px solid ${borderC}`,
        cursor: 'pointer', fontFamily: 'inherit',
      }}
    >
      {children}
    </button>
  );
}

const thStyle: React.CSSProperties = {
  padding: '8px 10px', textAlign: 'left',
  fontWeight: 600, fontSize: 10, letterSpacing: '1px', textTransform: 'uppercase',
  color: theme.colors.textMuted, borderBottom: `1px solid ${theme.colors.border}`,
};
const tdStyle: React.CSSProperties = {
  padding: '8px 10px', verticalAlign: 'middle',
};
