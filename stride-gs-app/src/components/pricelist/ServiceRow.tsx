/**
 * ServiceRow — compact read-mode row + inline edit-mode form for one
 * service_catalog entry. Replaces the old ServiceCard + ServiceEditPanel
 * pair. Single edit-at-a-time is owned by the parent (PriceList.tsx).
 *
 * v2 2026-04-25 PST — adds a "Delivery Settings" panel that appears in
 *                     edit mode whenever the row is flagged
 *                     showAsDeliveryService (delivery_rate_unit /
 *                     visible_to_client / quote_required / description).
 *                     Service Times is also shown for delivery rows
 *                     even when billing=flat so admins can set per-class
 *                     dispatch minutes. Read-mode surfaces "Quote",
 *                     "Hidden" badges when relevant.
 *
 * v3 2026-04-25 PST — adds Stax + QB sync status badges (green dot when
 *                     a stax_item_id / qb_item_id is set, gray when not)
 *                     and an optional manual sync button (RefreshCw)
 *                     that calls onSync(id) and refreshes the badges
 *                     when the sync completes.
 */
import { useEffect, useMemo, useState } from 'react';
import { Pencil, Trash2, Clock, Truck, RefreshCw } from 'lucide-react';
import { theme } from '../../styles/theme';
import type {
  CatalogService, UpdateServiceInput, ServiceCategory, ServiceBilling,
  ServiceUnit, AutoApplyRule, ServicePriority, DeliveryRateUnit,
  ExternalSyncResult,
} from '../../hooks/useServiceCatalog';

const CATEGORIES: ServiceCategory[] = [
  'Warehouse','Storage','Shipping','Assembly','Repair','Labor','Admin','Delivery','Fabric Protection',
];
const UNITS: ServiceUnit[]           = ['per_item','per_day','per_task','per_hour'];
const BILLINGS: ServiceBilling[]     = ['class_based','flat'];
const AUTO_RULES: AutoApplyRule[]    = ['overweight','no_id','fragile','oversized'];
const PRIORITIES: ServicePriority[]  = ['Normal','High'];
const CLASSES = ['XS','S','M','L','XL','XXL'] as const;

const DELIVERY_RATE_UNITS: { value: DeliveryRateUnit; label: string }[] = [
  { value: 'flat',      label: 'Flat (one-time)' },
  { value: 'per_mile',  label: 'Per mile' },
  { value: 'per_15min', label: 'Per 15 minutes' },
  { value: 'plus_base', label: 'Base + per item' },
  { value: 'per_item',  label: 'Per item' },
];

interface ServiceRowProps {
  service: CatalogService;
  editing: boolean;
  onEditClick: () => void;
  onCancel: () => void;
  onSave: (id: string, updates: UpdateServiceInput) => Promise<CatalogService | null>;
  onDelete: (id: string) => Promise<boolean>;
  onToggleActive: (id: string, active: boolean) => Promise<void>;
  /** Optional — manual Stax + QBO sync. Read-mode shows a refresh button when present. */
  onSync?: (id: string) => Promise<ExternalSyncResult | null>;
}

function fmtUSD(n: number | undefined): string {
  if (!n) return '—';
  return n < 1 ? `$${n.toFixed(2)}` : `$${Math.round(n * 100) / 100}`;
}

function unitLabel(unit: CatalogService['unit']): string {
  return unit === 'per_item' ? '/ item'
    : unit === 'per_day' ? '/ day'
    : unit === 'per_task' ? '/ task'
    : '/ hour';
}

export function ServiceRow({
  service, editing, onEditClick, onCancel, onSave, onDelete, onToggleActive, onSync,
}: ServiceRowProps) {
  const v2 = theme.v2;

  const [draft, setDraft] = useState<CatalogService>(service);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncFlash, setSyncFlash] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const handleSyncClick = async () => {
    if (!onSync || syncing) return;
    setSyncing(true);
    setSyncFlash(null);
    const result = await onSync(service.id);
    setSyncing(false);
    if (!result) {
      setSyncFlash({ kind: 'err', msg: 'Sync failed' });
    } else if (result.errors.length === 0) {
      setSyncFlash({ kind: 'ok', msg: 'Synced' });
    } else {
      setSyncFlash({ kind: 'err', msg: result.errors.join(' · ') });
    }
    window.setTimeout(() => setSyncFlash(null), 4000);
  };

  // Reset draft + confirm state whenever the underlying service changes or
  // we re-enter edit mode.
  useEffect(() => {
    if (editing) {
      setDraft(service);
      setConfirmDelete(false);
      setValidationError(null);
    }
  }, [editing, service]);

  const isDirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(service),
    [draft, service],
  );

  const hasAnyTime = useMemo(
    () => CLASSES.some(c => (service.times[c] ?? 0) > 0),
    [service.times],
  );

  const handleSave = async () => {
    if (!draft.code.trim() || !draft.name.trim()) {
      setValidationError('Code and Name are required');
      return;
    }
    setValidationError(null);
    setSaving(true);
    const updates: UpdateServiceInput = {
      code: draft.code.trim().toUpperCase(),
      name: draft.name.trim(),
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
      billIfPass: draft.billIfPass,
      billIfFail: draft.billIfFail,
      times: draft.times,
      deliveryRateUnit: draft.deliveryRateUnit,
      visibleToClient: draft.visibleToClient,
      description: draft.description,
      quoteRequired: draft.quoteRequired,
    };
    const saved = await onSave(service.id, updates);
    setSaving(false);
    if (saved) onCancel();   // collapse back to read mode after save
  };

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      window.setTimeout(() => setConfirmDelete(false), 3000);
      return;
    }
    const ok = await onDelete(service.id);
    if (ok) onCancel();
  };

  // ── EDIT MODE ─────────────────────────────────────────────────────────
  if (editing) {
    return (
      <div style={{
        background: v2.colors.bgWhite,
        border: `2px solid ${v2.colors.accent}`,
        borderRadius: v2.radius.input,
        padding: '20px 22px',
        margin: '4px 0',
        boxShadow: '0 4px 20px rgba(232,105,42,0.12)',
        fontFamily: 'inherit',
      }}>
        {/* Identity */}
        <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 180px', gap: 12 }}>
          <div>
            <label style={inlineLabel(v2)}>Code</label>
            <input
              style={{ ...inlineInput(v2), textTransform: 'uppercase' }}
              value={draft.code}
              onChange={e => setDraft({ ...draft, code: e.target.value.toUpperCase() })}
            />
          </div>
          <div>
            <label style={inlineLabel(v2)}>Name</label>
            <input
              style={inlineInput(v2)}
              value={draft.name}
              onChange={e => setDraft({ ...draft, name: e.target.value })}
            />
          </div>
          <div>
            <label style={inlineLabel(v2)}>Category</label>
            <select
              style={inlineInput(v2)}
              value={draft.category}
              onChange={e => setDraft({ ...draft, category: e.target.value as ServiceCategory })}
            >
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        {/* Billing + Unit */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 110px', gap: 12, marginTop: 14 }}>
          <div>
            <label style={inlineLabel(v2)}>Billing</label>
            <select
              style={inlineInput(v2)}
              value={draft.billing}
              onChange={e => setDraft({ ...draft, billing: e.target.value as ServiceBilling })}
            >
              {BILLINGS.map(b => <option key={b} value={b}>{b === 'class_based' ? 'Class-based' : 'Flat rate'}</option>)}
            </select>
          </div>
          <div>
            <label style={inlineLabel(v2)}>Unit</label>
            <select
              style={inlineInput(v2)}
              value={draft.unit}
              onChange={e => setDraft({ ...draft, unit: e.target.value as ServiceUnit })}
            >
              {UNITS.map(u => <option key={u} value={u}>{u.replace('per_', 'per ')}</option>)}
            </select>
          </div>
          <div>
            <label style={inlineLabel(v2)}>Display order</label>
            <input
              type="number"
              style={inlineInput(v2)}
              value={draft.displayOrder}
              onChange={e => setDraft({ ...draft, displayOrder: Number(e.target.value) || 0 })}
            />
          </div>
        </div>

        {/* Rates: class-grid for class_based, single flat input otherwise */}
        {draft.billing === 'class_based' ? (
          <div style={{ marginTop: 16 }}>
            <label style={inlineLabel(v2)}>Class rates ($)</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8 }}>
              {CLASSES.map(cls => (
                <div key={cls}>
                  <div style={classHeaderStyle(v2)}>{cls}</div>
                  <input
                    type="number"
                    step="0.01"
                    style={{ ...inlineInput(v2), textAlign: 'center' }}
                    value={draft.rates[cls] ?? 0}
                    onChange={e => {
                      const num = Number(e.target.value) || 0;
                      const nextRates = { ...draft.rates, [cls]: num };
                      // Mirror XXL rate into the dedicated column for DB parity.
                      const nextXxl = cls === 'XXL' ? num : draft.xxlRate;
                      setDraft({ ...draft, rates: nextRates, xxlRate: nextXxl });
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 16 }}>
            <label style={inlineLabel(v2)}>Flat rate ($)</label>
            <input
              type="number"
              step="0.01"
              style={{ ...inlineInput(v2), maxWidth: 200 }}
              value={draft.flatRate}
              onChange={e => setDraft({ ...draft, flatRate: Number(e.target.value) || 0 })}
            />
          </div>
        )}

        {/* Service times — class_based rows always need them (per-class
            minutes). Delivery rows benefit from them too because the
            CreateDeliveryOrderModal uses the per-class minutes for
            dispatch routing duration even when the rate is flat. */}
        {(draft.billing === 'class_based' || draft.showAsDeliveryService) && (
          <div style={{ marginTop: 14 }}>
            <label style={{ ...inlineLabel(v2), display: 'flex', alignItems: 'center', gap: 6 }}>
              <Clock size={11} /> Service times (minutes)
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8 }}>
              {CLASSES.map(cls => (
                <div key={cls}>
                  <div style={classHeaderStyle(v2)}>{cls}</div>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    style={{ ...inlineInput(v2), textAlign: 'center' }}
                    value={draft.times[cls] ?? ''}
                    placeholder="—"
                    onChange={e => {
                      const raw = e.target.value;
                      const n = raw === '' ? undefined : (Number(raw) || 0);
                      setDraft({ ...draft, times: { ...draft.times, [cls]: n } });
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Toggle row */}
        <div style={{
          marginTop: 18, padding: 14,
          background: v2.colors.bgPage, borderRadius: v2.radius.input,
          display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10,
        }}>
          <ToggleRow label="Show in Matrix"      checked={draft.showInMatrix}          onChange={v => setDraft({ ...draft, showInMatrix: v })} />
          <ToggleRow label="Show as Task"        checked={draft.showAsTask}            onChange={v => setDraft({ ...draft, showAsTask: v })} />
          <ToggleRow label="Receiving Add-on"    checked={draft.showAsReceivingAddon}  onChange={v => setDraft({ ...draft, showAsReceivingAddon: v })} />
          <ToggleRow label="Delivery Service"    checked={draft.showAsDeliveryService} onChange={v => setDraft({ ...draft, showAsDeliveryService: v })} />
          <ToggleRow label="Has Dedicated Page"  checked={draft.hasDedicatedPage}      onChange={v => setDraft({ ...draft, hasDedicatedPage: v })} />
          <ToggleRow label="Taxable"             checked={draft.taxable}               onChange={v => setDraft({ ...draft, taxable: v })} />
          <ToggleRow label="Bill if Pass"        checked={draft.billIfPass}            onChange={v => setDraft({ ...draft, billIfPass: v })} />
          <ToggleRow label="Bill if Fail"        checked={draft.billIfFail}            onChange={v => setDraft({ ...draft, billIfFail: v })} />
        </div>

        {/* Delivery Settings — only relevant when this row is exposed in
            the Create Delivery Order modal. */}
        {draft.showAsDeliveryService && (
          <div style={{
            marginTop: 16, padding: 14,
            background: 'rgba(232,93,45,0.06)',
            border: `1px solid ${v2.colors.accentLight}`,
            borderRadius: v2.radius.input,
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              fontSize: 11, fontWeight: 700, letterSpacing: '1.5px',
              color: v2.colors.accent, textTransform: 'uppercase',
              marginBottom: 12,
            }}>
              <Truck size={12} /> Delivery Settings
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={inlineLabel(v2)}>Rate unit</label>
                <select
                  style={inlineInput(v2)}
                  value={draft.deliveryRateUnit}
                  onChange={e => setDraft({ ...draft, deliveryRateUnit: e.target.value as DeliveryRateUnit })}
                >
                  {DELIVERY_RATE_UNITS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                <div style={{
                  display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10,
                  width: '100%', paddingBottom: 6,
                }}>
                  <ToggleRow
                    label="Visible to Client"
                    checked={draft.visibleToClient}
                    onChange={v => setDraft({ ...draft, visibleToClient: v })}
                  />
                  <ToggleRow
                    label="Quote Required"
                    checked={draft.quoteRequired}
                    onChange={v => setDraft({ ...draft, quoteRequired: v })}
                  />
                </div>
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <label style={inlineLabel(v2)}>Description (shown next to the toggle)</label>
              <input
                style={inlineInput(v2)}
                value={draft.description}
                placeholder="e.g. Add an extra crew member for heavy or stair-heavy moves"
                onChange={e => setDraft({ ...draft, description: e.target.value })}
              />
            </div>
          </div>
        )}

        {/* SLA + Priority + Auto-apply */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 14 }}>
          <div>
            <label style={inlineLabel(v2)}>Default SLA (hours)</label>
            <input
              type="number"
              style={inlineInput(v2)}
              value={draft.defaultSlaHours ?? ''}
              placeholder="e.g. 48"
              onChange={e => {
                const raw = e.target.value;
                setDraft({ ...draft, defaultSlaHours: raw === '' ? null : (Number(raw) || 0) });
              }}
            />
          </div>
          <div>
            <label style={inlineLabel(v2)}>Default priority</label>
            <select
              style={inlineInput(v2)}
              value={draft.defaultPriority ?? ''}
              onChange={e => setDraft({ ...draft, defaultPriority: (e.target.value || null) as ServicePriority | null })}
            >
              <option value="">None</option>
              {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label style={inlineLabel(v2)}>Auto-apply rule</label>
            <select
              style={inlineInput(v2)}
              value={draft.autoApplyRule ?? ''}
              onChange={e => setDraft({ ...draft, autoApplyRule: (e.target.value || null) as AutoApplyRule | null })}
            >
              <option value="">None (manual)</option>
              {AUTO_RULES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        </div>

        {validationError && (
          <div style={{
            marginTop: 12, padding: '8px 12px',
            background: 'rgba(180,90,90,0.1)', color: '#B45A5A',
            borderRadius: v2.radius.input, fontSize: 12,
          }}>{validationError}</div>
        )}

        {/* Footer */}
        <div style={{
          marginTop: 18, paddingTop: 14,
          borderTop: `1px solid ${v2.colors.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        }}>
          <button
            onClick={handleDelete}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '8px 14px', borderRadius: v2.radius.button,
              background: confirmDelete ? '#B45A5A' : 'transparent',
              border: `1px solid ${confirmDelete ? '#B45A5A' : 'rgba(180,90,90,0.3)'}`,
              color: confirmDelete ? '#fff' : '#B45A5A',
              cursor: 'pointer', fontSize: 11, fontWeight: 600, letterSpacing: '1.5px',
              textTransform: 'uppercase', fontFamily: 'inherit',
            }}
          >
            <Trash2 size={12} /> {confirmDelete ? 'Confirm Delete' : 'Delete'}
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onCancel}
              style={ghostBtn(v2)}
            >Cancel</button>
            <button
              onClick={handleSave}
              disabled={saving || !isDirty}
              style={{
                ...primaryBtn(v2),
                background: isDirty ? v2.colors.accent : v2.colors.border,
                color: isDirty ? '#fff' : v2.colors.textMuted,
                cursor: (isDirty && !saving) ? 'pointer' : 'not-allowed',
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── READ MODE ─────────────────────────────────────────────────────────
  const tags: { label: string; bg: string; color: string }[] = [];
  if (service.showInMatrix)          tags.push({ label: 'Matrix',     bg: v2.colors.statusAccepted.bg, color: v2.colors.statusAccepted.text });
  if (service.showAsTask)            tags.push({ label: 'Task',       bg: v2.colors.statusSent.bg,     color: v2.colors.statusSent.text });
  if (service.showAsDeliveryService) tags.push({ label: 'Delivery',   bg: v2.colors.statusDraft.bg,    color: v2.colors.statusDraft.text });
  if (service.showAsReceivingAddon)  tags.push({ label: 'Add-on',     bg: v2.colors.accentLight,       color: v2.colors.accent });
  if (service.hasDedicatedPage)      tags.push({ label: 'Has Page',   bg: v2.colors.statusExpired.bg,  color: v2.colors.statusExpired.text });
  if (service.showAsDeliveryService && service.quoteRequired) {
    tags.push({ label: 'Quote',  bg: 'rgba(180,90,90,0.12)', color: '#B45A5A' });
  }
  if (service.showAsDeliveryService && !service.visibleToClient) {
    tags.push({ label: 'Hidden', bg: 'rgba(120,120,120,0.15)', color: '#666' });
  }

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '88px minmax(180px, 1.4fr) auto 1fr auto',
      alignItems: 'center', columnGap: 14, rowGap: 6,
      padding: '12px 16px',
      background: v2.colors.bgWhite,
      borderRadius: v2.radius.input,
      border: `1px solid ${v2.colors.border}`,
      opacity: service.active ? 1 : 0.55,
      transition: 'background 0.15s',
    }}>
      {/* Code */}
      <div style={{
        fontSize: 12, fontWeight: 700, letterSpacing: '1px',
        color: v2.colors.accent, fontVariantNumeric: 'tabular-nums',
      }}>{service.code}</div>

      {/* Name + category tag */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span style={{
          fontSize: 13, fontWeight: 600, color: v2.colors.text,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{service.name}</span>
        <span style={{
          fontSize: 10, fontWeight: 600, letterSpacing: '0.5px',
          padding: '2px 8px', borderRadius: v2.radius.badge,
          background: v2.colors.bgPage, color: v2.colors.textSecondary,
          textTransform: 'uppercase', whiteSpace: 'nowrap',
        }}>{service.category}</span>
      </div>

      {/* Rates */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
        {service.billing === 'class_based' ? (
          CLASSES.map(cls => {
            const v = service.rates[cls];
            if (!v) return null;
            return (
              <span key={cls} style={chipStyle(v2)}>
                <span style={{ color: v2.colors.textMuted, marginRight: 3 }}>{cls}</span>
                <span style={{ color: v2.colors.text, fontWeight: 600 }}>{fmtUSD(v)}</span>
              </span>
            );
          })
        ) : (
          <span style={{
            ...chipStyle(v2),
            background: v2.colors.accentLight, color: v2.colors.accent, fontWeight: 600,
          }}>
            Flat: {fmtUSD(service.flatRate)} <span style={{ color: v2.colors.textMuted, marginLeft: 4 }}>{unitLabel(service.unit)}</span>
          </span>
        )}
      </div>

      {/* Times + Tags */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
        {hasAnyTime && CLASSES.map(cls => {
          const t = service.times[cls];
          if (!t || t <= 0) return null;
          return (
            <span key={cls} style={{ ...chipStyle(v2), background: 'rgba(40,130,200,0.08)' }}>
              <Clock size={9} style={{ color: v2.colors.statusSent.text, marginRight: 3 }} />
              <span style={{ color: v2.colors.textMuted, marginRight: 3 }}>{cls}</span>
              <span style={{ color: v2.colors.statusSent.text, fontWeight: 600 }}>{t}m</span>
            </span>
          );
        })}
        {tags.map(t => (
          <span key={t.label} style={{
            fontSize: 9, fontWeight: 600, letterSpacing: '0.5px',
            padding: '2px 7px', borderRadius: v2.radius.badge,
            background: t.bg, color: t.color, textTransform: 'uppercase',
          }}>{t.label}</span>
        ))}
        <SyncBadge label="Stax" synced={!!service.staxItemId} />
        <SyncBadge label="QB"   synced={!!service.qbItemId} />
        {syncFlash && (
          <span
            title={syncFlash.msg}
            style={{
              fontSize: 9, fontWeight: 600, letterSpacing: '0.5px',
              padding: '2px 7px', borderRadius: v2.radius.badge,
              background: syncFlash.kind === 'ok' ? 'rgba(74,138,92,0.15)' : 'rgba(180,90,90,0.12)',
              color: syncFlash.kind === 'ok' ? '#4A8A5C' : '#B45A5A',
              textTransform: 'uppercase',
              maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
          >
            {syncFlash.kind === 'ok' ? 'Synced ✓' : 'Sync failed'}
          </span>
        )}
      </div>

      {/* Active toggle + Sync + Edit */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <ActiveToggle
          checked={service.active}
          onChange={v => { void onToggleActive(service.id, v); }}
        />
        {onSync && (
          <button
            onClick={() => { void handleSyncClick(); }}
            disabled={syncing}
            title={syncing ? 'Syncing…' : 'Push this row to Stax + QuickBooks'}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 30, height: 28, borderRadius: v2.radius.button,
              background: 'transparent',
              border: `1px solid ${v2.colors.border}`,
              color: syncing ? v2.colors.textMuted : v2.colors.textSecondary,
              cursor: syncing ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
              padding: 0,
            }}
            onMouseEnter={e => { if (!syncing) e.currentTarget.style.background = v2.colors.bgPage; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
          >
            <RefreshCw
              size={12}
              style={syncing ? { animation: 'service-row-spin 0.8s linear infinite' } : undefined}
            />
          </button>
        )}
        {/* Local keyframes — kept inline to avoid touching global stylesheets. */}
        <style>{`@keyframes service-row-spin { to { transform: rotate(360deg); } }`}</style>
        <button
          onClick={onEditClick}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '6px 12px', borderRadius: v2.radius.button,
            background: 'transparent',
            border: `1px solid ${v2.colors.border}`,
            color: v2.colors.text,
            cursor: 'pointer', fontSize: 10, fontWeight: 600, letterSpacing: '1.5px',
            textTransform: 'uppercase', fontFamily: 'inherit',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = v2.colors.bgPage; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
        >
          <Pencil size={11} /> Edit
        </button>
      </div>
    </div>
  );
}

function SyncBadge({ label, synced }: { label: string; synced: boolean }) {
  const v2 = theme.v2;
  return (
    <span
      title={synced ? `${label} catalog: synced` : `${label} catalog: not synced`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        fontSize: 9, fontWeight: 700, letterSpacing: '0.5px',
        padding: '2px 7px', borderRadius: v2.radius.badge,
        background: synced ? 'rgba(74,138,92,0.12)' : 'rgba(140,140,140,0.10)',
        color: synced ? '#4A8A5C' : '#999',
        textTransform: 'uppercase',
      }}
    >
      <span style={{
        width: 6, height: 6, borderRadius: '50%',
        background: synced ? '#4A8A5C' : '#B0B0B0',
      }} />
      {label}
    </span>
  );
}

// ── Style helpers ──────────────────────────────────────────────────────
function inlineInput(v2: typeof theme.v2): React.CSSProperties {
  return {
    width: '100%', boxSizing: 'border-box',
    background: v2.colors.bgWhite,
    border: `1px solid ${v2.colors.border}`,
    borderRadius: v2.radius.input,
    padding: '8px 12px', fontSize: 13,
    color: v2.colors.text, fontFamily: 'inherit',
  };
}
function inlineLabel(v2: typeof theme.v2): React.CSSProperties {
  return { ...v2.typography.label, display: 'block', marginBottom: 5 };
}
function classHeaderStyle(v2: typeof theme.v2): React.CSSProperties {
  return {
    fontSize: 9, fontWeight: 700, letterSpacing: '1px',
    color: v2.colors.textMuted, marginBottom: 3, textAlign: 'center',
  };
}
function chipStyle(v2: typeof theme.v2): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center',
    fontSize: 10, fontVariantNumeric: 'tabular-nums',
    padding: '2px 7px', borderRadius: v2.radius.chip,
    background: v2.colors.bgPage,
  };
}
function ghostBtn(v2: typeof theme.v2): React.CSSProperties {
  return {
    padding: '8px 18px', borderRadius: v2.radius.button,
    background: 'transparent', border: `1px solid ${v2.colors.border}`,
    color: v2.colors.textSecondary,
    cursor: 'pointer', fontSize: 11, fontWeight: 600, letterSpacing: '1.5px',
    textTransform: 'uppercase', fontFamily: 'inherit',
  };
}
function primaryBtn(v2: typeof theme.v2): React.CSSProperties {
  return {
    padding: '8px 22px', borderRadius: v2.radius.button,
    background: v2.colors.accent, border: 'none', color: '#fff',
    cursor: 'pointer', fontSize: 11, fontWeight: 600, letterSpacing: '1.5px',
    textTransform: 'uppercase', fontFamily: 'inherit',
  };
}

// ── Reusable inline toggle ─────────────────────────────────────────────
function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  const v2 = theme.v2;
  return (
    <label style={{
      display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
      fontSize: 12, color: v2.colors.text, userSelect: 'none',
    }}>
      <div
        onClick={() => onChange(!checked)}
        style={{
          position: 'relative', width: 30, height: 18,
          background: checked ? v2.colors.accent : '#D4D0CA',
          borderRadius: 100, transition: 'background 0.15s', flexShrink: 0,
        }}
      >
        <div style={{
          position: 'absolute', top: 2, left: checked ? 14 : 2,
          width: 14, height: 14, borderRadius: '50%', background: '#fff',
          transition: 'left 0.15s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        }} />
      </div>
      <span>{label}</span>
    </label>
  );
}

function ActiveToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  const v2 = theme.v2;
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onChange(!checked); }}
      title={checked ? 'Active — click to deactivate' : 'Inactive — click to activate'}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '4px 10px', borderRadius: v2.radius.badge,
        background: checked ? 'rgba(74,138,92,0.12)' : 'rgba(140,140,140,0.12)',
        border: 'none', cursor: 'pointer', fontFamily: 'inherit',
        fontSize: 9, fontWeight: 700, letterSpacing: '1px',
        color: checked ? '#4A8A5C' : '#666',
        textTransform: 'uppercase',
      }}
    >
      <span style={{
        width: 6, height: 6, borderRadius: '50%',
        background: checked ? '#4A8A5C' : '#999',
      }} />
      {checked ? 'Active' : 'Inactive'}
    </button>
  );
}
