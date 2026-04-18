import { useState, useCallback } from 'react';
import { FileText, Hammer, BookOpen, Settings2 } from 'lucide-react';
import { theme } from '../styles/theme';
import { useQuoteStore } from '../hooks/useQuoteStore';
import { useIsMobile } from '../hooks/useIsMobile';
import { QuoteMyQuotes } from '../components/quotes/QuoteMyQuotes';
import { QuoteBuilder } from '../components/quotes/QuoteBuilder';
import { QuoteCatalog } from '../components/quotes/QuoteCatalog';
import { QuoteSettings } from '../components/quotes/QuoteSettings';

const v = theme.v2;
type QuoteTab = 'my-quotes' | 'builder' | 'catalog' | 'settings';

const TAB_DEFS: { id: QuoteTab; label: string; icon: React.ReactNode }[] = [
  { id: 'my-quotes', label: 'My Quotes', icon: <FileText size={15} /> },
  { id: 'builder',   label: 'Builder',   icon: <Hammer size={15} /> },
  { id: 'catalog',   label: 'Catalog',   icon: <BookOpen size={15} /> },
  { id: 'settings',  label: 'Settings',  icon: <Settings2 size={15} /> },
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, margin: '-28px -32px', padding: '28px 32px', minHeight: '100%', background: v.colors.bgPage, borderRadius: 0 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 300, letterSpacing: '-0.5px', margin: 0, color: v.colors.text }}>Quote Tool</h1>
          <p style={{ ...v.typography.label, marginTop: 6, marginBottom: 0 }}>CREATE AND MANAGE CLIENT ESTIMATES</p>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, background: v.colors.bgCard, borderRadius: v.radius.badge, padding: 4 }}>
        {TAB_DEFS.map(tab => {
          const active = activeTab === tab.id;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: isMobile ? '10px 14px' : '10px 20px',
              fontSize: 12, fontWeight: active ? 600 : 500, fontFamily: 'inherit',
              background: active ? v.colors.bgWhite : 'transparent',
              border: 'none', cursor: 'pointer',
              borderRadius: v.radius.badge,
              color: active ? v.colors.accent : v.colors.textSecondary,
              transition: 'all 0.2s',
              boxShadow: active ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
              letterSpacing: '0.5px',
              textTransform: 'uppercase',
            }}>
              {tab.icon}
              {!isMobile && tab.label}
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
