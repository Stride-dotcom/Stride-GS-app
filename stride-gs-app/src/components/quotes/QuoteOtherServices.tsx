import { useState, useCallback } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { theme } from '../../styles/theme';
import type { Quote, ServiceDef } from '../../lib/quoteTypes';

interface Props {
  quote: Quote;
  services: ServiceDef[];
  onChange: (patch: Partial<Quote>) => void;
}

export function QuoteOtherServices({ quote, services, onChange }: Props) {
  const [open, setOpen] = useState(true);
  const otherServices = services.filter(s => s.active && !s.showInMatrix && !s.isStorage);

  // Group by category
  const grouped: Record<string, typeof otherServices> = {};
  for (const svc of otherServices) {
    (grouped[svc.category] ??= []).push(svc);
  }

  const toggle = useCallback((svcId: string) => {
    const prev = quote.otherServices[svcId];
    onChange({
      otherServices: { ...quote.otherServices, [svcId]: { selected: !prev?.selected, qty: prev?.qty || 1, rateOverride: prev?.rateOverride ?? null } },
    });
  }, [quote.otherServices, onChange]);

  const setQty = useCallback((svcId: string, qty: number) => {
    const prev = quote.otherServices[svcId] || { selected: true, qty: 1, rateOverride: null };
    onChange({
      otherServices: { ...quote.otherServices, [svcId]: { ...prev, qty: Math.max(1, qty) } },
    });
  }, [quote.otherServices, onChange]);

  const setRateOverride = useCallback((svcId: string, val: string) => {
    const prev = quote.otherServices[svcId] || { selected: true, qty: 1, rateOverride: null };
    const parsed = parseFloat(val);
    onChange({
      otherServices: { ...quote.otherServices, [svcId]: { ...prev, rateOverride: isNaN(parsed) ? null : parsed } },
    });
  }, [quote.otherServices, onChange]);

  const selectedCount = otherServices.filter(s => quote.otherServices[s.id]?.selected).length;

  return (
    <div style={{ background: '#fff', border: `1px solid ${theme.colors.border}`, borderRadius: 12, overflow: 'hidden' }}>
      <button onClick={() => setOpen(v => !v)} style={{
        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 20px', border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'inherit',
      }}>
        <div>
          <span style={{ fontSize: 14, fontWeight: 700, color: theme.colors.text }}>Other Services</span>
          {selectedCount > 0 && <span style={{ fontSize: 12, color: theme.colors.orange, marginLeft: 8 }}>{selectedCount} selected</span>}
        </div>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </button>
      {open && (
        <div style={{ padding: '0 20px 16px' }}>
          {Object.entries(grouped).map(([category, svcs]) => (
            <div key={category} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6, paddingTop: 4, borderTop: `1px solid ${theme.colors.border}` }}>{category}</div>
              {svcs.map(svc => {
                const entry = quote.otherServices[svc.id];
                const isSelected = !!entry?.selected;
                return (
                  <div key={svc.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', opacity: isSelected ? 1 : 0.6 }}>
                    <input type="checkbox" checked={isSelected} onChange={() => toggle(svc.id)} style={{ accentColor: theme.colors.orange, flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: 13, fontWeight: isSelected ? 500 : 400 }}>{svc.name}</span>
                    <span style={{ fontSize: 10, color: theme.colors.textMuted, width: 60, textAlign: 'right' }}>{svc.unit.replace('_', '/')}</span>
                    {isSelected && (
                      <>
                        <input type="number" min={1} value={entry?.qty || 1} onChange={e => setQty(svc.id, parseInt(e.target.value) || 1)}
                          style={{ width: 48, textAlign: 'center', padding: '3px', border: `1px solid ${theme.colors.border}`, borderRadius: 4, fontSize: 12, fontFamily: 'inherit' }} />
                        <span style={{ fontSize: 11, color: theme.colors.textMuted }}>×</span>
                        <input type="number" step="0.01" value={entry?.rateOverride ?? svc.flatRate} onChange={e => setRateOverride(svc.id, e.target.value)}
                          style={{ width: 64, textAlign: 'right', padding: '3px', border: `1px solid ${theme.colors.border}`, borderRadius: 4, fontSize: 12, fontFamily: 'inherit' }} />
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
