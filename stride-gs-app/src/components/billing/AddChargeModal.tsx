/**
 * AddChargeModal — staff/admin form to add (or edit) a manual billing charge.
 *
 * On create: POSTs to addManualCharge → writes a "MANUAL-..." Ledger Row to
 * the client's Billing_Ledger and to Supabase.
 * On edit:   POSTs to updateBillingRow with the same payload shape (the GAS
 * handler accepts svcCode/svcName/itemClass when the row is MANUAL-).
 */
import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { BtnSpinner } from '../ui/BtnSpinner';
import { theme } from '../../styles/theme';
import { useClients } from '../../hooks/useClients';
import { useServiceCatalog, type CatalogService } from '../../hooks/useServiceCatalog';
import { useAuth } from '../../contexts/AuthContext';
import {
  postAddManualCharge, postUpdateBillingRow,
  type AddManualChargePayload, type UpdateBillingRowPayload,
} from '../../lib/api';

const CLASSES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'] as const;
const CUSTOM_SVC_CODE = '__CUSTOM__';

export interface ManualChargeEditTarget {
  ledgerRowId: string;
  clientSheetId: string;
  clientName: string;
  svcCode: string;
  svcName: string;
  itemClass: string;
  qty: number;
  rate: number;
  description: string;
  notes: string;
  sidemark: string;
}

interface Props {
  /** When set, modal opens in EDIT mode (PATCH via updateBillingRow). */
  editing?: ManualChargeEditTarget | null;
  /** When opening in ADD mode, pre-select this client (e.g. the active filter). */
  defaultClientSheetId?: string;
  onClose: () => void;
  onSaved: (msg: string) => void;
}

export function AddChargeModal({ editing, defaultClientSheetId, onClose, onSaved }: Props) {
  const v2 = theme.v2;
  const { user } = useAuth();
  const { apiClients } = useClients();
  const { services } = useServiceCatalog();

  const isEdit = !!editing;

  const [clientSheetId, setClientSheetId] = useState<string>(
    editing?.clientSheetId ?? defaultClientSheetId ?? '',
  );
  const [serviceId, setServiceId] = useState<string>('');   // catalog row.id, or CUSTOM_SVC_CODE
  const [customCode, setCustomCode] = useState('');
  const [customName, setCustomName] = useState('');
  const [classCode, setClassCode] = useState<string>(editing?.itemClass ?? '');
  const [qty, setQty] = useState<string>(editing ? String(editing.qty) : '1');
  const [rate, setRate] = useState<string>(editing ? String(editing.rate) : '0');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [notes, setNotes] = useState(editing?.notes ?? '');
  const [sidemark, setSidemark] = useState(editing?.sidemark ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── On mount in EDIT mode: try to preselect the catalog service by code.
  //    If the existing svcCode doesn't exist in the catalog, fall back to
  //    Custom and keep the original code/name.
  useEffect(() => {
    if (!editing) return;
    const match = services.find(s => s.code === editing.svcCode);
    if (match) {
      setServiceId(match.id);
    } else {
      setServiceId(CUSTOM_SVC_CODE);
      setCustomCode(editing.svcCode);
      setCustomName(editing.svcName);
    }
  }, [editing, services]);

  const activeServices = useMemo(
    () => services.filter(s => s.active).sort((a, b) => a.code.localeCompare(b.code)),
    [services],
  );

  const selectedService: CatalogService | null = useMemo(
    () => services.find(s => s.id === serviceId) ?? null,
    [services, serviceId],
  );
  const isCustom = serviceId === CUSTOM_SVC_CODE;
  const isClassBased = !!selectedService && selectedService.billing === 'class_based';

  // When the user picks a service or changes the class, auto-fill rate from
  // the catalog. We DON'T overwrite an explicit rate if the user has been
  // typing — only run this when the source values change (not on every render).
  useEffect(() => {
    if (!selectedService) return;
    if (selectedService.billing === 'flat') {
      setRate(String(selectedService.flatRate ?? 0));
    } else if (classCode) {
      const cls = classCode as keyof typeof selectedService.rates;
      const r = selectedService.rates[cls] ?? 0;
      setRate(String(r));
    }
  }, [selectedService, classCode]);

  const numQty  = Number(qty)  || 0;
  const numRate = Number(rate) || 0;
  const total   = Math.round(numQty * numRate * 100) / 100;

  const canSave =
    !!clientSheetId &&
    !!serviceId &&
    (isCustom ? customCode.trim().length > 0 && customName.trim().length > 0 : true) &&
    numQty > 0;

  const resolvedServiceCode = isCustom ? customCode.trim().toUpperCase() : (selectedService?.code ?? '');
  const resolvedServiceName = isCustom ? customName.trim() : (selectedService?.name ?? '');

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);

    if (isEdit && editing) {
      const payload: UpdateBillingRowPayload = {
        ledgerRowId: editing.ledgerRowId,
        sidemark,
        description,
        notes,
        rate: numRate,
        qty: numQty,
        svcCode: resolvedServiceCode,
        svcName: resolvedServiceName,
        itemClass: classCode,
      };
      const res = await postUpdateBillingRow(payload, clientSheetId);
      setSaving(false);
      if (res.ok) {
        onSaved(`Charge updated — $${total.toFixed(2)} · ${resolvedServiceName}`);
        onClose();
      } else {
        setError(res.error || 'Update failed');
      }
      return;
    }

    const payload: AddManualChargePayload = {
      serviceCode: resolvedServiceCode,
      serviceName: resolvedServiceName,
      classCode,
      rate: numRate,
      quantity: numQty,
      description,
      notes,
      sidemark,
      createdBy: user?.displayName || user?.email || '',
    };
    const res = await postAddManualCharge(payload, clientSheetId);
    setSaving(false);
    if (res.ok && res.data?.success) {
      onSaved(`Charge added — $${total.toFixed(2)} · ${resolvedServiceName}`);
      onClose();
    } else {
      setError(res.error || res.data?.error || 'Failed to add charge');
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box',
    padding: '10px 14px', fontSize: 13,
    background: v2.colors.bgWhite,
    border: `1px solid ${v2.colors.border}`,
    borderRadius: v2.radius.input,
    color: v2.colors.text, fontFamily: 'inherit',
  };
  const labelStyle: React.CSSProperties = {
    ...v2.typography.label, display: 'block', marginBottom: 6,
  };

  return (
    <>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000,
      }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: 'min(560px, 92vw)', maxHeight: '92vh', overflowY: 'auto',
        background: v2.colors.bgPage, zIndex: 1001, borderRadius: v2.radius.card,
        boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        fontFamily: theme.typography.fontFamily,
      }}>
        {/* Header */}
        <div style={{
          padding: '20px 28px',
          borderBottom: `1px solid ${v2.colors.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ ...v2.typography.label, marginBottom: 4 }}>Billing</div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 500, color: v2.colors.text }}>
              {isEdit ? 'Edit Manual Charge' : 'Add Manual Charge'}
            </h2>
          </div>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', cursor: 'pointer', padding: 6,
            color: v2.colors.textSecondary, display: 'flex',
          }}>
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Client */}
          <div>
            <label style={labelStyle}>Client *</label>
            <select
              style={inputStyle}
              value={clientSheetId}
              onChange={e => setClientSheetId(e.target.value)}
              disabled={isEdit}
              title={isEdit ? 'Client cannot be changed on an existing charge' : undefined}
            >
              <option value="">Select a client…</option>
              {[...apiClients].sort((a, b) => a.name.localeCompare(b.name)).map(c => (
                <option key={c.spreadsheetId} value={c.spreadsheetId}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* Service */}
          <div>
            <label style={labelStyle}>Service *</label>
            <select
              style={inputStyle}
              value={serviceId}
              onChange={e => {
                setServiceId(e.target.value);
                // reset custom fields when switching back to a real service
                if (e.target.value !== CUSTOM_SVC_CODE) {
                  setCustomCode('');
                  setCustomName('');
                }
              }}
            >
              <option value="">Select a service…</option>
              {activeServices.map(s => (
                <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
              ))}
              <option value={CUSTOM_SVC_CODE}>— Custom (free-text) —</option>
            </select>
          </div>

          {isCustom && (
            <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 12 }}>
              <div>
                <label style={labelStyle}>Custom code *</label>
                <input
                  style={{ ...inputStyle, textTransform: 'uppercase' }}
                  value={customCode}
                  placeholder="MISC"
                  onChange={e => setCustomCode(e.target.value.toUpperCase())}
                />
              </div>
              <div>
                <label style={labelStyle}>Custom name *</label>
                <input
                  style={inputStyle}
                  value={customName}
                  placeholder="Crating material disposal"
                  onChange={e => setCustomName(e.target.value)}
                />
              </div>
            </div>
          )}

          {/* Class (class-based services only) */}
          {isClassBased && (
            <div>
              <label style={labelStyle}>Item Class</label>
              <select
                style={inputStyle}
                value={classCode}
                onChange={e => setClassCode(e.target.value)}
              >
                <option value="">— Select class —</option>
                {CLASSES.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          )}

          {/* Quantity / Rate / Total */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>Quantity *</label>
              <input
                type="number" min="0" step="1"
                style={inputStyle}
                value={qty}
                onChange={e => setQty(e.target.value)}
              />
            </div>
            <div>
              <label style={labelStyle}>Rate ($)</label>
              <input
                type="number" min="0" step="0.01"
                style={inputStyle}
                value={rate}
                onChange={e => setRate(e.target.value)}
              />
            </div>
            <div>
              <label style={labelStyle}>Total</label>
              <div style={{
                ...inputStyle,
                display: 'flex', alignItems: 'center',
                background: v2.colors.bgCard,
                fontWeight: 600, color: v2.colors.accent,
                fontVariantNumeric: 'tabular-nums',
              }}>
                ${total.toFixed(2)}
              </div>
            </div>
          </div>

          {/* Description */}
          <div>
            <label style={labelStyle}>Description</label>
            <input
              style={inputStyle}
              value={description}
              placeholder={resolvedServiceName || 'Short summary for the invoice line'}
              onChange={e => setDescription(e.target.value)}
            />
          </div>

          {/* Notes */}
          <div>
            <label style={labelStyle}>Notes</label>
            <textarea
              style={{ ...inputStyle, minHeight: 70, fontFamily: 'inherit', resize: 'vertical' }}
              value={notes}
              placeholder="e.g. 3 pallets of crating material disposed"
              onChange={e => setNotes(e.target.value)}
            />
          </div>

          {/* Sidemark */}
          <div>
            <label style={labelStyle}>Sidemark <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, fontSize: 12, color: v2.colors.textMuted }}>(optional — groups on invoices)</span></label>
            <input
              style={inputStyle}
              value={sidemark}
              onChange={e => setSidemark(e.target.value)}
            />
          </div>

          {error && (
            <div style={{
              padding: '10px 14px', borderRadius: v2.radius.input,
              background: 'rgba(180,90,90,0.1)', color: '#B45A5A', fontSize: 12,
            }}>{error}</div>
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
          >Cancel</button>
          <button
            onClick={handleSave}
            disabled={!canSave || saving}
            style={{
              padding: '10px 24px', borderRadius: v2.radius.button,
              background: canSave ? v2.colors.accent : v2.colors.border,
              border: 'none',
              color: canSave ? '#fff' : v2.colors.textMuted,
              cursor: saving ? 'progress' : (canSave ? 'pointer' : 'not-allowed'),
              fontSize: 11, fontWeight: 600, letterSpacing: '1.5px',
              textTransform: 'uppercase', fontFamily: 'inherit',
              opacity: saving ? 0.85 : 1,
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}
          >
            {saving && <BtnSpinner size={11} color="#fff" />}
            {saving ? (isEdit ? 'Saving…' : 'Adding…') : (isEdit ? 'Save Changes' : 'Add Charge')}
          </button>
        </div>
      </div>
    </>
  );
}
