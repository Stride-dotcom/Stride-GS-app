import { useState, useMemo } from 'react';
import { Plus, Pencil, Trash2, Search } from 'lucide-react';
import { theme } from '../../styles/theme';
import { QuoteServiceModal } from './QuoteServiceModal';
import type { ServiceDef } from '../../lib/quoteTypes';
import type { useQuoteStore } from '../../hooks/useQuoteStore';

const v = theme.v2;
type Store = ReturnType<typeof useQuoteStore>;

interface Props { store: Store }

export function QuoteCatalog({ store }: Props) {
  const [search, setSearch] = useState('');
  const [editSvc, setEditSvc] = useState<ServiceDef | null | 'new'>(null);

  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    return store.catalog.services.filter(svc =>
      !s || svc.name.toLowerCase().includes(s) || svc.code.toLowerCase().includes(s) || svc.category.toLowerCase().includes(s)
    );
  }, [store.catalog.services, search]);

  const thStyle: React.CSSProperties = {
    padding: v.table.cellPadding, fontSize: v.table.headerFontSize, fontWeight: v.table.headerWeight,
    textAlign: 'left', color: v.colors.textMuted, textTransform: 'uppercase',
    letterSpacing: v.table.headerLetterSpacing, borderBottom: `1px solid ${v.table.rowBorder}`, background: v.colors.bgPage,
  };
  const tdStyle: React.CSSProperties = {
    padding: v.table.cellPadding, fontSize: v.table.cellFontSize,
    borderBottom: `1px solid ${v.table.rowBorder}`,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: v.colors.textMuted }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search services..."
            style={{ width: '100%', padding: '10px 14px 10px 38px', fontSize: 13, border: `1px solid ${v.colors.border}`, borderRadius: v.radius.input, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', background: v.colors.bgWhite }} />
        </div>
        <button onClick={() => setEditSvc('new')} style={{
          ...v.typography.buttonPrimary, display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 24px', border: 'none', borderRadius: v.radius.button,
          background: v.colors.accent, color: v.colors.textOnDark, cursor: 'pointer', fontFamily: 'inherit',
        }}>
          <Plus size={14} /> ADD SERVICE
        </button>
      </div>

      <div style={{ background: v.colors.bgWhite, borderRadius: v.radius.table, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
          <thead><tr>
            <th style={thStyle}>Code</th><th style={thStyle}>Name</th><th style={thStyle}>Category</th>
            <th style={thStyle}>Unit</th><th style={thStyle}>Billing</th><th style={thStyle}>Rate</th>
            <th style={{ ...thStyle, textAlign: 'center' }}>Active</th><th style={{ ...thStyle, width: 80 }}></th>
          </tr></thead>
          <tbody>
            {filtered.map(svc => (
              <tr key={svc.id} style={{ opacity: svc.active ? 1 : 0.4 }}>
                <td style={{ ...tdStyle, fontWeight: 600, fontFamily: 'monospace', color: v.colors.accent }}>{svc.code}</td>
                <td style={{ ...tdStyle, fontWeight: 500 }}>{svc.name}</td>
                <td style={{ ...tdStyle, color: v.colors.textSecondary }}>{svc.category}</td>
                <td style={{ ...tdStyle, ...v.typography.label }}>{svc.unit.replace('_', '/')}</td>
                <td style={tdStyle}>
                  <span style={{ padding: '3px 10px', borderRadius: v.radius.badge, fontSize: 10, fontWeight: 600,
                    background: svc.billing === 'class_based' ? 'rgba(124,58,237,0.12)' : v.colors.statusSent.bg,
                    color: svc.billing === 'class_based' ? '#7C3AED' : v.colors.statusSent.text }}>
                    {svc.billing === 'class_based' ? 'CLASS' : 'FLAT'}
                  </span>
                </td>
                <td style={{ ...tdStyle, fontVariantNumeric: 'tabular-nums' }}>
                  {svc.billing === 'flat' ? `$${svc.flatRate.toFixed(2)}` : (
                    <div style={{ display: 'flex', gap: 4 }}>
                      {(['XS', 'S', 'M', 'L', 'XL'] as const).map(cls => (
                        <span key={cls} style={{ fontSize: 10, padding: '2px 5px', borderRadius: v.radius.chip, background: v.colors.bgPage, color: v.colors.textSecondary }}>
                          {cls}:${svc.rates[cls]}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td style={{ ...tdStyle, textAlign: 'center' }}>
                  <input type="checkbox" checked={svc.active} onChange={e => store.updateService(svc.id, { active: e.target.checked })} style={{ accentColor: v.colors.accent }} />
                </td>
                <td style={{ ...tdStyle, display: 'flex', gap: 6 }}>
                  <button onClick={() => setEditSvc(svc)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: v.colors.textSecondary, padding: 4 }}><Pencil size={13} /></button>
                  <button onClick={() => { if (confirm(`Delete "${svc.name}"?`)) store.deleteService(svc.id); }} style={{ border: 'none', background: 'none', cursor: 'pointer', color: v.colors.statusDeclined.text, padding: 4 }}><Trash2 size={13} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editSvc !== null && (
        <QuoteServiceModal service={editSvc === 'new' ? null : editSvc}
          onSave={svc => { if (editSvc === 'new') store.addService(svc); else store.updateService(svc.id, svc); setEditSvc(null); }}
          onClose={() => setEditSvc(null)} />
      )}
    </div>
  );
}
