/**
 * ParityMonitor — admin-only diagnostic page comparing pricing between the
 * MPL Price_List sheet and the Supabase service_catalog. Reads via a single
 * GAS endpoint (getPricingParity). A Sync-to-Sheet shortcut is included so
 * the admin can repair drift and refresh in one flow.
 */
import { useState, useMemo, useCallback } from 'react';
import { RefreshCw, CheckCircle2, AlertTriangle, Download, Scale, Loader2 } from 'lucide-react';
import { theme } from '../styles/theme';
import { useParityMonitor } from '../hooks/useParityMonitor';
import { syncPriceListFromSupabase, type ParityService, type ParityClass } from '../lib/api';
import { fmtDateTime } from '../lib/constants';
import { LiveBillingEvents } from '../components/pricelist/LiveBillingEvents';

const CLASSES: ParityClass[] = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

type Filter = 'all' | 'mismatched' | 'matching';

// ─── Styles ────────────────────────────────────────────────────────────────
const statCard = (accent: string): React.CSSProperties => ({
  flex: 1,
  minWidth: 160,
  background: '#1C1C1C',
  color: '#fff',
  borderRadius: 12,
  padding: '16px 20px',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  borderLeft: `4px solid ${accent}`,
});
const statLabel: React.CSSProperties = { fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.5)', letterSpacing: '1.5px', textTransform: 'uppercase' };
const statValue: React.CSSProperties = { fontSize: 28, fontWeight: 700, fontFamily: 'Inter, sans-serif' };

const cardWrap: React.CSSProperties = { background: '#fff', border: `1px solid ${theme.colors.border}`, borderRadius: 12, padding: 16, marginBottom: 14 };
const th: React.CSSProperties = { padding: '8px 10px', textAlign: 'left', fontWeight: 500, fontSize: 10, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: `1px solid ${theme.colors.border}`, background: '#fff', position: 'sticky', top: 0, zIndex: 1, whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: `1px solid ${theme.colors.borderLight}`, verticalAlign: 'middle', fontSize: 12 };

const MATCH_BG = '#F0FDF4';
const MISMATCH_BG = '#FEF2F2';
const MATCH_FG = '#15803D';
const MISMATCH_FG = '#B91C1C';
const MISSING_BG = '#FEF3C7';
const MISSING_FG = '#92400E';

function fmtRate(n: number | undefined | null): string {
  if (n == null || n === 0) return '—';
  return `$${Number(n).toFixed(2)}`;
}

function exportCsv(services: ParityService[]) {
  const header = [
    'Code', 'Name', 'Category', 'Billing', 'Source', 'Match',
    ...CLASSES.map(c => `Sheet ${c}`),
    ...CLASSES.map(c => `SB ${c}`),
    'Sheet Flat', 'SB Flat',
  ];
  const rows = services.map(s => {
    const sh = s.sheet, sb = s.supabase;
    return [
      s.code, s.name, s.category, s.billing, s.source, s.match ? 'yes' : 'no',
      ...CLASSES.map(c => (sh ? sh.rates[c] ?? '' : '')),
      ...CLASSES.map(c => (sb ? sb.rates[c] ?? '' : '')),
      sh ? sh.flatRate : '',
      sb ? sb.flatRate : '',
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
  });
  const blob = new Blob([header.join(',') + '\n' + rows.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'pricing-parity.csv';
  a.click();
}

// ─── Rate cell (stacked sheet/supabase with match coloring) ────────────────
function RateCell({ sheet, sb, cls, match }: { sheet: number | undefined; sb: number | undefined; cls: ParityClass; match: boolean }) {
  const s = sheet ?? 0;
  const v = sb ?? 0;
  const cellMatch = Math.abs(s - v) < 0.001;
  const bg = cellMatch ? MATCH_BG : MISMATCH_BG;
  const fg = cellMatch ? MATCH_FG : MISMATCH_FG;
  return (
    <td style={{ ...td, background: bg, textAlign: 'right', fontVariantNumeric: 'tabular-nums', padding: '6px 10px' }}>
      <div style={{ fontSize: 11, color: fg, fontWeight: 600 }}>{fmtRate(s)}</div>
      <div style={{ fontSize: 10, color: cellMatch ? 'rgba(21,128,61,0.7)' : fg, fontWeight: 500, fontStyle: 'italic' }}>{fmtRate(v)}</div>
      {!cellMatch && <div style={{ fontSize: 9, color: fg, fontWeight: 700, marginTop: 2, letterSpacing: '0.05em' }}>Δ {(s - v).toFixed(2)}</div>}
      {/* cls + match are referenced to keep prop surface stable even though we don't render them here */}
      <span hidden>{cls}{match ? '' : ''}</span>
    </td>
  );
}

function MissingBadge() {
  return <span style={{ display: 'inline-block', padding: '1px 6px', fontSize: 9, fontWeight: 700, background: MISSING_BG, color: MISSING_FG, borderRadius: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Missing</span>;
}

// ─── Page ──────────────────────────────────────────────────────────────────
export function ParityMonitor() {
  const { data, loading, error, refresh, lastFetchedAt } = useParityMonitor(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const handleSync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncMsg(null);
    const res = await syncPriceListFromSupabase();
    setSyncing(false);
    if (res.ok && res.data?.success) {
      setSyncMsg(`Sync OK — updated ${res.data.updated}, appended ${res.data.appended} (${res.data.total_supabase} in Supabase)`);
      refresh();
    } else {
      setSyncMsg(res.error || 'Sync failed');
    }
    setTimeout(() => setSyncMsg(null), 6000);
  }, [syncing, refresh]);

  const categories = useMemo(() => {
    if (!data) return [];
    const set = new Set(data.services.map(s => s.category).filter(Boolean));
    return Array.from(set).sort();
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.services.filter(s => {
      if (filter === 'mismatched' && s.match && s.source === 'both') return false;
      if (filter === 'matching' && (!s.match || s.source !== 'both')) return false;
      if (categoryFilter && s.category !== categoryFilter) return false;
      return true;
    });
  }, [data, filter, categoryFilter]);

  const classBased = useMemo(() => filtered.filter(s => s.billing !== 'flat'), [filtered]);
  const flatOnly = useMemo(() => filtered.filter(s => s.billing === 'flat'), [filtered]);

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '0.5px', color: '#1C1C1C', display: 'flex', alignItems: 'center', gap: 10 }}>
            <Scale size={20} color={theme.colors.orange} />
            Pricing Parity Monitor
          </div>
          <div style={{ fontSize: 12, color: theme.colors.textMuted, marginTop: 2 }}>
            MPL sheet vs Supabase service catalog.
            {lastFetchedAt && <span> Last read {fmtDateTime(lastFetchedAt.toISOString())}.</span>}
          </div>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', fontSize: 12, fontWeight: 600, borderRadius: 8, border: `1px solid ${theme.colors.border}`, background: '#fff', cursor: loading ? 'wait' : 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary }}
        >
          {loading ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={13} />} Refresh
        </button>
        <button
          onClick={handleSync}
          disabled={syncing || loading}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', fontSize: 12, fontWeight: 600, borderRadius: 8, border: 'none', background: theme.colors.orange, color: '#fff', cursor: syncing ? 'wait' : 'pointer', fontFamily: 'inherit' }}
        >
          {syncing ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={13} />} Sync to Sheet
        </button>
        <button
          onClick={() => data && exportCsv(data.services)}
          disabled={!data}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', fontSize: 12, fontWeight: 600, borderRadius: 8, border: `1px solid ${theme.colors.border}`, background: '#fff', cursor: data ? 'pointer' : 'not-allowed', fontFamily: 'inherit', color: theme.colors.textSecondary }}
        >
          <Download size={13} /> Export CSV
        </button>
      </div>

      {syncMsg && (
        <div style={{ padding: '8px 12px', marginBottom: 12, background: syncMsg.startsWith('Sync OK') ? '#F0FDF4' : '#FEF2F2', border: `1px solid ${syncMsg.startsWith('Sync OK') ? '#86EFAC' : '#FCA5A5'}`, color: syncMsg.startsWith('Sync OK') ? '#15803D' : '#B91C1C', borderRadius: 8, fontSize: 12 }}>
          {syncMsg}
        </div>
      )}

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 12, background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#B91C1C', borderRadius: 8, fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {data && !data.supabaseReachable && (
        <div style={{ padding: '10px 14px', marginBottom: 12, background: '#FEF3C7', border: '1px solid #F59E0B', color: '#92400E', borderRadius: 8, fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          <AlertTriangle size={14} /> Supabase unreachable — only sheet data shown.
        </div>
      )}

      {/* Stats */}
      {data && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
          <div style={statCard(theme.colors.orange)}>
            <span style={statLabel}>Total Services</span>
            <span style={statValue}>{data.summary.total}</span>
          </div>
          <div style={statCard('#22C55E')}>
            <span style={statLabel}>Matching</span>
            <span style={{ ...statValue, color: '#86EFAC' }}>{data.summary.matching}</span>
          </div>
          <div style={statCard('#EF4444')}>
            <span style={statLabel}>Mismatched</span>
            <span style={{ ...statValue, color: '#FCA5A5' }}>{data.summary.mismatched}</span>
          </div>
          <div style={statCard('#F59E0B')}>
            <span style={statLabel}>Missing Rows</span>
            <span style={{ ...statValue, color: '#FCD34D' }}>{data.summary.sheetOnly + data.summary.supabaseOnly}</span>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', marginTop: -3 }}>
              {data.summary.sheetOnly} sheet-only · {data.summary.supabaseOnly} Supabase-only
            </span>
          </div>
        </div>
      )}

      {/* Class Volumes comparison */}
      {data && (
        <div style={cardWrap}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Class Volumes</span>
            {data.classVolumes.match
              ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: MATCH_FG, background: MATCH_BG, padding: '2px 8px', borderRadius: 8, fontWeight: 700 }}><CheckCircle2 size={11} /> MATCH</span>
              : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: MISMATCH_FG, background: MISMATCH_BG, padding: '2px 8px', borderRadius: 8, fontWeight: 700 }}><AlertTriangle size={11} /> MISMATCH</span>}
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...th, width: 100 }}>Source</th>
                {CLASSES.map(c => <th key={c} style={{ ...th, textAlign: 'right' }}>{c}</th>)}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ ...td, fontWeight: 600 }}>MPL Sheet</td>
                {CLASSES.map(c => {
                  const sheetV = data.classVolumes.sheet[c] ?? 0;
                  const sbV = data.classVolumes.supabase[c] ?? 0;
                  const match = Math.abs(sheetV - sbV) < 0.001;
                  return <td key={c} style={{ ...td, textAlign: 'right', background: match ? MATCH_BG : MISMATCH_BG, color: match ? MATCH_FG : MISMATCH_FG, fontWeight: 600 }}>{sheetV.toFixed(0)}</td>;
                })}
              </tr>
              <tr>
                <td style={{ ...td, fontWeight: 600 }}>Supabase</td>
                {CLASSES.map(c => {
                  const sheetV = data.classVolumes.sheet[c] ?? 0;
                  const sbV = data.classVolumes.supabase[c] ?? 0;
                  const match = Math.abs(sheetV - sbV) < 0.001;
                  return <td key={c} style={{ ...td, textAlign: 'right', background: match ? MATCH_BG : MISMATCH_BG, color: match ? MATCH_FG : MISMATCH_FG, fontWeight: 600 }}>{sbV.toFixed(0)}</td>;
                })}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Filters */}
      {data && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['all', 'mismatched', 'matching'] as Filter[]).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  padding: '6px 14px', fontSize: 12, fontWeight: 600, borderRadius: 100,
                  border: `1px solid ${filter === f ? theme.colors.orange : theme.colors.border}`,
                  background: filter === f ? theme.colors.orange : '#fff',
                  color: filter === f ? '#fff' : theme.colors.textSecondary,
                  cursor: 'pointer', fontFamily: 'inherit',
                  textTransform: 'capitalize',
                }}
              >{f}</button>
            ))}
          </div>
          <select
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value)}
            style={{ padding: '6px 10px', fontSize: 12, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', color: theme.colors.text, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            <option value="">All categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <span style={{ fontSize: 12, color: theme.colors.textMuted, marginLeft: 'auto' }}>
            Showing <strong>{filtered.length}</strong> of <strong>{data.services.length}</strong>
          </span>
        </div>
      )}

      {/* Class-based comparison */}
      {data && classBased.length > 0 && (
        <div style={{ background: '#fff', border: `1px solid ${theme.colors.border}`, borderRadius: 12, overflow: 'hidden', marginBottom: 14 }}>
          <div style={{ padding: '10px 14px', borderBottom: `1px solid ${theme.colors.borderLight}`, fontSize: 13, fontWeight: 600 }}>
            Class-based services ({classBased.length})
          </div>
          <div style={{ overflowX: 'auto', maxHeight: 'calc(100dvh - 520px)', minHeight: 200 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
              <thead>
                <tr>
                  <th style={{ ...th, width: 90 }}>Code</th>
                  <th style={{ ...th, width: 180 }}>Name</th>
                  <th style={{ ...th, width: 120 }}>Category</th>
                  <th style={{ ...th, width: 80 }}>Source</th>
                  <th style={{ ...th, width: 70, textAlign: 'center' }}>Match</th>
                  {CLASSES.map(c => <th key={c} style={{ ...th, textAlign: 'right', width: 80 }}>{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {classBased.map(s => (
                  <tr key={s.code} style={{ background: s.match && s.source === 'both' ? 'transparent' : (s.source !== 'both' ? '#FFFBEB' : '#FFF5F5') }}>
                    <td style={{ ...td, fontFamily: 'monospace', fontWeight: 600, color: theme.colors.orange }}>{s.code}</td>
                    <td style={{ ...td, fontWeight: 500 }}>{s.name}</td>
                    <td style={{ ...td, color: theme.colors.textMuted }}>{s.category || '—'}</td>
                    <td style={{ ...td }}>
                      {s.source === 'both' ? <span style={{ fontSize: 10, fontWeight: 600, color: theme.colors.textMuted }}>Both</span>
                        : s.source === 'sheet' ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, color: MISSING_FG, background: MISSING_BG, padding: '2px 6px', borderRadius: 6 }}>Sheet only</span>
                        : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, color: MISSING_FG, background: MISSING_BG, padding: '2px 6px', borderRadius: 6 }}>SB only</span>}
                    </td>
                    <td style={{ ...td, textAlign: 'center' }}>
                      {s.source !== 'both' ? <MissingBadge />
                        : s.match ? <CheckCircle2 size={15} color={MATCH_FG} />
                        : <AlertTriangle size={15} color={MISMATCH_FG} />}
                    </td>
                    {CLASSES.map(c => (
                      <RateCell
                        key={c}
                        sheet={s.sheet?.rates[c]}
                        sb={s.supabase?.rates[c]}
                        cls={c}
                        match={s.match}
                      />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '8px 14px', borderTop: `1px solid ${theme.colors.borderLight}`, fontSize: 11, color: theme.colors.textMuted }}>
            Each cell shows <strong>sheet rate</strong> (top) / <em>Supabase rate</em> (bottom). Green = match, red = drift.
          </div>
        </div>
      )}

      {/* Flat-rate services */}
      {data && flatOnly.length > 0 && (
        <div style={{ background: '#fff', border: `1px solid ${theme.colors.border}`, borderRadius: 12, overflow: 'hidden', marginBottom: 14 }}>
          <div style={{ padding: '10px 14px', borderBottom: `1px solid ${theme.colors.borderLight}`, fontSize: 13, fontWeight: 600 }}>
            Flat-rate services ({flatOnly.length})
          </div>
          <div style={{ overflowX: 'auto', maxHeight: 360 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
              <thead>
                <tr>
                  <th style={{ ...th, width: 90 }}>Code</th>
                  <th style={{ ...th, width: 200 }}>Name</th>
                  <th style={{ ...th, width: 120 }}>Category</th>
                  <th style={{ ...th, width: 70, textAlign: 'center' }}>Match</th>
                  <th style={{ ...th, width: 120, textAlign: 'right' }}>Sheet Rate</th>
                  <th style={{ ...th, width: 120, textAlign: 'right' }}>Supabase Rate</th>
                </tr>
              </thead>
              <tbody>
                {flatOnly.map(s => {
                  const shV = s.sheet?.flatRate ?? 0;
                  const sbV = s.supabase?.flatRate ?? 0;
                  const cellMatch = s.source === 'both' && Math.abs(shV - sbV) < 0.001;
                  return (
                    <tr key={s.code} style={{ background: cellMatch ? 'transparent' : (s.source !== 'both' ? '#FFFBEB' : '#FFF5F5') }}>
                      <td style={{ ...td, fontFamily: 'monospace', fontWeight: 600, color: theme.colors.orange }}>{s.code}</td>
                      <td style={{ ...td, fontWeight: 500 }}>{s.name}</td>
                      <td style={{ ...td, color: theme.colors.textMuted }}>{s.category || '—'}</td>
                      <td style={{ ...td, textAlign: 'center' }}>
                        {s.source !== 'both' ? <MissingBadge />
                          : cellMatch ? <CheckCircle2 size={15} color={MATCH_FG} />
                          : <AlertTriangle size={15} color={MISMATCH_FG} />}
                      </td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 600, background: cellMatch ? MATCH_BG : (s.sheet ? MISMATCH_BG : MISSING_BG), color: cellMatch ? MATCH_FG : (s.sheet ? MISMATCH_FG : MISSING_FG) }}>
                        {s.sheet ? fmtRate(shV) : <MissingBadge />}
                      </td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 600, background: cellMatch ? MATCH_BG : (s.supabase ? MISMATCH_BG : MISSING_BG), color: cellMatch ? MATCH_FG : (s.supabase ? MISMATCH_FG : MISSING_FG) }}>
                        {s.supabase ? fmtRate(sbV) : <MissingBadge />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {loading && !data && (
        <div style={{ textAlign: 'center', padding: 40, color: theme.colors.textMuted, fontSize: 13 }}>
          <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> Loading parity data…
        </div>
      )}

      {/* v38.91.0 — live event-level feed from public.billing_parity_log.
          Whereas the static table above compares every catalog row at a
          point in time, this section shows the actual rate chosen during
          each real billing event (receiving / task complete / storage
          etc). Mismatches here mean the GAS shadow-mode cutover is
          NOT safe to flip yet; zero mismatches across a representative
          window = green light for Phase 5 primary flip. */}
      <LiveBillingEvents />
    </div>
  );
}

export default ParityMonitor;
