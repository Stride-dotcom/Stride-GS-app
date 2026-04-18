import { useMemo, useCallback } from 'react';
import { theme } from '../../styles/theme';
import { useClients } from '../../hooks/useClients';
import type { Quote } from '../../lib/quoteTypes';

interface Props {
  quote: Quote;
  onChange: (patch: Partial<Quote>) => void;
}

export function QuoteClientCard({ quote, onChange }: Props) {
  const { clients } = useClients();
  const clientOptions = useMemo(() => clients.map(c => ({ id: c.id, name: c.name })), [clients]);

  const handleClientChange = useCallback((val: string) => {
    const match = clientOptions.find(c => c.name.toLowerCase() === val.toLowerCase());
    onChange({ client: val, clientSheetId: match?.id || '' });
  }, [clientOptions, onChange]);

  const label: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: theme.colors.textSecondary, marginBottom: 3, display: 'block', textTransform: 'uppercase', letterSpacing: '0.5px' };
  const input: React.CSSProperties = { width: '100%', padding: '8px 10px', fontSize: 13, border: `1px solid ${theme.colors.border}`, borderRadius: 8, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' };

  return (
    <div style={{ background: '#fff', border: `1px solid ${theme.colors.border}`, borderRadius: 12, padding: 20 }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14, color: theme.colors.text }}>Client Information</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={label}>Client / Company</label>
          <input list="quote-clients" value={quote.client} onChange={e => handleClientChange(e.target.value)} style={input} placeholder="Type or select client..." />
          <datalist id="quote-clients">
            {clientOptions.map(c => <option key={c.id} value={c.name} />)}
          </datalist>
        </div>
        <div>
          <label style={label}>Project / Reference</label>
          <input value={quote.project} onChange={e => onChange({ project: e.target.value })} style={input} placeholder="Project name..." />
        </div>
        <div>
          <label style={label}>Address</label>
          <input value={quote.address} onChange={e => onChange({ address: e.target.value })} style={input} placeholder="Delivery address..." />
        </div>
        <div>
          <label style={label}>Quote Date</label>
          <input type="date" value={quote.date} onChange={e => onChange({ date: e.target.value })} style={input} />
        </div>
        <div>
          <label style={label}>Expiration</label>
          <input type="date" value={quote.expiration} onChange={e => onChange({ expiration: e.target.value })} style={input} />
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: theme.colors.orange }}>{quote.number}</span>
        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: quote.status === 'draft' ? '#EFF6FF' : quote.status === 'accepted' ? '#F0FDF4' : '#F3F4F6', color: quote.status === 'draft' ? '#1D4ED8' : quote.status === 'accepted' ? '#15803D' : '#6B7280', fontWeight: 600 }}>
          {quote.status.charAt(0).toUpperCase() + quote.status.slice(1)}
        </span>
      </div>
    </div>
  );
}
