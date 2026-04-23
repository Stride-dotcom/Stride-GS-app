import React, { useState, useEffect } from 'react';
import {
  X, MapPin, Phone, Mail, Calendar, Clock, Package, FileText, Truck,
  DollarSign, CheckCircle2, AlertCircle, Clock3, Pencil,
} from 'lucide-react';
import { theme } from '../../styles/theme';
import { getPanelContainerStyle, panelBackdropStyle } from './panelStyles';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useResizablePanel } from '../../hooks/useResizablePanel';
import { supabase } from '../../lib/supabase';
import type { DtOrderForUI, DtOrderItemForUI } from '../../lib/supabaseQueries';
import { createPortal } from 'react-dom';

// Human-readable labels + chip config for review workflow states
const REVIEW_CFG: Record<string, { bg: string; color: string; label: string; icon: React.ReactNode }> = {
  pending_review:      { bg: '#FEF3C7', color: '#B45309', label: 'Pending Review',   icon: <Clock3 size={11} /> },
  approved:            { bg: '#DCFCE7', color: '#166534', label: 'Approved',         icon: <CheckCircle2 size={11} /> },
  rejected:            { bg: '#FEE2E2', color: '#991B1B', label: 'Rejected',         icon: <AlertCircle size={11} /> },
  revision_requested:  { bg: '#FEF3C7', color: '#92400E', label: 'Revision Needed',  icon: <AlertCircle size={11} /> },
};

const REVIEW_STATUS_OPTIONS = [
  { value: 'pending_review',     label: 'Pending Review' },
  { value: 'approved',           label: 'Approved' },
  { value: 'rejected',           label: 'Rejected' },
  { value: 'revision_requested', label: 'Revision Requested' },
  { value: 'not_required',       label: 'Not Required' },
];

function fmtCurrency(n: number): string {
  return `$${n.toFixed(2)}`;
}

interface Props {
  order: DtOrderForUI;
  onClose: () => void;
  onUpdated?: () => void;
}

interface OrderEdit {
  contactName: string;
  contactAddress: string;
  contactCity: string;
  contactState: string;
  contactZip: string;
  contactPhone: string;
  contactEmail: string;
  localServiceDate: string;
  windowStartLocal: string;
  windowEndLocal: string;
  poNumber: string;
  sidemark: string;
  clientReference: string;
  details: string;
  orderTotal: string;
  baseDeliveryFee: string;
  reviewStatus: string;
  reviewNotes: string;
}

function orderToEdit(order: DtOrderForUI): OrderEdit {
  return {
    contactName:      order.contactName ?? '',
    contactAddress:   order.contactAddress ?? '',
    contactCity:      order.contactCity ?? '',
    contactState:     order.contactState ?? '',
    contactZip:       order.contactZip ?? '',
    contactPhone:     order.contactPhone ?? '',
    contactEmail:     order.contactEmail ?? '',
    localServiceDate: order.localServiceDate ?? '',
    windowStartLocal: (order.windowStartLocal ?? '').slice(0, 5),
    windowEndLocal:   (order.windowEndLocal ?? '').slice(0, 5),
    poNumber:         order.poNumber ?? '',
    sidemark:         order.sidemark ?? '',
    clientReference:  order.clientReference ?? '',
    details:          order.details ?? '',
    orderTotal:       order.orderTotal != null ? String(order.orderTotal) : '',
    baseDeliveryFee:  order.baseDeliveryFee != null ? String(order.baseDeliveryFee) : '',
    reviewStatus:     order.reviewStatus ?? 'pending_review',
    reviewNotes:      order.reviewNotes ?? '',
  };
}

function Field({ label, value, icon }: { label: string; value?: string | null; icon?: React.ReactNode }) {
  if (!value) return null;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 10, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
        {icon && <span style={{ opacity: 0.6 }}>{icon}</span>}
        {label}
      </div>
      <div style={{ fontSize: 13, color: theme.colors.text }}>{value}</div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '6px 8px', fontSize: 13,
  border: `1px solid ${theme.colors.border}`, borderRadius: 6,
  outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
};

function EditField({
  label, value, onChange, icon, type = 'text', rows, options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  icon?: React.ReactNode;
  type?: 'text' | 'number' | 'date' | 'time' | 'email' | 'tel' | 'textarea' | 'select';
  rows?: number;
  options?: { value: string; label: string }[];
}) {
  const labelEl = (
    <div style={{ fontSize: 10, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
      {icon && <span style={{ opacity: 0.6 }}>{icon}</span>}
      {label}
    </div>
  );
  let input: React.ReactNode;
  if (type === 'textarea') {
    input = <textarea value={value} onChange={e => onChange(e.target.value)} rows={rows ?? 3} style={{ ...inputStyle, resize: 'vertical' }} />;
  } else if (type === 'select') {
    input = <select value={value} onChange={e => onChange(e.target.value)} style={inputStyle}>{options!.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>;
  } else {
    input = <input type={type} value={value} onChange={e => onChange(e.target.value)} style={inputStyle} />;
  }
  return <div style={{ marginBottom: 12 }}>{labelEl}{input}</div>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10, paddingBottom: 6, borderBottom: `1px solid ${theme.colors.border}` }}>{title}</div>
      {children}
    </div>
  );
}

function formatWindow(start: string, end: string, tz: string): string {
  if (!start && !end) return '—';
  const fmtTime = (t: string) => {
    if (!t) return '';
    const parts = t.split(':');
    if (parts.length < 2) return t;
    let h = parseInt(parts[0]);
    const m = parts[1];
    const period = h >= 12 ? 'PM' : 'AM';
    if (h === 0) h = 12;
    else if (h > 12) h -= 12;
    return `${h}:${m} ${period}`;
  };
  const timeStr = [start && fmtTime(start), end && fmtTime(end)].filter(Boolean).join(' – ');
  const tzShort = tz === 'America/Los_Angeles' ? ' PT' : tz ? ` (${tz})` : '';
  return timeStr + tzShort;
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return iso; }
}

const CATEGORY_CFG: Record<string, { bg: string; color: string }> = {
  open:        { bg: '#EFF6FF', color: '#1D4ED8' },
  in_progress: { bg: '#EDE9FE', color: '#7C3AED' },
  completed:   { bg: '#F0FDF4', color: '#15803D' },
  exception:   { bg: '#FEF2F2', color: '#DC2626' },
  cancelled:   { bg: '#F3F4F6', color: '#6B7280' },
};

export function OrderDetailPanel({ order, onClose, onUpdated }: Props) {
  const { isMobile } = useIsMobile();
  const { width: panelWidth, handleMouseDown } = useResizablePanel(480, 'order', isMobile);
  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState<OrderEdit>(() => orderToEdit(order));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setEdit(orderToEdit(order));
  }, [order]);

  const setField = <K extends keyof OrderEdit>(k: K, v: OrderEdit[K]) =>
    setEdit(prev => ({ ...prev, [k]: v }));

  const startEdit  = () => { setEdit(orderToEdit(order)); setSaveError(null); setEditing(true); };
  const cancelEdit = () => { setEditing(false); setSaveError(null); };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const { data: authData } = await supabase.auth.getUser();
      const reviewerUid = authData?.user?.id ?? null;

      const patch: Record<string, unknown> = {
        contact_name:       edit.contactName.trim()    || null,
        contact_address:    edit.contactAddress.trim() || null,
        contact_city:       edit.contactCity.trim()    || null,
        contact_state:      edit.contactState.trim()   || null,
        contact_zip:        edit.contactZip.trim()     || null,
        contact_phone:      edit.contactPhone.trim()   || null,
        contact_email:      edit.contactEmail.trim()   || null,
        local_service_date: edit.localServiceDate      || null,
        window_start_local: edit.windowStartLocal      || null,
        window_end_local:   edit.windowEndLocal        || null,
        po_number:          edit.poNumber.trim()       || null,
        sidemark:           edit.sidemark.trim()       || null,
        client_reference:   edit.clientReference.trim()|| null,
        details:            edit.details.trim()        || null,
        review_status:      edit.reviewStatus,
        review_notes:       edit.reviewNotes.trim()    || null,
        reviewed_by:        reviewerUid,
        reviewed_at:        new Date().toISOString(),
      };

      const newOrderTotal = edit.orderTotal      === '' ? null : Number(edit.orderTotal);
      const newBaseFee    = edit.baseDeliveryFee === '' ? null : Number(edit.baseDeliveryFee);
      const pricingChanged =
        newOrderTotal !== order.orderTotal ||
        newBaseFee    !== order.baseDeliveryFee;
      if (pricingChanged) {
        patch.order_total       = newOrderTotal;
        patch.base_delivery_fee = newBaseFee;
        patch.pricing_override  = true;
      }

      const { error } = await supabase.from('dt_orders').update(patch).eq('id', order.id);
      if (error) throw error;

      setEditing(false);
      onUpdated?.();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const cfg = CATEGORY_CFG[order.statusCategory] || CATEGORY_CFG.open;
  const addressLine = [order.contactAddress, order.contactCity, order.contactState, order.contactZip]
    .filter(Boolean).join(', ');

  const panel = (
    <>
      <div style={panelBackdropStyle} onClick={onClose} />
      <div style={getPanelContainerStyle(panelWidth, isMobile)}>
        {!isMobile && (
          <div
            onMouseDown={handleMouseDown}
            style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, cursor: 'col-resize', zIndex: 10 }}
          />
        )}

        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${theme.colors.border}`, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexShrink: 0 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: theme.colors.text, fontFamily: 'monospace' }}>{order.dtIdentifier}</span>
              {order.isPickup && (
                <span style={{ fontSize: 10, fontWeight: 600, background: '#FEF3C7', color: '#B45309', padding: '2px 8px', borderRadius: 10 }}>PICKUP</span>
              )}
              <span style={{ fontSize: 11, fontWeight: 600, background: cfg.bg, color: cfg.color, padding: '2px 10px', borderRadius: 12 }}>{order.statusName}</span>
              {order.reviewStatus && order.reviewStatus !== 'not_required' && REVIEW_CFG[order.reviewStatus] && (
                <span style={{
                  fontSize: 11, fontWeight: 600, background: REVIEW_CFG[order.reviewStatus].bg,
                  color: REVIEW_CFG[order.reviewStatus].color, padding: '2px 10px', borderRadius: 12,
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                }}>
                  {REVIEW_CFG[order.reviewStatus].icon}
                  {REVIEW_CFG[order.reviewStatus].label}
                </span>
              )}
            </div>
            {order.clientName && (
              <div style={{ fontSize: 12, color: theme.colors.textMuted }}>{order.clientName}</div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            {!editing && (
              <button
                onClick={startEdit}
                title="Edit order"
                style={{ background: theme.colors.orange, color: '#fff', border: 'none', cursor: 'pointer', padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}
              >
                <Pencil size={12} /> Edit
              </button>
            )}
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: theme.colors.textMuted }}>
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>

          {/* Schedule */}
          <Section title="Schedule">
            {editing ? (
              <>
                <EditField label="Service Date" value={edit.localServiceDate} onChange={v => setField('localServiceDate', v)} type="date" icon={<Calendar size={11} />} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <EditField label="Window Start" value={edit.windowStartLocal} onChange={v => setField('windowStartLocal', v)} type="time" icon={<Clock size={11} />} />
                  <EditField label="Window End"   value={edit.windowEndLocal}   onChange={v => setField('windowEndLocal', v)}   type="time" />
                </div>
              </>
            ) : (
              <>
                <Field label="Service Date" value={formatDate(order.localServiceDate)} icon={<Calendar size={11} />} />
                <Field label="Time Window"  value={formatWindow(order.windowStartLocal, order.windowEndLocal, order.timezone)} icon={<Clock size={11} />} />
              </>
            )}
          </Section>

          {/* Contact */}
          <Section title="Contact">
            {editing ? (
              <>
                <EditField label="Name"    value={edit.contactName}    onChange={v => setField('contactName', v)} />
                <EditField label="Address" value={edit.contactAddress} onChange={v => setField('contactAddress', v)} icon={<MapPin size={11} />} />
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 8 }}>
                  <EditField label="City"  value={edit.contactCity}  onChange={v => setField('contactCity', v)} />
                  <EditField label="State" value={edit.contactState} onChange={v => setField('contactState', v)} />
                  <EditField label="Zip"   value={edit.contactZip}   onChange={v => setField('contactZip', v)} />
                </div>
                <EditField label="Phone" value={edit.contactPhone} onChange={v => setField('contactPhone', v)} type="tel"   icon={<Phone size={11} />} />
                <EditField label="Email" value={edit.contactEmail} onChange={v => setField('contactEmail', v)} type="email" icon={<Mail size={11} />} />
              </>
            ) : (
              <>
                <Field label="Name"    value={order.contactName} />
                <Field label="Address" value={addressLine}       icon={<MapPin size={11} />} />
                <Field label="Phone"   value={order.contactPhone} icon={<Phone size={11} />} />
                <Field label="Email"   value={order.contactEmail} icon={<Mail size={11} />} />
              </>
            )}
          </Section>

          {/* Order Details */}
          <Section title="Order Details">
            {editing ? (
              <>
                <EditField label="PO Number"        value={edit.poNumber}        onChange={v => setField('poNumber', v)}        icon={<FileText size={11} />} />
                <EditField label="Sidemark"         value={edit.sidemark}        onChange={v => setField('sidemark', v)}        icon={<Package size={11} />} />
                <EditField label="Client Reference" value={edit.clientReference} onChange={v => setField('clientReference', v)} />
                <EditField label="Details"          value={edit.details}         onChange={v => setField('details', v)}         type="textarea" rows={3} />
              </>
            ) : (
              <>
                <Field label="PO Number"        value={order.poNumber}        icon={<FileText size={11} />} />
                <Field label="Sidemark"         value={order.sidemark}        icon={<Package size={11} />} />
                <Field label="Client Reference" value={order.clientReference} />
                <Field label="Source"           value={order.source}          icon={<Truck size={11} />} />
                {order.dtDispatchId != null && (
                  <Field label="Dispatch ID" value={String(order.dtDispatchId)} />
                )}
              </>
            )}
          </Section>

          {/* Pricing */}
          <Section title="Pricing">
            {editing ? (
              <>
                <EditField label="Base Fee"    value={edit.baseDeliveryFee} onChange={v => setField('baseDeliveryFee', v)} type="number" />
                <EditField label="Order Total" value={edit.orderTotal}      onChange={v => setField('orderTotal', v)}      type="number" icon={<DollarSign size={11} />} />
                <div style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: -4, fontStyle: 'italic' }}>
                  Changing either pricing field will mark the order as manually overridden.
                </div>
              </>
            ) : (
              (order.baseDeliveryFee != null || order.orderTotal != null || (order.accessorials?.length ?? 0) > 0) && (
                <>
                  {order.baseDeliveryFee != null && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
                      <span style={{ color: theme.colors.textMuted }}>{order.isPickup ? 'Base Pickup Fee' : 'Base Delivery Fee'}</span>
                      <span style={{ fontWeight: 500 }}>{fmtCurrency(order.baseDeliveryFee)}</span>
                    </div>
                  )}
                  {order.extraItemsCount > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
                      <span style={{ color: theme.colors.textMuted }}>Extra Items ({order.extraItemsCount} × $25)</span>
                      <span style={{ fontWeight: 500 }}>{fmtCurrency(order.extraItemsFee)}</span>
                    </div>
                  )}
                  {order.accessorials?.map((acc, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
                      <span style={{ color: theme.colors.textMuted }}>{acc.code}{acc.quantity > 1 ? ` × ${acc.quantity}` : ''}</span>
                      <span style={{ fontWeight: 500 }}>{fmtCurrency(acc.subtotal)}</span>
                    </div>
                  ))}
                  {order.fabricProtectionTotal > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
                      <span style={{ color: theme.colors.textMuted }}>Fabric Protection</span>
                      <span style={{ fontWeight: 500 }}>{fmtCurrency(order.fabricProtectionTotal)}</span>
                    </div>
                  )}
                  {order.orderTotal != null && (
                    <div style={{
                      display: 'flex', justifyContent: 'space-between', fontSize: 14,
                      marginTop: 10, paddingTop: 10, borderTop: `1px solid ${theme.colors.border}`,
                      fontWeight: 700, color: theme.colors.text,
                    }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <DollarSign size={13} />
                        Order Total
                        {order.pricingOverride && (
                          <span style={{ fontSize: 10, fontWeight: 600, background: '#FEF3C7', color: '#B45309', padding: '1px 6px', borderRadius: 6, marginLeft: 6 }}>MANUAL</span>
                        )}
                      </span>
                      <span>{fmtCurrency(order.orderTotal)}</span>
                    </div>
                  )}
                  {order.pricingNotes && (
                    <div style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: 8, fontStyle: 'italic' }}>{order.pricingNotes}</div>
                  )}
                </>
              )
            )}
          </Section>

          {/* Review */}
          <Section title="Review">
            {editing ? (
              <>
                <EditField
                  label="Review Status"
                  value={edit.reviewStatus}
                  onChange={v => setField('reviewStatus', v)}
                  type="select"
                  options={REVIEW_STATUS_OPTIONS}
                />
                <EditField
                  label="Review Notes"
                  value={edit.reviewNotes}
                  onChange={v => setField('reviewNotes', v)}
                  type="textarea"
                  rows={3}
                />
              </>
            ) : (
              order.reviewStatus && order.reviewStatus !== 'not_required' && (
                <>
                  {order.createdByRole && <Field label="Created By"   value={order.createdByRole} />}
                  {order.reviewNotes   && <Field label="Review Notes" value={order.reviewNotes} />}
                  {order.reviewedAt    && <Field label="Reviewed At"  value={new Date(order.reviewedAt).toLocaleString()} />}
                  {order.pushedToDtAt  && <Field label="Pushed to DT" value={new Date(order.pushedToDtAt).toLocaleString()} />}
                </>
              )
            )}
          </Section>

          {/* Notes (view only — edited above) */}
          {!editing && (order.details || order.latestNotePreview) && (
            <Section title="Notes">
              {order.details           && <Field label="Details"     value={order.details} />}
              {order.latestNotePreview && <Field label="Latest Note" value={order.latestNotePreview} />}
            </Section>
          )}

          {/* Items */}
          {!editing && order.items && order.items.length > 0 && (
            <Section title={`Items (${order.items.length})`}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {order.items.map((item: DtOrderItemForUI, idx: number) => (
                  <div key={item.id || idx} style={{
                    padding: '10px 12px', borderRadius: 8,
                    background: idx % 2 === 0 ? '#f8f9fa' : '#fff',
                    border: `1px solid ${theme.colors.border}`,
                  }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: theme.colors.text, marginBottom: 4 }}>
                      {item.description || 'No description'}
                    </div>
                    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12, color: theme.colors.textMuted }}>
                      {item.dtItemCode        && <span><span style={{ fontWeight: 500 }}>SKU:</span> {item.dtItemCode}</span>}
                      {item.quantity != null  && <span><span style={{ fontWeight: 500 }}>Qty:</span> {item.quantity}</span>}
                      {item.deliveredQuantity != null && (
                        <span>
                          <span style={{ fontWeight: 500 }}>Delivered:</span>{' '}
                          <span style={{ color: item.deliveredQuantity === item.quantity ? '#15803D' : '#B45309' }}>
                            {item.deliveredQuantity}
                          </span>
                        </span>
                      )}
                      {item.unitPrice != null && item.unitPrice > 0 && (
                        <span><span style={{ fontWeight: 500 }}>Amount:</span> ${item.unitPrice.toFixed(2)}</span>
                      )}
                    </div>
                    {item.notes && (
                      <div style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: 4, fontStyle: 'italic' }}>
                        {item.notes}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: 8, fontStyle: 'italic' }}>
                Items aren't editable here — cancel the order and recreate if you need to change items.
              </div>
            </Section>
          )}

          {!editing && order.lastSyncedAt && (
            <div style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: 8 }}>
              Last synced: {new Date(order.lastSyncedAt).toLocaleString()}
            </div>
          )}
        </div>

        {/* Sticky edit action bar */}
        {editing && (
          <div style={{
            padding: '12px 20px', borderTop: `1px solid ${theme.colors.border}`,
            background: '#fff', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          }}>
            <div style={{ fontSize: 12, color: saveError ? '#DC2626' : theme.colors.textMuted, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {saveError ?? 'Editing — save to persist changes.'}
            </div>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <button
                onClick={cancelEdit}
                disabled={saving}
                style={{ background: '#fff', color: theme.colors.text, border: `1px solid ${theme.colors.border}`, cursor: saving ? 'not-allowed' : 'pointer', padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 500, opacity: saving ? 0.6 : 1 }}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                style={{ background: theme.colors.orange, color: '#fff', border: 'none', cursor: saving ? 'not-allowed' : 'pointer', padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 600, opacity: saving ? 0.7 : 1 }}
              >
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );

  return createPortal(panel, document.body);
}
