import { theme } from '../../styles/theme';
import type { Quote } from '../../lib/quoteTypes';

interface Props {
  quote: Quote;
  onChange: (patch: Partial<Quote>) => void;
}

export function QuoteDiscountCard({ quote, onChange }: Props) {
  const input: React.CSSProperties = { width: '100%', padding: '8px 10px', fontSize: 13, border: `1px solid ${theme.colors.border}`, borderRadius: 8, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' };

  return (
    <div style={{ background: '#fff', border: `1px solid ${theme.colors.border}`, borderRadius: 12, padding: 20 }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: theme.colors.text }}>Discount</div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'end', marginBottom: 10 }}>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: theme.colors.textSecondary, display: 'block', marginBottom: 3 }}>Type</label>
          <select value={quote.discount.type} onChange={e => onChange({ discount: { ...quote.discount, type: e.target.value as 'percent' | 'flat' } })} style={{ ...input, cursor: 'pointer' }}>
            <option value="percent">Percentage (%)</option>
            <option value="flat">Flat Amount ($)</option>
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: theme.colors.textSecondary, display: 'block', marginBottom: 3 }}>
            {quote.discount.type === 'percent' ? 'Percent' : 'Amount'}
          </label>
          <input type="number" min={0} step={quote.discount.type === 'percent' ? 1 : 0.01}
            value={quote.discount.value || ''} placeholder="0"
            onChange={e => onChange({ discount: { ...quote.discount, value: parseFloat(e.target.value) || 0 } })}
            style={input} />
        </div>
      </div>
      <div>
        <label style={{ fontSize: 11, fontWeight: 600, color: theme.colors.textSecondary, display: 'block', marginBottom: 3 }}>Reason (optional)</label>
        <input value={quote.discount.reason} onChange={e => onChange({ discount: { ...quote.discount, reason: e.target.value } })} style={input} placeholder="e.g. Volume discount, preferred client..." />
      </div>
    </div>
  );
}
