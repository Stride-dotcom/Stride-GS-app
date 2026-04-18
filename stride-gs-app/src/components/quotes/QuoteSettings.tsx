import { useState, useCallback } from 'react';
import { Plus, Trash2, RotateCcw, Download, Upload } from 'lucide-react';
import { theme } from '../../styles/theme';
import type { useQuoteStore } from '../../hooks/useQuoteStore';

type Store = ReturnType<typeof useQuoteStore>;

interface Props {
  store: Store;
}

export function QuoteSettings({ store }: Props) {
  const { settings, setSettings, catalog, setCatalog, resetCatalog } = store;
  const [toast, setToast] = useState<string | null>(null);
  const [newTaxName, setNewTaxName] = useState('');
  const [newTaxRate, setNewTaxRate] = useState('');

  const showToast = useCallback((msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000); }, []);

  const card: React.CSSProperties = { background: '#fff', border: `1px solid ${theme.colors.border}`, borderRadius: 12, padding: 20 };
  const label: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: theme.colors.textSecondary, display: 'block', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.5px' };
  const input: React.CSSProperties = { width: '100%', padding: '8px 10px', fontSize: 13, border: `1px solid ${theme.colors.border}`, borderRadius: 8, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' };

  const handleExport = () => {
    const data = { catalog, settings, version: 1 };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'stride-quote-catalog.json'; a.click();
    URL.revokeObjectURL(url);
    showToast('Catalog exported');
  };

  const handleImport = () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json';
    inp.onchange = async () => {
      const file = inp.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (data.catalog) setCatalog(data.catalog);
        if (data.settings) setSettings(data.settings);
        showToast('Catalog imported');
      } catch { showToast('Invalid JSON file'); }
    };
    inp.click();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 700 }}>
      {toast && (
        <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 500, padding: '10px 16px', borderRadius: 10, background: '#F0FDF4', border: '1px solid #A7F3D0', color: '#15803D', fontSize: 13, fontWeight: 500, boxShadow: '0 4px 16px rgba(0,0,0,0.1)', fontFamily: theme.typography.fontFamily }}>{toast}</div>
      )}

      {/* Company Info */}
      <div style={card}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Company Information</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div><label style={label}>Company Name</label><input value={settings.companyName} onChange={e => setSettings(p => ({ ...p, companyName: e.target.value }))} style={input} /></div>
          <div><label style={label}>Phone</label><input value={settings.companyPhone} onChange={e => setSettings(p => ({ ...p, companyPhone: e.target.value }))} style={input} /></div>
          <div style={{ gridColumn: '1 / -1' }}><label style={label}>Address</label><input value={settings.companyAddress} onChange={e => setSettings(p => ({ ...p, companyAddress: e.target.value }))} style={input} /></div>
          <div><label style={label}>Email</label><input value={settings.companyEmail} onChange={e => setSettings(p => ({ ...p, companyEmail: e.target.value }))} style={input} /></div>
        </div>
      </div>

      {/* Tax Areas */}
      <div style={card}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Tax Areas</div>
        {catalog.taxAreas.map(ta => (
          <div key={ta.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: `1px solid ${theme.colors.border}` }}>
            <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{ta.name}</span>
            <span style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums', color: theme.colors.textSecondary }}>{ta.rate}%</span>
            <button onClick={() => store.deleteTaxArea(ta.id)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#DC2626', padding: 4 }}><Trash2 size={13} /></button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <input value={newTaxName} onChange={e => setNewTaxName(e.target.value)} placeholder="Area name" style={{ ...input, flex: 1 }} />
          <input type="number" step="0.01" value={newTaxRate} onChange={e => setNewTaxRate(e.target.value)} placeholder="Rate %" style={{ ...input, width: 80 }} />
          <button onClick={() => {
            if (!newTaxName.trim() || !newTaxRate) return;
            store.addTaxArea({ id: newTaxName.toLowerCase().replace(/\s+/g, '_'), name: newTaxName.trim(), rate: parseFloat(newTaxRate) || 0 });
            setNewTaxName(''); setNewTaxRate('');
          }} style={{ padding: '6px 12px', border: 'none', borderRadius: 6, background: theme.colors.orange, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
            <Plus size={12} /> Add
          </button>
        </div>
      </div>

      {/* Defaults */}
      <div style={card}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Quote Defaults</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <div><label style={label}>Expiration (days)</label><input type="number" min={1} value={settings.defaultExpirationDays} onChange={e => setSettings(p => ({ ...p, defaultExpirationDays: parseInt(e.target.value) || 30 }))} style={input} /></div>
          <div><label style={label}>Storage (months)</label><input type="number" min={0} value={settings.defaultStorageMonths} onChange={e => setSettings(p => ({ ...p, defaultStorageMonths: parseInt(e.target.value) || 0 }))} style={input} /></div>
          <div><label style={label}>Prefix</label><input value={settings.quotePrefix} onChange={e => setSettings(p => ({ ...p, quotePrefix: e.target.value.toUpperCase() }))} style={input} /></div>
        </div>
      </div>

      {/* Import / Export / Reset */}
      <div style={card}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Data Management</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={handleExport} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', fontSize: 12, fontWeight: 600, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>
            <Download size={13} /> Export Catalog
          </button>
          <button onClick={handleImport} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', fontSize: 12, fontWeight: 600, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>
            <Upload size={13} /> Import Catalog
          </button>
          <button onClick={() => { if (confirm('Reset catalog to defaults? This replaces all services, tax areas, and coverage options.')) { resetCatalog(); showToast('Catalog reset'); } }}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', fontSize: 12, fontWeight: 600, border: `1px solid #FECACA`, borderRadius: 8, background: '#FEF2F2', color: '#DC2626', cursor: 'pointer', fontFamily: 'inherit' }}>
            <RotateCcw size={13} /> Reset to Defaults
          </button>
        </div>
      </div>
    </div>
  );
}
