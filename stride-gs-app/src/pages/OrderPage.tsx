/**
 * OrderPage.tsx — Full-page delivery order detail view.
 * Route: #/orders/:orderId
 *
 * Uses the EntityPage shell (locked design spec). Fetches the order via
 * useOrderDetail and renders Details / Items / Activity tabs.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  AlertCircle, Loader2, SearchX, Pencil, X,
  CheckCircle2, Clock3, DollarSign, MapPin, Phone,
  Mail, Calendar, Clock, Package, FileText, Truck,
  User, PenLine, MessageSquare,
} from 'lucide-react';
import { theme } from '../styles/theme';
import { BtnSpinner } from '../components/ui/BtnSpinner';
import { useAuth } from '../contexts/AuthContext';
import { useOrderDetail } from '../hooks/useOrderDetail';
import {
  fetchDtOrderByIdFromSupabase,
  fetchDtOrderHistory,
  fetchDtOrderNotes,
  fetchDtOrderPhotos,
} from '../lib/supabaseQueries';
import type {
  DtOrderForUI,
  DtOrderItemForUI,
  DtOrderHistoryEvent,
  DtSideNote,
  DtOrderPhoto,
} from '../lib/supabaseQueries';
import {
  EntityPage, EPCard, EPLabel, EPFooterButton, EntityPageTokens as EP,
} from '../components/shared/EntityPage';
import { EntityHistory } from '../components/shared/EntityHistory';
import { supabase } from '../lib/supabase';
import { CreateDeliveryOrderModal } from '../components/shared/CreateDeliveryOrderModal';
import { ReleaseItemsModal } from '../components/shared/ReleaseItemsModal';
import { generateOrderPdf } from '../lib/orderPdf';
import { logDtOrderAudit } from '../lib/dtOrderAudit';

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORY_CFG: Record<string, { bg: string; color: string; label: string }> = {
  open:        { bg: '#EFF6FF', color: '#1D4ED8', label: 'Open' },
  in_progress: { bg: '#EDE9FE', color: '#7C3AED', label: 'In Progress' },
  completed:   { bg: '#F0FDF4', color: '#15803D', label: 'Completed' },
  exception:   { bg: '#FEF2F2', color: '#DC2626', label: 'Exception' },
  cancelled:   { bg: '#F3F4F6', color: '#6B7280', label: 'Cancelled' },
};

const REVIEW_CFG: Record<string, { bg: string; color: string; label: string; icon: React.ReactNode }> = {
  pending_review:     { bg: '#FEF3C7', color: '#B45309', label: 'Pending Review',  icon: <Clock3 size={11} /> },
  approved:           { bg: '#DCFCE7', color: '#166534', label: 'Approved',        icon: <CheckCircle2 size={11} /> },
  rejected:           { bg: '#FEE2E2', color: '#991B1B', label: 'Rejected',        icon: <AlertCircle size={11} /> },
  revision_requested: { bg: '#FEF3C7', color: '#92400E', label: 'Revision Needed', icon: <AlertCircle size={11} /> },
};

const REVIEW_STATUS_OPTIONS = [
  { value: 'pending_review',     label: 'Pending Review' },
  { value: 'approved',           label: 'Approved' },
  { value: 'rejected',           label: 'Rejected' },
  { value: 'revision_requested', label: 'Revision Requested' },
  { value: 'not_required',       label: 'Not Required' },
];

// ── Edit state type (mirrors OrderDetailPanel) ────────────────────────────────

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

function orderToEdit(o: DtOrderForUI): OrderEdit {
  return {
    contactName:      o.contactName ?? '',
    contactAddress:   o.contactAddress ?? '',
    contactCity:      o.contactCity ?? '',
    contactState:     o.contactState ?? '',
    contactZip:       o.contactZip ?? '',
    contactPhone:     o.contactPhone ?? '',
    contactEmail:     o.contactEmail ?? '',
    localServiceDate: o.localServiceDate ?? '',
    windowStartLocal: (o.windowStartLocal ?? '').slice(0, 5),
    windowEndLocal:   (o.windowEndLocal ?? '').slice(0, 5),
    poNumber:         o.poNumber ?? '',
    sidemark:         o.sidemark ?? '',
    clientReference:  o.clientReference ?? '',
    details:          o.details ?? '',
    orderTotal:       o.orderTotal != null ? String(o.orderTotal) : '',
    baseDeliveryFee:  o.baseDeliveryFee != null ? String(o.baseDeliveryFee) : '',
    reviewStatus:     o.reviewStatus ?? 'pending_review',
    reviewNotes:      o.reviewNotes ?? '',
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtCurrency(n: number) { return `$${n.toFixed(2)}`; }

function fmtDate(iso: string): string {
  if (!iso) return '—';
  try { return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return iso; }
}

function fmtWindow(start: string, end: string, tz: string): string {
  if (!start && !end) return '—';
  const fmt = (t: string) => {
    const [hStr, m] = t.split(':');
    let h = parseInt(hStr);
    const p = h >= 12 ? 'PM' : 'AM';
    if (h === 0) h = 12; else if (h > 12) h -= 12;
    return `${h}:${m} ${p}`;
  };
  const timeStr = [start && fmt(start), end && fmt(end)].filter(Boolean).join(' – ');
  const tzShort = tz === 'America/Los_Angeles' ? ' PT' : tz ? ` (${tz})` : '';
  return timeStr + tzShort;
}

// ── Sub-components ────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '7px 10px', fontSize: 13,
  border: `1px solid ${theme.colors.border}`, borderRadius: 8,
  outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
  background: '#fff',
};

function Field({ label, value, icon }: { label: string; value?: string | null; icon?: React.ReactNode }) {
  if (!value) return null;
  return (
    <div style={{ marginBottom: 14 }}>
      <EPLabel>{icon ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>{icon}{label}</span> : label}</EPLabel>
      <div style={{ fontSize: 13, color: EP.textPrimary, lineHeight: 1.5 }}>{value}</div>
    </div>
  );
}

function EditField({ label, value, onChange, type = 'text', rows, options, icon }: {
  label: string; value: string; onChange: (v: string) => void;
  type?: 'text' | 'number' | 'date' | 'time' | 'email' | 'tel' | 'textarea' | 'select';
  rows?: number; options?: { value: string; label: string }[]; icon?: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <EPLabel>{icon ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>{icon}{label}</span> : label}</EPLabel>
      {type === 'textarea'
        ? <textarea value={value} onChange={e => onChange(e.target.value)} rows={rows ?? 3} style={{ ...inputStyle, resize: 'vertical' }} />
        : type === 'select'
          ? <select value={value} onChange={e => onChange(e.target.value)} style={inputStyle}>{options!.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
          : <input type={type} value={value} onChange={e => onChange(e.target.value)} style={inputStyle} />
      }
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 700, color: EP.textMuted, textTransform: 'uppercase', letterSpacing: '2px', marginBottom: 14, paddingBottom: 8, borderBottom: `1px solid ${theme.colors.border}` }}>
      {children}
    </div>
  );
}

// ── Loading / error states ────────────────────────────────────────────────────

const backBtnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: `${theme.spacing.sm} ${theme.spacing.lg}`, borderRadius: theme.radii.lg,
  border: `1px solid ${theme.colors.border}`,
  background: theme.colors.bgCard, color: theme.colors.text,
  fontSize: theme.typography.sizes.base, fontWeight: theme.typography.weights.medium,
  cursor: 'pointer', fontFamily: 'inherit',
};

function PageState({ icon: Icon, color, title, body, actions }: {
  icon: React.ComponentType<{ size: number; color?: string }>;
  color: string; title: string; body: string; actions?: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16, padding: 32, textAlign: 'center' }}>
      <Icon size={48} color={color} />
      <div style={{ fontSize: 18, fontWeight: 600, color: theme.colors.text }}>{title}</div>
      <div style={{ fontSize: 14, color: theme.colors.textMuted, maxWidth: 400 }}>{body}</div>
      {actions}
    </div>
  );
}

// ── Details tab content ───────────────────────────────────────────────────────

function DetailsTab({
  order,
  editing,
  edit,
  setField,
  saving,
  saveError,
  onStartEdit,
  onCancelEdit,
  onSave,
}: {
  order: DtOrderForUI;
  editing: boolean;
  edit: OrderEdit;
  setField: <K extends keyof OrderEdit>(k: K, v: OrderEdit[K]) => void;
  saving: boolean;
  saveError: string | null;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: () => void;
}) {
  const addressLine = [order.contactAddress, order.contactCity, order.contactState, order.contactZip].filter(Boolean).join(', ');
  const hasPricing = order.baseDeliveryFee != null || order.orderTotal != null || (order.accessorials?.length ?? 0) > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Schedule */}
      <EPCard>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <SectionTitle>Schedule</SectionTitle>
          {!editing && (
            <button onClick={onStartEdit} style={{ background: 'none', border: `1px solid ${theme.colors.border}`, borderRadius: 8, padding: '5px 12px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, color: EP.textSecondary, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <Pencil size={12} /> Edit
            </button>
          )}
        </div>
        {editing ? (
          <>
            <EditField label="Service Date" value={edit.localServiceDate} onChange={v => setField('localServiceDate', v)} type="date" icon={<Calendar size={11} />} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <EditField label="Window Start" value={edit.windowStartLocal} onChange={v => setField('windowStartLocal', v)} type="time" icon={<Clock size={11} />} />
              <EditField label="Window End"   value={edit.windowEndLocal}   onChange={v => setField('windowEndLocal', v)}   type="time" />
            </div>
          </>
        ) : (
          <>
            <Field label="Service Date" value={fmtDate(order.localServiceDate)} icon={<Calendar size={11} />} />
            <Field label="Time Window"  value={fmtWindow(order.windowStartLocal, order.windowEndLocal, order.timezone)} icon={<Clock size={11} />} />
          </>
        )}
      </EPCard>

      {/* Contact */}
      <EPCard>
        <SectionTitle>Contact</SectionTitle>
        {editing ? (
          <>
            <EditField label="Name"    value={edit.contactName}    onChange={v => setField('contactName', v)} />
            <EditField label="Address" value={edit.contactAddress} onChange={v => setField('contactAddress', v)} icon={<MapPin size={11} />} />
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10 }}>
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
            <Field label="Address" value={addressLine || null} icon={<MapPin size={11} />} />
            <Field label="Phone"   value={order.contactPhone} icon={<Phone size={11} />} />
            <Field label="Email"   value={order.contactEmail} icon={<Mail size={11} />} />
          </>
        )}
      </EPCard>

      {/* Order Details */}
      <EPCard>
        <SectionTitle>Order Details</SectionTitle>
        {editing ? (
          <>
            <EditField label="PO Number"        value={edit.poNumber}        onChange={v => setField('poNumber', v)}        icon={<FileText size={11} />} />
            <EditField label="Sidemark"         value={edit.sidemark}        onChange={v => setField('sidemark', v)}        icon={<Package size={11} />} />
            <EditField label="Client Reference" value={edit.clientReference} onChange={v => setField('clientReference', v)} />
            <EditField label="Details / Notes"  value={edit.details}         onChange={v => setField('details', v)}         type="textarea" rows={3} />
          </>
        ) : (
          <>
            <Field label="Order Type"       value={order.orderType ? order.orderType.replace(/_/g, ' ') : null} icon={<Truck size={11} />} />
            <Field label="PO Number"        value={order.poNumber}        icon={<FileText size={11} />} />
            <Field label="Sidemark"         value={order.sidemark}        icon={<Package size={11} />} />
            <Field label="Client Reference" value={order.clientReference} />
            <Field label="Source"           value={order.source} />
            {order.dtDispatchId != null && <Field label="Dispatch ID" value={String(order.dtDispatchId)} />}
            {order.details && <Field label="Details / Notes" value={order.details} />}
          </>
        )}
      </EPCard>

      {/* Pricing */}
      {(hasPricing || editing) && (
        <EPCard>
          <SectionTitle>Pricing</SectionTitle>
          {editing ? (
            <>
              <EditField label="Base Fee"    value={edit.baseDeliveryFee} onChange={v => setField('baseDeliveryFee', v)} type="number" />
              <EditField label="Order Total" value={edit.orderTotal}      onChange={v => setField('orderTotal', v)}      type="number" icon={<DollarSign size={11} />} />
              <div style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: -4, fontStyle: 'italic' }}>
                Changing either pricing field marks the order as manually overridden.
              </div>
            </>
          ) : (
            <>
              {order.baseDeliveryFee != null && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
                  <span style={{ color: EP.textSecondary }}>{order.isPickup ? 'Base Pickup Fee' : 'Base Delivery Fee'}</span>
                  <span style={{ fontWeight: 600 }}>{fmtCurrency(order.baseDeliveryFee)}</span>
                </div>
              )}
              {order.extraItemsCount > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
                  <span style={{ color: EP.textSecondary }}>Extra Items ({order.extraItemsCount} × $25)</span>
                  <span style={{ fontWeight: 600 }}>{fmtCurrency(order.extraItemsFee)}</span>
                </div>
              )}
              {order.accessorials?.map((acc, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
                  <span style={{ color: EP.textSecondary }}>{acc.code}{acc.quantity > 1 ? ` × ${acc.quantity}` : ''}</span>
                  <span style={{ fontWeight: 600 }}>{fmtCurrency(acc.subtotal)}</span>
                </div>
              ))}
              {order.fabricProtectionTotal > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
                  <span style={{ color: EP.textSecondary }}>Fabric Protection</span>
                  <span style={{ fontWeight: 600 }}>{fmtCurrency(order.fabricProtectionTotal)}</span>
                </div>
              )}
              {order.orderTotal != null && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${theme.colors.border}`, fontWeight: 700, color: EP.textPrimary }}>
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
                <div style={{ fontSize: 11, color: EP.textMuted, marginTop: 8, fontStyle: 'italic' }}>{order.pricingNotes}</div>
              )}
              <div style={{ fontSize: 11, color: EP.textMuted, marginTop: 10, fontStyle: 'italic', lineHeight: 1.45 }}>
                Pricing is estimated based on the information provided. If additional assembly, labor, or special handling services are required at the time of delivery, rates may be adjusted accordingly.
              </div>
            </>
          )}
        </EPCard>
      )}

      {/* Review */}
      <EPCard>
        <SectionTitle>Review</SectionTitle>
        {editing ? (
          <>
            <EditField label="Review Status" value={edit.reviewStatus} onChange={v => setField('reviewStatus', v)} type="select" options={REVIEW_STATUS_OPTIONS} />
            <EditField label="Review Notes"  value={edit.reviewNotes}  onChange={v => setField('reviewNotes', v)}  type="textarea" rows={3} />
          </>
        ) : (
          <>
            {order.reviewStatus && order.reviewStatus !== 'not_required' && REVIEW_CFG[order.reviewStatus] && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 12, fontSize: 12, fontWeight: 600, background: REVIEW_CFG[order.reviewStatus].bg, color: REVIEW_CFG[order.reviewStatus].color, marginBottom: 12 }}>
                {REVIEW_CFG[order.reviewStatus].icon}
                {REVIEW_CFG[order.reviewStatus].label}
              </div>
            )}
            {order.createdByRole && <Field label="Created By"   value={order.createdByRole} />}
            {order.reviewNotes   && <Field label="Review Notes" value={order.reviewNotes} />}
            {order.reviewedAt    && <Field label="Reviewed At"  value={new Date(order.reviewedAt).toLocaleString()} />}
            {order.pushedToDtAt  && <Field label="Pushed to DT" value={new Date(order.pushedToDtAt).toLocaleString()} />}
            {order.lastSyncedAt  && <Field label="Last Synced"  value={new Date(order.lastSyncedAt).toLocaleString()} />}
          </>
        )}
      </EPCard>

      {/* Edit action bar */}
      {editing && (
        <EPCard style={{ background: '#FAFAF9' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ fontSize: 12, color: saveError ? '#DC2626' : EP.textMuted, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {saveError ?? 'Editing — save to persist changes.'}
            </div>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <button onClick={onCancelEdit} disabled={saving} style={{ background: '#fff', color: EP.textPrimary, border: `1px solid ${theme.colors.border}`, cursor: saving ? 'not-allowed' : 'pointer', padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500, opacity: saving ? 0.6 : 1, fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <X size={13} /> Cancel
              </button>
              <button onClick={onSave} disabled={saving} style={{ background: EP.accent, color: '#fff', border: 'none', cursor: saving ? 'progress' : 'pointer', padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, opacity: saving ? 0.85 : 1, fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {saving && <BtnSpinner size={12} color="#fff" />}
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </EPCard>
      )}
    </div>
  );
}

// ── Items tab content ─────────────────────────────────────────────────────────

function ItemsTab({ items }: { items: DtOrderItemForUI[] }) {
  if (items.length === 0) {
    return (
      <EPCard>
        <div style={{ textAlign: 'center', color: EP.textMuted, fontSize: 13, padding: '24px 0' }}>No items on this order.</div>
      </EPCard>
    );
  }
  return (
    <EPCard>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((item, idx) => {
          // Treat short-delivery as a flag worth highlighting. delivered=false
          // explicitly OR a delivered_quantity below ordered quantity counts.
          const orderedQty = item.quantity ?? 0;
          const delQty = item.deliveredQuantity ?? null;
          const explicitlyShort = item.delivered === false;
          const qtyShort = delQty != null && orderedQty > 0 && delQty < orderedQty;
          const fullyDelivered = item.delivered === true || (delQty != null && orderedQty > 0 && delQty >= orderedQty);
          return (
            <div key={item.id || idx} style={{ padding: '12px 14px', borderRadius: 10, background: idx % 2 === 0 ? '#FAFAF9' : '#fff', border: `1px solid ${theme.colors.border}` }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: EP.textPrimary, flex: 1, minWidth: 0 }}>
                  {item.description || 'No description'}
                </div>
                {fullyDelivered && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, background: '#F0FDF4', color: '#15803D', padding: '2px 8px', borderRadius: 10, flexShrink: 0 }}>
                    <CheckCircle2 size={11} /> Delivered
                  </span>
                )}
                {(explicitlyShort || qtyShort) && !fullyDelivered && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, background: '#FEF3C7', color: '#B45309', padding: '2px 8px', borderRadius: 10, flexShrink: 0 }}>
                    <AlertCircle size={11} /> Short
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12, color: EP.textSecondary }}>
                {item.dtItemCode        && <span><span style={{ fontWeight: 600 }}>SKU:</span> {item.dtItemCode}</span>}
                {item.quantity != null  && <span><span style={{ fontWeight: 600 }}>Qty:</span> {item.quantity}</span>}
                {item.deliveredQuantity != null && (
                  <span>
                    <span style={{ fontWeight: 600 }}>Delivered:</span>{' '}
                    <span style={{ color: qtyShort ? '#B45309' : '#15803D' }}>
                      {item.deliveredQuantity}
                    </span>
                  </span>
                )}
                {item.checkedQuantity != null && item.checkedQuantity !== item.deliveredQuantity && (
                  <span><span style={{ fontWeight: 600 }}>Checked:</span> {item.checkedQuantity}</span>
                )}
                {item.dtLocation && (
                  <span><span style={{ fontWeight: 600 }}>Location:</span> {item.dtLocation}</span>
                )}
                {item.unitPrice != null && item.unitPrice > 0 && (
                  <span><span style={{ fontWeight: 600 }}>Amount:</span> ${item.unitPrice.toFixed(2)}</span>
                )}
              </div>
              {item.itemNote && (
                <div style={{ fontSize: 12, color: '#92400E', marginTop: 6, padding: '6px 8px', background: '#FFFBEB', borderRadius: 6, borderLeft: '3px solid #F59E0B' }}>
                  <span style={{ fontWeight: 600 }}>Driver note:</span> {item.itemNote}
                </div>
              )}
              {item.returnCodes && item.returnCodes.length > 0 && (
                <div style={{ fontSize: 11, color: '#991B1B', marginTop: 6, fontWeight: 500 }}>
                  Return codes: {item.returnCodes.join(', ')}
                </div>
              )}
              {item.notes && (
                <div style={{ fontSize: 11, color: EP.textMuted, marginTop: 6, fontStyle: 'italic' }}>{item.notes}</div>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 11, color: EP.textMuted, marginTop: 12, fontStyle: 'italic' }}>
        Items can't be edited here — cancel and recreate the order to change items.
      </div>
    </EPCard>
  );
}

// ── Completion tab content ───────────────────────────────────────────────────
//
// Shows the data that flows back from DispatchTrack via dt-sync-statuses
// once an order has been pushed and worked on. Hidden entirely when the
// order has no sync-back data (i.e. nothing has happened in DT yet).

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  catch { return iso; }
}

function fmtDuration(min: number | null): string {
  if (min == null) return '—';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function CompletionTab({
  order,
  notes,
  history,
  photos,
  loading,
}: {
  order: DtOrderForUI;
  notes: DtSideNote[];
  history: DtOrderHistoryEvent[];
  photos: DtOrderPhoto[];
  loading: boolean;
}) {
  const hasCompletionData = !!(
    order.startedAt || order.finishedAt || order.driverName || order.truckName ||
    order.signatureCapturedAt || order.codAmount != null || order.dtStatusCode
  );

  if (!hasCompletionData && history.length === 0 && notes.length === 0 && photos.length === 0) {
    return (
      <EPCard>
        <div style={{ textAlign: 'center', color: EP.textMuted, fontSize: 13, padding: '24px 0' }}>
          {loading
            ? 'Loading completion data…'
            : order.pushedToDtAt
              ? 'No driver activity yet. Click "DT Sync" on the Orders page to pull the latest from DispatchTrack.'
              : 'This order hasn\'t been pushed to DispatchTrack yet.'}
        </div>
      </EPCard>
    );
  }

  // Variance vs estimate: DtOrderForUI doesn't currently expose
  // service_time_minutes (operator-set estimate), so we only show the
  // actual. If a future change surfaces the estimate we can compare
  // here and badge over/under.
  const actual = order.actualServiceTimeMinutes;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Driver / truck */}
      {(order.driverName || order.truckName || order.serviceUnit || order.stopNumber != null) && (
        <EPCard>
          <SectionTitle>Driver &amp; Vehicle</SectionTitle>
          <Field label="Driver"       value={order.driverName || null} icon={<User size={11} />} />
          <Field label="Truck"        value={order.truckName ? `${order.truckName}${order.truckId ? ` (#${order.truckId})` : ''}` : null} icon={<Truck size={11} />} />
          <Field label="Service Unit" value={order.serviceUnit || null} />
          <Field label="Stop #"       value={order.stopNumber != null ? String(order.stopNumber) : null} />
        </EPCard>
      )}

      {/* Timing */}
      <EPCard>
        <SectionTitle>Timing</SectionTitle>
        <Field label="Scheduled" value={fmtDateTime(order.scheduledAt)} icon={<Calendar size={11} />} />
        <Field label="Started"   value={fmtDateTime(order.startedAt)}   icon={<Clock size={11} />} />
        <Field label="Finished"  value={fmtDateTime(order.finishedAt)}  icon={<CheckCircle2 size={11} />} />
        {actual != null && (
          <Field
            label="Actual Service Time"
            value={fmtDuration(actual)}
            icon={<Clock3 size={11} />}
          />
        )}
        {order.dtStatusCode && (
          <Field label="DT Status Code" value={order.dtStatusCode} />
        )}
      </EPCard>

      {/* Payment / signature */}
      {(order.codAmount != null || order.paymentCollected || order.signatureCapturedAt) && (
        <EPCard>
          <SectionTitle>Proof of Delivery</SectionTitle>
          {order.codAmount != null && (
            <Field label="COD Amount" value={fmtCurrency(order.codAmount)} icon={<DollarSign size={11} />} />
          )}
          {order.paymentCollected && (
            <Field label="Payment Collected" value="Yes" icon={<DollarSign size={11} />} />
          )}
          {order.paymentNotes && (
            <Field label="Payment Notes" value={order.paymentNotes} />
          )}
          {order.signatureCapturedAt && (
            <Field label="Signature Captured" value={fmtDateTime(order.signatureCapturedAt)} icon={<PenLine size={11} />} />
          )}
        </EPCard>
      )}

      {/* POD photos pulled from DT export.xml. Photo bytes live in
          our dt-pod-photos storage bucket; signed URLs are issued
          with a 1-hour TTL by fetchDtOrderPhotos. Click thumbnail
          to open the full-res in a new tab. */}
      {photos.length > 0 && (
        <EPCard>
          <SectionTitle>POD Photos ({photos.length})</SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
            {photos.map(p => (
              <a
                key={p.id}
                href={p.fullUrl ?? '#'}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'block', borderRadius: 8, overflow: 'hidden', border: `1px solid ${theme.colors.border}`, background: '#FAFAF9', textDecoration: 'none', color: 'inherit' }}
                title={p.capturedAt ? fmtDateTime(p.capturedAt) : p.dtImageName}
                onClick={e => { if (!p.fullUrl) e.preventDefault(); }}
              >
                {p.thumbnailUrl ? (
                  <img
                    src={p.thumbnailUrl}
                    alt={p.dtImageName}
                    loading="lazy"
                    style={{ width: '100%', height: 120, objectFit: 'cover', display: 'block' }}
                  />
                ) : (
                  <div style={{ width: '100%', height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: EP.textMuted }}>
                    {p.fetchError ? 'Fetch failed' : 'Loading…'}
                  </div>
                )}
                {p.capturedAt && (
                  <div style={{ fontSize: 10, color: EP.textMuted, padding: '4px 6px', borderTop: `1px solid ${theme.colors.border}` }}>
                    {fmtDateTime(p.capturedAt)}
                  </div>
                )}
              </a>
            ))}
          </div>
        </EPCard>
      )}

      {/* DT-side notes (driver/dispatcher posted in DispatchTrack) */}
      {notes.length > 0 && (
        <EPCard>
          <SectionTitle>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <MessageSquare size={11} /> DT Notes ({notes.length})
            </span>
          </SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {notes.map((n) => (
              <div key={n.id} style={{ padding: '8px 10px', background: '#F8FAFC', borderRadius: 8, border: `1px solid ${theme.colors.border}` }}>
                <div style={{ fontSize: 12, color: EP.textPrimary, whiteSpace: 'pre-wrap' }}>{n.body}</div>
                <div style={{ fontSize: 10, color: EP.textMuted, marginTop: 4 }}>
                  {n.authorName || 'DispatchTrack'}
                  {n.authorType && n.authorType !== 'system' ? ` · ${n.authorType}` : ''}
                  {n.createdAtDt ? ` · ${fmtDateTime(n.createdAtDt)}` : ''}
                </div>
              </div>
            ))}
          </div>
        </EPCard>
      )}

      {/* Driver Activity moved into the Activity tab. EntityHistory now
          merges entity_audit_log (app actions) and dt_order_history
          (DT-side driver events) into one chronological timeline with
          App / Driver origin tags. The standalone Details-tab block
          rendered the same dt_order_history rows here, so removing it
          eliminates the duplicate timeline. */}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function OrderPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canReview = user?.role === 'admin' || user?.role === 'staff';

  const { order: fetchedOrder, status, error, refetch } = useOrderDetail(orderId);

  // Local copy for optimistic updates
  const [localOrder, setLocalOrder] = useState<DtOrderForUI | null>(null);
  useEffect(() => { if (fetchedOrder) setLocalOrder(fetchedOrder); }, [fetchedOrder]);

  const order = localOrder ?? fetchedOrder;

  // Edit state
  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState<OrderEdit>(() => order ? orderToEdit(order) : orderToEdit({} as DtOrderForUI));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // DT sync-back data — driver activity timeline + DT-side notes pulled
  // from the cache columns the dt-sync-statuses Edge Function writes.
  // Reload alongside the order so a Push-to-DT or DT Sync click refreshes
  // both. Empty until first sync runs.
  const [dtHistory, setDtHistory] = useState<DtOrderHistoryEvent[]>([]);
  const [dtNotes, setDtNotes] = useState<DtSideNote[]>([]);
  const [dtPhotos, setDtPhotos] = useState<DtOrderPhoto[]>([]);
  const [dtAuxLoading, setDtAuxLoading] = useState(false);
  useEffect(() => {
    if (!order?.id) return;
    let cancelled = false;
    setDtAuxLoading(true);
    Promise.all([
      fetchDtOrderHistory(order.id),
      fetchDtOrderNotes(order.id),
      fetchDtOrderPhotos(order.id),
    ])
      .then(([h, n, p]) => {
        if (cancelled) return;
        setDtHistory(h);
        setDtNotes(n);
        setDtPhotos(p);
      })
      .finally(() => { if (!cancelled) setDtAuxLoading(false); });
    return () => { cancelled = true; };
  }, [order?.id, order?.lastSyncedAt]);

  // Reject / Request Revision: prompts the reviewer for notes, persists
  // review_status + review_notes + reviewed_at, then fires the
  // notify-order-revision Edge Function which emails BOTH the office
  // distro (NOTIFICATION_EMAILS secret) AND the order submitter
  // (resolved server-side from created_by_user → profiles.email).
  // Email send is best-effort: failures are logged via console.warn
  // and do NOT unwind the review_status change. The status persisted
  // either way; an ops re-send is a one-line edit-resend if needed.
  const handleReviewAction = useCallback(async (action: 'revision_requested' | 'rejected') => {
    if (!order) return;
    const promptLabel = action === 'rejected'
      ? 'Reason for rejecting (will be emailed to the submitter):'
      : 'What revisions are needed? (will be emailed to the submitter):';
    const notes = window.prompt(promptLabel, order.reviewNotes || '');
    if (notes === null) return; // cancelled
    setSaving(true);
    setSaveError(null);
    try {
      const { data: authData } = await supabase.auth.getUser();
      const reviewerUid = authData?.user?.id ?? null;
      let reviewerName = 'Stride Reviewer';
      if (reviewerUid) {
        const { data: prof } = await supabase
          .from('profiles')
          .select('display_name, email')
          .eq('id', reviewerUid)
          .maybeSingle();
        reviewerName = (prof?.display_name as string) || (prof?.email as string) || reviewerName;
      }

      const { error: updErr } = await supabase
        .from('dt_orders')
        .update({
          review_status: action,
          review_notes:  notes.trim() || null,
          reviewed_by:   reviewerUid,
          reviewed_at:   new Date().toISOString(),
        })
        .eq('id', order.id);
      if (updErr) throw updErr;

      // Audit: reviewer rejected or requested-revision. Best-effort.
      void logDtOrderAudit({
        orderId: order.id,
        tenantId: order.tenantId,
        action: action === 'rejected' ? 'reject' : 'revision_requested',
        changes: {
          reviewStatus: { old: order.reviewStatus, new: action },
          reviewerName,
          reviewNotes: notes.trim() || null,
        },
        performedBy: user?.email ?? null,
      });

      // Best-effort email — don't unwind the status change on send fail.
      try {
        const { data, error: invokeErr } = await supabase.functions.invoke('notify-order-revision', {
          body: {
            orderId: order.id,
            action,
            reviewerName,
            reviewNotes: notes.trim(),
          },
        });
        if (invokeErr) console.warn('[OrderPage] notify-order-revision invoke error:', invokeErr.message);
        else if (data && (data as { ok?: boolean }).ok === false) {
          console.warn('[OrderPage] notify-order-revision returned ok:false', data);
        }
      } catch (e) {
        console.warn('[OrderPage] notify-order-revision threw', e);
      }

      const fresh = await fetchDtOrderByIdFromSupabase(order.id);
      if (fresh) setLocalOrder(fresh);
      refetch();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [order, refetch, user?.email]);

  // Phase A — Edit Full Order: opens the same form the create flow uses
  // (CreateDeliveryOrderModal in editOrderId mode). The detail page's
  // inline Edit covers the common fields fast; the full-form modal is
  // for everything else (mode change, items, accessorials, coverage).
  const [showFullEditModal, setShowFullEditModal] = useState(false);
  // Push-to-DT state — wires the existing dt-push-order Edge Function
  // to the detail page footer so reviewers don't have to navigate to
  // the Review queue.
  const [pushingDt, setPushingDt] = useState(false);
  const [pushDtError, setPushDtError] = useState<string | null>(null);
  // Manual inventory release on completed delivery orders. Reuses
  // ReleaseItemsModal (same flow Inventory.tsx uses), pre-selects all
  // dt_order_items rows that have an inventory_id linkage, and defaults
  // the release date to the delivery's finished_at.
  const [showReleaseModal, setShowReleaseModal] = useState(false);

  useEffect(() => {
    if (order && !editing) setEdit(orderToEdit(order));
  }, [order, editing]);

  const setField = useCallback(<K extends keyof OrderEdit>(k: K, v: OrderEdit[K]) => {
    setEdit(prev => ({ ...prev, [k]: v }));
  }, []);

  const handleStartEdit = useCallback(() => {
    if (order) setEdit(orderToEdit(order));
    setSaveError(null);
    setEditing(true);
  }, [order]);

  const handleCancelEdit = useCallback(() => { setEditing(false); setSaveError(null); }, []);

  const handleSave = useCallback(async () => {
    if (!order) return;
    setSaving(true);
    setSaveError(null);

    // Optimistic — paint the edited values into local state immediately so
    // the inline form's "Save" doesn't visibly flash old data while we
    // round-trip to Supabase and back. DtOrderForUI uses '' (not null) for
    // empty fields, so trim() the edited values directly.
    const optimisticOrder: DtOrderForUI = {
      ...order,
      contactName:       edit.contactName.trim(),
      contactAddress:    edit.contactAddress.trim(),
      contactCity:       edit.contactCity.trim(),
      contactState:      edit.contactState.trim(),
      contactZip:        edit.contactZip.trim(),
      contactPhone:      edit.contactPhone.trim(),
      contactEmail:      edit.contactEmail.trim(),
      localServiceDate:  edit.localServiceDate,
      windowStartLocal:  edit.windowStartLocal,
      windowEndLocal:    edit.windowEndLocal,
      poNumber:          edit.poNumber.trim(),
      sidemark:          edit.sidemark.trim(),
      clientReference:   edit.clientReference.trim(),
      details:           edit.details.trim(),
      reviewStatus:      edit.reviewStatus,
      reviewNotes:       edit.reviewNotes.trim(),
    };

    try {
      const { data: authData } = await supabase.auth.getUser();
      const reviewerUid = authData?.user?.id ?? null;

      const patch: Record<string, unknown> = {
        contact_name:       edit.contactName.trim()     || null,
        contact_address:    edit.contactAddress.trim()  || null,
        contact_city:       edit.contactCity.trim()     || null,
        contact_state:      edit.contactState.trim()    || null,
        contact_zip:        edit.contactZip.trim()      || null,
        contact_phone:      edit.contactPhone.trim()    || null,
        contact_email:      edit.contactEmail.trim()    || null,
        local_service_date: edit.localServiceDate       || null,
        window_start_local: edit.windowStartLocal       || null,
        window_end_local:   edit.windowEndLocal         || null,
        po_number:          edit.poNumber.trim()        || null,
        sidemark:           edit.sidemark.trim()        || null,
        client_reference:   edit.clientReference.trim() || null,
        details:            edit.details.trim()         || null,
        review_status:      edit.reviewStatus,
        review_notes:       edit.reviewNotes.trim()     || null,
        reviewed_by:        reviewerUid,
        reviewed_at:        new Date().toISOString(),
      };

      const newTotal    = edit.orderTotal      === '' ? null : Number(edit.orderTotal);
      const newBaseFee  = edit.baseDeliveryFee === '' ? null : Number(edit.baseDeliveryFee);
      const pricingChanged = newTotal !== order.orderTotal || newBaseFee !== order.baseDeliveryFee;
      if (pricingChanged) {
        patch.order_total       = newTotal;
        patch.base_delivery_fee = newBaseFee;
        patch.pricing_override  = true;
        optimisticOrder.orderTotal      = newTotal;
        optimisticOrder.baseDeliveryFee = newBaseFee;
      }

      // Apply the optimistic version BEFORE the network round-trip — the
      // user sees their edits the instant they hit Save.
      setLocalOrder(optimisticOrder);

      const { error: err } = await supabase.from('dt_orders').update(patch).eq('id', order.id);
      if (err) throw err;

      // Audit: inline edit save. Best-effort. Diff is coarse (which
      // top-level fields changed); the patch object is the canonical
      // record of what got written.
      const changedFields: string[] = [];
      if (edit.contactName     !== (order.contactName     ?? '')) changedFields.push('contactName');
      if (edit.contactAddress  !== (order.contactAddress  ?? '')) changedFields.push('contactAddress');
      if (edit.contactCity     !== (order.contactCity     ?? '')) changedFields.push('contactCity');
      if (edit.contactState    !== (order.contactState    ?? '')) changedFields.push('contactState');
      if (edit.contactZip      !== (order.contactZip      ?? '')) changedFields.push('contactZip');
      if (edit.contactPhone    !== (order.contactPhone    ?? '')) changedFields.push('contactPhone');
      if (edit.contactEmail    !== (order.contactEmail    ?? '')) changedFields.push('contactEmail');
      if (edit.localServiceDate !== (order.localServiceDate ?? '')) changedFields.push('localServiceDate');
      if (edit.windowStartLocal !== ((order.windowStartLocal ?? '').slice(0, 5))) changedFields.push('windowStartLocal');
      if (edit.windowEndLocal   !== ((order.windowEndLocal   ?? '').slice(0, 5))) changedFields.push('windowEndLocal');
      if (edit.poNumber        !== (order.poNumber        ?? '')) changedFields.push('poNumber');
      if (edit.sidemark        !== (order.sidemark        ?? '')) changedFields.push('sidemark');
      if (edit.clientReference !== (order.clientReference ?? '')) changedFields.push('clientReference');
      if (edit.details         !== (order.details         ?? '')) changedFields.push('details');
      if (edit.reviewStatus    !== order.reviewStatus)             changedFields.push('reviewStatus');
      if (edit.reviewNotes     !== (order.reviewNotes     ?? '')) changedFields.push('reviewNotes');
      if (pricingChanged)                                          changedFields.push('pricing');
      void logDtOrderAudit({
        orderId: order.id,
        tenantId: order.tenantId,
        action: 'update',
        changes: {
          fieldsChanged: changedFields,
          ...(edit.reviewStatus !== order.reviewStatus
            ? { reviewStatus: { old: order.reviewStatus, new: edit.reviewStatus } }
            : {}),
          ...(pricingChanged
            ? { orderTotal: { old: order.orderTotal, new: newTotal },
                baseDeliveryFee: { old: order.baseDeliveryFee, new: newBaseFee } }
            : {}),
        },
        performedBy: user?.email ?? null,
      });

      // If the inline edit flipped review_status into a state that
      // emails the submitter (revision_requested / rejected), fire the
      // notify-order-revision Edge Function. The footer Reject /
      // Request Revision buttons already do this, but operators can
      // also reach the same states via the Review-Status dropdown
      // inside the inline edit form — without this branch those would
      // silently skip the email. Best-effort: a send failure logs warn
      // but doesn't unwind the saved status.
      const reviewActionable = (edit.reviewStatus === 'revision_requested' || edit.reviewStatus === 'rejected')
        && edit.reviewStatus !== order.reviewStatus;
      if (reviewActionable) {
        let reviewerName = 'Stride Reviewer';
        if (reviewerUid) {
          const { data: prof } = await supabase
            .from('profiles')
            .select('display_name, email')
            .eq('id', reviewerUid)
            .maybeSingle();
          reviewerName = (prof?.display_name as string) || (prof?.email as string) || reviewerName;
        }
        try {
          const { data, error: invokeErr } = await supabase.functions.invoke('notify-order-revision', {
            body: {
              orderId: order.id,
              action:  edit.reviewStatus,
              reviewerName,
              reviewNotes: edit.reviewNotes.trim(),
            },
          });
          if (invokeErr) console.warn('[OrderPage] notify-order-revision invoke error:', invokeErr.message);
          else if (data && (data as { ok?: boolean }).ok === false) {
            console.warn('[OrderPage] notify-order-revision returned ok:false', data);
          }
        } catch (e) {
          console.warn('[OrderPage] notify-order-revision threw', e);
        }
      }

      setEditing(false);
      // Refresh from Supabase so local copy reflects persisted data
      const fresh = await fetchDtOrderByIdFromSupabase(order.id);
      if (fresh) setLocalOrder(fresh);
      refetch();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [order, edit, refetch, user?.email]);

  // ── Loading / error states ─────────────────────────────────────────────────

  if (status === 'loading') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16, color: theme.colors.textMuted }}>
        <Loader2 size={32} style={{ animation: 'spin 1s linear infinite' }} />
        <div style={{ fontSize: 14 }}>Loading order…</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    );
  }
  if (status === 'not-found') return <PageState icon={SearchX} color={theme.colors.textMuted} title="Order Not Found" body={`No order found with this ID.`} actions={<button onClick={() => navigate('/orders')} style={backBtnStyle}>Back to Orders</button>} />;
  if (status === 'error') {
    return (
      <PageState icon={AlertCircle} color={theme.colors.statusRed} title="Failed to Load Order" body={error || 'An unexpected error occurred.'}
        actions={<div style={{ display: 'flex', gap: 12 }}><button onClick={refetch} style={{ ...backBtnStyle, color: theme.colors.primary }}>Retry</button><button onClick={() => navigate('/orders')} style={backBtnStyle}>Back to Orders</button></div>}
      />
    );
  }
  if (!order) return null;

  // ── Header elements ────────────────────────────────────────────────────────

  const catCfg = CATEGORY_CFG[order.statusCategory] || CATEGORY_CFG.open;
  const reviewCfg = order.reviewStatus && order.reviewStatus !== 'not_required' ? REVIEW_CFG[order.reviewStatus] : null;

  const statusBadge = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {order.isPickup && (
        <span style={{ fontSize: 10, fontWeight: 700, background: '#FEF3C7', color: '#B45309', padding: '2px 8px', borderRadius: 10, letterSpacing: '1px', textTransform: 'uppercase' }}>PICKUP</span>
      )}
      <span style={{ fontSize: 12, fontWeight: 600, background: catCfg.bg, color: catCfg.color, padding: '3px 10px', borderRadius: 12 }}>
        {order.statusName || catCfg.label}
      </span>
      {reviewCfg && (
        <span style={{ fontSize: 12, fontWeight: 600, background: reviewCfg.bg, color: reviewCfg.color, padding: '3px 10px', borderRadius: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {reviewCfg.icon}{reviewCfg.label}
        </span>
      )}
    </span>
  );

  // ── Tabs ───────────────────────────────────────────────────────────────────

  const tabs = [
    {
      id: 'details',
      label: 'Details',
      keepMounted: true,
      render: () => (
        <DetailsTab
          order={order}
          editing={editing}
          edit={edit}
          setField={setField}
          saving={saving}
          saveError={saveError}
          onStartEdit={handleStartEdit}
          onCancelEdit={handleCancelEdit}
          onSave={handleSave}
        />
      ),
    },
    {
      id: 'items',
      label: 'Items',
      badgeCount: order.items?.length ?? 0,
      render: () => <ItemsTab items={order.items ?? []} />,
    },
    {
      id: 'completion',
      label: 'Completion',
      // Badge surfaces "fresh" data the operator hasn't seen yet — for
      // now we use the count of DT-side notes since those tend to flag
      // exceptions that need attention (driver/dispatcher notes don't
      // get posted unless something is worth saying).
      badgeCount: dtNotes.length > 0 ? dtNotes.length : undefined,
      render: () => (
        <CompletionTab
          order={order}
          notes={dtNotes}
          history={dtHistory}
          photos={dtPhotos}
          loading={dtAuxLoading}
        />
      ),
    },
    {
      id: 'activity',
      label: 'Activity',
      render: () => (
        <EPCard>
          <EntityHistory entityType="dt_order" entityId={order.id} tenantId={order.tenantId ?? undefined} />
        </EPCard>
      ),
    },
  ];

  // ── Footer ─────────────────────────────────────────────────────────────────

  // Inventory items on this order that the manual-release flow can act
  // on. dt_order_items.inventory_id is null for ad-hoc / free-text
  // lines (filtered out — nothing in Stride inventory to flip from
  // Active → Released for them). Dedup by inventory_id because two
  // order lines can reference the same physical item (e.g. return +
  // re-deliver pair); the modal's React keys + selection Set need
  // unique inventory_ids, and you can only release a physical item
  // once anyway.
  const releasableItems = (() => {
    // Existing dt_order_items rows have dt_item_code populated
    // (human-readable Item ID) but inventory_id (UUID FK) is null on
    // any order created before that column was added. Fall back to
    // dt_item_code so the Release Items button still appears for those
    // orders, and so the GAS releaseItems endpoint — which matches by
    // human-readable Item ID against the Inventory sheet — gets the
    // identifier it can actually look up. The UUID inventory_id alone
    // wouldn't match anything sheet-side anyway, so dt_item_code is
    // the practical linkage key here.
    const seen = new Set<string>();
    const out: typeof order.items = [];
    for (const it of order.items ?? []) {
      const linkId = it.inventoryId || it.dtItemCode;
      if (!linkId || seen.has(linkId)) continue;
      seen.add(linkId);
      out.push(it);
    }
    return out;
  })();
  const canReleaseItems =
    order.statusCategory === 'completed' &&
    !!order.tenantId &&
    releasableItems.length > 0;

  // Print PDF button — always available (admin / staff / client) so
  // anyone with permission to see the order can hand the customer a
  // printed copy or save one for their own records.
  const printButton = !editing ? (
    <EPFooterButton
      key="print-pdf"
      label="Print PDF"
      variant="secondary"
      onClick={() => generateOrderPdf(order)}
    />
  ) : null;

  const footerContent = canReview && !editing ? (
    <>
      {printButton}
      {/* Edit Full Order — opens the create-order modal in edit mode
          so the operator can change anything that the inline Edit
          buttons don't cover (mode, items, accessorials, coverage,
          billing method, service time, etc.). Same form the create
          flow uses; one source of truth. */}
      <EPFooterButton
        label="Edit Full Order"
        variant="secondary"
        onClick={() => setShowFullEditModal(true)}
      />
      {canReleaseItems && (
        <EPFooterButton
          label="Release Items"
          variant="primary"
          onClick={() => setShowReleaseModal(true)}
        />
      )}
      {(order.reviewStatus === 'pending_review' || order.reviewStatus === 'revision_requested') && (
        <>
          <EPFooterButton
            label="Approve"
            variant="primary"
            onClick={async () => {
              await supabase.from('dt_orders').update({ review_status: 'approved', reviewed_at: new Date().toISOString() }).eq('id', order.id);
              // Audit: approve. Best-effort.
              void logDtOrderAudit({
                orderId: order.id,
                tenantId: order.tenantId,
                action: 'approve',
                changes: { reviewStatus: { old: order.reviewStatus, new: 'approved' } },
                performedBy: user?.email ?? null,
              });
              const fresh = await fetchDtOrderByIdFromSupabase(order.id);
              if (fresh) setLocalOrder(fresh);
              refetch();
            }}
          />
          <EPFooterButton
            label="Request Revision"
            variant="secondary"
            onClick={() => handleReviewAction('revision_requested')}
          />
          <EPFooterButton
            label="Reject"
            variant="secondary"
            onClick={() => handleReviewAction('rejected')}
          />
        </>
      )}
      {/* v2026-05-04: Republish-to-DT support. Ashok confirmed DT's
          add_order is upsert-by-identifier, so re-posting the same
          order_number with an updated payload replaces the order in DT.
          We surface the affordance whenever the order has been edited
          since the last push (updated_at > pushed_to_dt_at) — operators
          get a one-click way to propagate item add/remove + field edits.
          The same button does first-time push when pushedToDtAt is null. */}
      {order.reviewStatus === 'approved' && (() => {
        const everPushed = !!order.pushedToDtAt;
        const stale = everPushed && !!order.updatedAt && new Date(order.updatedAt).getTime() > new Date(order.pushedToDtAt!).getTime();
        if (everPushed && !stale) return null;
        const label = pushingDt ? 'Pushing…' : (everPushed ? 'Republish to DT' : 'Push to DT');
        return (
        <EPFooterButton
          label={label}
          variant="primary"
          onClick={async () => {
            // Reviewers can push from the detail page now (was Review
            // tab only). Calls the dt-push-order Edge Function which
            // owns the XML build + DT API call + audit log.
            if (pushingDt) return;
            setPushingDt(true);
            setPushDtError(null);
            try {
              const { data, error: invokeErr } = await supabase.functions.invoke('dt-push-order', {
                body: { orderId: order.id },
              });
              // supabase.functions.invoke surfaces a generic
              // "Edge Function returned a non-2xx status code" on any
              // non-2xx, hiding the actual { error } body the
              // function returned. Pull the response body off the
              // FunctionsHttpError context so the toast carries the
              // real reason (e.g. "Order has no items", "DT API
              // error: <message>", "Linked pickup push failed: …").
              if (invokeErr) {
                let detailed = invokeErr.message;
                try {
                  const ctx = (invokeErr as { context?: { json?: () => Promise<unknown>; status?: number } }).context;
                  if (ctx?.json) {
                    const body = await ctx.json() as { error?: string; responseBody?: string } | null;
                    if (body?.error) {
                      detailed = body.error;
                      if (body.responseBody) detailed += ` (DT response: ${body.responseBody.slice(0, 200)})`;
                    }
                  }
                } catch (_) { /* fall back to invokeErr.message */ }
                throw new Error(detailed);
              }
              const res = data as { ok?: boolean; error?: string; dt_identifier?: string; linked_identifier?: string } | null;
              if (!res?.ok) throw new Error(res?.error || 'DT push failed');
              // Audit: push_to_dt. Best-effort. Done client-side so the
              // row is attributed to the authenticated user (the edge
              // function runs under service role and doesn't see the
              // caller's email). For P+D orders the edge function pushes
              // both legs; we stamp an audit row on the linked pickup's
              // dt_order_id too so its own Activity tab reflects the push.
              void logDtOrderAudit({
                orderId: order.id,
                tenantId: order.tenantId,
                action: 'push_to_dt',
                changes: {
                  dtIdentifier: res.dt_identifier ?? order.dtIdentifier,
                  ...(res.linked_identifier ? { linkedIdentifier: res.linked_identifier } : {}),
                  orderType: order.orderType,
                  itemCount: order.items?.length ?? 0,
                },
                performedBy: user?.email ?? null,
              });
              if (res.linked_identifier && order.linkedOrderId) {
                void logDtOrderAudit({
                  orderId: order.linkedOrderId,
                  tenantId: order.tenantId,
                  action: 'push_to_dt',
                  changes: {
                    dtIdentifier: res.linked_identifier,
                    linkedIdentifier: res.dt_identifier ?? order.dtIdentifier,
                    pushedAlongsideDelivery: true,
                  },
                  performedBy: user?.email ?? null,
                });
              }
              const fresh = await fetchDtOrderByIdFromSupabase(order.id);
              if (fresh) setLocalOrder(fresh);
              refetch();
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              console.error('[OrderPage] DT push failed:', msg, e);
              setPushDtError(msg);
            } finally {
              setPushingDt(false);
            }
          }}
        />
        );
      })()}
    </>
  ) : printButton;

  const hasFooter = footerContent !== null && React.Children.count(footerContent) > 0;

  return (
    <>
      {pushDtError && (
        <div role="alert" style={{
          position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)',
          zIndex: 1100, padding: '14px 18px', background: '#FEF2F2',
          border: '1px solid #FCA5A5', color: '#991B1B', borderRadius: 10,
          fontSize: 13, maxWidth: 720, boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
          display: 'flex', alignItems: 'flex-start', gap: 10,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>DT push failed</div>
            <div style={{ fontWeight: 400, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{pushDtError}</div>
          </div>
          <button
            onClick={() => setPushDtError(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#991B1B', fontWeight: 700, fontSize: 18, lineHeight: 1, padding: 0, flexShrink: 0 }}
            aria-label="Dismiss"
          >×</button>
        </div>
      )}
      <EntityPage
        entityLabel="ORDER"
        entityId={order.dtIdentifier || order.id.slice(0, 8).toUpperCase()}
        statusBadge={statusBadge}
        clientName={order.clientName || undefined}
        tabs={tabs}
        initialTabId="details"
        footer={hasFooter ? footerContent : undefined}
      />
      {showFullEditModal && (
        <CreateDeliveryOrderModal
          editOrderId={order.id}
          onClose={() => setShowFullEditModal(false)}
          onSubmit={async () => {
            setShowFullEditModal(false);
            // Refetch the order so the page reflects whatever changed
            // in the modal (status flip, identifier replacement on
            // promote, fields, items, accessorials, coverage, etc.).
            const fresh = await fetchDtOrderByIdFromSupabase(order.id);
            if (fresh) setLocalOrder(fresh);
            refetch();
          }}
        />
      )}
      {showReleaseModal && order.tenantId && (
        <ReleaseItemsModal
          // dt_item_code is the human-readable Item ID GAS releaseItems
          // matches against in the Inventory sheet. inventoryId (UUID)
          // is kept as a fallback only for rows that legitimately have
          // no dt_item_code — see the releasableItems comment above.
          itemIds={releasableItems.map(it => (it.dtItemCode || it.inventoryId)!)}
          clientName={order.clientName || 'this client'}
          clientSheetId={order.tenantId}
          defaultReleaseDate={order.finishedAt ? order.finishedAt.slice(0, 10) : undefined}
          selectableItems={releasableItems.map(it => ({
            id: (it.dtItemCode || it.inventoryId)!,
            label: it.description || it.dtItemCode || 'Item',
            sublabel: [
              it.dtItemCode && `SKU ${it.dtItemCode}`,
              it.quantity != null && `Qty ${it.quantity}`,
            ].filter(Boolean).join(' · ') || undefined,
          }))}
          onClose={() => setShowReleaseModal(false)}
          onSuccess={async () => {
            // Refetch so the page reflects the released items (and any
            // dt_orders mirror columns that change as a side effect).
            const fresh = await fetchDtOrderByIdFromSupabase(order.id);
            if (fresh) setLocalOrder(fresh);
            refetch();
          }}
        />
      )}
    </>
  );
}
