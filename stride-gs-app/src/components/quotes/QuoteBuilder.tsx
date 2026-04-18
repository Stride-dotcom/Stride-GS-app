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

type Store = ReturnType<typeof useQuoteStore>;

interface Props {
  store: Store;
  quoteId: string | null;
  onBack: () => void;
}

export function QuoteBuilder({ store, quoteId, onBack }: Props) {
  const { isMobile } = useIsMobile();
  const [toast, setToast] = useState<string | null>(null);

  const quote = useMemo(() => store.quotes.find(q => q.id === quoteId) ?? null, [store.quotes, quoteId]);

  const handleChange = useCallback((patch: Partial<Quote>) => {
    if (!quoteId) return;
    store.updateQuote(quoteId, patch);
  }, [quoteId, store]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  const handleSave = useCallback(() => {
    showToast('Quote saved');
  }, [showToast]);

  const handleDuplicate = useCallback(() => {
    if (!quoteId) return;
    const dup = store.duplicateQuote(quoteId);
    if (dup) showToast(`Duplicated as ${dup.number}`);
  }, [quoteId, store, showToast]);

  const handleVoid = useCallback(() => {
    if (!quoteId || !confirm('Void this quote? This marks it as void.')) return;
    store.setQuoteStatus(quoteId, 'void');
    showToast('Quote voided');
  }, [quoteId, store, showToast]);

  const handleDelete = useCallback(() => {
    if (!quoteId || !confirm('Delete this quote permanently?')) return;
    store.deleteQuote(quoteId);
    onBack();
  }, [quoteId, store, onBack]);

  const handleDownloadPdf = useCallback(() => {
    if (!quote) return;
    generateQuotePdf(quote, store.catalog, store.settings);
    showToast('PDF downloaded');
  }, [quote, store.catalog, store.settings, showToast]);

  if (!quote) {
    return (
      <div style={{ textAlign: 'center', padding: 40 }}>
        <p style={{ color: theme.colors.textMuted, marginBottom: 12 }}>No quote selected</p>
        <button onClick={onBack} style={{ padding: '8px 16px', fontSize: 13, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>
          Back to My Quotes
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Back button */}
      <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: theme.colors.textSecondary, border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'inherit', marginBottom: 12, padding: 0 }}>
        <ArrowLeft size={14} /> Back to My Quotes
      </button>

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 500, padding: '10px 16px', borderRadius: 10, background: '#F0FDF4', border: '1px solid #A7F3D0', color: '#15803D', fontSize: 13, fontWeight: 500, boxShadow: '0 4px 16px rgba(0,0,0,0.1)', fontFamily: theme.typography.fontFamily }}>
          {toast}
        </div>
      )}

      {/* 2-column layout (or stacked on mobile) */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 320px', gap: 16, alignItems: 'start' }}>
        {/* Left column — form */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <QuoteClientCard quote={quote} onChange={handleChange} />
          <QuotePricingMatrix quote={quote} services={store.catalog.services} classes={store.catalog.classes} onChange={handleChange} />
          <QuoteStorageSection quote={quote} services={store.catalog.services} classes={store.catalog.classes} onChange={handleChange} />
          <QuoteOtherServices quote={quote} services={store.catalog.services} onChange={handleChange} />
          <QuoteDiscountCard quote={quote} onChange={handleChange} />
          <QuoteCoverageCard quote={quote} coverageOptions={store.catalog.coverageOptions} onChange={handleChange} />

          {/* Notes */}
          <div style={{ background: '#fff', border: `1px solid ${theme.colors.border}`, borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: theme.colors.text }}>Notes</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: theme.colors.textSecondary, display: 'block', marginBottom: 3 }}>Customer Notes (visible on quote)</label>
                <textarea value={quote.customerNotes} onChange={e => handleChange({ customerNotes: e.target.value })}
                  rows={3} style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: `1px solid ${theme.colors.border}`, borderRadius: 8, fontFamily: 'inherit', outline: 'none', resize: 'vertical', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: theme.colors.textSecondary, display: 'block', marginBottom: 3 }}>Internal Notes (not shown on quote)</label>
                <textarea value={quote.internalNotes} onChange={e => handleChange({ internalNotes: e.target.value })}
                  rows={3} style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: `1px solid ${theme.colors.border}`, borderRadius: 8, fontFamily: 'inherit', outline: 'none', resize: 'vertical', boxSizing: 'border-box' }} />
              </div>
            </div>
          </div>
        </div>

        {/* Right column — sticky totals */}
        <QuoteTotalsPanel
          quote={quote}
          catalog={store.catalog}
          onSave={handleSave}
          onDuplicate={handleDuplicate}
          onDownloadPdf={handleDownloadPdf}
          onVoid={handleVoid}
          onDelete={handleDelete}
        />
      </div>
    </div>
  );
}
