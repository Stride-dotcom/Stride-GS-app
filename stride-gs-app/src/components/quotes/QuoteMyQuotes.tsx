import { useState, useMemo } from 'react';
import { Plus, Search, FileText, DollarSign, Clock, CheckCircle2 } from 'lucide-react';
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

  const { services, classes, coverageOptions } = store.catalog;
  const quotesWithTotals = useMemo(() => {
    return store.quotes.map(q => ({
      ...q,
      total: calcQuote(q, services, classes, coverageOptions).grandTotal,
    }));
  }, [store.quotes, services, classes, coverageOptions]);

  const filtered = useMemo(() => {
    let list = quotesWithTotals;
    if (statusFilter !== 'all') list = list.filter(q => q.status === statusFilter);
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(q => q.client.toLowerCase().includes(s) || q.number.toLowerCase().includes(s) || q.project.toLowerCase().includes(s));
    }
    return list;
  }, [quotesWithTotals, statusFilter, search]);

  const stats = useMemo(() => ({
    drafts: store.quotes.filter(q => q.status === 'draft').length,
    sent: store.quotes.filter(q => q.status === 'sent').length,
    accepted: store.quotes.filter(q => q.status === 'accepted').length,
    acceptedValue: quotesWithTotals.filter(q => q.status === 'accepted').reduce((s, q) => s + q.total, 0),
  }), [store.quotes, quotesWithTotals]);

  const statCard = (icon: React.ReactNode, value: string | number, label: string, accent?: boolean) => (
    <div style={{
      background: accent ? v.colors.accent : v.colors.bgDark,
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14 }}>
        {statCard(<FileText size={16} />, stats.drafts, 'DRAFTS')}
        {statCard(<Clock size={16} />, stats.sent, 'SENT')}
        {statCard(<CheckCircle2 size={16} />, stats.accepted, 'ACCEPTED')}
        {statCard(<DollarSign size={16} />, fmt$(stats.acceptedValue), 'ACCEPTED VALUE', true)}
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: v.colors.textMuted }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search quotes..."
            style={{ width: '100%', padding: '10px 14px 10px 38px', fontSize: 13, border: `1px solid ${v.colors.border}`, borderRadius: v.radius.input, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', background: v.colors.bgWhite }} />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as QuoteStatus | 'all')}
          style={{ padding: '10px 14px', fontSize: 13, border: `1px solid ${v.colors.border}`, borderRadius: v.radius.input, fontFamily: 'inherit', cursor: 'pointer', background: v.colors.bgWhite }}>
          <option value="all">All Statuses</option>
          <option value="draft">Draft</option><option value="sent">Sent</option><option value="accepted">Accepted</option>
          <option value="declined">Declined</option><option value="expired">Expired</option><option value="void">Void</option>
        </select>
        <button onClick={() => onOpenBuilder()} style={{
          ...v.typography.buttonPrimary, display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 24px', border: 'none', borderRadius: v.radius.button,
          background: v.colors.accent, color: v.colors.textOnDark, cursor: 'pointer', fontFamily: 'inherit',
        }}>
          <Plus size={14} /> NEW QUOTE
        </button>
      </div>

      {/* Table */}
      <div style={{ background: v.colors.bgWhite, borderRadius: v.radius.table, overflow: 'hidden' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: v.colors.textMuted, fontSize: 13 }}>
            {store.quotes.length === 0 ? 'No quotes yet — click "New Quote" to get started' : 'No quotes match your filters'}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={thStyle}>Quote #</th><th style={thStyle}>Client</th><th style={thStyle}>Project</th>
              <th style={thStyle}>Date</th><th style={thStyle}>Expires</th><th style={thStyle}>Status</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Total</th>
            </tr></thead>
            <tbody>
              {filtered.map(q => {
                const sc = statusPill(q.status);
                return (
                  <tr key={q.id} onClick={() => onOpenBuilder(q.id)} style={{ cursor: 'pointer', transition: 'background 0.15s' }}
                    onMouseEnter={e => (e.currentTarget.style.background = v.colors.bgPage)}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                    <td style={{ ...tdStyle, fontWeight: 600, color: v.colors.accent }}>{q.number}</td>
                    <td style={{ ...tdStyle, fontWeight: 500 }}>{q.client || '—'}</td>
                    <td style={{ ...tdStyle, color: v.colors.textSecondary }}>{q.project || '—'}</td>
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
  );
}
