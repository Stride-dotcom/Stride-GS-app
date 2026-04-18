import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { theme } from '../../styles/theme';
import type { ServiceDef, ServiceCategory, ServiceUnit, ServiceBilling } from '../../lib/quoteTypes';

interface Props {
  service: ServiceDef | null; // null = new
  onSave: (svc: ServiceDef) => void;
  onClose: () => void;
}

const CATEGORIES: ServiceCategory[] = ['Warehouse', 'Storage', 'Shipping', 'Assembly', 'Repair', 'Labor', 'Admin'];
const UNITS: { value: ServiceUnit; label: string }[] = [
  { value: 'per_item', label: 'Per Item' }, { value: 'per_day', label: 'Per Day' },
  { value: 'per_task', label: 'Per Task' }, { value: 'per_hour', label: 'Per Hour' },
];

export function QuoteServiceModal({ service, onSave, onClose }: Props) {
  const isNew = !service;
  const [form, setForm] = useState<ServiceDef>(service ?? {
    id: crypto.randomUUID(), code: '', name: '', category: 'Warehouse',
    unit: 'per_item', billing: 'flat', isStorage: false, taxable: true,
    active: true, flatRate: 0, rates: { XS: 0, S: 0, M: 0, L: 0, XL: 0 },
    showInMatrix: false, matrixOrder: 999,
  });

  const patch = (p: Partial<ServiceDef>) => setForm(prev => ({ ...prev, ...p }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.code.trim() || !form.name.trim()) return;
    onSave(form);
  };

  const label: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: theme.colors.textSecondary, display: 'block', marginBottom: 3 };
  const input: React.CSSProperties = { width: '100%', padding: '8px 10px', fontSize: 13, border: `1px solid ${theme.colors.border}`, borderRadius: 8, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' };

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 520, maxHeight: '90vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: `1px solid ${theme.colors.border}` }}>
          <span style={{ fontSize: 16, fontWeight: 700 }}>{isNew ? 'Add Service' : 'Edit Service'}</span>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: theme.colors.textMuted }}><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} style={{ padding: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div><label style={label}>Code</label><input value={form.code} onChange={e => patch({ code: e.target.value.toUpperCase() })} style={input} required /></div>
            <div><label style={label}>Name</label><input value={form.name} onChange={e => patch({ name: e.target.value })} style={input} required /></div>
            <div>
              <label style={label}>Category</label>
              <select value={form.category} onChange={e => patch({ category: e.target.value as ServiceCategory })} style={{ ...input, cursor: 'pointer' }}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={label}>Unit</label>
              <select value={form.unit} onChange={e => patch({ unit: e.target.value as ServiceUnit })} style={{ ...input, cursor: 'pointer' }}>
                {UNITS.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
              </select>
            </div>
            <div>
              <label style={label}>Billing</label>
              <select value={form.billing} onChange={e => patch({ billing: e.target.value as ServiceBilling })} style={{ ...input, cursor: 'pointer' }}>
                <option value="flat">Flat Rate</option>
                <option value="class_based">Class-Based Rates</option>
              </select>
            </div>
            {form.billing === 'flat' && (
              <div><label style={label}>Flat Rate ($)</label><input type="number" step="0.01" value={form.flatRate} onChange={e => patch({ flatRate: parseFloat(e.target.value) || 0 })} style={input} /></div>
            )}
          </div>

          {form.billing === 'class_based' && (
            <div style={{ marginBottom: 16 }}>
              <label style={label}>Class Rates</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
                {(['XS', 'S', 'M', 'L', 'XL'] as const).map(cls => (
                  <div key={cls}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: theme.colors.textMuted, textAlign: 'center', marginBottom: 2 }}>{cls}</div>
                    <input type="number" step="0.01" value={form.rates[cls]}
                      onChange={e => patch({ rates: { ...form.rates, [cls]: parseFloat(e.target.value) || 0 } })}
                      style={{ ...input, textAlign: 'center', padding: '6px' }} />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.taxable} onChange={e => patch({ taxable: e.target.checked })} style={{ accentColor: theme.colors.orange }} /> Taxable
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.isStorage} onChange={e => patch({ isStorage: e.target.checked })} style={{ accentColor: theme.colors.orange }} /> Storage Service
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.showInMatrix} onChange={e => patch({ showInMatrix: e.target.checked, matrixOrder: e.target.checked ? 10 : 999 })} style={{ accentColor: theme.colors.orange }} /> Show in Matrix
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.active} onChange={e => patch({ active: e.target.checked })} style={{ accentColor: theme.colors.orange }} /> Active
            </label>
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={{ padding: '8px 16px', fontSize: 13, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
            <button type="submit" style={{ padding: '8px 20px', fontSize: 13, fontWeight: 600, border: 'none', borderRadius: 8, background: theme.colors.orange, color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>
              {isNew ? 'Add Service' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
