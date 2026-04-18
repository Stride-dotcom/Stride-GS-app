import { useState, useMemo } from 'react';
import { Plus, Pencil, Trash2, Search } from 'lucide-react';
import { theme } from '../../styles/theme';
import { QuoteServiceModal } from './QuoteServiceModal';
import type { ServiceDef } from '../../lib/quoteTypes';
import type { useQuoteStore } from '../../hooks/useQuoteStore';

type Store = ReturnType<typeof useQuoteStore>;

interface Props {
  store: Store;
}

export function QuoteCatalog({ store }: Props) {
  const [search, setSearch] = useState('');
  const [editSvc, setEditSvc] = useState<ServiceDef | null | 'new'>(null);

  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    return store.catalog.services.filter(svc =>
      !s || svc.name.toLowerCase().includes(s) || svc.code.toLowerCase().includes(s) || svc.category.toLowerCase().includes(s)
    );
  }, [store.catalog.services, search]);

  const td: React.CSSProperties = { padding: '8px 12px', fontSize: 12, borderBottom: `1px solid ${theme.colors.border}` };
  const th: React.CSSProperties = { ...td, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: theme.colors.textSecondary, borderBottom: `2px solid ${theme.colors.border}` };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: theme.colors.textMuted }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search services..."
            style={{ width: '100%', padding: '8px 10px 8px 32px', fontSize: 13, border: `1px solid ${theme.colors.border}`, borderRadius: 8, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
        </div>
        <button onClick={() => setEditSvc('new')} style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', fontSize: 13, fontWeight: 600,
          border: 'none', borderRadius: 8, background: theme.colors.orange, color: '#fff', cursor: 'pointer', fontFamily: 'inherit',
        }}>
          <Plus size={14} /> Add Service
        </button>
      </div>

      {/* Table */}
      <div style={{ background: '#fff', border: `1px solid ${theme.colors.border}`, borderRadius: 12, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
          <thead><tr>
            <th style={th}>Code</th>
            <th style={th}>Name</th>
            <th style={th}>Category</th>
            <th style={th}>Unit</th>
            <th style={th}>Billing</th>
            <th style={th}>Rate</th>
            <th style={{ ...th, textAlign: 'center' }}>Active</th>
            <th style={{ ...th, width: 80 }}></th>
          </tr></thead>
          <tbody>
            {filtered.map(svc => (
              <tr key={svc.id} style={{ opacity: svc.active ? 1 : 0.5 }}>
                <td style={{ ...td, fontWeight: 600, fontFamily: 'monospace', color: theme.colors.orange }}>{svc.code}</td>
                <td style={{ ...td, fontWeight: 500 }}>{svc.name}</td>
                <td style={{ ...td, color: theme.colors.textSecondary }}>{svc.category}</td>
                <td style={{ ...td, color: theme.colors.textSecondary, fontSize: 11 }}>{svc.unit.replace('_', '/')}</td>
                <td style={{ ...td, fontSize: 11 }}>
                  <span style={{ padding: '2px 8px', borderRadius: 8, fontSize: 10, fontWeight: 600, background: svc.billing === 'class_based' ? '#EDE9FE' : '#EFF6FF', color: svc.billing === 'class_based' ? '#7C3AED' : '#1D4ED8' }}>
                    {svc.billing === 'class_based' ? 'Class' : 'Flat'}
                  </span>
                </td>
                <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>
                  {svc.billing === 'flat' ? `$${svc.flatRate.toFixed(2)}` : (
                    <div style={{ display: 'flex', gap: 4 }}>
                      {(['XS', 'S', 'M', 'L', 'XL'] as const).map(cls => (
                        <span key={cls} style={{ fontSize: 10, padding: '1px 4px', borderRadius: 4, background: '#F3F4F6', color: theme.colors.textSecondary }}>
                          {cls}:${svc.rates[cls]}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td style={{ ...td, textAlign: 'center' }}>
                  <input type="checkbox" checked={svc.active} onChange={e => store.updateService(svc.id, { active: e.target.checked })} style={{ accentColor: theme.colors.orange }} />
                </td>
                <td style={{ ...td, display: 'flex', gap: 4 }}>
                  <button onClick={() => setEditSvc(svc)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: theme.colors.textSecondary, padding: 4 }}><Pencil size={13} /></button>
                  <button onClick={() => { if (confirm(`Delete "${svc.name}"?`)) store.deleteService(svc.id); }} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#DC2626', padding: 4 }}><Trash2 size={13} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {editSvc !== null && (
        <QuoteServiceModal
          service={editSvc === 'new' ? null : editSvc}
          onSave={svc => {
            if (editSvc === 'new') store.addService(svc);
            else store.updateService(svc.id, svc);
            setEditSvc(null);
          }}
          onClose={() => setEditSvc(null)}
        />
      )}
    </div>
  );
}
