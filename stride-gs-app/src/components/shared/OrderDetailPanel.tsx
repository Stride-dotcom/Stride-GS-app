import React from 'react';
import { X, MapPin, Phone, Mail, Calendar, Clock, Package, FileText, Truck } from 'lucide-react';
import { theme } from '../../styles/theme';
import { getPanelContainerStyle, panelBackdropStyle } from './panelStyles';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useResizablePanel } from '../../hooks/useResizablePanel';
import type { DtOrderForUI } from '../../lib/supabaseQueries';
import { createPortal } from 'react-dom';

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

          {/* Details / Notes */}
          {(order.details || order.latestNotePreview) && (
            <Section title="Notes">
              {order.details && <Field label="Details" value={order.details} />}
              {order.latestNotePreview && <Field label="Latest Note" value={order.latestNotePreview} />}
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
