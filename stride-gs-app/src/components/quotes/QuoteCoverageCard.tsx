import { theme } from '../../styles/theme';
import type { Quote, CoverageOption } from '../../lib/quoteTypes';

const v = theme.v2;

interface Props {
  quote: Quote;
  coverageOptions: CoverageOption[];
  onChange: (patch: Partial<Quote>) => void;
}

export function QuoteCoverageCard({ quote, coverageOptions, onChange }: Props) {
  const selected = coverageOptions.find(c => c.id === quote.coverage.typeId);
  const label: React.CSSProperties = { ...v.typography.label, marginBottom: 6, display: 'block' };
  const input: React.CSSProperties = { width: '100%', padding: '10px 14px', fontSize: 13, border: `1px solid ${v.colors.border}`, borderRadius: v.radius.input, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', background: v.colors.bgWhite };

  return (
    <div style={{ background: v.colors.bgCard, borderRadius: v.radius.card, padding: v.card.padding }}>
      <div style={{ ...v.typography.cardTitle, color: v.colors.text, marginBottom: 16 }}>Coverage / Valuation</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {coverageOptions.map(opt => (
          <label key={opt.id} style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
            borderRadius: v.radius.input, cursor: 'pointer',
            border: `1px solid ${quote.coverage.typeId === opt.id ? v.colors.accent : v.colors.border}`,
            background: quote.coverage.typeId === opt.id ? v.colors.accentLight : v.colors.bgWhite,
            transition: 'all 0.15s',
          }}>
            <input type="radio" name="coverage" value={opt.id} checked={quote.coverage.typeId === opt.id}
              onChange={() => onChange({ coverage: { ...quote.coverage, typeId: opt.id } })}
              style={{ accentColor: v.colors.accent }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: v.colors.text }}>{opt.name}</div>
              <div style={{ fontSize: 11, color: v.colors.textMuted, marginTop: 2 }}>{opt.description}</div>
            </div>
            {opt.included && <span style={{ ...v.typography.label, color: v.colors.statusAccepted.text, background: v.colors.statusAccepted.bg, padding: '4px 10px', borderRadius: v.radius.badge }}>INCLUDED</span>}
          </label>
        ))}
      </div>
      {selected && !selected.included && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 16 }}>
          {selected.method === 'percent_declared' && (
            <div>
              <label style={label}>DECLARED VALUE ($)</label>
              <input type="number" min={0} step={100} value={quote.coverage.declaredValue || ''}
                onChange={e => onChange({ coverage: { ...quote.coverage, declaredValue: parseFloat(e.target.value) || 0 } })}
                style={input} placeholder="0" />
            </div>
          )}
          {selected.method === 'per_lb' && (
            <div>
              <label style={label}>WEIGHT (LBS)</label>
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
