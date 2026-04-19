/**
 * QuoteSettings — per-user Quote Tool preferences.
 *
 * Session 73 Phase 2: catalog management (services, tax areas, coverage
 * options) moved to the Price List page. Settings tab now only covers
 * company info + per-user quote defaults (prefix, expiration, storage).
 * Quote import/export is retained (quotes only, no catalog data).
 */
import { useState, useCallback } from 'react';
import { Download, Upload, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { theme } from '../../styles/theme';
import type { useQuoteStore } from '../../hooks/useQuoteStore';

const v = theme.v2;
type Store = ReturnType<typeof useQuoteStore>;
interface Props { store: Store }

export function QuoteSettings({ store }: Props) {
  const { settings, setSettings, exportQuotes, importQuotes, catalog } = store;
  const [toast, setToast] = useState<string | null>(null);
  const showToast = useCallback((msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000); }, []);

  const card: React.CSSProperties = { background: v.colors.bgCard, borderRadius: v.radius.card, padding: v.card.padding };
  const label: React.CSSProperties = { ...v.typography.label, marginBottom: 6, display: 'block' };
  const input: React.CSSProperties = { width: '100%', padding: '10px 14px', fontSize: 13, border: `1px solid ${v.colors.border}`, borderRadius: v.radius.input, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', background: v.colors.bgWhite };

  const handleExport = () => {
    const blob = new Blob([exportQuotes()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stride-quotes-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Quotes exported');
  };

  const handleImport = () => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json';
    inp.onchange = async () => {
      const file = inp.files?.[0];
      if (!file) return;
      const res = importQuotes(await file.text());
      if (res.error) showToast(res.error);
      else showToast(`Imported ${res.imported} quote${res.imported === 1 ? '' : 's'}`);
    };
    inp.click();
  };

  const ghostBtn: React.CSSProperties = {
    ...v.typography.buttonPrimary, display: 'flex', alignItems: 'center', gap: 6,
    padding: '10px 18px', border: `1px solid ${v.colors.border}`, borderRadius: v.radius.button,
    background: v.colors.bgWhite, cursor: 'pointer', fontFamily: 'inherit', color: v.colors.text,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 700 }}>
      {toast && (
        <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 500, padding: '12px 20px', borderRadius: v.radius.badge, background: v.colors.statusAccepted.bg, color: v.colors.statusAccepted.text, fontSize: 13, fontWeight: 600, boxShadow: '0 4px 20px rgba(0,0,0,0.1)', fontFamily: theme.typography.fontFamily }}>{toast}</div>
      )}

      {/* Catalog relocation notice */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '14px 18px',
        background: v.colors.bgWhite,
        border: `1px solid ${v.colors.border}`,
        borderRadius: v.radius.card,
        fontSize: 13, color: v.colors.text,
      }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: v.colors.statusAccepted.text, flexShrink: 0 }} />
        <div style={{ flex: 1, lineHeight: 1.5 }}>
          <strong>Service catalog, tax areas, and coverage options are managed on the Price List page.</strong>
          {' '}Edits propagate to every quote in real time.
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

      {/* Company info */}
      <div style={card}>
        <div style={{ ...v.typography.cardTitle, color: v.colors.text, marginBottom: 20 }}>Company Information</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div><label style={label}>COMPANY NAME</label><input value={settings.companyName} onChange={e => setSettings(p => ({ ...p, companyName: e.target.value }))} style={input} /></div>
          <div><label style={label}>PHONE</label><input value={settings.companyPhone} onChange={e => setSettings(p => ({ ...p, companyPhone: e.target.value }))} style={input} /></div>
          <div style={{ gridColumn: '1 / -1' }}><label style={label}>ADDRESS</label><input value={settings.companyAddress} onChange={e => setSettings(p => ({ ...p, companyAddress: e.target.value }))} style={input} /></div>
          <div><label style={label}>EMAIL</label><input value={settings.companyEmail} onChange={e => setSettings(p => ({ ...p, companyEmail: e.target.value }))} style={input} /></div>
        </div>
      </div>

      {/* Quote defaults */}
      <div style={card}>
        <div style={{ ...v.typography.cardTitle, color: v.colors.text, marginBottom: 20 }}>Quote Defaults</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 14 }}>
          <div><label style={label}>EXPIRATION (DAYS)</label><input type="number" min={1} value={settings.defaultExpirationDays} onChange={e => setSettings(p => ({ ...p, defaultExpirationDays: parseInt(e.target.value) || 30 }))} style={input} /></div>
          <div><label style={label}>STORAGE (MONTHS)</label><input type="number" min={0} value={settings.defaultStorageMonths} onChange={e => setSettings(p => ({ ...p, defaultStorageMonths: parseInt(e.target.value) || 0 }))} style={input} /></div>
          <div><label style={label}>PREFIX</label><input value={settings.quotePrefix} onChange={e => setSettings(p => ({ ...p, quotePrefix: e.target.value.toUpperCase() }))} style={input} /></div>
        </div>
        <div>
          <label style={label}>DEFAULT TAX AREA</label>
          <select
            value={settings.defaultTaxAreaId}
            onChange={e => setSettings(p => ({ ...p, defaultTaxAreaId: e.target.value }))}
            style={{ ...input, cursor: 'pointer' }}
          >
            {catalog.taxAreas.map(ta => (
              <option key={ta.id} value={ta.id}>{ta.name} — {ta.rate}%</option>
            ))}
          </select>
        </div>
      </div>

      {/* Data management — quotes only */}
      <div style={card}>
        <div style={{ ...v.typography.cardTitle, color: v.colors.text, marginBottom: 8 }}>Data Management</div>
        <div style={{ fontSize: 12, color: v.colors.textMuted, marginBottom: 16, lineHeight: 1.4 }}>
          Export or import quotes (JSON). Catalog data isn&rsquo;t included — it lives in Supabase and is managed on the Price List page.
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button onClick={handleExport} style={ghostBtn}><Download size={13} /> EXPORT QUOTES</button>
          <button onClick={handleImport} style={ghostBtn}><Upload size={13} /> IMPORT QUOTES</button>
        </div>
      </div>
    </div>
  );
}
