import { useMemo } from 'react';
import { Save, Copy, FileDown, Trash2, Ban } from 'lucide-react';
import { theme } from '../../styles/theme';
import { calcQuote } from '../../lib/quoteCalc';
import type { Quote, QuoteCatalog, CalcResult } from '../../lib/quoteTypes';

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

  const btn = (label: string, icon: React.ReactNode, onClick: () => void, variant: 'primary' | 'secondary' | 'danger' = 'secondary'): React.ReactNode => {
    const bg = variant === 'primary' ? theme.colors.orange : variant === 'danger' ? '#DC2626' : 'transparent';
    const fg = variant === 'secondary' ? theme.colors.text : '#fff';
    const border = variant === 'secondary' ? `1px solid rgba(255,255,255,0.2)` : 'none';
    return (
      <button key={label} onClick={onClick} style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px',
        fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
        borderRadius: 8, border, background: bg, color: fg, width: '100%',
        justifyContent: 'center',
      }}>
        {icon}{label}
      </button>
    );
  };

  // Group line items by category
  const grouped = useMemo(() => {
    const g: Record<string, typeof result.lineItems> = {};
    for (const li of result.lineItems) {
      (g[li.category] ??= []).push(li);
    }
    return g;
  }, [result.lineItems]);

  return (
    <div style={{
      background: '#1E293B', borderRadius: 12, padding: 20, color: '#F1F5F9',
      position: 'sticky', top: 20,
    }}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16, letterSpacing: '-0.3px' }}>Quote Summary</div>

      {/* Line items grouped */}
      <div style={{ maxHeight: 300, overflowY: 'auto', marginBottom: 16 }}>
        {Object.entries(grouped).map(([cat, items]) => (
          <div key={cat} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>{cat}</div>
            {items.map((li, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0', color: '#CBD5E1' }}>
                <span>{li.serviceName}{li.className ? ` (${li.className})` : ''} × {li.qty}</span>
                <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>${fmt(li.amount)}</span>
              </div>
            ))}
          </div>
        ))}
        {result.lineItems.length === 0 && (
          <div style={{ fontSize: 12, color: '#64748B', textAlign: 'center', padding: '20px 0' }}>
            No services selected yet
          </div>
        )}
      </div>

      {/* Totals */}
      <div style={{ borderTop: '1px solid #334155', paddingTop: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
          <span>Subtotal</span>
          <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>${fmt(result.subtotal)}</span>
        </div>
        {result.discountAmount > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6, color: '#4ADE80' }}>
            <span>Discount {quote.discount.type === 'percent' ? `(${quote.discount.value}%)` : ''}</span>
            <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>-${fmt(result.discountAmount)}</span>
          </div>
        )}
        {result.taxAmount > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6, color: '#94A3B8' }}>
            <span>Tax ({quote.taxRate}%)</span>
            <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>${fmt(result.taxAmount)}</span>
          </div>
        )}
        {result.coverageCost > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6, color: '#94A3B8' }}>
            <span>Coverage</span>
            <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>${fmt(result.coverageCost)}</span>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 18, fontWeight: 800, marginTop: 10, paddingTop: 10, borderTop: '1px solid #475569' }}>
          <span>Total</span>
          <span style={{ color: theme.colors.orange, fontVariantNumeric: 'tabular-nums' }}>${fmt(result.grandTotal)}</span>
        </div>
      </div>

      {/* Tax toggle + area selector */}
      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={quote.taxEnabled} id="tax-toggle"
            onChange={() => onUpdate({ taxEnabled: !quote.taxEnabled })}
            style={{ accentColor: theme.colors.orange }} />
          <label htmlFor="tax-toggle" style={{ fontSize: 11, color: '#94A3B8', cursor: 'pointer' }}>Tax enabled</label>
          {quote.taxEnabled && <span style={{ fontSize: 11, color: '#64748B', marginLeft: 'auto' }}>{quote.taxRate}%</span>}
        </div>
        {quote.taxEnabled && catalog.taxAreas.length > 0 && (
          <select value={quote.taxAreaId}
            onChange={e => {
              const area = catalog.taxAreas.find(a => a.id === e.target.value);
              if (area) onUpdate({ taxAreaId: area.id, taxRate: area.rate });
            }}
            style={{ width: '100%', padding: '6px 8px', fontSize: 11, background: '#334155', color: '#F1F5F9', border: '1px solid #475569', borderRadius: 6, fontFamily: 'inherit', cursor: 'pointer' }}>
            {catalog.taxAreas.map(ta => (
              <option key={ta.id} value={ta.id}>{ta.name} ({ta.rate}%)</option>
            ))}
          </select>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 16 }}>
        {btn('Save Quote', <Save size={14} />, onSave, 'primary')}
        {btn('Download PDF', <FileDown size={14} />, onDownloadPdf)}
        {btn('Duplicate', <Copy size={14} />, onDuplicate)}
        {quote.status !== 'void' && btn('Void Quote', <Ban size={14} />, onVoid, 'danger')}
        {btn('Delete', <Trash2 size={14} />, onDelete, 'danger')}
      </div>
    </div>
  );
}
