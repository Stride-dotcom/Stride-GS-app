import { useState, useCallback } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { theme } from '../../styles/theme';
import type { Quote, ServiceDef } from '../../lib/quoteTypes';

const v = theme.v2;

interface Props {
  quote: Quote;
  services: ServiceDef[];
  onChange: (patch: Partial<Quote>) => void;
}

export function QuoteOtherServices({ quote, services, onChange }: Props) {
  const [open, setOpen] = useState(true);
  // Each category starts collapsed; adding a key to this set expands it.
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());
  const otherServices = services.filter(s => s.active && !s.showInMatrix && !s.isStorage);

  const grouped: Record<string, typeof otherServices> = {};
  for (const svc of otherServices) (grouped[svc.category] ??= []).push(svc);

  const toggleCat = useCallback((cat: string) => {
    setExpandedCats(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  }, []);

  const toggle = useCallback((svcId: string) => {
    const prev = quote.otherServices[svcId];
    onChange({ otherServices: { ...quote.otherServices, [svcId]: { selected: !prev?.selected, qty: prev?.qty || 1, rateOverride: prev?.rateOverride ?? null } } });
  }, [quote.otherServices, onChange]);

  const setQty = useCallback((svcId: string, qty: number) => {
    const prev = quote.otherServices[svcId] || { selected: true, qty: 1, rateOverride: null };
    onChange({ otherServices: { ...quote.otherServices, [svcId]: { ...prev, qty: Math.max(1, qty) } } });
  }, [quote.otherServices, onChange]);

  const setRateOverride = useCallback((svcId: string, val: string) => {
    const prev = quote.otherServices[svcId] || { selected: true, qty: 1, rateOverride: null };
    const parsed = parseFloat(val);
    onChange({ otherServices: { ...quote.otherServices, [svcId]: { ...prev, rateOverride: isNaN(parsed) ? null : parsed } } });
  }, [quote.otherServices, onChange]);

  const selectedCount = otherServices.filter(s => quote.otherServices[s.id]?.selected).length;
  const smallInput: React.CSSProperties = { padding: '5px 6px', border: `1px solid ${v.colors.border}`, borderRadius: v.radius.input, fontSize: 13, fontFamily: 'inherit', background: v.colors.bgWhite, textAlign: 'center' };

  return (
    <div style={{ background: v.colors.bgCard, borderRadius: v.radius.card, overflow: 'hidden' }}>
      <button onClick={() => setOpen(o => !o)} style={{
        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: v.card.padding, border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'inherit',
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <span style={{ ...v.typography.cardTitle, color: v.colors.text }}>Other Services</span>
          {selectedCount > 0 && <span style={{ fontSize: 12, fontWeight: 600, color: v.colors.accent }}>{selectedCount} selected</span>}
        </div>
        {open ? <ChevronDown size={18} color={v.colors.textMuted} /> : <ChevronRight size={18} color={v.colors.textMuted} />}
      </button>
      {open && (
        <div style={{ padding: '0 16px 16px' }}>
          {Object.entries(grouped).map(([category, svcs]) => {
            const isCatOpen = expandedCats.has(category);
            const catSelectedCount = svcs.filter(s => quote.otherServices[s.id]?.selected).length;
            return (
              <div key={category} style={{ marginBottom: 4, border: `1px solid ${v.colors.border}`, borderRadius: v.radius.input, overflow: 'hidden' }}>
                {/* Category header — clickable toggle */}
                <button
                  onClick={() => toggleCat(category)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 14px', border: 'none', background: isCatOpen ? v.colors.bgWhite : v.colors.bgPage,
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {isCatOpen ? <ChevronDown size={13} color={v.colors.textMuted} /> : <ChevronRight size={13} color={v.colors.textMuted} />}
                    <span style={{ ...v.typography.label, fontSize: 11 }}>{category}</span>
                    {catSelectedCount > 0 && (
                      <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 4, background: v.colors.accentLight, color: v.colors.accent, fontWeight: 700 }}>
                        {catSelectedCount}
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: 10, color: v.colors.textMuted }}>{svcs.length} service{svcs.length !== 1 ? 's' : ''}</span>
                </button>
                {isCatOpen && (
                  <div style={{ padding: '4px 14px 12px', background: v.colors.bgWhite }}>
                    {svcs.map(svc => {
                      const entry = quote.otherServices[svc.id];
                      const isSelected = !!entry?.selected;
                      return (
                        <div key={svc.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', opacity: isSelected ? 1 : 0.55, borderBottom: `1px solid ${v.colors.border}` }}>
                          <input type="checkbox" checked={isSelected} onChange={() => toggle(svc.id)} style={{ accentColor: v.colors.accent, flexShrink: 0 }} />
                          <span style={{ flex: 1, fontSize: 13, fontWeight: isSelected ? 500 : 400, color: v.colors.text }}>{svc.name}</span>
                          <span style={{ ...v.typography.label, width: 60, textAlign: 'right' }}>{svc.unit.replace('_', '/')}</span>
                          {isSelected && (
                            <>
                              <input type="number" min={1} value={entry?.qty || 1} onChange={e => setQty(svc.id, parseInt(e.target.value) || 1)} style={{ ...smallInput, width: 48 }} />
                              <span style={{ fontSize: 11, color: v.colors.textMuted }}>×</span>
                              <input type="number" step="0.01" value={entry?.rateOverride ?? svc.flatRate} onChange={e => setRateOverride(svc.id, e.target.value)} style={{ ...smallInput, width: 72, textAlign: 'right' }} />
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
