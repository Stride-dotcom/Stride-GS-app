/**
 * ServiceEditPanel — slide-out editor for a service_catalog row.
 *
 * Opens from the right side. All fields are editable. Save writes through
 * useServiceCatalog.updateService, which inserts one audit row per changed
 * field. Delete is two-step (click Delete, then confirm).
 */
import { useEffect, useMemo, useState } from 'react';
import { X, Trash2, History } from 'lucide-react';
import { theme } from '../../styles/theme';
import type {
  CatalogService, UpdateServiceInput, ServiceCategory, ServiceBilling,
  ServiceUnit, AutoApplyRule, ServicePriority, CatalogAuditEntry,
} from '../../hooks/useServiceCatalog';

const CATEGORIES: ServiceCategory[] = ['Warehouse','Storage','Shipping','Assembly','Repair','Labor','Admin','Delivery'];
const UNITS: ServiceUnit[]           = ['per_item','per_day','per_task','per_hour'];
const BILLINGS: ServiceBilling[]     = ['class_based','flat'];
const AUTO_RULES: AutoApplyRule[]    = ['overweight','no_id','fragile','oversized'];
const PRIORITIES: ServicePriority[]  = ['Normal','High'];
const CLASSES = ['XS','S','M','L','XL'] as const;

interface ServiceEditPanelProps {
  service: CatalogService;
  onClose: () => void;
  onSave: (id: string, updates: UpdateServiceInput) => Promise<CatalogService | null>;
  onDelete: (id: string) => Promise<boolean>;
  onGetAudit: (serviceId: string) => Promise<CatalogAuditEntry[]>;
}

export function ServiceEditPanel({ service, onClose, onSave, onDelete, onGetAudit }: ServiceEditPanelProps) {
  const v2 = theme.v2;

  // Local editable copy — reset when switching services.
  const [draft, setDraft] = useState<CatalogService>(service);
  useEffect(() => { setDraft(service); }, [service]);

  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const [audit, setAudit] = useState<CatalogAuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  // Close confirm state if user navigates away
  useEffect(() => { setConfirmDelete(false); }, [service.id]);

  const isDirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(service), [draft, service]);

  const handleSave = async () => {
    if (!isDirty) { onClose(); return; }
    setSaving(true);
    const updates: UpdateServiceInput = {
      code: draft.code,
      name: draft.name,
      category: draft.category,
      billing: draft.billing,
      rates: draft.rates,
      flatRate: draft.flatRate,
      unit: draft.unit,
      taxable: draft.taxable,
      active: draft.active,
      showInMatrix: draft.showInMatrix,
      showAsTask: draft.showAsTask,
      showAsDeliveryService: draft.showAsDeliveryService,
      showAsReceivingAddon: draft.showAsReceivingAddon,
      autoApplyRule: draft.autoApplyRule,
      defaultSlaHours: draft.defaultSlaHours,
      defaultPriority: draft.defaultPriority,
      hasDedicatedPage: draft.hasDedicatedPage,
      displayOrder: draft.displayOrder,
    };
    const saved = await onSave(service.id, updates);
    setSaving(false);
    if (saved) onClose();
  };

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    const ok = await onDelete(service.id);
    if (ok) onClose();
  };

  const handleShowAudit = async () => {
    setShowAudit(true);
    setAuditLoading(true);
    const rows = await onGetAudit(service.id);
    setAudit(rows);
    setAuditLoading(false);
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

  const sectionStyle: React.CSSProperties = {
    marginBottom: 24,
    paddingBottom: 24,
    borderBottom: `1px solid ${v2.colors.border}`,
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)',
          zIndex: 1000, animation: 'fadeIn 0.15s ease',
        }}
      />
      {/* Panel */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(560px, 100vw)',
        background: v2.colors.bgPage, zIndex: 1001, overflowY: 'auto',
        boxShadow: '-8px 0 32px rgba(0,0,0,0.12)',
        fontFamily: theme.typography.fontFamily,
        animation: 'slideInRight 0.2s ease',
      }}>
        {/* Header */}
        <div style={{
          position: 'sticky', top: 0, zIndex: 2,
          background: v2.colors.bgPage,
          padding: '20px 28px',
          borderBottom: `1px solid ${v2.colors.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ ...v2.typography.label, marginBottom: 2 }}>{service.code}</div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 500, color: v2.colors.text }}>
              Edit service
            </h2>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleShowAudit}
              title="View change history"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 36, height: 36, borderRadius: v2.radius.input,
                background: 'transparent', border: `1px solid ${v2.colors.border}`,
                cursor: 'pointer', color: v2.colors.textSecondary,
              }}
            >
              <History size={16} />
            </button>
            <button
              onClick={onClose}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 36, height: 36, borderRadius: v2.radius.input,
                background: 'transparent', border: `1px solid ${v2.colors.border}`,
                cursor: 'pointer', color: v2.colors.textSecondary,
              }}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '28px' }}>
          {/* Identity */}
          <div style={sectionStyle}>
            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12 }}>
              <div>
                <label style={labelStyle}>Code</label>
                <input
                  style={{ ...inputStyle, textTransform: 'uppercase' }}
                  value={draft.code}
                  onChange={e => setDraft({ ...draft, code: e.target.value.toUpperCase() })}
                />
              </div>
              <div>
                <label style={labelStyle}>Name</label>
                <input
                  style={inputStyle}
                  value={draft.name}
                  onChange={e => setDraft({ ...draft, name: e.target.value })}
                />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
              <div>
                <label style={labelStyle}>Category</label>
                <select
                  style={inputStyle}
                  value={draft.category}
                  onChange={e => setDraft({ ...draft, category: e.target.value as ServiceCategory })}
                >
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Display order</label>
                <input
                  type="number"
                  style={inputStyle}
                  value={draft.displayOrder}
                  onChange={e => setDraft({ ...draft, displayOrder: Number(e.target.value) || 0 })}
                />
              </div>
            </div>
          </div>

          {/* Billing */}
          <div style={sectionStyle}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={labelStyle}>Billing</label>
                <select
                  style={inputStyle}
                  value={draft.billing}
                  onChange={e => setDraft({ ...draft, billing: e.target.value as ServiceBilling })}
                >
                  {BILLINGS.map(b => <option key={b} value={b}>{b === 'class_based' ? 'Class-based' : 'Flat rate'}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Unit</label>
                <select
                  style={inputStyle}
                  value={draft.unit}
                  onChange={e => setDraft({ ...draft, unit: e.target.value as ServiceUnit })}
                >
                  {UNITS.map(u => <option key={u} value={u}>{u.replace('per_', 'per ')}</option>)}
                </select>
              </div>
            </div>

            {draft.billing === 'class_based' ? (
              <div style={{ marginTop: 16 }}>
                <label style={labelStyle}>Class rates ($)</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
                  {CLASSES.map(cls => (
                    <div key={cls}>
                      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '1px', color: v2.colors.textMuted, marginBottom: 4, textAlign: 'center' }}>{cls}</div>
                      <input
                        type="number"
                        step="0.01"
                        style={{ ...inputStyle, textAlign: 'center' }}
                        value={draft.rates[cls] ?? 0}
                        onChange={e => setDraft({ ...draft, rates: { ...draft.rates, [cls]: Number(e.target.value) || 0 } })}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 16 }}>
                <label style={labelStyle}>Flat rate ($)</label>
                <input
                  type="number"
                  step="0.01"
                  style={inputStyle}
                  value={draft.flatRate}
                  onChange={e => setDraft({ ...draft, flatRate: Number(e.target.value) || 0 })}
                />
              </div>
            )}

            <div style={{ marginTop: 16, display: 'flex', gap: 20 }}>
              <ToggleRow
                label="Taxable"
                checked={draft.taxable}
                onChange={v => setDraft({ ...draft, taxable: v })}
              />
              <ToggleRow
                label="Active"
                checked={draft.active}
                onChange={v => setDraft({ ...draft, active: v })}
              />
            </div>
          </div>

          {/* Surface flags */}
          <div style={sectionStyle}>
            <label style={{ ...labelStyle, marginBottom: 10 }}>Where this service appears</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <ToggleRow
                label="Quote pricing matrix"
                checked={draft.showInMatrix}
                onChange={v => setDraft({ ...draft, showInMatrix: v })}
              />
              <ToggleRow
                label="Selectable as a task type"
                checked={draft.showAsTask}
                onChange={v => setDraft({ ...draft, showAsTask: v })}
              />
              <ToggleRow
                label="Selectable as a delivery service"
                checked={draft.showAsDeliveryService}
                onChange={v => setDraft({ ...draft, showAsDeliveryService: v })}
              />
              <ToggleRow
                label="Shown as a Receiving add-on"
                checked={draft.showAsReceivingAddon}
                onChange={v => setDraft({ ...draft, showAsReceivingAddon: v })}
              />
              <ToggleRow
                label="Has its own dedicated page"
                checked={draft.hasDedicatedPage}
                onChange={v => setDraft({ ...draft, hasDedicatedPage: v })}
              />
            </div>
          </div>

          {/* Task defaults */}
          <div style={sectionStyle}>
            <label style={{ ...labelStyle, marginBottom: 10 }}>Task defaults (when used as task)</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={labelStyle}>Default SLA (hours)</label>
                <input
                  type="number"
                  style={inputStyle}
                  value={draft.defaultSlaHours ?? ''}
                  placeholder="e.g. 48"
                  onChange={e => {
                    const raw = e.target.value;
                    setDraft({ ...draft, defaultSlaHours: raw === '' ? null : (Number(raw) || 0) });
                  }}
                />
              </div>
              <div>
                <label style={labelStyle}>Default priority</label>
                <select
                  style={inputStyle}
                  value={draft.defaultPriority ?? ''}
                  onChange={e => setDraft({ ...draft, defaultPriority: (e.target.value || null) as ServicePriority | null })}
                >
                  <option value="">None</option>
                  {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Auto-apply */}
          <div style={{ ...sectionStyle, borderBottom: 'none' }}>
            <label style={labelStyle}>Auto-apply rule</label>
            <select
              style={inputStyle}
              value={draft.autoApplyRule ?? ''}
              onChange={e => setDraft({ ...draft, autoApplyRule: (e.target.value || null) as AutoApplyRule | null })}
            >
              <option value="">None (manual only)</option>
              {AUTO_RULES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <div style={{ fontSize: 11, color: v2.colors.textMuted, marginTop: 6, lineHeight: 1.4 }}>
              Trigger this service automatically during Receiving when the item matches the selected condition.
            </div>
          </div>
        </div>

        {/* Footer actions */}
        <div style={{
          position: 'sticky', bottom: 0, zIndex: 2,
          background: v2.colors.bgPage,
          borderTop: `1px solid ${v2.colors.border}`,
          padding: '16px 28px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        }}>
          <button
            onClick={handleDelete}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '10px 16px', borderRadius: v2.radius.button,
              background: confirmDelete ? '#B45A5A' : 'transparent',
              border: `1px solid ${confirmDelete ? '#B45A5A' : 'rgba(180,90,90,0.3)'}`,
              color: confirmDelete ? '#fff' : '#B45A5A',
              cursor: 'pointer', fontSize: 11, fontWeight: 600, letterSpacing: '1.5px',
              textTransform: 'uppercase', fontFamily: 'inherit',
            }}
          >
            <Trash2 size={13} />
            {confirmDelete ? 'Confirm delete' : 'Delete'}
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
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
              onClick={handleSave}
              disabled={saving || !isDirty}
              style={{
                padding: '10px 24px', borderRadius: v2.radius.button,
                background: isDirty ? v2.colors.accent : v2.colors.border,
                border: 'none',
                color: isDirty ? '#fff' : v2.colors.textMuted,
                cursor: isDirty && !saving ? 'pointer' : 'not-allowed',
                fontSize: 11, fontWeight: 600, letterSpacing: '1.5px',
                textTransform: 'uppercase', fontFamily: 'inherit',
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      </div>

      {/* Audit log sub-panel */}
      {showAudit && (
        <AuditPanel
          entries={audit}
          loading={auditLoading}
          onClose={() => setShowAudit(false)}
        />
      )}

      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
      `}</style>
    </>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  const v2 = theme.v2;
  return (
    <label style={{
      display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
      fontSize: 13, color: v2.colors.text, userSelect: 'none',
    }}>
      <div
        onClick={() => onChange(!checked)}
        style={{
          position: 'relative',
          width: 34, height: 20,
          background: checked ? v2.colors.accent : '#D4D0CA',
          borderRadius: 100,
          transition: 'background 0.15s',
          flexShrink: 0,
        }}
      >
        <div style={{
          position: 'absolute', top: 2, left: checked ? 16 : 2,
          width: 16, height: 16, borderRadius: '50%',
          background: '#fff',
          transition: 'left 0.15s',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        }} />
      </div>
      <span>{label}</span>
    </label>
  );
}

function AuditPanel({ entries, loading, onClose }: { entries: CatalogAuditEntry[]; loading: boolean; onClose: () => void }) {
  const v2 = theme.v2;
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.25)', zIndex: 1002 }} />
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(480px, 100vw)',
        background: v2.colors.bgPage, zIndex: 1003, overflowY: 'auto',
        boxShadow: '-8px 0 32px rgba(0,0,0,0.15)',
        fontFamily: theme.typography.fontFamily,
      }}>
        <div style={{
          position: 'sticky', top: 0, background: v2.colors.bgPage, padding: '20px 28px',
          borderBottom: `1px solid ${v2.colors.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 500, color: v2.colors.text }}>Change history</h3>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', cursor: 'pointer', padding: 6,
            color: v2.colors.textSecondary, display: 'flex',
          }}>
            <X size={16} />
          </button>
        </div>
        <div style={{ padding: '20px 28px' }}>
          {loading ? (
            <div style={{ color: v2.colors.textMuted, fontSize: 13 }}>Loading…</div>
          ) : entries.length === 0 ? (
            <div style={{ color: v2.colors.textMuted, fontSize: 13 }}>No changes recorded yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {entries.map(e => (
                <div key={e.id} style={{
                  background: v2.colors.bgWhite,
                  border: `1px solid ${v2.colors.border}`,
                  borderRadius: v2.radius.input,
                  padding: '12px 14px',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: v2.colors.accent, letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                      {e.fieldChanged}
                    </span>
                    <span style={{ fontSize: 11, color: v2.colors.textMuted }}>
                      {new Date(e.changedAt).toLocaleString()}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: v2.colors.text, wordBreak: 'break-word' }}>
                    <span style={{ color: v2.colors.textMuted }}>{e.oldValue || '—'}</span>
                    <span style={{ margin: '0 6px', color: v2.colors.textMuted }}>→</span>
                    <span style={{ fontWeight: 500 }}>{e.newValue || '—'}</span>
                  </div>
                  {e.changedByName && (
                    <div style={{ fontSize: 10, color: v2.colors.textMuted, marginTop: 4 }}>
                      by {e.changedByName}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
