/**
 * QuoteCatalog — READ-ONLY view of the Supabase service catalog.
 *
 * Session 73: edits happen on /price-list (admin-only). This tab now
 * just shows what services and rates the Quote Tool will use, with a
 * button to jump to /price-list for edits.
 */
import { useMemo, useState } from 'react';
import { Search, ExternalLink, CloudOff } from 'lucide-react';
import { Link } from 'react-router-dom';
import { theme } from '../../styles/theme';
import type { useQuoteStore } from '../../hooks/useQuoteStore';

const v = theme.v2;
type Store = ReturnType<typeof useQuoteStore>;

interface Props { store: Store }

export function QuoteCatalog({ store }: Props) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    return store.catalog.services.filter(svc =>
      !s
        || svc.name.toLowerCase().includes(s)
        || svc.code.toLowerCase().includes(s)
        || svc.category.toLowerCase().includes(s)
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

  const fromFallback = store.catalogSource === 'fallback';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Banner explaining where the data comes from */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '14px 18px',
        background: fromFallback ? 'rgba(200,160,40,0.10)' : v.colors.bgWhite,
        border: `1px solid ${fromFallback ? 'rgba(200,160,40,0.35)' : v.colors.border}`,
        borderRadius: v.radius.card, fontSize: 13, color: v.colors.text,
      }}>
        {fromFallback ? (
          <CloudOff size={16} style={{ color: '#B08810', flexShrink: 0 }} />
        ) : (
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: v.colors.statusAccepted.text, flexShrink: 0 }} />
        )}
        <div style={{ flex: 1, lineHeight: 1.5 }}>
          {fromFallback ? (
            <>
              <strong>Showing offline defaults.</strong> The Supabase service catalog couldn&rsquo;t be loaded — the Quote
              Tool is using the built-in fallback services. Edits below are disabled.
            </>
          ) : (
            <>
              <strong>Services load from the central Price List.</strong> To edit codes, rates, taxability, or add/remove
              services, use the Price List page. Changes propagate to every quote immediately.
            </>
          )}
        </div>
        <Link
          to="/price-list"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '8px 16px', borderRadius: v.radius.button,
            background: v.colors.bgDark, color: v.colors.textOnDark,
            fontSize: 11, fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase',
            textDecoration: 'none', fontFamily: 'inherit', whiteSpace: 'nowrap',
          }}
        >
          Open Price List <ExternalLink size={12} />
        </Link>
      </div>

      {/* Search */}
      <div style={{ position: 'relative', maxWidth: 420 }}>
        <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: v.colors.textMuted }} />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search services..."
          style={{ width: '100%', padding: '10px 14px 10px 38px', fontSize: 13, border: `1px solid ${v.colors.border}`, borderRadius: v.radius.input, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', background: v.colors.bgWhite }} />
      </div>

      {/* Table */}
      <div style={{ background: v.colors.bgWhite, borderRadius: v.radius.table, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
          <thead><tr>
            <th style={thStyle}>Code</th>
            <th style={thStyle}>Name</th>
            <th style={thStyle}>Category</th>
            <th style={thStyle}>Unit</th>
            <th style={thStyle}>Billing</th>
            <th style={thStyle}>Rate</th>
            <th style={{ ...thStyle, textAlign: 'center' }}>Matrix</th>
            <th style={{ ...thStyle, textAlign: 'center' }}>Active</th>
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
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {(['XS', 'S', 'M', 'L', 'XL', 'XXL'] as const).map(cls => {
                        const r = svc.rates[cls];
                        if (r == null || r === 0) return null;
                        return (
                          <span key={cls} style={{ fontSize: 10, padding: '2px 5px', borderRadius: v.radius.chip, background: v.colors.bgPage, color: v.colors.textSecondary }}>
                            {cls}:${r}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </td>
                <td style={{ ...tdStyle, textAlign: 'center', color: v.colors.textSecondary }}>
                  {svc.showInMatrix ? '✓' : '—'}
                </td>
                <td style={{ ...tdStyle, textAlign: 'center', color: v.colors.textSecondary }}>
                  {svc.active ? '✓' : '—'}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} style={{ ...tdStyle, textAlign: 'center', padding: 40, color: v.colors.textMuted }}>
                  {store.catalogLoading ? 'Loading services…' : 'No services match your search.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
