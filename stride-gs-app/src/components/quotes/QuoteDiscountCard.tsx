import { theme } from '../../styles/theme';
import type { Quote } from '../../lib/quoteTypes';

const v = theme.v2;

interface Props {
  quote: Quote;
  onChange: (patch: Partial<Quote>) => void;
}

export function QuoteDiscountCard({ quote, onChange }: Props) {
  const label: React.CSSProperties = { ...v.typography.label, marginBottom: 6, display: 'block' };
  const input: React.CSSProperties = { width: '100%', padding: '10px 14px', fontSize: 13, border: `1px solid ${v.colors.border}`, borderRadius: v.radius.input, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', background: v.colors.bgWhite };

  return (
    <div style={{ background: v.colors.bgCard, borderRadius: v.radius.card, padding: v.card.padding }}>
      <div style={{ ...v.typography.cardTitle, color: v.colors.text, marginBottom: 16 }}>Discount</div>
      <div style={{ display: 'flex', gap: 14, alignItems: 'end', marginBottom: 14 }}>
        <div style={{ flex: 1 }}>
          <label style={label}>TYPE</label>
          <select value={quote.discount.type} onChange={e => onChange({ discount: { ...quote.discount, type: e.target.value as 'percent' | 'flat' } })} style={{ ...input, cursor: 'pointer' }}>
            <option value="percent">Percentage (%)</option>
            <option value="flat">Flat Amount ($)</option>
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label style={label}>{quote.discount.type === 'percent' ? 'PERCENT' : 'AMOUNT'}</label>
          <input type="number" min={0} step={quote.discount.type === 'percent' ? 1 : 0.01}
            value={quote.discount.value || ''} placeholder="0"
            onChange={e => onChange({ discount: { ...quote.discount, value: parseFloat(e.target.value) || 0 } })}
            style={input} />
        </div>
      </div>
      <div>
        <label style={label}>REASON (OPTIONAL)</label>
        <input value={quote.discount.reason} onChange={e => onChange({ discount: { ...quote.discount, reason: e.target.value } })} style={input} placeholder="e.g. Volume discount, preferred client..." />
      </div>
    </div>
  );
}
