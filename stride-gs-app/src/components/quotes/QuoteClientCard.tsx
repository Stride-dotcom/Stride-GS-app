import { useMemo, useCallback } from 'react';
import { theme } from '../../styles/theme';
import { useClients } from '../../hooks/useClients';
import type { Quote } from '../../lib/quoteTypes';

const v = theme.v2;

interface Props {
  quote: Quote;
  onChange: (patch: Partial<Quote>) => void;
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

export function QuoteClientCard({ quote, onChange }: Props) {
  const { clients } = useClients();
  const clientOptions = useMemo(() => clients.map(c => ({ id: c.id, name: c.name })), [clients]);

  const handleClientChange = useCallback((val: string) => {
    const match = clientOptions.find(c => c.name.toLowerCase() === val.toLowerCase());
    onChange({ client: val, clientSheetId: match?.id || '' });
  }, [clientOptions, onChange]);

  const label: React.CSSProperties = { ...v.typography.label, marginBottom: 6, display: 'block' };
  const input: React.CSSProperties = { width: '100%', padding: '10px 14px', fontSize: 13, border: `1px solid ${v.colors.border}`, borderRadius: v.radius.input, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', background: v.colors.bgWhite };

  const sc = statusPill(quote.status);

  return (
    <div style={{ background: v.colors.bgCard, borderRadius: v.radius.card, padding: v.card.padding }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ ...v.typography.cardTitle, color: v.colors.text }}>Client Information</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: v.colors.accent }}>{quote.number}</span>
          <span style={{ padding: '4px 12px', borderRadius: v.radius.badge, fontSize: 11, fontWeight: 600, background: sc.bg, color: sc.text }}>
            {quote.status.charAt(0).toUpperCase() + quote.status.slice(1)}
          </span>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={label}>CLIENT / COMPANY</label>
          <input list="quote-clients" value={quote.client} onChange={e => handleClientChange(e.target.value)} style={input} placeholder="Type or select client..." />
          <datalist id="quote-clients">
            {clientOptions.map(c => <option key={c.id} value={c.name} />)}
          </datalist>
        </div>
        <div>
          <label style={label}>PROJECT / REFERENCE</label>
          <input value={quote.project} onChange={e => onChange({ project: e.target.value })} style={input} placeholder="Project name..." />
        </div>
        <div>
          <label style={label}>ADDRESS</label>
          <input value={quote.address} onChange={e => onChange({ address: e.target.value })} style={input} placeholder="Delivery address..." />
        </div>
        <div>
          <label style={label}>QUOTE DATE</label>
          <input type="date" value={quote.date} onChange={e => onChange({ date: e.target.value })} style={input} />
        </div>
        <div>
          <label style={label}>EXPIRATION</label>
          <input type="date" value={quote.expiration} onChange={e => onChange({ expiration: e.target.value })} style={input} />
        </div>
      </div>
    </div>
  );
}
