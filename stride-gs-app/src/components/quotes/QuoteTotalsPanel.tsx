import { useMemo } from 'react';
import { Save, Copy, FileDown, Trash2, Ban } from 'lucide-react';
import { theme } from '../../styles/theme';
import { calcQuote } from '../../lib/quoteCalc';
import type { Quote, QuoteCatalog, CalcResult } from '../../lib/quoteTypes';

const v = theme.v2;

interface Props {
  quote: Quote;
  catalog: QuoteCatalog;
  onUpdate: (patch: Partial<Quote>) => void;
  onSave: () => void;
  onDuplicate: () => void;
  onDownloadPdf: () => void;
  onVoid: () => void;
  onDelete: () => void;
}

function fmt(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function QuoteTotalsPanel({ quote, catalog, onUpdate, onSave, onDuplicate, onDownloadPdf, onVoid, onDelete }: Props) {
  const result: CalcResult = useMemo(
    () => calcQuote(quote, catalog.services, catalog.classes, catalog.coverageOptions),
    [quote, catalog]
  );

  const grouped = useMemo(() => {
    const g: Record<string, typeof result.lineItems> = {};
    for (const li of result.lineItems) (g[li.category] ??= []).push(li);
    return g;
  }, [result.lineItems]);

  const btnPrimary: React.CSSProperties = {
    ...v.typography.buttonPrimary, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    padding: '10px 16px', border: 'none', borderRadius: v.radius.button,
    background: v.colors.accent, color: v.colors.textOnDark, cursor: 'pointer', fontFamily: 'inherit', width: '100%',
  };
  const btnGhost: React.CSSProperties = {
    ...v.typography.buttonPrimary, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    padding: '10px 16px', border: `1px solid ${v.colors.borderOnDark}`, borderRadius: v.radius.button,
    background: 'transparent', color: v.colors.textOnDark, cursor: 'pointer', fontFamily: 'inherit', width: '100%',
  };
  const btnDanger: React.CSSProperties = {
    ...btnGhost, borderColor: 'rgba(180,90,90,0.4)', color: '#F87171',
  };

  return (
    <div style={{
      background: v.colors.bgDark, borderRadius: v.radius.card, padding: v.card.padding, color: v.colors.textOnDark,
      position: 'sticky', top: 20,
    }}>
      <div style={{ ...v.typography.label, color: v.colors.textOnDarkMuted, marginBottom: 20 }}>QUOTE SUMMARY</div>

      {/* Line items */}
      <div style={{ maxHeight: 320, overflowY: 'auto', marginBottom: 20 }}>
        {Object.entries(grouped).map(([cat, items]) => (
          <div key={cat} style={{ marginBottom: 12 }}>
            <div style={{ ...v.typography.label, color: v.colors.textOnDarkMuted, marginBottom: 6 }}>{cat}</div>
            {items.map((li, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', color: 'rgba(255,255,255,0.7)' }}>
                <span>{li.serviceName}{li.className ? ` (${li.className})` : ''} × {li.qty}</span>
                <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>${fmt(li.amount)}</span>
              </div>
            ))}
          </div>
        ))}
        {result.lineItems.length === 0 && (
          <div style={{ fontSize: 12, color: v.colors.textOnDarkMuted, textAlign: 'center', padding: '24px 0' }}>No services selected yet</div>
        )}
      </div>

      {/* Totals */}
      <div style={{ borderTop: `1px solid ${v.colors.borderOnDark}`, paddingTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
          <span>Subtotal</span><span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>${fmt(result.subtotal)}</span>
        </div>
        {result.discountAmount > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8, color: '#4ADE80' }}>
            <span>Discount {quote.discount.type === 'percent' ? `(${quote.discount.value}%)` : ''}</span>
            <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>-${fmt(result.discountAmount)}</span>
          </div>
        )}
        {result.taxAmount > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8, color: 'rgba(255,255,255,0.5)' }}>
            <span>Tax ({quote.taxRate}%)</span><span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>${fmt(result.taxAmount)}</span>
          </div>
        )}
        {result.coverageCost > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8, color: 'rgba(255,255,255,0.5)' }}>
            <span>Coverage</span><span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>${fmt(result.coverageCost)}</span>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 24, fontWeight: 300, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${v.colors.borderOnDark}` }}>
          <span>Total</span><span style={{ color: v.colors.accent, fontVariantNumeric: 'tabular-nums' }}>${fmt(result.grandTotal)}</span>
        </div>
      </div>

      {/* Tax toggle + area */}
      <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={quote.taxEnabled} id="tax-toggle"
            onChange={() => onUpdate({ taxEnabled: !quote.taxEnabled })} style={{ accentColor: v.colors.accent }} />
          <label htmlFor="tax-toggle" style={{ fontSize: 11, color: v.colors.textOnDarkMuted, cursor: 'pointer' }}>Tax enabled</label>
          {quote.taxEnabled && <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginLeft: 'auto' }}>{quote.taxRate}%</span>}
        </div>
        {quote.taxEnabled && catalog.taxAreas.length > 0 && (
          <select value={quote.taxAreaId}
            onChange={e => { const area = catalog.taxAreas.find(a => a.id === e.target.value); if (area) onUpdate({ taxAreaId: area.id, taxRate: area.rate }); }}
            style={{ width: '100%', padding: '8px 10px', fontSize: 11, background: '#2A2A2A', color: v.colors.textOnDark, border: `1px solid ${v.colors.borderOnDark}`, borderRadius: v.radius.input, fontFamily: 'inherit', cursor: 'pointer' }}>
            {catalog.taxAreas.map(ta => <option key={ta.id} value={ta.id}>{ta.name} ({ta.rate}%)</option>)}
          </select>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 20 }}>
        <button onClick={onSave} style={btnPrimary}><Save size={14} /> SAVE QUOTE</button>
        <button onClick={onDownloadPdf} style={btnGhost}><FileDown size={14} /> DOWNLOAD PDF</button>
        <button onClick={onDuplicate} style={btnGhost}><Copy size={14} /> DUPLICATE</button>
        {quote.status !== 'void' && <button onClick={onVoid} style={btnDanger}><Ban size={14} /> VOID QUOTE</button>}
        <button onClick={onDelete} style={btnDanger}><Trash2 size={14} /> DELETE</button>
      </div>
    </div>
  );
}
