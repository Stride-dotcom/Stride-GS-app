import { useCallback } from 'react';
import { theme } from '../../styles/theme';
import type { Quote, ServiceDef, ClassDef } from '../../lib/quoteTypes';

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
    onChange({
      classLines: quote.classLines.map(cl => cl.classId === classId ? { ...cl, qty } : cl),
    });
  }, [quote.classLines, onChange]);

  const toggleCell = useCallback((classId: string, svcId: string) => {
    const key = `${classId}:${svcId}`;
    const prev = quote.matrixCells[key];
    onChange({
      matrixCells: { ...quote.matrixCells, [key]: { selected: !prev?.selected, qty: prev?.qty || 0 } },
    });
  }, [quote.matrixCells, onChange]);

  const th: React.CSSProperties = { padding: '8px 6px', fontSize: 11, fontWeight: 700, textAlign: 'center', background: '#F8FAFC', borderBottom: `1px solid ${theme.colors.border}`, whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '0.5px', color: theme.colors.textSecondary };
  const td: React.CSSProperties = { padding: '6px', textAlign: 'center', borderBottom: `1px solid ${theme.colors.border}`, fontSize: 12 };

  return (
    <div style={{ background: '#fff', border: `1px solid ${theme.colors.border}`, borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ padding: '14px 20px', borderBottom: `1px solid ${theme.colors.border}` }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: theme.colors.text }}>Pricing Matrix</div>
        <div style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: 2 }}>Set item quantities per class, then check services to include</div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 500 }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: 'left', paddingLeft: 16 }}>Service</th>
              {activeClasses.map(cls => (
                <th key={cls.id} style={th}>{cls.id}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* Quantity row */}
            <tr style={{ background: '#FFFBEB' }}>
              <td style={{ ...td, fontWeight: 700, textAlign: 'left', paddingLeft: 16, fontSize: 11, color: '#92400E' }}>QTY PER CLASS</td>
              {activeClasses.map(cls => {
                const cl = quote.classLines.find(c => c.classId === cls.id);
                return (
                  <td key={cls.id} style={td}>
                    <input type="number" min={0} value={cl?.qty || 0} onChange={e => handleQtyChange(cls.id, Math.max(0, parseInt(e.target.value) || 0))}
                      style={{ width: 52, textAlign: 'center', padding: '4px', border: `1px solid ${theme.colors.border}`, borderRadius: 6, fontSize: 13, fontWeight: 600, fontFamily: 'inherit' }} />
                  </td>
                );
              })}
            </tr>
            {/* Service rows */}
            {matrixServices.map(svc => (
              <tr key={svc.id}>
                <td style={{ ...td, textAlign: 'left', paddingLeft: 16, fontWeight: 500 }}>
                  {svc.name}
                  <span style={{ fontSize: 10, color: theme.colors.textMuted, marginLeft: 6 }}>{svc.code}</span>
                </td>
                {activeClasses.map(cls => {
                  const key = `${cls.id}:${svc.id}`;
                  const cell = quote.matrixCells[key];
                  const rate = svc.billing === 'class_based' ? svc.rates[cls.id as keyof typeof svc.rates] : svc.flatRate;
                  return (
                    <td key={cls.id} style={{ ...td, cursor: 'pointer', background: cell?.selected ? '#F0FDF4' : undefined }}
                      onClick={() => toggleCell(cls.id, svc.id)}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                        <input type="checkbox" checked={!!cell?.selected} onChange={() => {}} style={{ accentColor: theme.colors.orange, cursor: 'pointer' }} />
                        <span style={{ fontSize: 10, color: theme.colors.textMuted }}>${rate.toFixed(2)}</span>
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
