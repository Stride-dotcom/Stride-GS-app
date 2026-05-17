/**
 * ParityDashboard — admin/staff view of the GAS→Supabase migration shadow
 * testing state. Reads the public.parity_summary view (one row per
 * migrating function, rolled up from public.parity_results +
 * public.feature_flags) and the public.parity_billing_shadow view (the
 * billing/payment subset, with the redacted GAS input payload attached so
 * Justin can watch the auto-pay shadow runs).
 *
 * Both views ship in migration 20260516000000_parity_dashboard_views.sql.
 * The Settings → Migration tab is the *control* surface (flip flags);
 * this page is the *observation* surface (is the shadow safe to flip?).
 *
 * Auto-refreshes the summary + billing feed every 30s. Row click expands
 * to the last 10 raw parity_results for that function.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  GitCompare, RefreshCw, Loader2, AlertTriangle, ChevronRight, ChevronDown,
  CheckCircle2, XCircle, Zap, CircleDashed,
} from 'lucide-react';
import { theme } from '../styles/theme';
import { supabase } from '../lib/supabase';
import { fmtDateTime, fmtDate } from '../lib/constants';

const REFRESH_MS = 30_000;

// ─── Types ─────────────────────────────────────────────────────────────────
interface SummaryRow {
  function_key: string;
  active_backend: 'gas' | 'supabase';
  shadow_backend: 'gas' | 'supabase' | null;
  parity_enabled: boolean;
  total_checks: number;
  mismatch_count: number;
  match_rate_pct: number | null;
  last_run_at: string | null;
  last_7d_total: number;
  last_7d_matches: number;
  last_7d_mismatches: number;
  last_7d_match_rate: number | null;
  avg_gas_ms: number | null;
  avg_sb_ms: number | null;
  sb_speed_improvement_pct: number | null;
  notes: string | null;
}

interface ParityResultRow {
  id: string;
  function_key: string;
  tenant_id: string | null;
  match: boolean;
  gas_duration_ms: number | null;
  sb_duration_ms: number | null;
  mismatch_details: unknown;
  created_at: string;
}

interface BillingShadowRow {
  id: string;
  created_at: string;
  function_key: string;
  tenant_id: string | null;
  match: boolean;
  gas_duration_ms: number | null;
  sb_duration_ms: number | null;
  mismatch_details: unknown;
  input_summary: Record<string, unknown> | null;
}

// ─── Helpers ───────────────────────────────────────────────────────────────
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

const ACRONYMS: Record<string, string> = { Wc: 'WC', Sb: 'SB', Qbo: 'QBO', Id: 'ID' };

/** camelCase function_key → "Title Case" (e.g. completeTask → "Complete Task"). */
function fmtFunctionKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, c => c.toUpperCase())
    .split(' ')
    .map(w => ACRONYMS[w] ?? w)
    .join(' ');
}

function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 0) return 'just now';
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604_800) return `${Math.floor(s / 86_400)}d ago`;
  return fmtDate(iso);
}

const MONEY_KEYS = [
  'amount', 'total', 'total_amount', 'totalAmount', 'invoice_total',
  'invoiceTotal', 'charge_amount', 'chargeAmount', 'grand_total', 'grandTotal',
];

/** Best-effort dollar-amount extraction from a redacted input payload. */
function extractAmount(input: Record<string, unknown> | null): string {
  if (!input || typeof input !== 'object') return '—';
  for (const k of MONEY_KEYS) {
    const v = num((input as Record<string, unknown>)[k]);
    if (v != null) return `$${v.toFixed(2)}`;
  }
  return '—';
}

// ─── Shared styles ─────────────────────────────────────────────────────────
const statCard = (accent: string): React.CSSProperties => ({
  flex: 1,
  minWidth: 170,
  background: '#1C1C1C',
  color: '#fff',
  borderRadius: 12,
  padding: '16px 20px',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  borderLeft: `4px solid ${accent}`,
});
const statLabel: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.5)',
  letterSpacing: '1.5px', textTransform: 'uppercase',
};
const statValue: React.CSSProperties = { fontSize: 28, fontWeight: 700, fontVariantNumeric: 'tabular-nums' };

const th: React.CSSProperties = {
  padding: '9px 12px', textAlign: 'left', fontWeight: 600, fontSize: 10,
  color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '1px',
  borderBottom: `1px solid ${theme.colors.border}`, background: '#fff',
  position: 'sticky', top: 0, zIndex: 1, whiteSpace: 'nowrap',
};
const td: React.CSSProperties = {
  padding: '10px 12px', borderBottom: `1px solid ${theme.colors.borderLight}`,
  verticalAlign: 'middle', fontSize: 12,
};
const cardWrap: React.CSSProperties = {
  background: '#fff', border: `1px solid ${theme.colors.border}`,
  borderRadius: 12, overflow: 'hidden', marginBottom: 16,
};

// ─── Status / metric badges ────────────────────────────────────────────────
function StatusBadge({ row }: { row: SummaryRow }) {
  let bg: string, fg: string, label: string;
  if (row.active_backend === 'supabase') {
    bg = theme.colors.statusGreenBg; fg = theme.colors.statusGreen; label = 'Live on SB';
  } else if (row.parity_enabled) {
    bg = theme.colors.statusBlueBg; fg = theme.colors.statusBlue; label = 'Shadow';
  } else {
    bg = theme.colors.statusGrayBg; fg = theme.colors.statusGray; label = 'Pending';
  }
  return (
    <span style={{
      display: 'inline-block', padding: '2px 9px', fontSize: 10, fontWeight: 700,
      background: bg, color: fg, borderRadius: 100, textTransform: 'uppercase',
      letterSpacing: '0.05em', whiteSpace: 'nowrap',
    }}>{label}</span>
  );
}

function matchRateColor(pct: number | null): string {
  if (pct == null) return theme.colors.textMuted;
  if (pct > 95) return theme.colors.statusGreen;
  if (pct >= 80) return theme.colors.statusAmber;
  return theme.colors.statusRed;
}

function MatchRateCell({ pct, total }: { pct: number | null; total: number }) {
  if (total === 0 || pct == null) {
    return <span style={{ color: theme.colors.textMuted }}>—</span>;
  }
  return (
    <span style={{ color: matchRateColor(pct), fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
      {pct.toFixed(1)}%
    </span>
  );
}

function SpeedCell({ pct }: { pct: number | null }) {
  if (pct == null) return <span style={{ color: theme.colors.textMuted }}>—</span>;
  const faster = pct >= 0;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      color: faster ? theme.colors.statusGreen : theme.colors.statusRed,
      fontWeight: 600, fontVariantNumeric: 'tabular-nums',
    }}>
      <Zap size={11} />
      {Math.abs(pct).toFixed(0)}% {faster ? 'faster' : 'slower'}
    </span>
  );
}

// ─── Expanded detail: last 10 raw parity_results ───────────────────────────
function RowDetail({ functionKey }: { functionKey: string }) {
  const [rows, setRows] = useState<ParityResultRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error: err } = await supabase
        .from('parity_results')
        .select('id, function_key, tenant_id, match, gas_duration_ms, sb_duration_ms, mismatch_details, created_at')
        .eq('function_key', functionKey)
        .order('created_at', { ascending: false })
        .limit(10);
      if (!alive) return;
      if (err) { setError(err.message); return; }
      setRows((data ?? []) as ParityResultRow[]);
    })();
    return () => { alive = false; };
  }, [functionKey]);

  if (error) {
    return (
      <div style={{ padding: '12px 16px', fontSize: 12, color: theme.colors.statusRed }}>
        Failed to load recent runs: {error}
      </div>
    );
  }
  if (rows === null) {
    return (
      <div style={{ padding: '14px 16px', fontSize: 12, color: theme.colors.textMuted }}>
        <Loader2 size={13} style={{ animation: 'spin 1s linear infinite', verticalAlign: 'middle' }} /> Loading recent runs…
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div style={{ padding: '14px 16px', fontSize: 12, color: theme.colors.textMuted }}>
        No parity runs recorded yet for this function.
      </div>
    );
  }

  return (
    <div style={{ padding: '12px 16px', background: theme.colors.bgSubtle }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: theme.colors.textMuted, marginBottom: 8 }}>
        Last {rows.length} run{rows.length !== 1 ? 's' : ''}
      </div>
      <div style={{ overflowX: 'auto', border: `1px solid ${theme.colors.borderLight}`, borderRadius: 8, background: '#fff' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 620 }}>
          <thead>
            <tr>
              <th style={th}>When</th>
              <th style={th}>Tenant</th>
              <th style={{ ...th, textAlign: 'center' }}>Result</th>
              <th style={{ ...th, textAlign: 'right' }}>GAS ms</th>
              <th style={{ ...th, textAlign: 'right' }}>SB ms</th>
              <th style={th}>Mismatch detail</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} style={{ background: r.match ? '#fff' : theme.colors.statusRedBg }}>
                <td style={{ ...td, whiteSpace: 'nowrap', color: theme.colors.textSecondary }}>{fmtDateTime(r.created_at)}</td>
                <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>{r.tenant_id || '—'}</td>
                <td style={{ ...td, textAlign: 'center' }}>
                  {r.match
                    ? <CheckCircle2 size={15} color={theme.colors.statusGreen} />
                    : <XCircle size={15} color={theme.colors.statusRed} />}
                </td>
                <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.gas_duration_ms ?? '—'}</td>
                <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.sb_duration_ms ?? '—'}</td>
                <td style={{ ...td, maxWidth: 360 }}>
                  {r.match || r.mismatch_details == null
                    ? <span style={{ color: theme.colors.textMuted }}>—</span>
                    : <code style={{ fontSize: 10, color: theme.colors.statusRed, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {JSON.stringify(r.mismatch_details).slice(0, 300)}
                      </code>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────
export function ParityDashboard() {
  const [rows, setRows] = useState<SummaryRow[]>([]);
  const [billing, setBilling] = useState<BillingShadowRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const fetchAll = useCallback(async (showSpinner: boolean) => {
    if (showSpinner) setLoading(true);
    const [summaryRes, billingRes] = await Promise.all([
      supabase.from('parity_summary').select('*').order('function_key', { ascending: true }),
      supabase.from('parity_billing_shadow').select('*').order('created_at', { ascending: false }).limit(50),
    ]);
    if (!mountedRef.current) return;
    if (summaryRes.error) {
      setError(summaryRes.error.message);
      setLoading(false);
      return;
    }
    setError(null);
    const mapped = (summaryRes.data ?? []).map((r: Record<string, unknown>): SummaryRow => ({
      function_key: String(r.function_key),
      active_backend: r.active_backend === 'supabase' ? 'supabase' : 'gas',
      shadow_backend: r.shadow_backend === 'supabase' ? 'supabase' : r.shadow_backend === 'gas' ? 'gas' : null,
      parity_enabled: r.parity_enabled === true,
      total_checks: num(r.total_checks) ?? 0,
      mismatch_count: num(r.mismatch_count) ?? 0,
      match_rate_pct: num(r.match_rate_pct),
      last_run_at: (r.last_run_at as string) ?? null,
      last_7d_total: num(r.last_7d_total) ?? 0,
      last_7d_matches: num(r.last_7d_matches) ?? 0,
      last_7d_mismatches: num(r.last_7d_mismatches) ?? 0,
      last_7d_match_rate: num(r.last_7d_match_rate),
      avg_gas_ms: num(r.avg_gas_ms),
      avg_sb_ms: num(r.avg_sb_ms),
      sb_speed_improvement_pct: num(r.sb_speed_improvement_pct),
      notes: (r.notes as string) ?? null,
    }));
    setRows(mapped);
    setBilling(billingRes.error ? [] : ((billingRes.data ?? []) as BillingShadowRow[]));
    setLastFetched(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchAll(true);
    const id = setInterval(() => { void fetchAll(false); }, REFRESH_MS);
    return () => clearInterval(id);
  }, [fetchAll]);

  const summary = useMemo(() => {
    const onSb = rows.filter(r => r.active_backend === 'supabase').length;
    const shadow = rows.filter(r => r.parity_enabled).length;
    const rated = rows.map(r => r.last_7d_match_rate).filter((v): v is number => v != null);
    const overall = rated.length
      ? rated.reduce((a, b) => a + b, 0) / rated.length
      : null;
    return { total: rows.length, onSb, shadow, overall };
  }, [rows]);

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '0.3px', color: '#1C1C1C', display: 'flex', alignItems: 'center', gap: 10 }}>
            <GitCompare size={20} color={theme.colors.orange} />
            Migration Parity Dashboard
          </div>
          <div style={{ fontSize: 12, color: theme.colors.textMuted, marginTop: 3 }}>
            GAS → Supabase shadow-testing status.
            {lastFetched && <span> Last refreshed {fmtDateTime(lastFetched.toISOString())} · auto-refreshes every 30s.</span>}
          </div>
        </div>
        <button
          onClick={() => { void fetchAll(true); }}
          disabled={loading}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px',
            fontSize: 12, fontWeight: 600, borderRadius: 8,
            border: `1px solid ${theme.colors.border}`, background: '#fff',
            cursor: loading ? 'wait' : 'pointer', fontFamily: 'inherit',
            color: theme.colors.textSecondary,
          }}
        >
          {loading
            ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
            : <RefreshCw size={13} />} Refresh
        </button>
      </div>

      {error && (
        <div style={{
          padding: '12px 16px', marginBottom: 14, background: theme.colors.statusRedBg,
          border: `1px solid ${theme.colors.statusRed}`, color: theme.colors.statusRed,
          borderRadius: 8, fontSize: 12, display: 'flex', alignItems: 'flex-start', gap: 8,
        }}>
          <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            Could not load parity views: {error}
            {/relation .* does not exist|could not find the table/i.test(error) && (
              <div style={{ marginTop: 4, color: theme.colors.textSecondary }}>
                The <code>parity_summary</code> / <code>parity_billing_shadow</code> views are defined in
                migration <code>20260516000000_parity_dashboard_views.sql</code> but not yet applied to this
                Supabase project. Apply it, then refresh.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Summary cards */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={statCard(theme.colors.orange)}>
          <span style={statLabel}>Total Functions</span>
          <span style={statValue}>{summary.total}</span>
        </div>
        <div style={statCard(theme.colors.statusGreen)}>
          <span style={statLabel}>Live on Supabase</span>
          <span style={{ ...statValue, color: '#86EFAC' }}>{summary.onSb}</span>
        </div>
        <div style={statCard(theme.colors.statusBlue)}>
          <span style={statLabel}>Shadow Active</span>
          <span style={{ ...statValue, color: '#93C5FD' }}>{summary.shadow}</span>
        </div>
        <div style={statCard(summary.overall == null ? theme.colors.statusGray : matchRateColor(summary.overall))}>
          <span style={statLabel}>Overall Match Rate (7d)</span>
          <span style={statValue}>
            {summary.overall == null ? '—' : `${summary.overall.toFixed(1)}%`}
          </span>
        </div>
      </div>

      {/* Main table */}
      <div style={cardWrap}>
        <div style={{ padding: '11px 16px', borderBottom: `1px solid ${theme.colors.borderLight}`, fontSize: 13, fontWeight: 600 }}>
          Functions ({rows.length})
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
            <thead>
              <tr>
                <th style={{ ...th, width: 30 }} aria-label="expand" />
                <th style={th}>Function</th>
                <th style={{ ...th, width: 120 }}>Status</th>
                <th style={{ ...th, width: 110, textAlign: 'right' }}>7-Day Checks</th>
                <th style={{ ...th, width: 110, textAlign: 'right' }}>Match Rate</th>
                <th style={{ ...th, width: 130 }}>Speed</th>
                <th style={{ ...th, width: 110 }}>Last Run</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !loading && !error && (
                <tr><td style={{ ...td, textAlign: 'center', color: theme.colors.textMuted }} colSpan={7}>No functions found.</td></tr>
              )}
              {loading && rows.length === 0 && (
                <tr><td style={{ ...td, textAlign: 'center', color: theme.colors.textMuted }} colSpan={7}>
                  <Loader2 size={15} style={{ animation: 'spin 1s linear infinite', verticalAlign: 'middle' }} /> Loading…
                </td></tr>
              )}
              {rows.map(r => {
                const isOpen = expanded === r.function_key;
                return (
                  <Fragment key={r.function_key}>
                    <tr
                      onClick={() => setExpanded(isOpen ? null : r.function_key)}
                      style={{ cursor: 'pointer', background: isOpen ? theme.colors.orangeLight : '#fff' }}
                    >
                      <td style={{ ...td, textAlign: 'center', color: theme.colors.textMuted }}>
                        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </td>
                      <td style={{ ...td, fontWeight: 600, color: theme.colors.text }}>
                        {fmtFunctionKey(r.function_key)}
                        <span style={{ display: 'block', fontSize: 10, fontWeight: 400, color: theme.colors.textMuted, fontFamily: 'monospace' }}>
                          {r.function_key}
                        </span>
                      </td>
                      <td style={td}><StatusBadge row={r} /></td>
                      <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {r.last_7d_total === 0
                          ? <span style={{ color: theme.colors.textMuted }}>0</span>
                          : r.last_7d_total}
                        {r.last_7d_mismatches > 0 && (
                          <span style={{ color: theme.colors.statusRed, fontSize: 10, marginLeft: 5 }}>
                            ({r.last_7d_mismatches} ✗)
                          </span>
                        )}
                      </td>
                      <td style={{ ...td, textAlign: 'right' }}>
                        <MatchRateCell pct={r.last_7d_match_rate} total={r.last_7d_total} />
                      </td>
                      <td style={td}><SpeedCell pct={r.sb_speed_improvement_pct} /></td>
                      <td style={{ ...td, color: theme.colors.textSecondary, whiteSpace: 'nowrap' }}>
                        {r.last_run_at
                          ? <span title={fmtDateTime(r.last_run_at)}>{relativeTime(r.last_run_at)}</span>
                          : <span style={{ color: theme.colors.textMuted, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              <CircleDashed size={11} /> never
                            </span>}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={7} style={{ padding: 0, borderBottom: `1px solid ${theme.colors.borderLight}` }}>
                          <RowDetail functionKey={r.function_key} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Billing shadow section */}
      <div style={cardWrap}>
        <div style={{ padding: '11px 16px', borderBottom: `1px solid ${theme.colors.borderLight}`, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Billing Shadow Runs</span>
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase',
            padding: '2px 8px', borderRadius: 100,
            background: theme.colors.bgSubtle, color: theme.colors.textMuted,
          }}>
            Auto-pay / invoice
          </span>
          <span style={{ fontSize: 11, color: theme.colors.textMuted, marginLeft: 'auto' }}>
            Most recent {billing.length}
          </span>
        </div>
        <div style={{ overflowX: 'auto', maxHeight: 420 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760, fontSize: 12 }}>
            <thead>
              <tr>
                <th style={th}>Time</th>
                <th style={th}>Function</th>
                <th style={th}>Client (tenant)</th>
                <th style={{ ...th, textAlign: 'right' }}>Amount</th>
                <th style={{ ...th, textAlign: 'center' }}>Match</th>
                <th style={{ ...th, textAlign: 'right' }}>GAS / SB ms</th>
              </tr>
            </thead>
            <tbody>
              {billing.length === 0 && (
                <tr><td style={{ ...td, textAlign: 'center', color: theme.colors.textMuted }} colSpan={6}>
                  {error ? 'Unavailable.' : 'No billing shadow runs recorded yet.'}
                </td></tr>
              )}
              {billing.map(b => (
                <tr key={b.id} style={{ background: b.match ? '#fff' : theme.colors.statusRedBg }}>
                  <td style={{ ...td, whiteSpace: 'nowrap', color: theme.colors.textSecondary }}>{fmtDateTime(b.created_at)}</td>
                  <td style={{ ...td, fontWeight: 600 }}>
                    {fmtFunctionKey(b.function_key)}
                  </td>
                  <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>{b.tenant_id || '—'}</td>
                  <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                    {extractAmount(b.input_summary)}
                  </td>
                  <td style={{ ...td, textAlign: 'center' }}>
                    {b.match
                      ? <CheckCircle2 size={15} color={theme.colors.statusGreen} />
                      : <XCircle size={15} color={theme.colors.statusRed} />}
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: theme.colors.textSecondary }}>
                    {b.gas_duration_ms ?? '—'} / {b.sb_duration_ms ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default ParityDashboard;
