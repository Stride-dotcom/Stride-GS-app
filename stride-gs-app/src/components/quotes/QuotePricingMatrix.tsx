import { useCallback } from 'react';
import { theme } from '../../styles/theme';
import type { Quote, ServiceDef, ClassDef } from '../../lib/quoteTypes';

const v = theme.v2;

interface Props {
  quote: Quote;
  services: ServiceDef[];
  classes: ClassDef[];
  onChange: (patch: Partial<Quote>) => void;
}

export function QuotePricingMatrix({ quote, services, classes, onChange }: Props) {
  const activeClasses = classes.filter(c => c.active).sort((a, b) => a.order - b.order);
  const matrixServices = services.filter(s => s.active && s.showInMatrix).sort((a, b) => a.matrixOrder - b.matrixOrder);

  const handleQtyChange = useCallback((classId: string, qty: number) => {
    onChange({ classLines: quote.classLines.map(cl => cl.classId === classId ? { ...cl, qty } : cl) });
  }, [quote.classLines, onChange]);

  const toggleCell = useCallback((classId: string, svcId: string) => {
    const key = `${classId}:${svcId}`;
    const prev = quote.matrixCells[key];
    onChange({ matrixCells: { ...quote.matrixCells, [key]: { selected: !prev?.selected, qty: prev?.qty || 0 } } });
  }, [quote.matrixCells, onChange]);

  const th: React.CSSProperties = {
    padding: '12px 8px', fontSize: v.table.headerFontSize, fontWeight: v.table.headerWeight,
    textAlign: 'center', color: v.colors.textMuted, textTransform: 'uppercase',
    letterSpacing: v.table.headerLetterSpacing, borderBottom: `1px solid ${v.table.rowBorder}`,
  };
  const td: React.CSSProperties = { padding: '8px', textAlign: 'center', borderBottom: `1px solid ${v.table.rowBorder}`, fontSize: 13 };

  return (
    <div style={{ background: v.colors.bgCard, borderRadius: v.radius.card, overflow: 'hidden' }}>
      <div style={{ padding: v.card.padding, paddingBottom: 16 }}>
        <div style={{ ...v.typography.cardTitle, color: v.colors.text }}>Pricing Matrix</div>
        <p style={{ ...v.typography.label, marginTop: 8, marginBottom: 0 }}>SET ITEM QUANTITIES PER CLASS, THEN CHECK SERVICES TO INCLUDE</p>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 500, background: v.colors.bgWhite }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: 'left', paddingLeft: 20 }}>Service</th>
              {activeClasses.map(cls => <th key={cls.id} style={th}>{cls.id}</th>)}
            </tr>
          </thead>
          <tbody>
            {/* Quantity row */}
            <tr style={{ background: v.colors.accentLight }}>
              <td style={{ ...td, ...v.typography.label, fontWeight: 600, textAlign: 'left', paddingLeft: 20, color: v.colors.accent }}>QTY PER CLASS</td>
              {activeClasses.map(cls => {
                const cl = quote.classLines.find(c => c.classId === cls.id);
                return (
                  <td key={cls.id} style={td}>
                    <input type="number" min={0} value={cl?.qty || 0} onChange={e => handleQtyChange(cls.id, Math.max(0, parseInt(e.target.value) || 0))}
                      style={{ width: 52, textAlign: 'center', padding: '6px', border: `1px solid ${v.colors.border}`, borderRadius: v.radius.input, fontSize: 14, fontWeight: 600, fontFamily: 'inherit', background: v.colors.bgWhite }} />
                  </td>
                );
              })}
            </tr>
            {matrixServices.map(svc => (
              <tr key={svc.id}>
                <td style={{ ...td, textAlign: 'left', paddingLeft: 20, fontWeight: 500 }}>
                  {svc.name}
                  <span style={{ ...v.typography.label, marginLeft: 8, letterSpacing: '1px' }}>{svc.code}</span>
                </td>
                {activeClasses.map(cls => {
                  const key = `${cls.id}:${svc.id}`;
                  const cell = quote.matrixCells[key];
                  const rate = svc.billing === 'class_based' ? svc.rates[cls.id as keyof typeof svc.rates] : svc.flatRate;
                  return (
                    <td key={cls.id} style={{ ...td, cursor: 'pointer', background: cell?.selected ? 'rgba(74,138,92,0.08)' : undefined }}
                      onClick={() => toggleCell(cls.id, svc.id)}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                        <input type="checkbox" checked={!!cell?.selected} onChange={() => {}} style={{ accentColor: v.colors.accent, cursor: 'pointer' }} />
                        <span style={{ fontSize: 10, color: v.colors.textMuted }}>${rate.toFixed(2)}</span>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
