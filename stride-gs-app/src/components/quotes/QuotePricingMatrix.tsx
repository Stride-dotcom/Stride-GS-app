import { useCallback, useMemo } from 'react';
import { theme } from '../../styles/theme';
import type { Quote, ServiceDef, ClassDef, MatrixCell } from '../../lib/quoteTypes';

const v = theme.v2;

interface Props {
  quote: Quote;
  services: ServiceDef[];
  classes: ClassDef[];
  onChange: (patch: Partial<Quote>) => void;
}

/**
 * QuotePricingMatrix — Session 74 rewrite to match the approved
 * class-as-rows / service-as-columns layout the user built in their
 * other app. Each cell is a { checkbox, qty } pair so you can say
 * "10 Large items need Receiving but only 5 of them need Inspection"
 * without a single class-level qty forcing the same number everywhere.
 *
 * Columns:
 *   - Select-all master (row + column)
 *   - Class label (XS, S, M, L, XL, XXL)
 *   - Default Qty (class-level) — the fallback for any selected cell
 *     whose per-cell qty has never been set. Pre-seeded from the class
 *     line's qty; edit here to set a new default.
 *   - One column per matrix-eligible service with a checkbox + per-cell
 *     qty input. Rate footnote under the cell.
 *
 * Data model notes:
 *   - quote.classLines[classId].qty is the class-level default qty.
 *   - quote.matrixCells[`${classId}:${serviceId}`].qty is the per-cell
 *     override. Persisted per cell so typing here does NOT ripple into
 *     other services for the same class.
 *   - calcQuote reads cell.qty when > 0, else falls back to class qty.
 */
export function QuotePricingMatrix({ quote, services, classes, onChange }: Props) {
  const activeClasses = classes.filter(c => c.active).sort((a, b) => a.order - b.order);
  const matrixServices = services.filter(s => s.active && s.showInMatrix).sort((a, b) => a.matrixOrder - b.matrixOrder);

  // ── class default qty + per-cell toggles/qty ─────────────────────────────

  const handleClassQtyChange = useCallback((classId: string, qty: number) => {
    onChange({ classLines: quote.classLines.map(cl => cl.classId === classId ? { ...cl, qty } : cl) });
  }, [quote.classLines, onChange]);

  const keyFor = (classId: string, svcId: string) => `${classId}:${svcId}`;

  const toggleCell = useCallback((classId: string, svcId: string) => {
    const k = keyFor(classId, svcId);
    const prev = quote.matrixCells[k];
    // Seed the cell's qty from the class-level default the first time
    // it's turned on, so "select then see a number" just works.
    const classQty = quote.classLines.find(cl => cl.classId === classId)?.qty ?? 0;
    const seededQty = prev?.qty && prev.qty > 0 ? prev.qty : classQty;
    onChange({
      matrixCells: { ...quote.matrixCells, [k]: { selected: !prev?.selected, qty: seededQty } },
    });
  }, [quote.matrixCells, quote.classLines, onChange]);

  const setCellQty = useCallback((classId: string, svcId: string, qty: number) => {
    const k = keyFor(classId, svcId);
    const prev = quote.matrixCells[k];
    onChange({
      matrixCells: { ...quote.matrixCells, [k]: { selected: qty > 0 ? true : !!prev?.selected, qty } },
    });
  }, [quote.matrixCells, onChange]);

  // ── bulk select helpers ─────────────────────────────────────────────────

  const isRowAll = useCallback((classId: string): boolean => {
    if (matrixServices.length === 0) return false;
    return matrixServices.every(svc => !!quote.matrixCells[keyFor(classId, svc.id)]?.selected);
  }, [matrixServices, quote.matrixCells]);

  const isColAll = useCallback((svcId: string): boolean => {
    if (activeClasses.length === 0) return false;
    return activeClasses.every(cls => !!quote.matrixCells[keyFor(cls.id, svcId)]?.selected);
  }, [activeClasses, quote.matrixCells]);

  const isMasterAll = useMemo(() => {
    if (activeClasses.length === 0 || matrixServices.length === 0) return false;
    return activeClasses.every(cls => matrixServices.every(svc => !!quote.matrixCells[keyFor(cls.id, svc.id)]?.selected));
  }, [activeClasses, matrixServices, quote.matrixCells]);

  const bulkSet = useCallback((pairs: Array<[string, string]>, selected: boolean) => {
    const next: Record<string, MatrixCell> = { ...quote.matrixCells };
    for (const [cid, sid] of pairs) {
      const k = keyFor(cid, sid);
      const prev = next[k];
      const classQty = quote.classLines.find(cl => cl.classId === cid)?.qty ?? 0;
      // When turning on in bulk, seed any blank qty from the class default.
      const qty = prev?.qty && prev.qty > 0
        ? prev.qty
        : (selected ? classQty : (prev?.qty ?? 0));
      next[k] = { selected, qty };
    }
    onChange({ matrixCells: next });
  }, [quote.matrixCells, quote.classLines, onChange]);

  const toggleRow = useCallback((classId: string) => {
    const selected = !isRowAll(classId);
    bulkSet(matrixServices.map(svc => [classId, svc.id] as [string, string]), selected);
  }, [isRowAll, matrixServices, bulkSet]);

  const toggleCol = useCallback((svcId: string) => {
    const selected = !isColAll(svcId);
    bulkSet(activeClasses.map(cls => [cls.id, svcId] as [string, string]), selected);
  }, [isColAll, activeClasses, bulkSet]);

  const toggleMaster = useCallback(() => {
    const selected = !isMasterAll;
    const pairs: Array<[string, string]> = [];
    for (const cls of activeClasses) {
      for (const svc of matrixServices) pairs.push([cls.id, svc.id]);
    }
    bulkSet(pairs, selected);
  }, [isMasterAll, activeClasses, matrixServices, bulkSet]);

  // ── shared styles ───────────────────────────────────────────────────────

  const th: React.CSSProperties = {
    padding: '10px 8px', fontSize: v.table.headerFontSize, fontWeight: v.table.headerWeight,
    textAlign: 'center', color: v.colors.textMuted, textTransform: 'uppercase',
    letterSpacing: v.table.headerLetterSpacing, borderBottom: `1px solid ${v.table.rowBorder}`,
    background: v.colors.bgPage, verticalAlign: 'bottom', whiteSpace: 'nowrap',
  };
  const td: React.CSSProperties = {
    padding: '10px 8px', textAlign: 'center', borderBottom: `1px solid ${v.table.rowBorder}`, fontSize: 13,
  };
  const qtyInput: React.CSSProperties = {
    width: 56, textAlign: 'center', padding: '6px',
    border: `1px solid ${v.colors.border}`, borderRadius: v.radius.input,
    fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
    background: v.colors.bgWhite,
  };

  const selectAllCheckbox = (checked: boolean, onClick: () => void, title: string) => (
    <div
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={title}
      style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 2, cursor: 'pointer', userSelect: 'none' }}
    >
      <input
        type="checkbox" checked={checked} onChange={() => {}}
        style={{
          accentColor: v.colors.accent, cursor: 'pointer',
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
        <div style={{ ...v.typography.cardTitle, color: v.colors.text }}>Items &amp; Services by Class</div>
        <p style={{ ...v.typography.label, marginTop: 8, marginBottom: 0 }}>
          SET A DEFAULT QTY PER CLASS, THEN TOGGLE SERVICES.
          EACH SERVICE CAN HAVE ITS OWN QTY (E.G. 10 LARGE ITEMS FOR RECEIVING, 5 FOR INSPECTION).
        </p>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640, background: v.colors.bgWhite }}>
          <thead>
            <tr>
              {/* master select-all */}
              <th style={{ ...th, width: 56 }}>
                {selectAllCheckbox(isMasterAll, toggleMaster, 'Select every service × class cell')}
              </th>
              <th style={{ ...th, textAlign: 'left', paddingLeft: 16, width: 80 }}>Class</th>
              <th style={{ ...th, width: 90 }}>Default Qty</th>
              {matrixServices.map(svc => (
                <th key={svc.id} style={th}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: v.colors.textSecondary }}>{svc.name}</span>
                    <span style={{ fontSize: 9, color: v.colors.textMuted, letterSpacing: '1px' }}>{svc.code}</span>
                    {selectAllCheckbox(isColAll(svc.id), () => toggleCol(svc.id), `Select ${svc.name} across all classes`)}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {activeClasses.map(cls => {
              const classLine = quote.classLines.find(c => c.classId === cls.id);
              const classQty = classLine?.qty ?? 0;
              return (
                <tr key={cls.id}>
                  {/* row-level select-all */}
                  <td style={td}>
                    {selectAllCheckbox(isRowAll(cls.id), () => toggleRow(cls.id), `Select all services for ${cls.id}`)}
                  </td>
                  {/* class id */}
                  <td style={{ ...td, textAlign: 'left', paddingLeft: 16, fontWeight: 700 }}>
                    {cls.id}
                  </td>
                  {/* default class qty */}
                  <td style={td}>
                    <input
                      type="number" min={0} value={classQty}
                      onChange={e => handleClassQtyChange(cls.id, Math.max(0, parseInt(e.target.value) || 0))}
                      style={qtyInput}
                      title={`Default qty for ${cls.id} — applied to any newly-selected service cell`}
                    />
                  </td>
                  {/* per-cell service cells */}
                  {matrixServices.map(svc => {
                    const k = keyFor(cls.id, svc.id);
                    const cell = quote.matrixCells[k];
                    const selected = !!cell?.selected;
                    const cellQty = cell?.qty ?? 0;
                    const displayQty = selected && cellQty > 0 ? cellQty : (selected ? classQty : 0);
                    const rate = svc.billing === 'class_based'
                      ? (svc.rates[cls.id as keyof typeof svc.rates] ?? 0)
                      : svc.flatRate;
                    return (
                      <td
                        key={svc.id}
                        style={{
                          ...td,
                          cursor: 'pointer',
                          background: selected ? 'rgba(74,138,92,0.08)' : undefined,
                        }}
                        onClick={(e) => {
                          // Click anywhere in the cell toggles selection,
                          // EXCEPT when the user interacts with the qty input.
                          const target = e.target as HTMLElement;
                          if (target.tagName === 'INPUT' && target.getAttribute('type') === 'number') return;
                          toggleCell(cls.id, svc.id);
                        }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <input
                              type="checkbox" checked={selected} onChange={() => {}}
                              style={{ accentColor: v.colors.accent, cursor: 'pointer' }}
                            />
                            <input
                              type="number" min={0} value={displayQty}
                              onChange={e => {
                                const n = Math.max(0, parseInt(e.target.value) || 0);
                                setCellQty(cls.id, svc.id, n);
                              }}
                              onClick={e => e.stopPropagation()}
                              disabled={!selected && classQty === 0}
                              style={{
                                ...qtyInput, width: 50,
                                opacity: selected ? 1 : 0.55,
                              }}
                              title={selected
                                ? `Qty of ${cls.id} items receiving ${svc.name}`
                                : `Toggle the checkbox or type a qty to include ${svc.name} for ${cls.id}`}
                            />
                          </div>
                          <span style={{ fontSize: 10, color: v.colors.textMuted }}>
                            ${rate.toFixed(2)}
                          </span>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
