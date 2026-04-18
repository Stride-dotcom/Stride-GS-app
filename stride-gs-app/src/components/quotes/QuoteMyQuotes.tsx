import { useState, useMemo } from 'react';
import { Plus, Search, FileText, DollarSign, Clock, CheckCircle2 } from 'lucide-react';
import { theme } from '../../styles/theme';
import { Card } from '../ui/Card';
import { fmtDate } from '../../lib/constants';
import { calcQuote } from '../../lib/quoteCalc';
import type { QuoteStatus } from '../../lib/quoteTypes';
import type { useQuoteStore } from '../../hooks/useQuoteStore';

type Store = ReturnType<typeof useQuoteStore>;

interface Props {
  store: Store;
  onOpenBuilder: (quoteId?: string) => void;
}

const STATUS_CFG: Record<string, { bg: string; text: string }> = {
  draft:    { bg: '#EFF6FF', text: '#1D4ED8' },
  sent:     { bg: '#FEF3C7', text: '#B45309' },
  accepted: { bg: '#F0FDF4', text: '#15803D' },
  declined: { bg: '#FEF2F2', text: '#991B1B' },
  expired:  { bg: '#F3F4F6', text: '#6B7280' },
  void:     { bg: '#F3F4F6', text: '#6B7280' },
};

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

  // Stats
  const stats = useMemo(() => ({
    drafts: store.quotes.filter(q => q.status === 'draft').length,
    sent: store.quotes.filter(q => q.status === 'sent').length,
    accepted: store.quotes.filter(q => q.status === 'accepted').length,
    acceptedValue: quotesWithTotals.filter(q => q.status === 'accepted').reduce((s, q) => s + q.total, 0),
  }), [store.quotes, quotesWithTotals]);

  const th: React.CSSProperties = { padding: '10px 12px', fontSize: 11, fontWeight: 700, textAlign: 'left', color: theme.colors.textSecondary, textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: `2px solid ${theme.colors.border}` };
  const td: React.CSSProperties = { padding: '10px 12px', fontSize: 13, borderBottom: `1px solid ${theme.colors.border}` };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
        <Card style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 14 }}>
          <FileText size={18} color="#1D4ED8" />
          <div><div style={{ fontSize: 20, fontWeight: 700 }}>{stats.drafts}</div><div style={{ fontSize: 11, color: theme.colors.textMuted }}>Drafts</div></div>
        </Card>
        <Card style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 14 }}>
          <Clock size={18} color="#B45309" />
          <div><div style={{ fontSize: 20, fontWeight: 700 }}>{stats.sent}</div><div style={{ fontSize: 11, color: theme.colors.textMuted }}>Sent</div></div>
        </Card>
        <Card style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 14 }}>
          <CheckCircle2 size={18} color="#15803D" />
          <div><div style={{ fontSize: 20, fontWeight: 700 }}>{stats.accepted}</div><div style={{ fontSize: 11, color: theme.colors.textMuted }}>Accepted</div></div>
        </Card>
        <Card style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 14 }}>
          <DollarSign size={18} color={theme.colors.orange} />
          <div><div style={{ fontSize: 20, fontWeight: 700 }}>{fmt$(stats.acceptedValue)}</div><div style={{ fontSize: 11, color: theme.colors.textMuted }}>Accepted Value</div></div>
        </Card>
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: theme.colors.textMuted }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search quotes..."
            style={{ width: '100%', padding: '8px 10px 8px 32px', fontSize: 13, border: `1px solid ${theme.colors.border}`, borderRadius: 8, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as QuoteStatus | 'all')}
          style={{ padding: '8px 12px', fontSize: 13, border: `1px solid ${theme.colors.border}`, borderRadius: 8, fontFamily: 'inherit', cursor: 'pointer', background: '#fff' }}>
          <option value="all">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="sent">Sent</option>
          <option value="accepted">Accepted</option>
          <option value="declined">Declined</option>
          <option value="expired">Expired</option>
          <option value="void">Void</option>
        </select>
        <button onClick={() => onOpenBuilder()} style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', fontSize: 13, fontWeight: 600,
          border: 'none', borderRadius: 8, background: theme.colors.orange, color: '#fff', cursor: 'pointer', fontFamily: 'inherit',
        }}>
          <Plus size={14} /> New Quote
        </button>
      </div>

      {/* Quote list */}
      <div style={{ background: '#fff', border: `1px solid ${theme.colors.border}`, borderRadius: 12, overflow: 'hidden' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: theme.colors.textMuted, fontSize: 13 }}>
            {store.quotes.length === 0 ? 'No quotes yet — click "New Quote" to get started' : 'No quotes match your filters'}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th}>Quote #</th>
              <th style={th}>Client</th>
              <th style={th}>Project</th>
              <th style={th}>Date</th>
              <th style={th}>Expires</th>
              <th style={th}>Status</th>
              <th style={{ ...th, textAlign: 'right' }}>Total</th>
            </tr></thead>
            <tbody>
              {filtered.map(q => {
                const sc = STATUS_CFG[q.status] || STATUS_CFG.draft;
                return (
                  <tr key={q.id} onClick={() => onOpenBuilder(q.id)} style={{ cursor: 'pointer', transition: 'background 0.1s' }}
                    onMouseEnter={e => (e.currentTarget.style.background = theme.colors.bgSubtle)}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                    <td style={{ ...td, fontWeight: 600, color: theme.colors.orange }}>{q.number}</td>
                    <td style={{ ...td, fontWeight: 500 }}>{q.client || '—'}</td>
                    <td style={{ ...td, color: theme.colors.textSecondary }}>{q.project || '—'}</td>
                    <td style={{ ...td, color: theme.colors.textSecondary }}>{fmtDate(q.date)}</td>
                    <td style={{ ...td, color: theme.colors.textSecondary }}>{fmtDate(q.expiration)}</td>
                    <td style={td}>
                      <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: sc.bg, color: sc.text }}>
                        {q.status.charAt(0).toUpperCase() + q.status.slice(1)}
                      </span>
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmt$(q.total)}</td>
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
