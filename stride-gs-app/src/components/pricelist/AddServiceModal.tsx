/**
 * AddServiceModal — create a new service_catalog row.
 *
 * Minimal required fields: code, name, category, billing, unit.
 * Rates default to zeros; admin can fine-tune in the edit panel after.
 */
import { useState } from 'react';
import { X } from 'lucide-react';
import { theme } from '../../styles/theme';
import type {
  NewServiceInput, ServiceCategory, ServiceBilling, ServiceUnit,
} from '../../hooks/useServiceCatalog';

const CATEGORIES: ServiceCategory[] = ['Warehouse','Storage','Shipping','Assembly','Repair','Labor','Admin','Delivery'];
const UNITS: ServiceUnit[]           = ['per_item','per_day','per_task','per_hour'];
const BILLINGS: ServiceBilling[]     = ['class_based','flat'];

interface AddServiceModalProps {
  existingCodes: Set<string>;
  nextDisplayOrder: number;
  onClose: () => void;
  onCreate: (input: NewServiceInput) => Promise<unknown>;
}

export function AddServiceModal({ existingCodes, nextDisplayOrder, onClose, onCreate }: AddServiceModalProps) {
  const v2 = theme.v2;
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState<ServiceCategory>('Warehouse');
  const [billing, setBilling] = useState<ServiceBilling>('flat');
  const [unit, setUnit] = useState<ServiceUnit>('per_item');
  const [flatRate, setFlatRate] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedCode = code.trim().toUpperCase();
  const codeTaken = existingCodes.has(trimmedCode);
  const canSubmit = trimmedCode.length > 0 && name.trim().length > 0 && !codeTaken && !saving;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    const input: NewServiceInput = {
      code: trimmedCode,
      name: name.trim(),
      category,
      billing,
      rates: billing === 'class_based' ? { XS: 0, S: 0, M: 0, L: 0, XL: 0, XXL: 0 } : {},
      xxlRate: 0,
      flatRate: billing === 'flat' ? flatRate : 0,
      unit,
      taxable: true,
      active: true,
      showInMatrix: false,
      showAsTask: false,
      showAsDeliveryService: false,
      showAsReceivingAddon: false,
      autoApplyRule: null,
      defaultSlaHours: null,
      defaultPriority: null,
      hasDedicatedPage: false,
      displayOrder: nextDisplayOrder,
      billIfPass: true,
      billIfFail: true,
      times: {},
    };
    const created = await onCreate(input);
    setSaving(false);
    if (created) onClose();
    else setError('Failed to create service. Check the console for details.');
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    background: v2.colors.bgWhite,
    border: `1px solid ${v2.colors.border}`,
    borderRadius: v2.radius.input,
    padding: '10px 14px',
    fontSize: 13,
    color: v2.colors.text,
    fontFamily: 'inherit',
    boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    ...v2.typography.label,
    display: 'block',
    marginBottom: 6,
  };

  return (
    <>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 1000,
      }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: 'min(520px, 90vw)', maxHeight: '90vh', overflowY: 'auto',
        background: v2.colors.bgPage, zIndex: 1001, borderRadius: v2.radius.card,
        boxShadow: '0 16px 48px rgba(0,0,0,0.2)',
        fontFamily: theme.typography.fontFamily,
      }}>
        {/* Header */}
        <div style={{
          padding: '20px 28px',
          borderBottom: `1px solid ${v2.colors.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 500, color: v2.colors.text }}>
            Add service
          </h2>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', cursor: 'pointer', padding: 6,
            display: 'flex', color: v2.colors.textSecondary,
          }}>
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '24px 28px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>Code *</label>
              <input
                autoFocus
                style={{ ...inputStyle, textTransform: 'uppercase', borderColor: codeTaken ? '#B45A5A' : v2.colors.border }}
                value={code}
                placeholder="RUSH"
                onChange={e => setCode(e.target.value.toUpperCase())}
              />
              {codeTaken && (
                <div style={{ fontSize: 11, color: '#B45A5A', marginTop: 4 }}>Already in use</div>
              )}
            </div>
            <div>
              <label style={labelStyle}>Name *</label>
              <input
                style={inputStyle}
                value={name}
                placeholder="Rush Processing Fee"
                onChange={e => setName(e.target.value)}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 16 }}>
            <div>
              <label style={labelStyle}>Category</label>
              <select style={inputStyle} value={category} onChange={e => setCategory(e.target.value as ServiceCategory)}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Unit</label>
              <select style={inputStyle} value={unit} onChange={e => setUnit(e.target.value as ServiceUnit)}>
                {UNITS.map(u => <option key={u} value={u}>{u.replace('per_', 'per ')}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 16 }}>
            <div>
              <label style={labelStyle}>Billing</label>
              <select style={inputStyle} value={billing} onChange={e => setBilling(e.target.value as ServiceBilling)}>
                {BILLINGS.map(b => <option key={b} value={b}>{b === 'class_based' ? 'Class-based' : 'Flat rate'}</option>)}
              </select>
            </div>
            {billing === 'flat' && (
              <div>
                <label style={labelStyle}>Flat rate ($)</label>
                <input
                  type="number"
                  step="0.01"
                  style={inputStyle}
                  value={flatRate}
                  onChange={e => setFlatRate(Number(e.target.value) || 0)}
                />
              </div>
            )}
          </div>

          <div style={{ marginTop: 20, fontSize: 12, color: v2.colors.textMuted, lineHeight: 1.4 }}>
            You can set class rates, surface flags, SLA defaults, and the auto-apply rule after creating the service.
          </div>

          {error && (
            <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(180,90,90,0.1)', color: '#B45A5A', borderRadius: v2.radius.input, fontSize: 12 }}>
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '16px 28px',
          borderTop: `1px solid ${v2.colors.border}`,
          display: 'flex', justifyContent: 'flex-end', gap: 8,
        }}>
          <button
            onClick={onClose}
            style={{
              padding: '10px 20px', borderRadius: v2.radius.button,
              background: 'transparent', border: `1px solid ${v2.colors.border}`,
              color: v2.colors.textSecondary,
              cursor: 'pointer', fontSize: 11, fontWeight: 600, letterSpacing: '1.5px',
              textTransform: 'uppercase', fontFamily: 'inherit',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            style={{
              padding: '10px 24px', borderRadius: v2.radius.button,
              background: canSubmit ? v2.colors.accent : v2.colors.border,
              border: 'none',
              color: canSubmit ? '#fff' : v2.colors.textMuted,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
              fontSize: 11, fontWeight: 600, letterSpacing: '1.5px',
              textTransform: 'uppercase', fontFamily: 'inherit',
            }}
          >
            {saving ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </>
  );
}
