import { theme } from '../../styles/theme';
import type { Quote, CoverageOption } from '../../lib/quoteTypes';

interface Props {
  quote: Quote;
  coverageOptions: CoverageOption[];
  onChange: (patch: Partial<Quote>) => void;
}

export function QuoteCoverageCard({ quote, coverageOptions, onChange }: Props) {
  const selected = coverageOptions.find(c => c.id === quote.coverage.typeId);
  const input: React.CSSProperties = { width: '100%', padding: '8px 10px', fontSize: 13, border: `1px solid ${theme.colors.border}`, borderRadius: 8, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' };

  return (
    <div style={{ background: '#fff', border: `1px solid ${theme.colors.border}`, borderRadius: 12, padding: 20 }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: theme.colors.text }}>Coverage / Valuation</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {coverageOptions.map(opt => (
          <label key={opt.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${quote.coverage.typeId === opt.id ? theme.colors.orange : theme.colors.border}`, background: quote.coverage.typeId === opt.id ? '#FFF7ED' : '#fff' }}>
            <input type="radio" name="coverage" value={opt.id} checked={quote.coverage.typeId === opt.id}
              onChange={() => onChange({ coverage: { ...quote.coverage, typeId: opt.id } })}
              style={{ accentColor: theme.colors.orange }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{opt.name}</div>
              <div style={{ fontSize: 11, color: theme.colors.textMuted }}>{opt.description}</div>
            </div>
            {opt.included && <span style={{ fontSize: 10, fontWeight: 700, color: '#15803D', background: '#F0FDF4', padding: '2px 8px', borderRadius: 8 }}>Included</span>}
          </label>
        ))}
      </div>
      {selected && !selected.included && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
          {selected.method === 'percent_declared' && (
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: theme.colors.textSecondary, display: 'block', marginBottom: 3 }}>Declared Value ($)</label>
              <input type="number" min={0} step={100} value={quote.coverage.declaredValue || ''}
                onChange={e => onChange({ coverage: { ...quote.coverage, declaredValue: parseFloat(e.target.value) || 0 } })}
                style={input} placeholder="0" />
            </div>
          )}
          {selected.method === 'per_lb' && (
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: theme.colors.textSecondary, display: 'block', marginBottom: 3 }}>Weight (lbs)</label>
              <input type="number" min={0} value={quote.coverage.weightLbs || ''}
                onChange={e => onChange({ coverage: { ...quote.coverage, weightLbs: parseFloat(e.target.value) || 0 } })}
                style={input} placeholder="0" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
