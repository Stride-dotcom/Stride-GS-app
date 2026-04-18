import { useState, useCallback } from 'react';
import { Plus, Trash2, RotateCcw, Download, Upload } from 'lucide-react';
import { theme } from '../../styles/theme';
import type { useQuoteStore } from '../../hooks/useQuoteStore';

const v = theme.v2;
type Store = ReturnType<typeof useQuoteStore>;
interface Props { store: Store }

export function QuoteSettings({ store }: Props) {
  const { settings, setSettings, catalog, setCatalog, resetCatalog } = store;
  const [toast, setToast] = useState<string | null>(null);
  const [newTaxName, setNewTaxName] = useState('');
  const [newTaxRate, setNewTaxRate] = useState('');
  const showToast = useCallback((msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000); }, []);

  const card: React.CSSProperties = { background: v.colors.bgCard, borderRadius: v.radius.card, padding: v.card.padding };
  const label: React.CSSProperties = { ...v.typography.label, marginBottom: 6, display: 'block' };
  const input: React.CSSProperties = { width: '100%', padding: '10px 14px', fontSize: 13, border: `1px solid ${v.colors.border}`, borderRadius: v.radius.input, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', background: v.colors.bgWhite };

  const handleExport = () => {
    const blob = new Blob([JSON.stringify({ catalog, settings, version: 1 }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'stride-quote-catalog.json'; a.click();
    URL.revokeObjectURL(url); showToast('Catalog exported');
  };

  const handleImport = () => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json';
    inp.onchange = async () => {
      const file = inp.files?.[0]; if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        if (data.catalog) setCatalog(data.catalog);
        if (data.settings) setSettings(data.settings);
        showToast('Catalog imported');
      } catch { showToast('Invalid JSON file'); }
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

      <div style={card}>
        <div style={{ ...v.typography.cardTitle, color: v.colors.text, marginBottom: 20 }}>Company Information</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div><label style={label}>COMPANY NAME</label><input value={settings.companyName} onChange={e => setSettings(p => ({ ...p, companyName: e.target.value }))} style={input} /></div>
          <div><label style={label}>PHONE</label><input value={settings.companyPhone} onChange={e => setSettings(p => ({ ...p, companyPhone: e.target.value }))} style={input} /></div>
          <div style={{ gridColumn: '1 / -1' }}><label style={label}>ADDRESS</label><input value={settings.companyAddress} onChange={e => setSettings(p => ({ ...p, companyAddress: e.target.value }))} style={input} /></div>
          <div><label style={label}>EMAIL</label><input value={settings.companyEmail} onChange={e => setSettings(p => ({ ...p, companyEmail: e.target.value }))} style={input} /></div>
        </div>
      </div>

      <div style={card}>
        <div style={{ ...v.typography.cardTitle, color: v.colors.text, marginBottom: 20 }}>Tax Areas</div>
        {catalog.taxAreas.map(ta => (
          <div key={ta.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: `1px solid ${v.colors.border}` }}>
            <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{ta.name}</span>
            <span style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums', color: v.colors.textSecondary }}>{ta.rate}%</span>
            <button onClick={() => store.deleteTaxArea(ta.id)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: v.colors.statusDeclined.text, padding: 4 }}><Trash2 size={14} /></button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <input value={newTaxName} onChange={e => setNewTaxName(e.target.value)} placeholder="Area name" style={{ ...input, flex: 1 }} />
          <input type="number" step="0.01" value={newTaxRate} onChange={e => setNewTaxRate(e.target.value)} placeholder="Rate %" style={{ ...input, width: 90 }} />
          <button onClick={() => {
            if (!newTaxName.trim() || !newTaxRate) return;
            store.addTaxArea({ id: newTaxName.toLowerCase().replace(/\s+/g, '_'), name: newTaxName.trim(), rate: parseFloat(newTaxRate) || 0 });
            setNewTaxName(''); setNewTaxRate('');
          }} style={{ ...v.typography.buttonPrimary, padding: '10px 20px', border: 'none', borderRadius: v.radius.button, background: v.colors.accent, color: v.colors.textOnDark, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
            <Plus size={13} /> ADD
          </button>
        </div>
      </div>

      <div style={card}>
        <div style={{ ...v.typography.cardTitle, color: v.colors.text, marginBottom: 20 }}>Quote Defaults</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
          <div><label style={label}>EXPIRATION (DAYS)</label><input type="number" min={1} value={settings.defaultExpirationDays} onChange={e => setSettings(p => ({ ...p, defaultExpirationDays: parseInt(e.target.value) || 30 }))} style={input} /></div>
          <div><label style={label}>STORAGE (MONTHS)</label><input type="number" min={0} value={settings.defaultStorageMonths} onChange={e => setSettings(p => ({ ...p, defaultStorageMonths: parseInt(e.target.value) || 0 }))} style={input} /></div>
          <div><label style={label}>PREFIX</label><input value={settings.quotePrefix} onChange={e => setSettings(p => ({ ...p, quotePrefix: e.target.value.toUpperCase() }))} style={input} /></div>
        </div>
      </div>

      <div style={card}>
        <div style={{ ...v.typography.cardTitle, color: v.colors.text, marginBottom: 20 }}>Data Management</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button onClick={handleExport} style={ghostBtn}><Download size={13} /> EXPORT</button>
          <button onClick={handleImport} style={ghostBtn}><Upload size={13} /> IMPORT</button>
          <button onClick={() => { if (confirm('Reset catalog to defaults?')) { resetCatalog(); showToast('Catalog reset'); } }}
            style={{ ...ghostBtn, borderColor: v.colors.statusDeclined.text + '40', color: v.colors.statusDeclined.text }}>
            <RotateCcw size={13} /> RESET DEFAULTS
          </button>
        </div>
      </div>
    </div>
  );
}
