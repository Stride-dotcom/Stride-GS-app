import { useState, useCallback } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { theme } from '../../styles/theme';
import type { Quote, ServiceDef, ClassDef } from '../../lib/quoteTypes';

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
  const td: React.CSSProperties = { padding: '6px', textAlign: 'center', borderBottom: `1px solid ${theme.colors.border}`, fontSize: 12 };

  return (
    <div style={{ background: '#fff', border: `1px solid ${theme.colors.border}`, borderRadius: 12, overflow: 'hidden' }}>
      <button onClick={() => setOpen(v => !v)} style={{
        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 20px', border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'inherit',
      }}>
        <div>
          <span style={{ fontSize: 14, fontWeight: 700, color: theme.colors.text }}>Storage</span>
          <span style={{ fontSize: 12, color: theme.colors.textMuted, marginLeft: 8 }}>{storageDays} day{storageDays !== 1 ? 's' : ''}</span>
        </div>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </button>
      {open && (
        <div style={{ padding: '0 20px 16px' }}>
          <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: theme.colors.textSecondary, display: 'block', marginBottom: 3 }}>Months</label>
              <input type="number" min={0} value={quote.storage.months}
                onChange={e => onChange({ storage: { ...quote.storage, months: Math.max(0, parseInt(e.target.value) || 0) } })}
                style={{ width: 70, padding: '6px 8px', border: `1px solid ${theme.colors.border}`, borderRadius: 6, fontSize: 13, fontFamily: 'inherit', textAlign: 'center' }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: theme.colors.textSecondary, display: 'block', marginBottom: 3 }}>Days</label>
              <input type="number" min={0} max={29} value={quote.storage.days}
                onChange={e => onChange({ storage: { ...quote.storage, days: Math.max(0, Math.min(29, parseInt(e.target.value) || 0)) } })}
                style={{ width: 70, padding: '6px 8px', border: `1px solid ${theme.colors.border}`, borderRadius: 6, fontSize: 13, fontFamily: 'inherit', textAlign: 'center' }} />
            </div>
          </div>
          {storageServices.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...td, textAlign: 'left', fontSize: 11, fontWeight: 700, color: theme.colors.textSecondary, background: '#F8FAFC' }}>Storage Type</th>
                  {activeClasses.map(cls => (
                    <th key={cls.id} style={{ ...td, fontSize: 11, fontWeight: 700, color: theme.colors.textSecondary, background: '#F8FAFC' }}>{cls.id}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {storageServices.map(svc => (
                  <tr key={svc.id}>
                    <td style={{ ...td, textAlign: 'left', fontWeight: 500 }}>{svc.name}</td>
                    {activeClasses.map(cls => {
                      const key = `${cls.id}:${svc.id}`;
                      const cell = quote.storageCells[key];
                      const rate = svc.rates[cls.id as keyof typeof svc.rates] ?? 0;
                      return (
                        <td key={cls.id} style={{ ...td, cursor: 'pointer', background: cell?.selected ? '#F0FDF4' : undefined }}
                          onClick={() => toggleStorage(cls.id, svc.id)}>
                          <input type="checkbox" checked={!!cell?.selected} onChange={() => {}} style={{ accentColor: theme.colors.orange }} />
                          <div style={{ fontSize: 10, color: theme.colors.textMuted }}>${rate.toFixed(2)}/day</div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
