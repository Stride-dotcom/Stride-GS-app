import { useState, useCallback, useMemo } from 'react';
import { ArrowLeft } from 'lucide-react';
import { theme } from '../../styles/theme';
import { useIsMobile } from '../../hooks/useIsMobile';
import { QuoteClientCard } from './QuoteClientCard';
import { QuotePricingMatrix } from './QuotePricingMatrix';
import { QuoteStorageSection } from './QuoteStorageSection';
import { QuoteOtherServices } from './QuoteOtherServices';
import { QuoteDiscountCard } from './QuoteDiscountCard';
import { QuoteCoverageCard } from './QuoteCoverageCard';
import { QuoteTotalsPanel } from './QuoteTotalsPanel';
import type { Quote } from '../../lib/quoteTypes';
import type { useQuoteStore } from '../../hooks/useQuoteStore';
import { generateQuotePdf } from '../../lib/quotePdf';

const v = theme.v2;
type Store = ReturnType<typeof useQuoteStore>;

interface Props {
  store: Store;
  quoteId: string | null;
  onBack: () => void;
}

export function QuoteBuilder({ store, quoteId, onBack }: Props) {
  const { isMobile } = useIsMobile();
  const [toast, setToast] = useState<string | null>(null);
  const { updateQuote, duplicateQuote, setQuoteStatus, deleteQuote: deleteQuoteFn } = store;

  const quote = useMemo(() => store.quotes.find(q => q.id === quoteId) ?? null, [store.quotes, quoteId]);

  const handleChange = useCallback((patch: Partial<Quote>) => {
    if (!quoteId) return;
    updateQuote(quoteId, patch);
  }, [quoteId, updateQuote]);

  const showToast = useCallback((msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000); }, []);

  // Session 74: explicit save bumps updatedAt so the store's setQuotes
  // diff triggers a Supabase upsert even when the quote body hasn't
  // changed since the last auto-save. Previously this was a pure
  // toast — users saw "saved" but no persistence happened at that
  // instant (auto-save had already covered it, or it hadn't, which is
  // how EST-1001 got lost).
  const handleSave = useCallback(() => {
    if (!quoteId) return;
    updateQuote(quoteId, {});
    showToast('Quote saved');
  }, [quoteId, updateQuote, showToast]);
  const handleDuplicate = useCallback(() => {
    if (!quoteId) return;
    const dup = duplicateQuote(quoteId);
    if (dup) showToast(`Duplicated as ${dup.number}`);
  }, [quoteId, duplicateQuote, showToast]);
  const handleVoid = useCallback(() => {
    if (!quoteId || !confirm('Void this quote?')) return;
    setQuoteStatus(quoteId, 'void'); showToast('Quote voided');
  }, [quoteId, setQuoteStatus, showToast]);
  const handleDelete = useCallback(() => {
    if (!quoteId || !confirm('Delete this quote permanently?')) return;
    deleteQuoteFn(quoteId); onBack();
  }, [quoteId, deleteQuoteFn, onBack]);
  const handleDownloadPdf = useCallback(() => {
    if (!quote) return;
    // generateQuotePdf is now async (it fetches the DOC_QUOTE template
    // from Supabase). Fire-and-forget — the toast is shown as soon as
    // the window.open dialog is triggered; errors are logged inside
    // quotePdf itself and the fallback HTML is used automatically.
    void generateQuotePdf(quote, store.catalog, store.settings);
    showToast('PDF opening — use the print dialog to save as PDF');
  }, [quote, store.catalog, store.settings, showToast]);

  if (!quote) {
    return (
      <div style={{ textAlign: 'center', padding: 48 }}>
        <p style={{ color: v.colors.textMuted, marginBottom: 16 }}>No quote selected</p>
        <button onClick={onBack} style={{
          ...v.typography.buttonPrimary, padding: '10px 24px', border: 'none', borderRadius: v.radius.button,
          background: v.colors.bgDark, color: v.colors.textOnDark, cursor: 'pointer', fontFamily: 'inherit',
        }}>BACK TO MY QUOTES</button>
      </div>
    );
  }

  return (
    <div>
      <button onClick={onBack} style={{
        display: 'flex', alignItems: 'center', gap: 6, ...v.typography.label,
        border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'inherit', marginBottom: 16, padding: 0, color: v.colors.textMuted,
      }}>
        <ArrowLeft size={14} /> BACK TO MY QUOTES
      </button>

      {toast && (
        <div style={{
          position: 'fixed', top: 16, right: 16, zIndex: 500, padding: '12px 20px',
          borderRadius: v.radius.badge, background: v.colors.statusAccepted.bg, border: `1px solid ${v.colors.statusAccepted.text}30`,
          color: v.colors.statusAccepted.text, fontSize: 13, fontWeight: 600, boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
          fontFamily: theme.typography.fontFamily,
        }}>{toast}</div>
      )}

      {/* Session 74: dropped `alignItems: 'start'` on the grid. When each
          cell auto-sizes to its content, the right column (Quote Summary)
          collapses to the panel's height with zero room to scroll —
          breaking `position: sticky`. Default `stretch` makes the right
          cell as tall as the left column, giving the sticky panel the
          containing block height it needs to stay pinned below the
          TopBar while the user scrolls through the long left column. */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 340px', gap: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <QuoteClientCard quote={quote} onChange={handleChange} />
          <QuotePricingMatrix quote={quote} services={store.catalog.services} classes={store.catalog.classes} onChange={handleChange} />
          <QuoteStorageSection quote={quote} services={store.catalog.services} classes={store.catalog.classes} onChange={handleChange} />
          <QuoteOtherServices quote={quote} services={store.catalog.services} onChange={handleChange} />
          <QuoteDiscountCard quote={quote} onChange={handleChange} />
          <QuoteCoverageCard quote={quote} coverageOptions={store.catalog.coverageOptions} onChange={handleChange} />
          {/* Notes */}
          <div style={{ background: v.colors.bgCard, borderRadius: v.radius.card, padding: v.card.padding }}>
            <div style={{ ...v.typography.cardTitle, color: v.colors.text, marginBottom: 16 }}>Notes</div>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 14 }}>
              <div>
                <label style={{ ...v.typography.label, display: 'block', marginBottom: 6 }}>CUSTOMER NOTES (VISIBLE ON QUOTE)</label>
                <textarea value={quote.customerNotes} onChange={e => handleChange({ customerNotes: e.target.value })}
                  rows={3} style={{ width: '100%', padding: '10px 14px', fontSize: 13, border: `1px solid ${v.colors.border}`, borderRadius: v.radius.input, fontFamily: 'inherit', outline: 'none', resize: 'vertical', boxSizing: 'border-box', background: v.colors.bgWhite }} />
              </div>
              <div>
                <label style={{ ...v.typography.label, display: 'block', marginBottom: 6 }}>INTERNAL NOTES (NOT SHOWN ON QUOTE)</label>
                <textarea value={quote.internalNotes} onChange={e => handleChange({ internalNotes: e.target.value })}
                  rows={3} style={{ width: '100%', padding: '10px 14px', fontSize: 13, border: `1px solid ${v.colors.border}`, borderRadius: v.radius.input, fontFamily: 'inherit', outline: 'none', resize: 'vertical', boxSizing: 'border-box', background: v.colors.bgWhite }} />
              </div>
            </div>
          </div>
        </div>

        <QuoteTotalsPanel quote={quote} catalog={store.catalog} onUpdate={handleChange}
          onSave={handleSave} onDuplicate={handleDuplicate} onDownloadPdf={handleDownloadPdf}
          onVoid={handleVoid} onDelete={handleDelete} />
      </div>
    </div>
  );
}
