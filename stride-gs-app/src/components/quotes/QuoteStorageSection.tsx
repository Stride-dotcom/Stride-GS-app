import { useState, useCallback } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { theme } from '../../styles/theme';
import type { Quote, ServiceDef, ClassDef } from '../../lib/quoteTypes';

const v = theme.v2;

interface Props {
  quote: Quote;
  services: ServiceDef[];
  classes: ClassDef[];
  onChange: (patch: Partial<Quote>) => void;
}

export function QuoteStorageSection({ quote, services, classes, onChange }: Props) {
  const [open, setOpen] = useState(true);
  const activeClasses = classes.filter(c => c.active).sort((a, b) => a.order - b.order);
  const storageServices = services.filter(s => s.active && s.isStorage);

  const toggleStorage = useCallback((classId: string, svcId: string) => {
    const key = `${classId}:${svcId}`;
    const prev = quote.storageCells[key];
    onChange({ storageCells: { ...quote.storageCells, [key]: { selected: !prev?.selected } } });
  }, [quote.storageCells, onChange]);

  const storageDays = (quote.storage.months * 30) + quote.storage.days;
  const td: React.CSSProperties = { padding: '8px', textAlign: 'center', borderBottom: `1px solid ${v.table.rowBorder}`, fontSize: 13 };
  const input: React.CSSProperties = { width: 70, padding: '8px', border: `1px solid ${v.colors.border}`, borderRadius: v.radius.input, fontSize: 14, fontFamily: 'inherit', textAlign: 'center', background: v.colors.bgWhite };

  return (
    <div style={{ background: v.colors.bgCard, borderRadius: v.radius.card, overflow: 'hidden' }}>
      <button onClick={() => setOpen(o => !o)} style={{
        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: v.card.padding, border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'inherit',
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <span style={{ ...v.typography.cardTitle, color: v.colors.text }}>Storage</span>
          <span style={{ ...v.typography.label }}>{storageDays} DAYS</span>
        </div>
        {open ? <ChevronDown size={18} color={v.colors.textMuted} /> : <ChevronRight size={18} color={v.colors.textMuted} />}
      </button>
      {open && (
        <div style={{ padding: '0 32px 28px' }}>
          <div style={{ display: 'flex', gap: 14, marginBottom: 16 }}>
            <div>
              <label style={{ ...v.typography.label, display: 'block', marginBottom: 6 }}>MONTHS</label>
              <input type="number" min={0} value={quote.storage.months}
                onChange={e => onChange({ storage: { ...quote.storage, months: Math.max(0, parseInt(e.target.value) || 0) } })}
                style={input} />
            </div>
            <div>
              <label style={{ ...v.typography.label, display: 'block', marginBottom: 6 }}>DAYS</label>
              <input type="number" min={0} max={29} value={quote.storage.days}
                onChange={e => onChange({ storage: { ...quote.storage, days: Math.max(0, Math.min(29, parseInt(e.target.value) || 0)) } })}
                style={input} />
            </div>
          </div>
          {storageServices.length > 0 && (
            <div style={{ background: v.colors.bgWhite, borderRadius: v.radius.table, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ ...td, textAlign: 'left', paddingLeft: 16, ...v.typography.label, background: v.colors.bgPage }}>Storage Type</th>
                    {activeClasses.map(cls => (
                      <th key={cls.id} style={{ ...td, ...v.typography.label, background: v.colors.bgPage }}>{cls.id}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {storageServices.map(svc => (
                    <tr key={svc.id}>
                      <td style={{ ...td, textAlign: 'left', paddingLeft: 16, fontWeight: 500 }}>{svc.name}</td>
                      {activeClasses.map(cls => {
                        const key = `${cls.id}:${svc.id}`;
                        const cell = quote.storageCells[key];
                        const rate = svc.rates[cls.id as keyof typeof svc.rates] ?? 0;
                        return (
                          <td key={cls.id} style={{ ...td, cursor: 'pointer', background: cell?.selected ? 'rgba(74,138,92,0.08)' : undefined }}
                            onClick={() => toggleStorage(cls.id, svc.id)}>
                            <input type="checkbox" checked={!!cell?.selected} onChange={() => {}} style={{ accentColor: v.colors.accent }} />
                            <div style={{ fontSize: 10, color: v.colors.textMuted }}>${rate.toFixed(2)}/day</div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
