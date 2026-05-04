/**
 * AddTaskServiceModal — staff/admin pick a service from the catalog to
 * attach as a billable add-on to an entity. Rate snapshots from the
 * catalog at the time of add (class_based services use the parent
 * item's class; flat services use flat_rate). The actual billing row
 * doesn't get written until the entity completes — this just queues
 * the add-on on public.addons.
 *
 * v38.173.0 — generalized for any entity type. The `parentType` prop
 * controls (a) the title copy, (b) the catalog filter:
 *
 *   - 'task': service_catalog where active=true AND show_as_task=true
 *     (preserves the original task-only behavior).
 *   - 'repair' | 'will_call' | 'inventory' | undefined:
 *     service_catalog where active=true (show every active service).
 *
 * The component name is preserved for back-compat with the existing
 * TaskDetailPanel call site, but new entity panels can pass parentType
 * to get the right copy + filter.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { theme } from '../../styles/theme';
import { useServiceCatalog, type CatalogService } from '../../hooks/useServiceCatalog';
import type { AddTaskAddonInput } from '../../hooks/useTaskAddons';
import type { EntityAddonParent } from '../../hooks/useEntityAddons';

interface Props {
  itemClass?: string | null;
  parentType?: EntityAddonParent;
  onClose: () => void;
  onSubmit: (input: AddTaskAddonInput) => Promise<unknown>;
}

const TITLE_BY_PARENT: Record<EntityAddonParent, string> = {
  task: 'Add Service to Task',
  repair: 'Add Service to Repair',
  will_call: 'Add Service to Will Call',
  inventory: 'Add Service to Item',
};

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', fontSize: 13,
  border: `1px solid ${theme.colors.border}`, borderRadius: 8,
  outline: 'none', fontFamily: 'inherit', background: '#fff',
};

function rateForClass(svc: CatalogService, itemClass: string | null | undefined): number {
  if (svc.billing === 'flat') return Number(svc.flatRate || 0);
  const k = (itemClass || '').toUpperCase() as keyof typeof svc.rates;
  return Number(svc.rates?.[k] ?? 0);
}

export function AddTaskServiceModal({ itemClass, parentType, onClose, onSubmit }: Props) {
  const { services, loading } = useServiceCatalog();
  // For tasks, preserve the historical show_as_task gate. For other
  // entity types the catalog has no parallel flag yet (and adding 4
  // would force a schema decision per service), so show every active
  // service and let the operator pick the right one.
  const taskServices = useMemo(
    () => services
      .filter(s => s.active && (parentType === 'task' || parentType === undefined ? s.showAsTask : true))
      .sort((a, b) => a.displayOrder - b.displayOrder),
    [services, parentType],
  );

  const [serviceId, setServiceId] = useState('');
  const [quantity, setQuantity] = useState('1');
  // Rate is a string so the operator can blank it out / type freely. The
  // catalog auto-fill writes here whenever the service or itemClass
  // changes; the operator can then override (e.g. negotiated labor rate).
  const [rateInput, setRateInput] = useState('');
  const [rateTouched, setRateTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = taskServices.find(s => s.id === serviceId) || null;
  const catalogRate = selected ? rateForClass(selected, itemClass) : 0;

  // Auto-fill rate when the service / class changes — but only if the
  // operator hasn't already typed an override. Reset the touched flag
  // when the service changes so a fresh selection picks up its catalog
  // rate even if a prior service had been overridden.
  useEffect(() => {
    setRateTouched(false);
    setRateInput(selected ? String(catalogRate) : '');
    // selected.id is the only signal we need; catalogRate change without
    // a service change shouldn't retrigger (e.g. itemClass swap mid-form
    // is rare, and re-applying the catalog there would clobber an
    // intentional override).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  const rateNum = Number(rateInput);
  const rate = isNaN(rateNum) ? 0 : rateNum;
  const qtyNum = Number(quantity) || 0;
  const total = qtyNum * rate;
  const isOverride = rateTouched && Math.abs(rate - catalogRate) > 0.0001;

  const canSubmit = !!selected && qtyNum > 0 && !submitting && !isNaN(rateNum) && rateInput.trim() !== '';

  const handleSubmit = async () => {
    if (!selected) { setError('Pick a service'); return; }
    if (!(qtyNum > 0)) { setError('Quantity must be greater than 0'); return; }
    if (isNaN(rateNum)) { setError('Rate must be a number'); return; }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        serviceCode: selected.code,
        serviceName: selected.name,
        quantity: qtyNum,
        rate: rate || null,
        itemClass: selected.billing === 'class_based' ? (itemClass || null) : null,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add service');
    }
    setSubmitting(false);
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
        zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 14, width: '100%', maxWidth: 460,
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)', overflow: 'hidden',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px', borderBottom: `1px solid ${theme.colors.border}`,
        }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{parentType ? TITLE_BY_PARENT[parentType] : 'Add Service to Task'}</div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: theme.colors.textMuted }}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: 18 }}>
          {error && (
            <div style={{
              padding: '8px 10px', background: '#FEF2F2', border: '1px solid #FCA5A5',
              borderRadius: 8, fontSize: 12, color: '#DC2626', marginBottom: 12,
            }}>
              {error}
            </div>
          )}

          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: theme.colors.textMuted, fontWeight: 600, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Service
            </div>
            <select
              value={serviceId}
              onChange={e => setServiceId(e.target.value)}
              style={inputStyle}
              disabled={loading || submitting}
            >
              <option value="">{loading ? 'Loading…' : 'Select a service…'}</option>
              {taskServices.map(s => (
                <option key={s.id} value={s.id}>
                  {s.code} — {s.name}
                </option>
              ))}
            </select>
            {!loading && taskServices.length === 0 && (
              <div style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: 4 }}>
                {parentType === 'task' || parentType === undefined
                  ? 'No catalog services flagged show_as_task.'
                  : 'No active services in the catalog.'}
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 11, color: theme.colors.textMuted, fontWeight: 600, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Quantity
              </div>
              <input
                type="number"
                min={0}
                step={1}
                value={quantity}
                onChange={e => setQuantity(e.target.value)}
                style={inputStyle}
                disabled={submitting}
              />
            </div>
            <div>
              <div style={{ fontSize: 11, color: theme.colors.textMuted, fontWeight: 600, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: 6 }}>
                Rate
                {isOverride && (
                  <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 4, background: '#FEF3C7', color: '#92400E', textTransform: 'none', letterSpacing: 0, fontWeight: 600 }}>
                    Override
                  </span>
                )}
              </div>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: theme.colors.textMuted, fontSize: 13, pointerEvents: 'none' }}>$</span>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={rateInput}
                  onChange={e => { setRateInput(e.target.value); setRateTouched(true); }}
                  disabled={!selected || submitting}
                  placeholder={selected ? '0.00' : '—'}
                  style={{ ...inputStyle, paddingLeft: 22 }}
                />
              </div>
              <div style={{ fontSize: 10, color: theme.colors.textMuted, marginTop: 3, display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                <span>
                  {selected
                    ? `Catalog: $${catalogRate.toFixed(2)}${selected.billing === 'class_based' ? ` (Class ${itemClass || '—'})` : ''}`
                    : 'Pick a service first'}
                </span>
                {isOverride && (
                  <button
                    type="button"
                    onClick={() => { setRateInput(String(catalogRate)); setRateTouched(false); }}
                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: theme.colors.orange, fontSize: 10, fontWeight: 600, fontFamily: 'inherit' }}
                  >
                    Reset
                  </button>
                )}
              </div>
            </div>
          </div>

          <div style={{
            padding: '10px 12px', background: theme.colors.bgSubtle,
            borderRadius: 8, marginBottom: 16,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Total
            </span>
            <span style={{ fontSize: 16, fontWeight: 700, color: theme.colors.text }}>
              {selected ? `$${total.toFixed(2)}` : '—'}
            </span>
          </div>

          {selected && rate <= 0 && (
            <div style={{ fontSize: 11, color: '#B45309', marginBottom: 12 }}>
              ⚠ Rate is $0 for this service/class — billing row will be created with Missing Rate flag.
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              onClick={onClose}
              disabled={submitting}
              style={{
                padding: '8px 14px', fontSize: 13, fontWeight: 600,
                border: `1px solid ${theme.colors.border}`, borderRadius: 8,
                background: '#fff', color: theme.colors.textSecondary,
                cursor: submitting ? 'wait' : 'pointer', fontFamily: 'inherit',
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              style={{
                padding: '8px 16px', fontSize: 13, fontWeight: 600,
                border: 'none', borderRadius: 8,
                background: canSubmit ? theme.colors.orange : theme.colors.bgSubtle,
                color: canSubmit ? '#fff' : theme.colors.textMuted,
                cursor: canSubmit ? 'pointer' : 'not-allowed', fontFamily: 'inherit',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              {submitting && <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />}
              {submitting ? 'Adding…' : 'Add'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
