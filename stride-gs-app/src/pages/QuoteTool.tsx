import { useState, useCallback } from 'react';
import { FileText, Hammer, BookOpen, Settings2 } from 'lucide-react';
import { theme } from '../styles/theme';
import { useQuoteStore } from '../hooks/useQuoteStore';
import { useIsMobile } from '../hooks/useIsMobile';
import { QuoteMyQuotes } from '../components/quotes/QuoteMyQuotes';
import { QuoteBuilder } from '../components/quotes/QuoteBuilder';
import { QuoteCatalog } from '../components/quotes/QuoteCatalog';
import { QuoteSettings } from '../components/quotes/QuoteSettings';

type QuoteTab = 'my-quotes' | 'builder' | 'catalog' | 'settings';

const TAB_DEFS: { id: QuoteTab; label: string; icon: React.ReactNode }[] = [
  { id: 'my-quotes', label: 'My Quotes', icon: <FileText size={14} /> },
  { id: 'builder',   label: 'Builder',   icon: <Hammer size={14} /> },
  { id: 'catalog',   label: 'Catalog',   icon: <BookOpen size={14} /> },
  { id: 'settings',  label: 'Settings',  icon: <Settings2 size={14} /> },
];

export function QuoteTool() {
  const { isMobile } = useIsMobile();
  const store = useQuoteStore();
  const [activeTab, setActiveTab] = useState<QuoteTab>('my-quotes');
  const [editingQuoteId, setEditingQuoteId] = useState<string | null>(null);

  const openBuilder = useCallback((quoteId?: string) => {
    if (quoteId) {
      setEditingQuoteId(quoteId);
    } else {
      const q = store.createQuote();
      setEditingQuoteId(q.id);
    }
    setActiveTab('builder');
  }, [store]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.3px', margin: 0 }}>Quote Tool</h1>
        <p style={{ fontSize: 13, color: theme.colors.textMuted, marginTop: 2, marginBottom: 0 }}>
          Create and manage client estimates
        </p>
      </div>

      {/* Tabs */}
      <div style={{ borderBottom: `2px solid ${theme.colors.border}` }}>
        <div style={{ display: 'flex', gap: 0 }}>
          {TAB_DEFS.map(tab => {
            const active = activeTab === tab.id;
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: isMobile ? '10px 12px' : '10px 18px',
                fontSize: 13, fontWeight: active ? 600 : 400, fontFamily: 'inherit',
                background: 'none', border: 'none', cursor: 'pointer',
                borderBottom: active ? `2px solid ${theme.colors.orange}` : '2px solid transparent',
                marginBottom: -2,
                color: active ? theme.colors.orange : theme.colors.textSecondary,
                transition: 'color 0.15s',
              }}>
                {tab.icon}
                {!isMobile && tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab content */}
      {activeTab === 'my-quotes' && (
        <QuoteMyQuotes store={store} onOpenBuilder={openBuilder} />
      )}
      {activeTab === 'builder' && (
        <QuoteBuilder
          store={store}
          quoteId={editingQuoteId}
          onBack={() => { setActiveTab('my-quotes'); setEditingQuoteId(null); }}
        />
      )}
      {activeTab === 'catalog' && (
        <QuoteCatalog store={store} />
      )}
      {activeTab === 'settings' && (
        <QuoteSettings store={store} />
      )}
    </div>
  );
}
