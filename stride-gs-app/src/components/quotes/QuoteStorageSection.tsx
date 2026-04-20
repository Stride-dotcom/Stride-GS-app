import { useState, useCallback, useMemo } from 'react';
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

  // ── Session 74: bulk-toggle helpers (mirror QuotePricingMatrix) ──────
  const keyFor = (classId: string, svcId: string) => `${classId}:${svcId}`;

  const isRowAll = useCallback((svcId: string): boolean => {
    if (activeClasses.length === 0) return false;
    return activeClasses.every(cls => !!quote.storageCells[keyFor(cls.id, svcId)]?.selected);
  }, [activeClasses, quote.storageCells]);

  const isColAll = useCallback((classId: string): boolean => {
    if (storageServices.length === 0) return false;
    return storageServices.every(svc => !!quote.storageCells[keyFor(classId, svc.id)]?.selected);
  }, [storageServices, quote.storageCells]);

  const isMasterAll = useMemo(() => {
    if (activeClasses.length === 0 || storageServices.length === 0) return false;
    return storageServices.every(svc => activeClasses.every(cls => !!quote.storageCells[keyFor(cls.id, svc.id)]?.selected));
  }, [storageServices, activeClasses, quote.storageCells]);

  const bulkSet = useCallback((pairs: Array<[string, string]>, selected: boolean) => {
    const next = { ...quote.storageCells };
    for (const [cid, sid] of pairs) {
      next[keyFor(cid, sid)] = { selected };
    }
    onChange({ storageCells: next });
  }, [quote.storageCells, onChange]);

  const toggleRow = useCallback((svcId: string) => {
    const selected = !isRowAll(svcId);
    bulkSet(activeClasses.map(cls => [cls.id, svcId] as [string, string]), selected);
  }, [isRowAll, activeClasses, bulkSet]);

  const toggleCol = useCallback((classId: string) => {
    const selected = !isColAll(classId);
    bulkSet(storageServices.map(svc => [classId, svc.id] as [string, string]), selected);
  }, [isColAll, storageServices, bulkSet]);

  const toggleMaster = useCallback(() => {
    const selected = !isMasterAll;
    const pairs: Array<[string, string]> = [];
    for (const svc of storageServices) {
      for (const cls of activeClasses) pairs.push([cls.id, svc.id]);
    }
    bulkSet(pairs, selected);
  }, [isMasterAll, storageServices, activeClasses, bulkSet]);

  const storageDays = (quote.storage.months * 30) + quote.storage.days;
  const td: React.CSSProperties = { padding: '8px', textAlign: 'center', borderBottom: `1px solid ${v.table.rowBorder}`, fontSize: 13 };
  const input: React.CSSProperties = { width: 70, padding: '8px', border: `1px solid ${v.colors.border}`, borderRadius: v.radius.input, fontSize: 14, fontFamily: 'inherit', textAlign: 'center', background: v.colors.bgWhite };

  // Shared select-all control (see QuotePricingMatrix for the matching
  // visual treatment — compact outlined box + "ALL" label).
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
                    {/* Top-left corner: master select-all. Session 74. */}
                    <th style={{ ...td, width: 56, background: v.colors.bgPage }}>
                      {selectAllCheckbox(isMasterAll, toggleMaster, 'Select every storage type × class')}
                    </th>
                    <th style={{ ...td, textAlign: 'left', paddingLeft: 8, ...v.typography.label, background: v.colors.bgPage }}>Storage Type</th>
                    {activeClasses.map(cls => (
                      <th key={cls.id} style={{ ...td, ...v.typography.label, background: v.colors.bgPage }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                          <span>{cls.id}</span>
                          {selectAllCheckbox(isColAll(cls.id), () => toggleCol(cls.id), `Select ${cls.id} across all storage types`)}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {storageServices.map(svc => (
                    <tr key={svc.id}>
                      <td style={td}>
                        {selectAllCheckbox(isRowAll(svc.id), () => toggleRow(svc.id), `Select all classes for ${svc.name}`)}
                      </td>
                      <td style={{ ...td, textAlign: 'left', paddingLeft: 8, fontWeight: 500 }}>{svc.name}</td>
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
