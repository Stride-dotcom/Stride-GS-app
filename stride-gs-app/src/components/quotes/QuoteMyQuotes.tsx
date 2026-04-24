import { useState, useMemo } from 'react';
import { Plus, Search, FileText, DollarSign, Clock, CheckCircle2, RefreshCw, AlertTriangle } from 'lucide-react';
import { theme } from '../../styles/theme';
import { fmtDate } from '../../lib/constants';
import { calcQuote } from '../../lib/quoteCalc';
import type { QuoteStatus } from '../../lib/quoteTypes';
import type { useQuoteStore } from '../../hooks/useQuoteStore';

const v = theme.v2;
type Store = ReturnType<typeof useQuoteStore>;

interface Props {
  store: Store;
  onOpenBuilder: (quoteId?: string) => void;
}

function statusPill(status: string): { bg: string; text: string } {
  switch (status) {
    case 'draft': return v.colors.statusDraft;
    case 'sent': return v.colors.statusSent;
    case 'accepted': return v.colors.statusAccepted;
    case 'declined': return v.colors.statusDeclined;
    default: return v.colors.statusExpired;
  }
}

function fmt$(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function QuoteMyQuotes({ store, onOpenBuilder }: Props) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<QuoteStatus | 'all'>('all');
  // Admin-only: filter the list by the user who created the quote.
  // 'all' = every user; '__me' = only the admin's own quotes; otherwise
  // an exact owner_email match. Hidden for non-admins.
  const [ownerFilter, setOwnerFilter] = useState<string>('all');

  const { services, classes, coverageOptions } = store.catalog;
  const { isAdminView, quoteOwners, currentUserEmail, saveErrors, refetch } = store;
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = async () => {
    setRefreshing(true);
    try { await refetch(); } finally { setRefreshing(false); }
  };

  const quotesWithTotals = useMemo(() => {
    return store.quotes.map(q => ({
      ...q,
      total: calcQuote(q, services, classes, coverageOptions).grandTotal,
      ownerEmail: quoteOwners[q.id] || currentUserEmail,
    }));
  }, [store.quotes, services, classes, coverageOptions, quoteOwners, currentUserEmail]);

  // Distinct owner emails for the dropdown — admin-only.
  const ownerOptions = useMemo(() => {
    if (!isAdminView) return [] as string[];
    const set = new Set<string>();
    for (const q of quotesWithTotals) if (q.ownerEmail) set.add(q.ownerEmail);
    return Array.from(set).sort();
  }, [isAdminView, quotesWithTotals]);

  const filtered = useMemo(() => {
    let list = quotesWithTotals;
    if (statusFilter !== 'all') list = list.filter(q => q.status === statusFilter);
    if (isAdminView && ownerFilter !== 'all') {
      const target = ownerFilter === '__me' ? currentUserEmail : ownerFilter;
      list = list.filter(q => q.ownerEmail === target);
    }
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(q =>
        q.client.toLowerCase().includes(s) ||
        q.number.toLowerCase().includes(s) ||
        q.project.toLowerCase().includes(s) ||
        (isAdminView && q.ownerEmail.toLowerCase().includes(s))
      );
    }
    return list;
  }, [quotesWithTotals, statusFilter, search, isAdminView, ownerFilter, currentUserEmail]);

  const stats = useMemo(() => ({
    drafts: store.quotes.filter(q => q.status === 'draft').length,
    sent: store.quotes.filter(q => q.status === 'sent').length,
    accepted: store.quotes.filter(q => q.status === 'accepted').length,
    acceptedValue: quotesWithTotals.filter(q => q.status === 'accepted').reduce((s, q) => s + q.total, 0),
  }), [store.quotes, quotesWithTotals]);

  // All 4 stat cards are dark — no orange card
  const statCard = (icon: React.ReactNode, value: string | number, label: string) => (
    <div style={{
      background: v.colors.bgDark,
      borderRadius: v.radius.card, padding: v.card.padding, color: v.colors.textOnDark,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div style={{ opacity: 0.6 }}>{icon}</div>
        <span style={{ ...v.typography.label, color: v.colors.textOnDarkMuted }}>{label}</span>
      </div>
      <div style={{ fontSize: 28, fontWeight: 300, lineHeight: 1 }}>{value}</div>
    </div>
  );

  const thStyle: React.CSSProperties = {
    padding: v.table.cellPadding, fontSize: v.table.headerFontSize, fontWeight: v.table.headerWeight,
    textAlign: 'left', color: v.colors.textMuted, textTransform: 'uppercase',
    letterSpacing: v.table.headerLetterSpacing, borderBottom: `1px solid ${v.table.rowBorder}`,
  };
  const tdStyle: React.CSSProperties = {
    padding: v.table.cellPadding, fontSize: v.table.cellFontSize,
    borderBottom: `1px solid ${v.table.rowBorder}`,
  };

  const pillInput: React.CSSProperties = {
    padding: '12px 18px', fontSize: 13, border: `1px solid ${v.colors.border}`,
    borderRadius: v.radius.button, fontFamily: 'inherit', outline: 'none',
    boxSizing: 'border-box' as const, background: v.colors.bgWhite,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Stats — all 4 dark */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14 }}>
        {statCard(<FileText size={16} />, stats.drafts, 'DRAFTS')}
        {statCard(<Clock size={16} />, stats.sent, 'SENT')}
        {statCard(<CheckCircle2 size={16} />, stats.accepted, 'ACCEPTED')}
        {statCard(<DollarSign size={16} />, fmt$(stats.acceptedValue), 'ACCEPTED VALUE')}
      </div>

      {/* Content card — wraps header + search + table */}
      <div style={{ background: v.colors.bgCard, borderRadius: v.radius.card, padding: v.card.padding }}>
        {/* Card header row: label + count + button */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '4px', color: v.colors.accent, textTransform: 'uppercase' }}>
              {isAdminView ? 'ALL USERS\u2019 QUOTES' : 'MY QUOTES'}
            </span>
            <span style={{ fontSize: 12, color: v.colors.textMuted, marginLeft: 12 }}>{store.quotes.length} total · {filtered.length} shown</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              title="Re-fetch quotes from Supabase. Use if another user just saved a quote you don't see yet."
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '10px 16px', border: `1px solid ${v.colors.border}`, borderRadius: v.radius.button,
                background: v.colors.bgWhite, color: v.colors.textSecondary,
                cursor: refreshing ? 'wait' : 'pointer', fontFamily: 'inherit',
                fontSize: 11, fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase',
                opacity: refreshing ? 0.6 : 1,
              }}
            >
              <RefreshCw size={13} />
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
            <button onClick={() => onOpenBuilder()} style={{
              ...v.typography.buttonPrimary, display: 'flex', alignItems: 'center', gap: 8,
              padding: '10px 24px', border: 'none', borderRadius: v.radius.button,
              background: v.colors.accent, color: v.colors.textOnDark, cursor: 'pointer', fontFamily: 'inherit',
            }}>
              <Plus size={14} /> NEW QUOTE
            </button>
          </div>
        </div>

        {/* Save-error banner — aggregate count of quotes that hit an
            RLS/auth/schema rejection on upsert. One-line summary with a
            prompt to check the browser console for the exact error. */}
        {Object.keys(saveErrors).length > 0 && (
          <div role="alert" style={{
            padding: '10px 14px', marginBottom: 14, borderRadius: 10,
            background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#B91C1C',
            fontSize: 12, display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <AlertTriangle size={14} />
            {Object.keys(saveErrors).length === 1
              ? `1 quote didn't save to the server. Check the browser console for details.`
              : `${Object.keys(saveErrors).length} quotes didn't save to the server. Check the browser console for details.`}
          </div>
        )}

        {/* Search + filter row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
            <Search size={14} style={{ position: 'absolute', left: 18, top: '50%', transform: 'translateY(-50%)', color: v.colors.textMuted }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search quotes..."
              style={{ ...pillInput, width: '100%', paddingLeft: 42 }} />
          </div>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as QuoteStatus | 'all')}
            style={{ ...pillInput, cursor: 'pointer' }}>
            <option value="all">All Statuses</option>
            <option value="draft">Draft</option><option value="sent">Sent</option><option value="accepted">Accepted</option>
            <option value="declined">Declined</option><option value="expired">Expired</option><option value="void">Void</option>
          </select>
          {/* Admin-only owner filter. 'All users' is the default so
              admins land on the full cross-user list; a "Mine only"
              pseudo-option scopes back to their own drafts quickly. */}
          {isAdminView && ownerOptions.length > 0 && (
            <select
              value={ownerFilter}
              onChange={e => setOwnerFilter(e.target.value)}
              style={{ ...pillInput, cursor: 'pointer' }}
              title="Filter by quote creator"
            >
              <option value="all">All Users</option>
              <option value="__me">Mine only ({currentUserEmail})</option>
              {ownerOptions.filter(o => o !== currentUserEmail).map(o => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          )}
        </div>

        {/* Table or empty state */}
        <div style={{ background: v.colors.bgWhite, borderRadius: v.radius.table, overflow: 'hidden' }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '64px 32px', textAlign: 'center' }}>
              {store.quotes.length === 0 ? (
                <>
                  <div style={{ fontSize: 18, fontWeight: 500, color: v.colors.text, marginBottom: 8 }}>No quotes yet</div>
                  <div style={{ fontSize: 14, color: '#888' }}>Click <strong>+ New Quote</strong> to create your first one.</div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 18, fontWeight: 500, color: v.colors.text, marginBottom: 8 }}>No matches</div>
                  <div style={{ fontSize: 14, color: '#888' }}>Try adjusting your search or status filter.</div>
                </>
              )}
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={thStyle}>Quote #</th><th style={thStyle}>Client</th><th style={thStyle}>Project</th>
                {isAdminView && <th style={thStyle}>Created By</th>}
                <th style={thStyle}>Date</th><th style={thStyle}>Expires</th><th style={thStyle}>Status</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Total</th>
              </tr></thead>
              <tbody>
                {filtered.map(q => {
                  const sc = statusPill(q.status);
                  // "Mine" vs "Not mine" styling hint so admins can
                  // scan the list and quickly see which quotes are
                  // someone else's work.
                  const isForeign = isAdminView && q.ownerEmail !== currentUserEmail;
                  return (
                    <tr key={q.id} onClick={() => onOpenBuilder(q.id)} style={{ cursor: 'pointer', transition: 'background 0.15s' }}
                      onMouseEnter={e => (e.currentTarget.style.background = v.colors.bgPage)}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                      <td style={{ ...tdStyle, fontWeight: 600, color: v.colors.accent }}>
                        {q.number}
                        {saveErrors[q.id] && (
                          <span
                            title={`Didn't save to server: ${saveErrors[q.id]}`}
                            style={{ marginLeft: 6, display: 'inline-flex', verticalAlign: 'middle' }}
                          >
                            <AlertTriangle size={12} color="#B91C1C" />
                          </span>
                        )}
                      </td>
                      <td style={{ ...tdStyle, fontWeight: 500 }}>{q.client || '—'}</td>
                      <td style={{ ...tdStyle, color: v.colors.textSecondary }}>{q.project || '—'}</td>
                      {isAdminView && (
                        <td style={{ ...tdStyle, color: isForeign ? v.colors.text : v.colors.textSecondary, fontWeight: isForeign ? 500 : 400 }}>
                          {q.ownerEmail || '—'}
                          {!isForeign && q.ownerEmail && (
                            <span style={{ marginLeft: 6, fontSize: 10, color: v.colors.textMuted, fontWeight: 400, letterSpacing: '0.5px', textTransform: 'uppercase' }}>You</span>
                          )}
                        </td>
                      )}
                      <td style={{ ...tdStyle, color: v.colors.textSecondary }}>{fmtDate(q.date)}</td>
                      <td style={{ ...tdStyle, color: v.colors.textSecondary }}>{fmtDate(q.expiration)}</td>
                      <td style={tdStyle}>
                        <span style={{ padding: '4px 12px', borderRadius: v.radius.badge, fontSize: 11, fontWeight: 600, background: sc.bg, color: sc.text }}>{q.status.charAt(0).toUpperCase() + q.status.slice(1)}</span>
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmt$(q.total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
