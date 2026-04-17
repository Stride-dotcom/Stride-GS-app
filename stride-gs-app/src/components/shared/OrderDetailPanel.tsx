import React from 'react';
import { X, MapPin, Phone, Mail, Calendar, Clock, Package, FileText, Truck, DollarSign, CheckCircle2, AlertCircle, Clock3 } from 'lucide-react';
import { theme } from '../../styles/theme';
import { getPanelContainerStyle, panelBackdropStyle } from './panelStyles';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useResizablePanel } from '../../hooks/useResizablePanel';
import type { DtOrderForUI, DtOrderItemForUI } from '../../lib/supabaseQueries';
import { createPortal } from 'react-dom';

// Human-readable labels + chip config for review workflow states
const REVIEW_CFG: Record<string, { bg: string; color: string; label: string; icon: React.ReactNode }> = {
  pending_review:      { bg: '#FEF3C7', color: '#B45309', label: 'Pending Review',   icon: <Clock3 size={11} /> },
  approved:            { bg: '#DCFCE7', color: '#166534', label: 'Approved',         icon: <CheckCircle2 size={11} /> },
  rejected:            { bg: '#FEE2E2', color: '#991B1B', label: 'Rejected',         icon: <AlertCircle size={11} /> },
  revision_requested:  { bg: '#FEF3C7', color: '#92400E', label: 'Revision Needed',  icon: <AlertCircle size={11} /> },
};

function fmtCurrency(n: number): string {
  return `$${n.toFixed(2)}`;
}

interface Props {
  order: DtOrderForUI;
  onClose: () => void;
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
  // Time values come as "HH:MM:SS" from Postgres time column, NOT as ISO dates.
  // Parse manually to display as "10:00 AM – 12:00 PM"
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

export function OrderDetailPanel({ order, onClose }: Props) {
  const { isMobile } = useIsMobile();
  const { width: panelWidth, handleMouseDown } = useResizablePanel(480, 'order', isMobile);

  const cfg = CATEGORY_CFG[order.statusCategory] || CATEGORY_CFG.open;
  const addressLine = [order.contactAddress, order.contactCity, order.contactState, order.contactZip]
    .filter(Boolean).join(', ');

  const panel = (
    <>
      <div style={panelBackdropStyle} onClick={onClose} />
      <div style={getPanelContainerStyle(panelWidth, isMobile)}>
        {/* Resize handle */}
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
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: theme.colors.textMuted, flexShrink: 0 }}>
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>

          {/* Schedule */}
          <Section title="Schedule">
            <Field label="Service Date" value={formatDate(order.localServiceDate)} icon={<Calendar size={11} />} />
            <Field label="Time Window" value={formatWindow(order.windowStartLocal, order.windowEndLocal, order.timezone)} icon={<Clock size={11} />} />
          </Section>

          {/* Contact */}
          <Section title="Contact">
            <Field label="Name" value={order.contactName} />
            <Field label="Address" value={addressLine} icon={<MapPin size={11} />} />
            <Field label="Phone" value={order.contactPhone} icon={<Phone size={11} />} />
            <Field label="Email" value={order.contactEmail} icon={<Mail size={11} />} />
          </Section>

          {/* Order Details */}
          <Section title="Order Details">
            <Field label="PO Number" value={order.poNumber} icon={<FileText size={11} />} />
            <Field label="Sidemark" value={order.sidemark} icon={<Package size={11} />} />
            <Field label="Client Reference" value={order.clientReference} />
            <Field label="Source" value={order.source} icon={<Truck size={11} />} />
            {order.dtDispatchId != null && (
              <Field label="Dispatch ID" value={String(order.dtDispatchId)} />
            )}
          </Section>

          {/* Pricing — shown when any pricing field is populated */}
          {(order.baseDeliveryFee != null || order.orderTotal != null || (order.accessorials?.length ?? 0) > 0) && (
            <Section title="Pricing">
              {order.baseDeliveryFee != null && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
                  <span style={{ color: theme.colors.textMuted }}>
                    {order.isPickup ? 'Base Pickup Fee' : 'Base Delivery Fee'}
                  </span>
                  <span style={{ fontWeight: 500 }}>{fmtCurrency(order.baseDeliveryFee)}</span>
                </div>
              )}
              {order.extraItemsCount > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
                  <span style={{ color: theme.colors.textMuted }}>
                    Extra Items ({order.extraItemsCount} × $25)
                  </span>
                  <span style={{ fontWeight: 500 }}>{fmtCurrency(order.extraItemsFee)}</span>
                </div>
              )}
              {order.accessorials?.map((acc, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
                  <span style={{ color: theme.colors.textMuted }}>
                    {acc.code}{acc.quantity > 1 ? ` × ${acc.quantity}` : ''}
                  </span>
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
                      <span style={{ fontSize: 10, fontWeight: 600, background: '#FEF3C7', color: '#B45309', padding: '1px 6px', borderRadius: 6, marginLeft: 6 }}>
                        MANUAL
                      </span>
                    )}
                  </span>
                  <span>{fmtCurrency(order.orderTotal)}</span>
                </div>
              )}
              {order.pricingNotes && (
                <div style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: 8, fontStyle: 'italic' }}>
                  {order.pricingNotes}
                </div>
              )}
            </Section>
          )}

          {/* Review — only when there's an active review workflow on this order */}
          {order.reviewStatus && order.reviewStatus !== 'not_required' && (
            <Section title="Review">
              {order.createdByRole && (
                <Field label="Created By" value={order.createdByRole} />
              )}
              {order.reviewNotes && (
                <Field label="Review Notes" value={order.reviewNotes} />
              )}
              {order.reviewedAt && (
                <Field label="Reviewed At" value={new Date(order.reviewedAt).toLocaleString()} />
              )}
              {order.pushedToDtAt && (
                <Field label="Pushed to DT" value={new Date(order.pushedToDtAt).toLocaleString()} />
              )}
            </Section>
          )}

          {/* Details / Notes */}
          {(order.details || order.latestNotePreview) && (
            <Section title="Notes">
              {order.details && <Field label="Details" value={order.details} />}
              {order.latestNotePreview && <Field label="Latest Note" value={order.latestNotePreview} />}
            </Section>
          )}

          {/* Items — at the bottom in case the list is long */}
          {order.items && order.items.length > 0 && (
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
                      {item.dtItemCode && (
                        <span><span style={{ fontWeight: 500 }}>SKU:</span> {item.dtItemCode}</span>
                      )}
                      {item.quantity != null && (
                        <span><span style={{ fontWeight: 500 }}>Qty:</span> {item.quantity}</span>
                      )}
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
            </Section>
          )}

          {/* Meta */}
          {order.lastSyncedAt && (
            <div style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: 8 }}>
              Last synced: {new Date(order.lastSyncedAt).toLocaleString()}
            </div>
          )}
        </div>
      </div>
    </>
  );

  return createPortal(panel, document.body);
}
