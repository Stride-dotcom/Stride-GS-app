import { useState, useCallback } from 'react';
import { theme } from '../styles/theme';
import { useQuoteStore } from '../hooks/useQuoteStore';
import { useIsMobile } from '../hooks/useIsMobile';
import { QuoteMyQuotes } from '../components/quotes/QuoteMyQuotes';
import { QuoteBuilder } from '../components/quotes/QuoteBuilder';
import { QuoteCatalog } from '../components/quotes/QuoteCatalog';
import { QuoteSettings } from '../components/quotes/QuoteSettings';

const v = theme.v2;
type QuoteTab = 'my-quotes' | 'builder' | 'catalog' | 'settings';

const TABS: { id: QuoteTab; label: string }[] = [
  { id: 'my-quotes', label: 'MY QUOTES' },
  { id: 'builder',   label: 'BUILDER' },
  { id: 'catalog',   label: 'CATALOG' },
  { id: 'settings',  label: 'SETTINGS' },
];

export function QuoteTool() {
  const { isMobile } = useIsMobile();
  const store = useQuoteStore();
  const [activeTab, setActiveTab] = useState<QuoteTab>('my-quotes');
  const [editingQuoteId, setEditingQuoteId] = useState<string | null>(null);

  const openBuilder = useCallback(async (quoteId?: string) => {
    if (quoteId) {
      setEditingQuoteId(quoteId);
    } else {
      const q = await store.createQuote();
      setEditingQuoteId(q.id);
    }
    setActiveTab('builder');
  }, [store]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, margin: '-28px -32px', padding: '28px 32px', minHeight: '100%', background: v.colors.bgPage }}>
      {/* Header — small inline branding */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: '1px', color: v.colors.text }}>
          STRIDE LOGISTICS · QUOTE TOOL
        </div>
        <div style={{ fontSize: 11, color: v.colors.textMuted }}>OFFLINE · v1.0</div>
      </div>

      {/* Tabs — dark active pill, text only, no icons */}
      <div style={{ display: 'inline-flex', gap: 0, background: v.colors.bgCard, borderRadius: v.radius.badge, padding: 5, alignSelf: 'flex-start' }}>
        {TABS.map(tab => {
          const active = activeTab === tab.id;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
              padding: isMobile ? '9px 14px' : '9px 22px',
              fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
              letterSpacing: '2px',
              background: active ? v.colors.bgDark : 'transparent',
              border: 'none', cursor: 'pointer',
              borderRadius: v.radius.badge,
              color: active ? v.colors.textOnDark : v.colors.textMuted,
              transition: 'all 0.2s',
            }}>
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {activeTab === 'my-quotes' && <QuoteMyQuotes store={store} onOpenBuilder={openBuilder} />}
      {activeTab === 'builder' && (
        <QuoteBuilder store={store} quoteId={editingQuoteId}
          onBack={() => { setActiveTab('my-quotes'); setEditingQuoteId(null); }} />
      )}
      {activeTab === 'catalog' && <QuoteCatalog store={store} />}
      {activeTab === 'settings' && <QuoteSettings store={store} />}
    </div>
  );
}
