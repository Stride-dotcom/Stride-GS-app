import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { theme } from '../../styles/theme';
import type { ServiceDef, ServiceCategory, ServiceUnit, ServiceBilling } from '../../lib/quoteTypes';

const v = theme.v2;

interface Props {
  service: ServiceDef | null;
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
  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); if (!form.code.trim() || !form.name.trim()) return; onSave(form); };

  const label: React.CSSProperties = { ...v.typography.label, marginBottom: 6, display: 'block' };
  const input: React.CSSProperties = { width: '100%', padding: '10px 14px', fontSize: 13, border: `1px solid ${v.colors.border}`, borderRadius: v.radius.input, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', background: v.colors.bgWhite };

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: v.colors.bgPage, borderRadius: v.radius.card, width: '100%', maxWidth: 520, maxHeight: '90vh', overflow: 'auto', boxShadow: '0 24px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 28px', borderBottom: `1px solid ${v.colors.border}` }}>
          <span style={{ ...v.typography.cardTitle }}>{isNew ? 'Add Service' : 'Edit Service'}</span>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: v.colors.textMuted }}><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} style={{ padding: '24px 28px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 20 }}>
            <div><label style={label}>CODE</label><input value={form.code} onChange={e => patch({ code: e.target.value.toUpperCase() })} style={input} required /></div>
            <div><label style={label}>NAME</label><input value={form.name} onChange={e => patch({ name: e.target.value })} style={input} required /></div>
            <div>
              <label style={label}>CATEGORY</label>
              <select value={form.category} onChange={e => patch({ category: e.target.value as ServiceCategory })} style={{ ...input, cursor: 'pointer' }}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={label}>UNIT</label>
              <select value={form.unit} onChange={e => patch({ unit: e.target.value as ServiceUnit })} style={{ ...input, cursor: 'pointer' }}>
                {UNITS.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
              </select>
            </div>
            <div>
              <label style={label}>BILLING</label>
              <select value={form.billing} onChange={e => patch({ billing: e.target.value as ServiceBilling })} style={{ ...input, cursor: 'pointer' }}>
                <option value="flat">Flat Rate</option><option value="class_based">Class-Based Rates</option>
              </select>
            </div>
            {form.billing === 'flat' && (
              <div><label style={label}>FLAT RATE ($)</label><input type="number" step="0.01" value={form.flatRate} onChange={e => patch({ flatRate: parseFloat(e.target.value) || 0 })} style={input} /></div>
            )}
          </div>

          {form.billing === 'class_based' && (
            <div style={{ marginBottom: 20 }}>
              <label style={label}>CLASS RATES</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
                {(['XS', 'S', 'M', 'L', 'XL'] as const).map(cls => (
                  <div key={cls}>
                    <div style={{ ...v.typography.label, textAlign: 'center', marginBottom: 4 }}>{cls}</div>
                    <input type="number" step="0.01" value={form.rates[cls]}
                      onChange={e => patch({ rates: { ...form.rates, [cls]: parseFloat(e.target.value) || 0 } })}
                      style={{ ...input, textAlign: 'center', padding: '8px' }} />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 20, marginBottom: 20, flexWrap: 'wrap' }}>
            {[
              { key: 'taxable', label: 'Taxable' }, { key: 'isStorage', label: 'Storage' },
              { key: 'showInMatrix', label: 'Show in Matrix' }, { key: 'active', label: 'Active' },
            ].map(opt => (
              <label key={opt.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={form[opt.key as keyof ServiceDef] as boolean}
                  onChange={e => patch({ [opt.key]: e.target.checked, ...(opt.key === 'showInMatrix' && e.target.checked ? { matrixOrder: 10 } : {}) } as Partial<ServiceDef>)}
                  style={{ accentColor: v.colors.accent }} />
                {opt.label}
              </label>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={{
              ...v.typography.buttonPrimary, padding: '10px 20px', border: `1px solid ${v.colors.border}`,
              borderRadius: v.radius.button, background: v.colors.bgWhite, cursor: 'pointer', fontFamily: 'inherit', color: v.colors.text,
            }}>CANCEL</button>
            <button type="submit" style={{
              ...v.typography.buttonPrimary, padding: '10px 24px', border: 'none',
              borderRadius: v.radius.button, background: v.colors.accent, color: v.colors.textOnDark, cursor: 'pointer', fontFamily: 'inherit',
            }}>{isNew ? 'ADD SERVICE' : 'SAVE CHANGES'}</button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
