import { useCallback, useMemo } from 'react';
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

  // ── Session 74: bulk-toggle helpers ──────────────────────────────────────
  // For each scope (row = service, col = class, master = everything) compute
  // whether the scope is "all selected" so the select-all checkbox shows
  // the correct state. Then writing a bulk toggle mutates N keys in one
  // onChange call so the quote store sees a single patch per click.

  const keyFor = (classId: string, svcId: string) => `${classId}:${svcId}`;

  // Row (service) — all classes for the service selected?
  const isRowAll = useCallback((svcId: string): boolean => {
    if (activeClasses.length === 0) return false;
    return activeClasses.every(cls => !!quote.matrixCells[keyFor(cls.id, svcId)]?.selected);
  }, [activeClasses, quote.matrixCells]);

  // Column (class) — all services for the class selected?
  const isColAll = useCallback((classId: string): boolean => {
    if (matrixServices.length === 0) return false;
    return matrixServices.every(svc => !!quote.matrixCells[keyFor(classId, svc.id)]?.selected);
  }, [matrixServices, quote.matrixCells]);

  // Master — everything selected?
  const isMasterAll = useMemo(() => {
    if (activeClasses.length === 0 || matrixServices.length === 0) return false;
    return matrixServices.every(svc => activeClasses.every(cls => !!quote.matrixCells[keyFor(cls.id, svc.id)]?.selected));
  }, [matrixServices, activeClasses, quote.matrixCells]);

  // Bulk-toggle a set of (classId, svcId) pairs to a given selected value
  // with one patch. `qty` is preserved on existing cells, defaulted to 0 on
  // newly-created cells.
  const bulkSet = useCallback((pairs: Array<[string, string]>, selected: boolean) => {
    const next = { ...quote.matrixCells };
    for (const [cid, sid] of pairs) {
      const k = keyFor(cid, sid);
      const prev = next[k];
      next[k] = { selected, qty: prev?.qty ?? 0 };
    }
    onChange({ matrixCells: next });
  }, [quote.matrixCells, onChange]);

  const toggleRow = useCallback((svcId: string) => {
    const selected = !isRowAll(svcId);
    bulkSet(activeClasses.map(cls => [cls.id, svcId] as [string, string]), selected);
  }, [isRowAll, activeClasses, bulkSet]);

  const toggleCol = useCallback((classId: string) => {
    const selected = !isColAll(classId);
    bulkSet(matrixServices.map(svc => [classId, svc.id] as [string, string]), selected);
  }, [isColAll, matrixServices, bulkSet]);

  const toggleMaster = useCallback(() => {
    const selected = !isMasterAll;
    const pairs: Array<[string, string]> = [];
    for (const svc of matrixServices) {
      for (const cls of activeClasses) pairs.push([cls.id, svc.id]);
    }
    bulkSet(pairs, selected);
  }, [isMasterAll, matrixServices, activeClasses, bulkSet]);

  const th: React.CSSProperties = {
    padding: '12px 8px', fontSize: v.table.headerFontSize, fontWeight: v.table.headerWeight,
    textAlign: 'center', color: v.colors.textMuted, textTransform: 'uppercase',
    letterSpacing: v.table.headerLetterSpacing, borderBottom: `1px solid ${v.table.rowBorder}`,
  };
  const td: React.CSSProperties = { padding: '8px', textAlign: 'center', borderBottom: `1px solid ${v.table.rowBorder}`, fontSize: 13 };

  // Select-all checkboxes visually distinct from per-cell ones: a tiny
  // outlined square with the accent color border instead of the filled
  // accent, and a compact "ALL" label under so users read it as a
  // control rather than a data cell.
  const selectAllCheckbox = (checked: boolean, onClick: () => void, title: string) => (
    <div
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={title}
      style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 2, cursor: 'pointer', userSelect: 'none' }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={() => {}}
        style={{
          accentColor: v.colors.accent,
          cursor: 'pointer',
          width: 14, height: 14,
          outline: checked ? 'none' : `1px solid ${v.colors.accent}`,
          outlineOffset: -1,
        }}
      />
      <span style={{ fontSize: 8, fontWeight: 700, color: v.colors.accent, letterSpacing: '1px' }}>ALL</span>
    </div>
  );

  return (
    <div style={{ background: v.colors.bgCard, borderRadius: v.radius.card, overflow: 'hidden' }}>
      <div style={{ padding: v.card.padding, paddingBottom: 16 }}>
        <div style={{ ...v.typography.cardTitle, color: v.colors.text }}>Pricing Matrix</div>
        <p style={{ ...v.typography.label, marginTop: 8, marginBottom: 0 }}>SET ITEM QUANTITIES PER CLASS, THEN CHECK SERVICES TO INCLUDE</p>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560, background: v.colors.bgWhite }}>
          <thead>
            <tr>
              {/* Top-left corner: master select-all. Session 74 addition. */}
              <th style={{ ...th, width: 56 }}>
                {selectAllCheckbox(isMasterAll, toggleMaster, 'Select every service × class in the matrix')}
              </th>
              <th style={{ ...th, textAlign: 'left', paddingLeft: 8 }}>Service</th>
              {activeClasses.map(cls => (
                <th key={cls.id} style={th}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: v.colors.textSecondary }}>{cls.id}</span>
                    {selectAllCheckbox(isColAll(cls.id), () => toggleCol(cls.id), `Select ${cls.id} across all services`)}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* Quantity row — leave the select-all column blank; quantity is a separate concept. */}
            <tr style={{ background: v.colors.accentLight }}>
              <td style={{ ...td }} />
              <td style={{ ...td, ...v.typography.label, fontWeight: 600, textAlign: 'left', paddingLeft: 8, color: v.colors.accent }}>QTY PER CLASS</td>
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
                {/* Row-level select all */}
                <td style={td}>
                  {selectAllCheckbox(isRowAll(svc.id), () => toggleRow(svc.id), `Select all classes for ${svc.name}`)}
                </td>
                <td style={{ ...td, textAlign: 'left', paddingLeft: 8, fontWeight: 500 }}>
                  {svc.name}
                  <span style={{ ...v.typography.label, marginLeft: 8, letterSpacing: '1px' }}>{svc.code}</span>
                </td>
                {activeClasses.map(cls => {
                  const key = `${cls.id}:${svc.id}`;
                  const cell = quote.matrixCells[key];
                  const rate = svc.billing === 'class_based' ? (svc.rates[cls.id as keyof typeof svc.rates] ?? 0) : svc.flatRate;
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
