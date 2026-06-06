/**
 * OrderPage.tsx — Full-page delivery order detail view.
 * Route: #/orders/:orderId
 *
 * Uses the EntityPage shell (locked design spec). Fetches the order via
 * useOrderDetail and renders Details / Items / Activity tabs.
 */
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import {
  AlertCircle, Loader2, SearchX, Pencil, X,
  CheckCircle2, Clock3, DollarSign, MapPin, Phone,
  Mail, Calendar, Clock, Package, FileText, Truck,
  User, PenLine, MessageSquare, Lock, PackageCheck,
  // v2026-05-09 — mobile FAB pattern (matches TaskDetailPanel /
  // RepairDetailPanel / WillCallDetailPanel). Approve / Push to DT /
  // Release Items stay inline as the chosen primary; Print PDF, Edit
  // Full Order, Request Revision, Reject, and Discard Draft collapse
  // into the FAB overflow on mobile.
  Printer, Edit3, XCircle, Trash2, RefreshCw,
} from 'lucide-react';
import { theme } from '../styles/theme';
import { BtnSpinner } from '../components/ui/BtnSpinner';
import { useAuth } from '../contexts/AuthContext';
import { useFeatureFlagRow, resolveFlagBackend } from '../contexts/FeatureFlagContext';
import { OrderCodStorageCard } from '../components/shared/OrderCodStorageCard';
import { useOrderDetail } from '../hooks/useOrderDetail';
import { useGoBack } from '../hooks/useGoBack';
import {
  fetchDtOrderByIdFromSupabase,
  fetchDtOrderHistory,
  fetchDtOrderNotes,
  fetchDtOrderPhotos,
} from '../lib/supabaseQueries';
import type {
  DtOrderForUI,
  DtOrderHistoryEvent,
  DtSideNote,
  DtOrderPhoto,
} from '../lib/supabaseQueries';
import {
  EntityPage, EPCard, EPLabel, EPFooterButton, EntityPageTokens as EP,
} from '../components/shared/EntityPage';
import { EntityHistory } from '../components/shared/EntityHistory';
import { PhotosPanel, DocumentsPanel } from '../components/shared/EntityAttachments';
import { useServiceCatalog } from '../hooks/useServiceCatalog';
import { supabase } from '../lib/supabase';
import { CreateDeliveryOrderModal } from '../components/shared/CreateDeliveryOrderModal';
import { AddPickupLegModal } from '../components/shared/AddPickupLegModal';
import { DtOrderReleasePanel, type ReleasableItem } from '../components/shared/DtOrderReleasePanel';
import { useIsMobile } from '../hooks/useIsMobile';
import { FloatingActionMenu, type FABAction } from '../components/shared/FloatingActionMenu';
import { generateOrderPdf } from '../lib/orderPdf';
import { logDtOrderAudit } from '../lib/dtOrderAudit';
import { ConfirmDialog } from '../components/shared/ConfirmDialog';
import { summarizeDtChanges, DT_GROUP_LABEL, type DtFieldGroup, type DtChangeSummary } from '../lib/dtSelectivePush';

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
  driverNotes: string;
  // v42 — per-leg notes split. pickupNotes goes to the linked PU
  // leg's pickup_notes column on save (when this is the delivery leg).
  // deliveryNotes goes to this row's delivery_notes. dt-push-order
  // reads each leg's per-leg column when building the DT Public note,
  // falling back to driverNotes for rows created pre-split.
  pickupNotes: string;
  deliveryNotes: string;
  internalNotes: string;
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
    driverNotes:      o.driverNotes ?? '',
    // Default the per-leg fields to the legacy driverNotes when the
    // new column is empty, so an operator editing a pre-split row
    // sees the legacy text in the field they're about to push on
    // (rather than losing it visually). On save it lands in the
    // per-leg column and the legacy column is left untouched (the
    // back-compat fallback in dt-push-order keeps things consistent
    // for any other consumer that hasn't been updated yet).
    pickupNotes:      o.pickupNotes   || ((o.orderType === 'pickup') ? (o.driverNotes ?? '') : ''),
    deliveryNotes:    o.deliveryNotes || ((o.orderType !== 'pickup') ? (o.driverNotes ?? '') : ''),
    internalNotes:    o.internalNotes ?? '',
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
  try { return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }); }
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

// Compact inline-items table styles. The full-fidelity per-item card
// view used to live in the (now-removed) Items tab; the Details tab
// renders this denser table instead so everything about the order is
// visible without tab-switching.
const inlineItemTh: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, letterSpacing: '0.05em',
  textTransform: 'uppercase', color: theme.colors.textMuted,
  padding: '6px 10px',
  borderBottom: `1px solid ${theme.colors.border}`,
};
const inlineItemTd: React.CSSProperties = {
  padding: '6px 10px', verticalAlign: 'top',
};

// ── Details tab content ───────────────────────────────────────────────────────

// v2026-05-09 — display-name map for the client-resubmit diff banner.
// Keys are dt_orders column names (or synthetic 'items' from
// computeResubmitDiff in CreateDeliveryOrderModal). Anything not in
// the map renders with a humanized fallback (snake_case → Title Case).
const RESUBMIT_FIELD_LABELS: Record<string, string> = {
  local_service_date:   'Service Date',
  window_start_local:   'Window Start',
  window_end_local:     'Window End',
  po_number:            'PO Number',
  sidemark:             'Sidemark',
  details:              'Order Details',
  driver_notes:         'Driver Notes',
  contact_name:         'Contact Name',
  contact_address:      'Contact Address',
  contact_city:         'Contact City',
  contact_state:        'Contact State',
  contact_zip:          'Contact ZIP',
  contact_phone:        'Contact Phone',
  contact_phone2:       'Contact Phone 2',
  contact_email:        'Contact Email',
  billing_method:       'Billing Method',
  service_time_minutes: 'Service Time (min)',
  order_type:           'Order Type',
  coverage_option_id:   'Coverage Option',
  declared_value:       'Declared Value',
  items:                'Items',
};

function humanizeFieldKey(key: string): string {
  if (RESUBMIT_FIELD_LABELS[key]) return RESUBMIT_FIELD_LABELS[key];
  return key.replace(/^_+/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatResubmitValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'object') {
    // Synthetic 'items' diff carries { count: N }
    const obj = v as Record<string, unknown>;
    if ('count' in obj) return `${obj.count} item(s)`;
    return JSON.stringify(obj);
  }
  return String(v);
}

/**
 * v2026-05-09 — resubmit banner. Renders at the top of the OrderPage
 * Details tab whenever a client-resubmit diff is recorded on the
 * order. Cleared by the staff Approve handler (sets lastResubmitAt
 * back to null), so the banner survives until staff acknowledges by
 * approving — which is the load-bearing UX guarantee here.
 */
function ResubmitBanner({ order }: { order: DtOrderForUI }) {
  if (!order.lastResubmitAt || !order.lastResubmitDiff) return null;
  const entries = Object.entries(order.lastResubmitDiff);
  if (entries.length === 0) return null;
  const when = fmtDateTime(order.lastResubmitAt);
  const who = order.lastResubmitBy || 'Client';
  return (
    <div style={{
      borderRadius: 10,
      border: '1px solid #BFDBFE',
      background: '#EFF6FF',
      padding: '14px 16px',
      fontFamily: theme.typography.fontFamily,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8,
        fontSize: 13, fontWeight: 700, color: '#1E40AF',
      }}>
        <PenLine size={14} />
        <span>Updated by {who} on {when}</span>
      </div>
      <div style={{ fontSize: 12, color: '#1E3A8A', marginBottom: 8 }}>
        Review the changes below — re-approving clears this banner.
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '6px 8px', color: '#1E40AF', borderBottom: '1px solid #BFDBFE', fontWeight: 600, width: '30%' }}>Field</th>
            <th style={{ textAlign: 'left', padding: '6px 8px', color: '#1E40AF', borderBottom: '1px solid #BFDBFE', fontWeight: 600, width: '35%' }}>Was</th>
            <th style={{ textAlign: 'left', padding: '6px 8px', color: '#1E40AF', borderBottom: '1px solid #BFDBFE', fontWeight: 600, width: '35%' }}>Now</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([key, val]) => (
            <tr key={key}>
              <td style={{ padding: '6px 8px', color: theme.colors.text, fontWeight: 600, verticalAlign: 'top' }}>
                {humanizeFieldKey(key)}
              </td>
              <td style={{ padding: '6px 8px', color: '#991B1B', textDecoration: 'line-through', verticalAlign: 'top', wordBreak: 'break-word' }}>
                {formatResubmitValue(val.old)}
              </td>
              <td style={{ padding: '6px 8px', color: '#166534', fontWeight: 600, verticalAlign: 'top', wordBreak: 'break-word' }}>
                {formatResubmitValue(val.new)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// v2026-05-13 — pickup-completion banner shown on the DELIVERY view
// of a P+D pair when the linked pickup leg has completed. Driven by
// dt_orders.linked_pickup_finished_at + linked_pickup_driver_name,
// populated by the stamp-pickup-on-linked-delivery shared helper.
//
// Two display states:
//   • Webhook-fresh (driver_name still NULL): "Picked up <when>" — a
//     placeholder timestamp from now() in the webhook path. Upgrades
//     within ~10–30s when dt-sync-statuses pulls the real DT data.
//   • Sync-fresh (driver_name populated): "Picked up <when> by <driver>"
//     — the real DT export.xml timestamp + driver name.
//
// Color matches the "completed" tone elsewhere in the app (green) so
// at a glance it reads as "good news, this step is done."
function LinkedPickupBanner({
  finishedAt, driverName, pickupOrderId, pickupIdentifier,
}: {
  finishedAt: string;
  driverName: string | null;
  pickupOrderId: string | null;
  pickupIdentifier: string | null;
}) {
  const when = fmtDateTime(finishedAt);
  const driverText = driverName && driverName.trim()
    ? ` by ${driverName.trim()}`
    : '';
  return (
    <div style={{
      borderRadius: 10,
      border: '1px solid #BBF7D0',
      background: '#F0FDF4',
      padding: '12px 16px',
      fontFamily: theme.typography.fontFamily,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 12, flexWrap: 'wrap',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        fontSize: 13, fontWeight: 600, color: '#166534',
      }}>
        <PackageCheck size={16} aria-hidden />
        <span>Picked up {when}{driverText}</span>
      </div>
      {pickupOrderId && pickupIdentifier && (
        <a
          href={`#/orders/${pickupOrderId}`}
          style={{
            fontSize: 12, fontWeight: 600,
            color: '#166534',
            border: '1px solid #BBF7D0',
            background: '#FFFFFF',
            padding: '4px 10px', borderRadius: 6,
            textDecoration: 'none',
          }}
          title="Open the linked pickup order"
        >
          View pickup {pickupIdentifier} →
        </a>
      )}
    </div>
  );
}

// Small status pill for the Items table's Status column. Color
// scheme matches Inventory.tsx's STATUS_CONFIG so a row's status
// reads identically across surfaces.
function InventoryStatusChip({ status }: { status: string }) {
  const cfg: Record<string, { bg: string; fg: string }> = {
    Active:        { bg: theme.colors.statusGreenBg, fg: theme.colors.statusGreen },
    Released:      { bg: theme.colors.statusBlueBg,  fg: theme.colors.statusBlue  },
    'On Hold':     { bg: theme.colors.statusAmberBg, fg: theme.colors.statusAmber },
    Transferred:   { bg: theme.colors.statusGrayBg,  fg: theme.colors.statusGray  },
  };
  const c = cfg[status] ?? { bg: theme.colors.statusGrayBg, fg: theme.colors.statusGray };
  return (
    <span style={{
      display: 'inline-block',
      fontSize: 10, fontWeight: 600,
      padding: '2px 8px', borderRadius: 10,
      background: c.bg, color: c.fg,
      whiteSpace: 'nowrap',
    }}>
      {status}
    </span>
  );
}

function DetailsTab({
  order,
  linkedOrder,
  editing,
  edit,
  setField,
  saving,
  saveError,
  onStartEdit,
  onCancelEdit,
  onSave,
  onSaveAndResync,
  isStaff,
  accessorialNames,
  inventoryStatuses,
  releasableItems,
  releasePanelOpen,
  onCloseReleasePanel,
  performedBy,
  onAddPickup,
}: {
  order: DtOrderForUI;
  /** P+D pair partner. Populated on the parent so DetailsTab can show
   *  pickup + delivery contacts side-by-side and a deep link to the
   *  partner row. Null for non-P+D orders. */
  linkedOrder: DtOrderForUI | null;
  editing: boolean;
  edit: OrderEdit;
  setField: <K extends keyof OrderEdit>(k: K, v: OrderEdit[K]) => void;
  saving: boolean;
  saveError: string | null;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: () => void;
  /** Save + immediately re-push to DispatchTrack. Only visible when
   *  the order has been pushed at least once. Undefined for the rare
   *  caller that wants the bare Save behavior. */
  onSaveAndResync?: () => void;
  /** Drives visibility of staff-only fields like Internal Notes. */
  isStaff: boolean;
  /** Code → human name map for accessorials. Caller (OrderPage) holds
   *  the useServiceCatalog hook so the fetch runs once at parent level. */
  accessorialNames: Record<string, string>;
  /** Per-item inventory.status + release_date, keyed by inventory_id.
   *  Drives the Status column on the items table — parent owns the
   *  fetch + realtime subscription so this stays declarative. */
  inventoryStatuses: Map<string, { status: string; releaseDate: string | null }>;
  /** Items eligible for manual release (filtered to inventory-linked,
   *  not already Released). Used by both the items table sort and
   *  the inline release panel. */
  releasableItems: ReleasableItem[];
  /** True when the operator clicked "Release Items..." in the footer. */
  releasePanelOpen: boolean;
  /** Collapse the inline release panel (Cancel button or success). */
  onCloseReleasePanel: () => void;
  /** Email of the operator firing the release — stamped on the audit
   *  entry. Null in demo / unauthenticated contexts. */
  performedBy: string | null;
  /** Opens the Add Pickup mini-modal. Wired from OrderPageInner so
   *  the modal state lives at the parent (alongside the other modals)
   *  while the trigger sits contextually inside the Notes card's
   *  Linked Pickups section. Undefined → button hidden (e.g. on a
   *  standalone pickup or a closed order). */
  onAddPickup?: () => void;
}) {
  const codFlagRow = useFeatureFlagRow('codStorageBilling');
  const codStorageOn = !!codFlagRow && resolveFlagBackend(codFlagRow, order.tenantId) === 'supabase';
  const addressLine = [order.contactAddress, order.contactCity, order.contactState, order.contactZip].filter(Boolean).join(', ');
  // Identify the P+D partner — when this row is the delivery leg of a
  // pair, the partner is the pickup leg (and vice versa). Drives the
  // side-by-side contact cards + the linked order # deep link.
  const isPD = order.orderType === 'pickup_and_delivery' || (order.linkedOrderId && linkedOrder);
  const thisIsPickupLeg = order.isPickup === true || order.orderType === 'pickup';
  const pickupLeg = thisIsPickupLeg ? order : (linkedOrder?.isPickup ? linkedOrder : null);
  const deliveryLeg = !thisIsPickupLeg ? order : linkedOrder;
  const pickupAddrLine = pickupLeg
    ? [pickupLeg.contactAddress, pickupLeg.contactCity, pickupLeg.contactState, pickupLeg.contactZip].filter(Boolean).join(', ')
    : '';
  const deliveryAddrLine = deliveryLeg
    ? [deliveryLeg.contactAddress, deliveryLeg.contactCity, deliveryLeg.contactState, deliveryLeg.contactZip].filter(Boolean).join(', ')
    : '';
  const hasPricing = order.baseDeliveryFee != null || order.orderTotal != null || (order.accessorials?.length ?? 0) > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* v2026-05-09 — client-resubmit diff banner. Renders only when
          the order has a recorded last_resubmit_diff (set when a client
          edits a non-draft order via CreateDeliveryOrderModal). Cleared
          by the staff Approve handler so it survives until staff
          acknowledges. Self-hides when there's nothing to show. */}
      <ResubmitBanner order={order} />

      {/* v41 (2026-05-26) — DT account fallback warning. Renders when
          the last push used STRIDE LOGISTICS instead of the tenant's
          mapped DT account (because the tenant isn't in
          dt_credentials.verified_account_tenants yet — see the v41
          fallback in dt-push-order). The order is visible in DT but
          attached to the wrong account; operator needs to verify the
          DT-side account name matches the Stride map exactly, mark the
          tenant verified via Settings → Integrations → DispatchTrack
          Account Mapping → Verify, then Republish. Self-hides once
          pushed_account_was_fallback flips back to false on a clean
          re-push. */}
      {order.pushedAccountWasFallback && (
        <div style={{
          background: '#FEF3C7',
          border: '1px solid #FCD34D',
          borderRadius: 8,
          padding: '12px 16px',
          fontSize: 13,
          lineHeight: 1.55,
          color: '#92400E',
        }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>
            ⚠ Pushed under STRIDE LOGISTICS fallback
          </div>
          <div>
            This order's last push went to DT under <strong>STRIDE LOGISTICS</strong> because
            this client's DT account hasn't been verified yet. The order is in DT
            but attached to the wrong account.
          </div>
          <div style={{ marginTop: 6 }}>
            <strong>To fix:</strong> open <strong>Settings → Integrations → DispatchTrack → Manage Account Mapping</strong>,
            confirm the DT account name matches DispatchTrack exactly (spelling + capitalization),
            then click <strong>Verify</strong> next to this client. Once verified, click <strong>Republish to DT</strong> above —
            the order will land under the correct account. (Note: the original push will likely remain on
            STRIDE LOGISTICS in DT until you delete it there.)
          </div>
        </div>
      )}

      {/* v2026-05-13 — linked-pickup completion banner. Renders only on
          the DELIVERY leg of a P+D pair when the linked pickup has
          completed. Driven by dt_orders.linked_pickup_finished_at +
          linked_pickup_driver_name, populated by stamp-pickup-on-linked-delivery
          (from notify-pickup-completed on the webhook path / dt-sync-statuses
          on the poll path). The deep-link to the pickup order opens a new
          tab so the operator doesn't lose their place on the delivery. */}
      {!thisIsPickupLeg && order.linkedPickupFinishedAt && (
        <LinkedPickupBanner
          finishedAt={order.linkedPickupFinishedAt}
          driverName={order.linkedPickupDriverName}
          pickupOrderId={order.linkedOrderId}
          pickupIdentifier={linkedOrder?.dtIdentifier ?? null}
        />
      )}

      {/* Card 1 — Schedule & Order Details. Combines the schedule
          fields, the order-level reference numbers, and the
          customer-facing "what this order involves" notes into one
          card so the operator can read the whole job at a glance.
          The Edit button on this header opens inline-edit mode for
          ALL editable fields across every card below. */}
      <EPCard>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <SectionTitle>Schedule &amp; Order Details</SectionTitle>
          {!editing && (
            <button onClick={onStartEdit} style={{ background: 'none', border: `1px solid ${theme.colors.border}`, borderRadius: 8, padding: '5px 12px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, color: EP.textSecondary, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <Pencil size={12} /> Edit
            </button>
          )}
        </div>
        {editing ? (
          <>
            {/* Label as "Requested Date" when DT has already scheduled to
                a different day — operator is editing the Stride-side
                requested date, not the DT-side scheduled date. The DT
                date is read-only here (mirrored back by sync) so we
                surface it as a help line below the editor instead of a
                separate edit field. */}
            <EditField
              label={order.dtScheduledDate && order.dtScheduledDate !== order.localServiceDate ? 'Requested Date' : 'Service Date'}
              value={edit.localServiceDate}
              onChange={v => setField('localServiceDate', v)}
              type="date"
              icon={<Calendar size={11} />}
            />
            {order.dtScheduledDate && order.dtScheduledDate !== order.localServiceDate && (
              <div style={{ fontSize: 11, color: EP.textMuted, marginTop: -8, marginBottom: 4, lineHeight: 1.5 }}>
                DT has this stop scheduled for <strong>{fmtDate(order.dtScheduledDate)}</strong>. Editing the requested date won't move it on DT's route — push a date change explicitly to do that.
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <EditField label="Window Start" value={edit.windowStartLocal} onChange={v => setField('windowStartLocal', v)} type="time" icon={<Clock size={11} />} />
              <EditField label="Window End"   value={edit.windowEndLocal}   onChange={v => setField('windowEndLocal', v)}   type="time" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <EditField label="PO Number"        value={edit.poNumber}        onChange={v => setField('poNumber', v)}        icon={<FileText size={11} />} />
              <EditField label="Sidemark"         value={edit.sidemark}        onChange={v => setField('sidemark', v)}        icon={<Package size={11} />} />
            </div>
            <EditField label="Client Reference" value={edit.clientReference} onChange={v => setField('clientReference', v)} />
            <EditField
              label="Order Details"
              value={edit.details}
              onChange={v => setField('details', v)}
              type="textarea"
              rows={3}
            />
            <div style={{ fontSize: 11, color: EP.textMuted, marginTop: -8, marginBottom: 4, lineHeight: 1.5 }}>
              Describe what this order involves — services needed, special handling instructions, or anything our team should know about the job.
            </div>
          </>
        ) : (
          <>
            {/* Two-date display: "Requested" is the Stride-side date the
                customer/operator originally asked for (local_service_date).
                "Scheduled" is the DT-side date the dispatcher actually
                routed the order to (dt_scheduled_date, mirrored from
                export.xml). When DT moves a stop to a different day,
                Stride keeps the original requested date for billing/audit
                while dt-push-order v39 uses the scheduled date on
                re-pushes so the route survives. Only render "Scheduled"
                separately when it differs from the requested date — same
                date is the steady state and one row reads cleaner. */}
            {order.dtScheduledDate && order.dtScheduledDate !== order.localServiceDate ? (
              <>
                <Field label="Requested" value={fmtDate(order.localServiceDate)} icon={<Calendar size={11} />} />
                <Field label="Scheduled" value={fmtDate(order.dtScheduledDate)} icon={<Calendar size={11} />} />
              </>
            ) : (
              <Field label="Service Date" value={fmtDate(order.dtScheduledDate || order.localServiceDate)} icon={<Calendar size={11} />} />
            )}
            <Field label="Time Window"  value={fmtWindow(order.windowStartLocal, order.windowEndLocal, order.timezone)} icon={<Clock size={11} />} />
            {order.serviceTimeMinutes != null && order.serviceTimeMinutes > 0 && (
              <Field label="Service Time" value={`${order.serviceTimeMinutes} min`} icon={<Clock size={11} />} />
            )}
            <Field label="Order Type" value={order.orderType ? order.orderType.replace(/_/g, ' ') : null} icon={<Truck size={11} />} />
            {order.poNumber        && <Field label="PO Number"        value={order.poNumber}        icon={<FileText size={11} />} />}
            {order.sidemark        && <Field label="Sidemark"         value={order.sidemark}        icon={<Package size={11} />} />}
            {order.clientReference && <Field label="Client Reference" value={order.clientReference} />}
            {order.source          && <Field label="Source"           value={order.source} />}
            {order.dtDispatchId != null && <Field label="Dispatch ID" value={String(order.dtDispatchId)} />}
            {order.details && (
              <div style={{ marginTop: 8, paddingTop: 10, borderTop: `1px solid ${theme.colors.borderLight || '#f0f0f0'}` }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: EP.textMuted, marginBottom: 4 }}>
                  Order Details
                </div>
                <div style={{ fontSize: 13, color: EP.textPrimary, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{order.details}</div>
              </div>
            )}
          </>
        )}
      </EPCard>

      {/* Contact — for P+D pairs render pickup + delivery side-by-side
          and surface the linked-leg order # as a clickable deep link.
          Falls back to the single-leg contact card for non-P+D orders.
          The Edit form still targets the current row's contact fields
          only (the linked leg has its own Edit Full Order modal). */}
      {(isPD && pickupLeg && deliveryLeg && pickupLeg.id !== deliveryLeg.id) ? (
        <EPCard>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <SectionTitle>Pickup &amp; Delivery</SectionTitle>
            {linkedOrder && (
              <a
                href={`#/orders/${linkedOrder.id}`}
                style={{
                  fontSize: 11, fontWeight: 600,
                  color: theme.colors.primary, textDecoration: 'none',
                  border: `1px solid ${theme.colors.primary}`,
                  padding: '3px 9px', borderRadius: 6,
                }}
                title={`Open the linked ${thisIsPickupLeg ? 'delivery' : 'pickup'} leg`}
              >
                Linked: {linkedOrder.dtIdentifier} →
              </a>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div style={{ background: '#FEF3C7', borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#92400E', marginBottom: 6 }}>
                Pickup{pickupLeg.id === order.id ? ' (this order)' : ''}
              </div>
              <Field label="Name"    value={pickupLeg.contactName} />
              <Field label="Address" value={pickupAddrLine || null} icon={<MapPin size={11} />} />
              <Field label="Phone"   value={pickupLeg.contactPhone} icon={<Phone size={11} />} />
              <Field label="Email"   value={pickupLeg.contactEmail} icon={<Mail size={11} />} />
            </div>
            <div style={{ background: '#DBEAFE', borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#1E40AF', marginBottom: 6 }}>
                Delivery{deliveryLeg.id === order.id ? ' (this order)' : ''}
              </div>
              <Field label="Name"    value={deliveryLeg.contactName} />
              <Field label="Address" value={deliveryAddrLine || null} icon={<MapPin size={11} />} />
              <Field label="Phone"   value={deliveryLeg.contactPhone} icon={<Phone size={11} />} />
              <Field label="Email"   value={deliveryLeg.contactEmail} icon={<Mail size={11} />} />
            </div>
          </div>
          {editing && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${theme.colors.borderLight || '#f0f0f0'}` }}>
              <div style={{ fontSize: 11, color: theme.colors.textMuted, marginBottom: 8, fontStyle: 'italic' }}>
                Editing this leg's contact fields below. Open the linked order to edit its leg.
              </div>
              <EditField label="Name"    value={edit.contactName}    onChange={v => setField('contactName', v)} />
              <EditField label="Address" value={edit.contactAddress} onChange={v => setField('contactAddress', v)} icon={<MapPin size={11} />} />
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10 }}>
                <EditField label="City"  value={edit.contactCity}  onChange={v => setField('contactCity', v)} />
                <EditField label="State" value={edit.contactState} onChange={v => setField('contactState', v)} />
                <EditField label="Zip"   value={edit.contactZip}   onChange={v => setField('contactZip', v)} />
              </div>
              <EditField label="Phone" value={edit.contactPhone} onChange={v => setField('contactPhone', v)} type="tel"   icon={<Phone size={11} />} />
              <EditField label="Email" value={edit.contactEmail} onChange={v => setField('contactEmail', v)} type="email" icon={<Mail size={11} />} />
            </div>
          )}
        </EPCard>
      ) : (
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
      )}


      {/* Inline release panel — opens when the operator clicks
          "Release Items..." in the footer. Mirrors the WC "Release
          Some..." UX. Writes go directly to Supabase (authoritative);
          realtime fans the status change through the items table's
          Status column + the footer button gate. */}
      {releasePanelOpen && order.tenantId && releasableItems.length > 0 && (
        <DtOrderReleasePanel
          orderId={order.id}
          tenantId={order.tenantId}
          defaultReleaseDateSource={order.finishedAt}
          items={releasableItems}
          performedBy={performedBy}
          onClose={onCloseReleasePanel}
        />
      )}

      {/* Items — moved inline from the old 'Items' tab. Compact table
          covering description / vendor / room / qty / class / location
          / status. Driver notes + return codes render as sub-rows when
          present so we don't lose the post-DT-sync information. */}
      {(order.items?.length ?? 0) > 0 && (
        <EPCard>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <SectionTitle>Items</SectionTitle>
            {/* Order-level stats: pieces (sum of qty), item IDs (count of
                rows), and cubic volume (sum of qty × cubic_feet). Per
                PR #543, cubic_feet on dt_order_items is stored PER-UNIT,
                so multiplying by quantity gives the row's total volume.
                Items with null / missing cubic_feet contribute 0; the
                cubic suffix is omitted entirely when the total rounds to
                0 so an all-ad-hoc order doesn't show " · 0.0 ft³". */}
            {(() => {
              const items = order.items ?? [];
              const pieces = items.reduce((s, it) => s + Math.max(1, Number(it.quantity) || 1), 0);
              const idCount = items.length;
              const cubicTotal = items.reduce((s, it) => {
                const qty = Math.max(1, Number(it.quantity) || 1);
                const perUnit = Number(it.cubicFeet) || 0;
                return s + qty * perUnit;
              }, 0);
              return (
                <span style={{ fontSize: 11, color: EP.textMuted }}>
                  {pieces} pieces · {idCount} item ID{idCount === 1 ? '' : 's'}
                  {cubicTotal >= 0.05 && ` · ${cubicTotal.toFixed(1)} ft³`}
                </span>
              );
            })()}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#FFFBEB', textAlign: 'left' }}>
                  <th style={inlineItemTh}>Description</th>
                  <th style={inlineItemTh}>Vendor</th>
                  <th style={inlineItemTh}>Room</th>
                  <th style={{ ...inlineItemTh, textAlign: 'right' }}>Qty</th>
                  <th style={{ ...inlineItemTh, textAlign: 'right' }}>Delivered</th>
                  <th style={inlineItemTh}>Class</th>
                  <th style={inlineItemTh}>Location</th>
                  <th style={inlineItemTh}>Status</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  // Phase 2 per-leg item grouping (2026-05-30).
                  //
                  // On a delivery with N linked pickup legs, we group
                  // items by their pickup_leg_id so the operator can see
                  // at a glance which items come from which pickup, plus
                  // a "Warehouse" group for items that ride from our
                  // warehouse (no pickup). The group header shows the
                  // pickup's label + status (✅ Completed / Pending) +
                  // any driver-entered pickup_completion_notes from the
                  // join row.
                  //
                  // Grouping suppressed on:
                  //   • pickup-leg pages (thisIsPickupLeg)
                  //   • orders with no linked pickups (standalone delivery)
                  //   • orders with linkedPickups.length === 1 AND no
                  //     item has pickup_leg_id set (legacy single-leg
                  //     P+D before this migration — rendering one
                  //     "Warehouse" + zero "Pickup X" group would look
                  //     wrong vs the all-from-pickup flat list staff
                  //     are used to).
                  //
                  // Renders the existing flat-table behaviour in the
                  // suppressed case so single-pickup orders look identical
                  // to today.
                  const items = order.items ?? [];
                  const anyLegTagged = items.some(it => !!it.pickupLegId);
                  const shouldGroup = !thisIsPickupLeg
                    && order.linkedPickups.length > 0
                    && (order.linkedPickups.length > 1 || anyLegTagged);

                  type Group = {
                    key: string;
                    header: { label: string; status: 'completed' | 'pending' | 'warehouse'; statusText: string; notes: string | null } | null;
                    items: typeof items;
                  };
                  const groups: Group[] = [];
                  if (!shouldGroup) {
                    groups.push({ key: 'flat', header: null, items });
                  } else {
                    // One group per linked pickup, ordered by sort_order.
                    const sortedLegs = [...order.linkedPickups].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
                    for (const lp of sortedLegs) {
                      const legItems = items.filter(it => it.pickupLegId === lp.id);
                      const labelDisplay = lp.pickupLabel
                        || lp.pickupContactName
                        || `Pickup ${(lp.sortOrder ?? 0) + 1}`;
                      const isCompleted = !!lp.pickupFinishedAt;
                      const statusText = isCompleted
                        ? `Completed ${fmtDateTime(lp.pickupFinishedAt as string)}${lp.pickupDriverName ? ` by ${lp.pickupDriverName}` : ''}`
                        : 'Pending';
                      groups.push({
                        key: lp.id,
                        header: {
                          label: `Pickup ${(lp.sortOrder ?? 0) + 1}: ${labelDisplay}`,
                          status: isCompleted ? 'completed' : 'pending',
                          statusText,
                          notes: (lp.pickupCompletionNotes ?? '').trim() || null,
                        },
                        items: legItems,
                      });
                    }
                    // Warehouse bucket — items with NULL pickup_leg_id.
                    const warehouseItems = items.filter(it => !it.pickupLegId);
                    if (warehouseItems.length > 0) {
                      groups.push({
                        key: 'warehouse',
                        header: { label: 'Warehouse Items', status: 'warehouse', statusText: 'No pickup — riding from warehouse', notes: null },
                        items: warehouseItems,
                      });
                    }
                  }

                  // Flatten groups into renderable rows. `idx` for the
                  // zebra stripe runs across the whole table so the
                  // alternating shading reads continuously through group
                  // headers, not restarting per group.
                  let rowIdx = -1;
                  return groups.map(grp => (
                    <React.Fragment key={grp.key}>
                      {grp.header && (
                        <tr>
                          <td colSpan={8} style={{
                            padding: '8px 10px',
                            background: grp.header.status === 'completed' ? '#ECFDF5'
                              : grp.header.status === 'pending' ? '#FEF3C7'
                              : '#F4F4F2',
                            borderTop: `2px solid ${grp.header.status === 'completed' ? '#86EFAC'
                              : grp.header.status === 'pending' ? '#FCD34D'
                              : theme.colors.border}`,
                            fontSize: 12,
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                              <div style={{ fontWeight: 600, color: grp.header.status === 'completed' ? '#166534'
                                : grp.header.status === 'pending' ? '#92400E'
                                : EP.textPrimary }}>
                                {grp.header.label}{grp.header.status === 'completed' ? ' ✅' : ''}
                              </div>
                              <div style={{ fontSize: 11, color: grp.header.status === 'completed' ? '#166534'
                                : grp.header.status === 'pending' ? '#92400E'
                                : EP.textMuted }}>
                                {grp.header.statusText}
                              </div>
                            </div>
                            {grp.header.notes && (
                              <div style={{ marginTop: 4, fontSize: 11, color: EP.textPrimary, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                                <span style={{ fontWeight: 600 }}>Driver notes:</span> {grp.header.notes}
                              </div>
                            )}
                            {grp.items.length === 0 && (
                              <div style={{ marginTop: 4, fontSize: 11, color: EP.textMuted, fontStyle: 'italic' }}>
                                No items assigned to this leg.
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                      {grp.items.map(item => {
                        rowIdx += 1;
                        const idx = rowIdx;
                        return (() => {
                  const orderedQty = item.quantity ?? 0;
                  const delQty = item.deliveredQuantity ?? null;
                  const qtyShort = delQty != null && orderedQty > 0 && delQty < orderedQty;
                  const fullyDelivered = item.delivered === true || (delQty != null && orderedQty > 0 && delQty >= orderedQty);
                  // inventoryStatuses is keyed by the inventory_id UUID
                  // (FK on dt_order_items). Ad-hoc / free-text items
                  // (no inventoryId) get "—" since they have no
                  // inventory row to track status on.
                  const invStatus = item.inventoryId
                    ? inventoryStatuses.get(item.inventoryId)
                    : null;
                  return (
                    <React.Fragment key={item.id || idx}>
                      <tr style={{ borderBottom: `1px solid ${theme.colors.borderLight || '#f0f0f0'}`, background: idx % 2 === 0 ? '#fff' : '#FAFAF9' }}>
                        <td style={inlineItemTd}>
                          <div style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span>{item.description || '—'}</span>
                            {/* Ad-hoc items have no inventory_id and no dt_item_code —
                                free-text entries from the public form or manual edits.
                                Tag visually so reviewers know there's no Stride-side
                                inventory row to release / track / cross-link. */}
                            {!item.inventoryId && !item.dtItemCode && (
                              <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 8, background: '#EFF6FF', color: '#1D4ED8', border: '1px solid #BFDBFE', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Ad-hoc</span>
                            )}
                          </div>
                          {item.dtItemCode && (
                            <div style={{ fontSize: 10, color: EP.textMuted, fontFamily: 'monospace' }}>{item.dtItemCode}</div>
                          )}
                          {/* v2026-05-13 — per-item picked-up indicator.
                              Stamped on the delivery item by stamp-pickup-on-linked-delivery
                              when the linked PU leg completes. Most useful when
                              a pickup is PARTIAL (driver picked some, refused
                              others) — the order-level banner above already
                              covers the all-or-nothing case. */}
                          {item.pickedUpAt && (
                            <div
                              style={{
                                display: 'inline-flex', alignItems: 'center', gap: 4,
                                marginTop: 3, padding: '2px 6px', borderRadius: 4,
                                background: '#DCFCE7', border: '1px solid #86EFAC',
                                fontSize: 10, fontWeight: 600,
                                color: '#166534',
                              }}
                              title={`Picked up ${fmtDateTime(item.pickedUpAt)}${order.linkedPickupDriverName ? ` by ${order.linkedPickupDriverName}` : ''}`}
                            >
                              <PackageCheck size={11} aria-hidden />
                              {/* Inline driver name + timestamp so the operator
                               *  sees "who" and "when" at a glance, not just a
                               *  hover tooltip. Driver name comes from the
                               *  order-level dt_orders.linked_pickup_driver_name
                               *  (stamped by stamp-pickup-on-linked-delivery
                               *  from the PU leg's dt_orders.driver_name);
                               *  picked_up_at comes from the per-item
                               *  dt_order_items.picked_up_at stamp. Falls back
                               *  to bare "Picked up" if either is missing so
                               *  partial state (e.g. dt-sync-statuses hasn't
                               *  hydrated driver name yet) still renders. */}
                              <span>
                                Picked up
                                {order.linkedPickupDriverName ? ` by ${order.linkedPickupDriverName}` : ''}
                                {' · '}{fmtDateTime(item.pickedUpAt)}
                              </span>
                            </div>
                          )}
                        </td>
                        <td style={inlineItemTd}>{item.vendor || '—'}</td>
                        <td style={inlineItemTd}>{item.room || '—'}</td>
                        <td style={{ ...inlineItemTd, textAlign: 'right', fontWeight: 600 }}>{orderedQty || '—'}</td>
                        <td style={{ ...inlineItemTd, textAlign: 'right', color: qtyShort ? '#B45309' : fullyDelivered ? '#15803D' : EP.textMuted }}>
                          {delQty != null ? delQty : '—'}
                        </td>
                        <td style={inlineItemTd}>{item.className || '—'}</td>
                        <td style={inlineItemTd}>{item.dtLocation || item.location || '—'}</td>
                        <td style={inlineItemTd}>
                          {!item.inventoryId ? (
                            <span style={{ color: EP.textMuted }}>—</span>
                          ) : invStatus ? (
                            <InventoryStatusChip status={invStatus.status} />
                          ) : (
                            <span style={{ color: EP.textMuted, fontSize: 11 }}>…</span>
                          )}
                        </td>
                      </tr>
                      {(item.itemNote || (item.returnCodes && item.returnCodes.length > 0) ||
                        item.pickupItemNote || (item.pickupReturnCodes && item.pickupReturnCodes.length > 0) ||
                        (item.pickupDeliveredQuantity != null && item.quantity != null && Number(item.pickupDeliveredQuantity) !== Number(item.quantity))) && (
                        <tr>
                          <td colSpan={8} style={{ padding: '0 10px 8px', background: idx % 2 === 0 ? '#fff' : '#FAFAF9' }}>
                            {item.itemNote && (
                              <div style={{ fontSize: 11, color: '#92400E', padding: '4px 8px', background: '#FFFBEB', borderRadius: 6, borderLeft: '3px solid #F59E0B', marginBottom: 4 }}>
                                <span style={{ fontWeight: 600 }}>Driver note:</span> {item.itemNote}
                              </div>
                            )}
                            {item.returnCodes && item.returnCodes.length > 0 && (
                              <div style={{ fontSize: 11, color: '#991B1B', fontWeight: 500, marginBottom: 4 }}>
                                Return codes: {item.returnCodes.join(', ')}
                              </div>
                            )}
                            {/* v2026-05-13 — PU-mirror audit row.
                                Set by stamp-pickup-on-linked-delivery Tier-B
                                propagation when the linked PU completes. Shows
                                the picked-up count (if different from ordered)
                                and any driver notes / return codes from the PU
                                leg, so the delivery operator sees what actually
                                happened at the source. */}
                            {(item.pickupItemNote ||
                              (item.pickupReturnCodes && item.pickupReturnCodes.length > 0) ||
                              (item.pickupDeliveredQuantity != null && item.quantity != null && Number(item.pickupDeliveredQuantity) !== Number(item.quantity))) && (
                              <div style={{ fontSize: 11, color: '#166534', padding: '4px 8px', background: '#F0FDF4', borderRadius: 6, borderLeft: '3px solid #16A34A' }}>
                                <span style={{ fontWeight: 600 }}>From pickup:</span>{' '}
                                {item.pickupDeliveredQuantity != null && item.quantity != null && Number(item.pickupDeliveredQuantity) !== Number(item.quantity) && (
                                  <span>picked up {item.pickupDeliveredQuantity} of {item.quantity}. </span>
                                )}
                                {item.pickupItemNote && <span>"{item.pickupItemNote}". </span>}
                                {item.pickupReturnCodes && item.pickupReturnCodes.length > 0 && (
                                  <span>Return codes: {item.pickupReturnCodes.join(', ')}.</span>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })();
                      })}
                    </React.Fragment>
                  ));
                })()}
              </tbody>
            </table>
          </div>
        </EPCard>
      )}

      {/* Card 4 — Services & Pricing.
          Top half: per-line accessorials with human names from the
          service catalog (falls back to code if not yet hydrated).
          Quote-pending lines show "Quote pending" instead of $0 so
          clients see something concrete and staff know there's a
          pricing pass owed. Bottom half: full pricing breakdown
          including base fee, extra items, accessorials roll-up,
          coverage, tax, and grand total. The MANUAL chip flags
          orders where an admin overrode the auto-computed total. */}
      {(hasPricing || (order.accessorials?.length ?? 0) > 0 || editing) && (
        <EPCard>
          <SectionTitle>Services &amp; Pricing</SectionTitle>
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
              {/* Add-on services list (header'd table). Hidden when
                  the order has no accessorials. */}
              {(order.accessorials?.length ?? 0) > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: EP.textMuted, marginBottom: 6 }}>
                    Add-On Services
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: '#FFF7ED', textAlign: 'left' }}>
                          <th style={inlineItemTh}>Service</th>
                          <th style={{ ...inlineItemTh, textAlign: 'right' }}>Qty</th>
                          <th style={{ ...inlineItemTh, textAlign: 'right' }}>Rate</th>
                          <th style={{ ...inlineItemTh, textAlign: 'right' }}>Subtotal</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(order.accessorials ?? []).map((acc, i) => {
                          const name = accessorialNames[acc.code] || acc.code;
                          const isQuotePending = !!acc.quotePending;
                          return (
                            <tr key={i} style={{ borderBottom: `1px solid ${theme.colors.borderLight || '#f0f0f0'}` }}>
                              <td style={inlineItemTd}>
                                <div style={{ fontWeight: 500 }}>{name}</div>
                                {acc.code !== name && (
                                  <div style={{ fontSize: 10, color: EP.textMuted, fontFamily: 'monospace' }}>{acc.code}</div>
                                )}
                                {acc.clientNotes && (
                                  <div style={{ fontSize: 11, color: EP.textMuted, marginTop: 2, fontStyle: 'italic' }}>
                                    "{acc.clientNotes}"
                                  </div>
                                )}
                              </td>
                              <td style={{ ...inlineItemTd, textAlign: 'right' }}>{acc.quantity}</td>
                              <td style={{ ...inlineItemTd, textAlign: 'right', color: EP.textMuted }}>
                                {isQuotePending ? '—' : fmtCurrency(acc.rate)}
                              </td>
                              <td style={{ ...inlineItemTd, textAlign: 'right', fontWeight: 600, color: isQuotePending ? '#B45309' : EP.textPrimary, fontStyle: isQuotePending ? 'italic' : 'normal' }}>
                                {isQuotePending ? 'Quote pending' : fmtCurrency(acc.subtotal)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Pricing breakdown */}
              {order.baseDeliveryFee != null && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
                  <span style={{ color: EP.textSecondary }}>{order.isPickup ? 'Base Pickup Fee' : 'Base Delivery Fee'}</span>
                  <span style={{ fontWeight: 600 }}>{fmtCurrency(order.baseDeliveryFee)}</span>
                </div>
              )}
              {order.extraItemsCount > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
                  <span style={{ color: EP.textSecondary }}>Extra Items × {order.extraItemsCount}</span>
                  <span style={{ fontWeight: 600 }}>{fmtCurrency(order.extraItemsFee)}</span>
                </div>
              )}
              {order.accessorialsTotal > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
                  <span style={{ color: EP.textSecondary }}>Add-on Services Total</span>
                  <span style={{ fontWeight: 600 }}>{fmtCurrency(order.accessorialsTotal)}</span>
                </div>
              )}
              {order.fabricProtectionTotal > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
                  <span style={{ color: EP.textSecondary }}>Fabric Protection</span>
                  <span style={{ fontWeight: 600 }}>{fmtCurrency(order.fabricProtectionTotal)}</span>
                </div>
              )}
              {order.coverageCharge != null && order.coverageCharge > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
                  <span style={{ color: EP.textSecondary }}>Coverage</span>
                  <span style={{ fontWeight: 600 }}>{fmtCurrency(order.coverageCharge)}</span>
                </div>
              )}
              {order.taxAmount != null && order.taxAmount > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
                  <span style={{ color: EP.textSecondary }}>
                    Sales Tax{order.taxRatePct != null && order.taxRatePct > 0 ? ` (${order.taxRatePct.toFixed(3)}%)` : ''}
                  </span>
                  <span style={{ fontWeight: 600 }}>{fmtCurrency(order.taxAmount)}</span>
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
            </>
          )}
        </EPCard>
      )}

      {/* Card 4.5 — COD Storage collection line (feature-gated) */}
      {codStorageOn && !editing && (
        <OrderCodStorageCard order={order} performedBy={performedBy} canEdit={isStaff} />
      )}

      {/* Card 5 — Notes. v42 split: Pickup Notes (pushed to the pickup
          leg's DT card) + Delivery Notes (pushed to the delivery leg's
          DT card). On a delivery's OrderPage both fields render; on a
          standalone pickup only Pickup Notes. Internal Notes stays
          staff-only (DT Private, audit-only).

          Multi-pickup Phase 1 also surfaces:
            • Pickup completion warnings (driver notes from a finished
              pickup, relayed by dt-sync-statuses v20).
            • A linked-pickups list when the delivery has multiple
              pickup legs (sourced from dt_pickup_links). */}
      <EPCard>
        <SectionTitle>Notes</SectionTitle>

        {/* Pickup-completion warning — only on the delivery side, only
            when at least one linked pickup has driver notes from DT.
            Highlighted so the delivery crew sees it before pushing
            off, even if they skim the rest of the card. */}
        {!thisIsPickupLeg && order.linkedPickups.some(lp => (lp.pickupCompletionNotes ?? '').trim().length > 0) && (
          <div style={{ background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: 8, padding: 12, marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#92400E', marginBottom: 6, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              ⚠ Pickup Notes from Driver
            </div>
            {order.linkedPickups
              .filter(lp => (lp.pickupCompletionNotes ?? '').trim().length > 0)
              .map(lp => {
                const labelDisplay = lp.pickupLabel
                  ? lp.pickupLabel
                  : (order.linkedPickups.length > 1 ? `Pickup ${(lp.sortOrder ?? 0) + 1}` : 'Pickup');
                return (
                  <div key={lp.id} style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#92400E', marginBottom: 2 }}>{labelDisplay}</div>
                    <div style={{ fontSize: 13, color: EP.textPrimary, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{lp.pickupCompletionNotes}</div>
                  </div>
                );
              })}
          </div>
        )}

        {/* Linked-pickups list — when the delivery has any join rows,
            render one row per pickup with its label + status + per-leg
            notes. Replaces the single LinkedPickupBanner for multi-
            pickup orders (the banner still renders at the top for
            single-pickup back-compat via linked_pickup_finished_at).
            The "+ Add Pickup" button opens AddPickupLegModal so the
            operator can append another leg without leaving the page. */}
        {!thisIsPickupLeg && (order.linkedPickups.length > 0 || onAddPickup) && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: EP.textMuted, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Truck size={11} /> Linked Pickups ({order.linkedPickups.length})
              </div>
              {onAddPickup && (
                <button onClick={onAddPickup}
                  style={{
                    background: 'none', border: `1px solid ${theme.colors.border}`, borderRadius: 6,
                    padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit',
                    fontSize: 11, fontWeight: 600, color: EP.textSecondary,
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                  }}>
                  + Add Pickup
                </button>
              )}
            </div>
            {order.linkedPickups.map(lp => {
              const labelDisplay = lp.pickupLabel
                ? lp.pickupLabel
                : (lp.pickupContactName || `Pickup ${(lp.sortOrder ?? 0) + 1}`);
              const finishedDisplay = lp.pickupFinishedAt
                ? `Picked up ${fmtDateTime(lp.pickupFinishedAt)}${lp.pickupDriverName ? ` by ${lp.pickupDriverName}` : ''}`
                : 'Pending';
              // Per-leg pickup fee — populated by AddPickupLegModal as
              // each new leg is added. NULL for the primary pickup
              // (sort_order=0) because that fee is rolled into the
              // delivery row's base_delivery_fee at create time. Show
              // a $— for NULL legs so it's visibly different from "$0".
              const feeDisplay = lp.pickupLegFee != null
                ? `$${lp.pickupLegFee.toFixed(2)}`
                : (lp.sortOrder === 0 ? 'in base' : '$—');
              return (
                <div key={lp.id} style={{ border: `1px solid ${theme.colors.border}`, borderRadius: 8, padding: 10, marginBottom: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: EP.textPrimary }}>{labelDisplay}</div>
                      {lp.pickupDtIdentifier && (
                        <div style={{ fontSize: 11, color: EP.textMuted, marginTop: 2, fontFamily: 'monospace' }}>{lp.pickupDtIdentifier}</div>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, whiteSpace: 'nowrap' }}>
                      <div style={{ fontSize: 11, color: lp.pickupFinishedAt ? '#15803D' : EP.textMuted }}>{finishedDisplay}</div>
                      <div style={{ fontSize: 11, color: EP.textMuted }}>Pickup fee: <span style={{ color: EP.textPrimary, fontWeight: 500 }}>{feeDisplay}</span></div>
                    </div>
                  </div>
                  {lp.pickupNotes && (
                    <div style={{ fontSize: 12, color: EP.textPrimary, marginTop: 6, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{lp.pickupNotes}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {editing ? (
          <>
            {/* Pickup Notes — shown on standalone pickups AND on the
                delivery side of a SINGLE-PICKUP P+D pair (where they
                push to the linked pickup row on save). Hidden on
                standalone deliveries that have no pickup leg.

                Multi-pickup orders (linkedPickups.length > 1) hide
                this field entirely: editing it on a multi-pickup
                delivery would only touch the original `-P` row's
                pickup_notes column (the cross-row write only knows
                about `linkedOrderId`, which still points at the
                primary pickup), silently dropping edits intended
                for `-P2..-P9`. Operators edit per-leg notes by
                opening each pickup's OrderPage directly until
                Phase 2 adds inline-per-leg editing here. */}
            {(thisIsPickupLeg
              || (order.orderType === 'pickup_and_delivery' && order.linkedPickups.length <= 1)
              || (!!order.linkedOrderId && order.linkedPickups.length <= 1)) && (
              <>
                <EditField
                  label="Pickup Notes"
                  icon={<Truck size={11} />}
                  value={edit.pickupNotes}
                  onChange={v => setField('pickupNotes', v)}
                  type="textarea"
                  rows={3}
                />
                <div style={{ fontSize: 11, color: EP.textMuted, marginTop: -8, marginBottom: 10, lineHeight: 1.5 }}>
                  Notes for the pickup crew — gate codes, parking instructions, what to grab, anything specific to the pickup site.
                </div>
              </>
            )}
            {!thisIsPickupLeg && order.linkedPickups.length > 1 && (
              <div style={{ fontSize: 11, color: EP.textMuted, marginBottom: 12, lineHeight: 1.5, fontStyle: 'italic' }}>
                Per-pickup notes are edited on each pickup's own page. Open a linked pickup above to edit its notes.
              </div>
            )}

            {/* Delivery Notes — shown on every order except standalone
                pickups (a standalone pickup has no delivery leg). */}
            {!thisIsPickupLeg && (
              <>
                <EditField
                  label="Delivery Notes"
                  icon={<Truck size={11} />}
                  value={edit.deliveryNotes}
                  onChange={v => setField('deliveryNotes', v)}
                  type="textarea"
                  rows={3}
                />
                <div style={{ fontSize: 11, color: EP.textMuted, marginTop: -8, marginBottom: 10, lineHeight: 1.5 }}>
                  Notes for the delivery crew — building access, install requirements, anything specific to the drop site.
                </div>
              </>
            )}

            {isStaff && (
              <>
                <EditField
                  label="Internal Notes"
                  icon={<Lock size={11} />}
                  value={edit.internalNotes}
                  onChange={v => setField('internalNotes', v)}
                  type="textarea"
                  rows={3}
                />
                <div style={{ fontSize: 11, color: '#92400E', marginTop: -8, marginBottom: 4, lineHeight: 1.5, fontStyle: 'italic' }}>
                  Only visible to Stride staff. Clients and drivers will not see these notes — not shared in the customer portal or DispatchTrack.
                </div>
              </>
            )}
          </>
        ) : (
          <>
            {/* Read mode — display whichever per-leg field has content,
                falling back to legacy driverNotes for pre-split rows. */}
            {(() => {
              const showPickup   = (thisIsPickupLeg || order.orderType === 'pickup_and_delivery' || !!order.linkedOrderId)
                                   && (order.pickupNotes || (thisIsPickupLeg && order.driverNotes));
              const showDelivery = !thisIsPickupLeg
                                   && (order.deliveryNotes || (!thisIsPickupLeg && order.driverNotes));
              const pickupBody   = order.pickupNotes   || (thisIsPickupLeg ? order.driverNotes : '');
              const deliveryBody = order.deliveryNotes || (!thisIsPickupLeg ? order.driverNotes : '');
              return (
                <>
                  {showPickup && (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: EP.textMuted, marginBottom: 4, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Truck size={11} /> Pickup Notes
                      </div>
                      <div style={{ fontSize: 13, color: EP.textPrimary, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{pickupBody}</div>
                    </div>
                  )}
                  {showDelivery && (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: EP.textMuted, marginBottom: 4, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Truck size={11} /> Delivery Notes
                      </div>
                      <div style={{ fontSize: 13, color: EP.textPrimary, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{deliveryBody}</div>
                    </div>
                  )}
                  {isStaff && order.internalNotes && (
                    <div style={{ background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: 8, padding: 10 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#92400E', marginBottom: 4, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Lock size={11} /> Internal Notes (staff only)
                      </div>
                      <div style={{ fontSize: 13, color: EP.textPrimary, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{order.internalNotes}</div>
                    </div>
                  )}
                  {!showPickup && !showDelivery && !(isStaff && order.internalNotes) && (
                    <div style={{ fontSize: 12, color: EP.textMuted, fontStyle: 'italic' }}>
                      No pickup, delivery, or internal notes on this order yet.
                    </div>
                  )}
                </>
              );
            })()}
          </>
        )}
      </EPCard>

      {/* Edit-only: Review Status / Review Notes (the read-only view of
          these fields lives on the Activity tab now — see render() of
          tab id 'activity'). Only staff can change review status from
          here, but the inline form keeps existing behavior intact for
          admins who do the bulk of approve/reject/revision flow. */}
      {editing && (
        <EPCard style={{ background: '#FEF7ED' }}>
          <SectionTitle>Review</SectionTitle>
          <EditField label="Review Status" value={edit.reviewStatus} onChange={v => setField('reviewStatus', v)} type="select" options={REVIEW_STATUS_OPTIONS} />
          <EditField label="Review Notes"  value={edit.reviewNotes}  onChange={v => setField('reviewNotes', v)}  type="textarea" rows={3} />
        </EPCard>
      )}

      {/* Edit action bar */}
      {editing && (
        <EPCard style={{ background: '#FAFAF9' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ fontSize: 12, color: saveError ? '#DC2626' : EP.textMuted, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {saveError ?? 'Editing — save to persist changes.'}
            </div>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <button onClick={onCancelEdit} disabled={saving} style={{ background: '#fff', color: EP.textPrimary, border: `1px solid ${theme.colors.border}`, cursor: saving ? 'not-allowed' : 'pointer', padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500, opacity: saving ? 0.6 : 1, fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <X size={13} /> Cancel
              </button>
              <button onClick={onSave} disabled={saving} style={{ background: order.pushedToDtAt ? '#fff' : EP.accent, color: order.pushedToDtAt ? EP.textPrimary : '#fff', border: order.pushedToDtAt ? `1px solid ${theme.colors.border}` : 'none', cursor: saving ? 'progress' : 'pointer', padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, opacity: saving ? 0.85 : 1, fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {saving && <BtnSpinner size={12} color={order.pushedToDtAt ? EP.textPrimary : '#fff'} />}
                {saving ? 'Saving…' : (order.pushedToDtAt ? 'Save (no DT push)' : 'Save Changes')}
              </button>
              {order.pushedToDtAt && onSaveAndResync && (
                /* Order is already in DispatchTrack — give the operator
                   a one-click "save + push" so DT stays in sync without
                   needing the separate Republish button after a save. */
                <button onClick={onSaveAndResync} disabled={saving} style={{ background: EP.accent, color: '#fff', border: 'none', cursor: saving ? 'progress' : 'pointer', padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, opacity: saving ? 0.85 : 1, fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {saving && <BtnSpinner size={12} color="#fff" />}
                  {saving ? 'Saving…' : 'Save & Resync to DT'}
                </button>
              )}
            </div>
          </div>
        </EPCard>
      )}
    </div>
  );
}

// ── Completion tab content ───────────────────────────────────────────────────
//
// Shows the data that flows back from DispatchTrack via dt-sync-statuses
// once an order has been pushed and worked on. Hidden entirely when the
// order has no sync-back data (i.e. nothing has happened in DT yet).

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    const dt = new Date(iso);
    if (isNaN(dt.getTime())) return iso;
    const date = dt.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
    const time = dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    return `${date} ${time}`;
  }
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
  // History-aware back for error/not-found and post-delete.
  const goBack = useGoBack('/orders');
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const canReview = user?.role === 'admin' || user?.role === 'staff';

  const { order: fetchedOrder, status, error, refetch } = useOrderDetail(orderId);

  // Local copy for optimistic updates.
  //
  // `lastMutationAtRef` matches the pattern in TaskPage/RepairPage/WillCallPage:
  // any mutation handler bumps it to Date.now() so the realtime-driven refetch
  // (via useOrderDetail → entityEvents subscription) can't clobber an
  // in-progress edit during the 1-3s GAS write-through window. Without this,
  // a user mid-edit who has been on the page for >0ms when their own optimistic
  // save fires sees the sync effect at the bottom of this useEffect
  // overwrite their local edits with the freshly-mirrored Supabase row.
  // The 6000ms ceiling covers cold-GAS round trips (worst case ~4-5s).
  const [localOrder, setLocalOrder] = useState<DtOrderForUI | null>(null);
  const lastMutationAtRef = useRef<number>(0);
  const OPTIMISTIC_GUARD_MS = 6000;

  const order = localOrder ?? fetchedOrder;

  // For P+D orders we also load the linked leg so the detail page
  // can show pickup + delivery contacts side-by-side and surface the
  // linked order # as a clickable deep link. Best-effort — null when
  // the linked id is missing or RLS blocks it; the side-by-side card
  // just doesn't render.
  const [linkedOrder, setLinkedOrder] = useState<DtOrderForUI | null>(null);
  useEffect(() => {
    if (!order?.linkedOrderId) { setLinkedOrder(null); return; }
    let cancelled = false;
    void fetchDtOrderByIdFromSupabase(order.linkedOrderId).then(r => {
      if (!cancelled) setLinkedOrder(r);
    }).catch(() => { /* tolerate */ });
    return () => { cancelled = true; };
  }, [order?.linkedOrderId]);

  // Service catalog → accessorial-code-to-human-name map. Used by the
  // Services & Pricing card to render "Assembly" instead of bare
  // codes like ASSEMBLY. One fetch per page mount; the hook caches.
  const { services: catalogServices } = useServiceCatalog();
  const accessorialNames = React.useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const s of catalogServices) out[s.code] = s.name;
    return out;
  }, [catalogServices]);

  // Edit state
  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState<OrderEdit>(() => order ? orderToEdit(order) : orderToEdit({} as DtOrderForUI));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Sync effect — copies the fresh Supabase row into local state UNLESS a
  // recent mutation is still propagating. Mirrors TaskPage's pattern: gate
  // on BOTH the 6000ms timer AND the saving flag, since a cold-GAS round
  // trip can exceed the timer (worst case ~4-5s, occasionally longer) and
  // we don't want a late-arriving realtime echo to clobber an in-flight
  // optimistic edit. Deps list includes `saving` so the effect re-runs
  // when saving flips false and the most-recent fetchedOrder lands clean.
  useEffect(() => {
    if (!fetchedOrder) return;
    if (saving) return;
    if (Date.now() - lastMutationAtRef.current < OPTIMISTIC_GUARD_MS) return;
    setLocalOrder(fetchedOrder);
  }, [fetchedOrder, saving]);

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
    lastMutationAtRef.current = Date.now();
    setSaving(true);
    setSaveError(null);

    // Optimistic — paint the new review status / notes immediately so the
    // footer banner and the badge in the header flip without waiting for
    // the Supabase round-trip + read-back.
    const prevReviewStatus = order.reviewStatus;
    const prevReviewNotes = order.reviewNotes;
    setLocalOrder(prev => prev ? { ...prev, reviewStatus: action, reviewNotes: notes.trim() } : prev);

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
      // Roll back optimistic patch on failure.
      setLocalOrder(prev => prev ? { ...prev, reviewStatus: prevReviewStatus, reviewNotes: prevReviewNotes } : prev);
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
  // Per-order "Sync from DT" button — declared at the top with the other
  // useState calls so it runs unconditionally on every render. Originally
  // placed alongside handleSyncFromDt further down (line ~2200) which
  // sat BELOW the early `if (status === 'loading') return` exit at
  // line ~1947 → on the loading render the hook never ran but on the
  // post-load render it did → React error #310 "Rendered more hooks
  // than during the previous render" crashed every order page.
  // Rules-of-hooks: declare ALL state at the top, before any early
  // return.
  const [syncingFromDt, setSyncingFromDt] = useState(false);
  // Re-push confirmation (Save & Resync on an already-pushed order).
  // Holds the diff summary while the operator decides whether to
  // re-push. null = dialog closed. The Supabase save has ALREADY
  // happened by the time this is set — confirming only gates the
  // scoped dt-push-order invoke; cancelling leaves the order saved
  // locally without touching DT (so DT keeps its route/schedule).
  const [resyncConfirm, setResyncConfirm] = useState<DtChangeSummary | null>(null);
  const [resyncPushing, setResyncPushing] = useState(false);
  // Manual inventory release — inline panel (WC-style), Supabase-direct
  // writes. The panel opens when the operator clicks "Release Items..."
  // in the footer; releasing flips inventory.status + release_date via
  // a direct supabase update, Supabase realtime then fans the update
  // through inventoryStatuses → Status column → button gate. Sheet
  // mirror is a separate fire-and-forget invoke that lands in Failed
  // Operations on failure.
  const [releaseMode, setReleaseMode] = useState<'none' | 'partial'>('none');
  // Multi-pickup Phase 1 — Add Pickup mini-modal open state. Triggered
  // from the Linked Pickups section of the Notes card on the delivery
  // OrderPage. Modal handles its own form state; we just refetch on
  // success so the new join row + pickup leg appear in the list.
  const [addPickupOpen, setAddPickupOpen] = useState(false);
  // inventoryStatuses caches the linked inventory rows' status +
  // release_date so the items table can render a Status column without
  // a separate per-row fetch, and so the "Release Items..." button can
  // hide when all linked items are already Released. Keyed by
  // inventory.id (UUID FK on dt_order_items.inventory_id).
  const [inventoryStatuses, setInventoryStatuses] =
    useState<Map<string, { status: string; releaseDate: string | null }>>(new Map());

  useEffect(() => {
    if (order && !editing) setEdit(orderToEdit(order));
  }, [order, editing]);

  // Stable, sorted, comma-joined list of inventory_id values on this
  // order. Used as the realtime-subscription dependency below so we
  // only tear down + recreate the channel when the actual SET of
  // linked inventory items changes — not on every refetch that
  // produces a new array reference (which would orphan in-flight
  // realtime updates during the 1-2s gap between unsubscribe and
  // resubscribe).
  const invIdsKey = useMemo(() => {
    return (order?.items ?? [])
      .map(it => it.inventoryId)
      .filter((id): id is string => !!id)
      .sort()
      .join(',');
  }, [order?.items]);

  // Fetch + subscribe to inventory statuses for every dt_order_items
  // row that has an inventory_id linkage. Drives both the Status
  // column on the items table and the "Release Items..." button
  // gate (hide when all linked items are already Released). Supabase
  // realtime pushes status changes from any source — manual release,
  // auto-release via DT-Finished, an admin manually flipping a row
  // in the Inventory page — without requiring this page to re-mount.
  useEffect(() => {
    if (!order?.id || !order?.tenantId) {
      setInventoryStatuses(new Map());
      return;
    }
    if (!invIdsKey) {
      setInventoryStatuses(new Map());
      return;
    }
    const invIds = invIdsKey.split(',');

    let cancelled = false;

    void (async () => {
      const { data } = await supabase
        .from('inventory')
        .select('id, status, release_date')
        .in('id', invIds);
      if (cancelled || !data) return;
      const m = new Map<string, { status: string; releaseDate: string | null }>();
      for (const r of data as Array<{ id: string; status: string | null; release_date: string | null }>) {
        m.set(r.id, { status: r.status ?? 'Active', releaseDate: r.release_date });
      }
      setInventoryStatuses(m);
    })();

    // Realtime — narrow to this tenant; we re-check the row id against
    // our invIds set in the handler so unrelated rows from the same
    // tenant don't trigger setState churn.
    const invIdSet = new Set(invIds);
    const channel = supabase
      .channel(`order_page_inventory_${order.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'inventory',
          filter: `tenant_id=eq.${order.tenantId}`,
        },
        (payload) => {
          const row = payload.new as { id?: string; status?: string | null; release_date?: string | null };
          if (!row?.id || !invIdSet.has(row.id)) return;
          setInventoryStatuses(prev => {
            const next = new Map(prev);
            next.set(row.id!, { status: row.status ?? 'Active', releaseDate: row.release_date ?? null });
            return next;
          });
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [order?.id, order?.tenantId, invIdsKey]);

  const setField = useCallback(<K extends keyof OrderEdit>(k: K, v: OrderEdit[K]) => {
    setEdit(prev => ({ ...prev, [k]: v }));
  }, []);

  const handleStartEdit = useCallback(() => {
    if (order) setEdit(orderToEdit(order));
    setSaveError(null);
    setEditing(true);
  }, [order]);

  const handleCancelEdit = useCallback(() => { setEditing(false); setSaveError(null); }, []);

  // DT push helper — reusable from the footer Republish button and the
  // inline-edit "Save & Resync" button. Runs the same edge-function
  // invocation, error-extraction, and audit-log logging the footer
  // already does. Returns the parsed result on success, throws on
  // any failure so callers can decide how to surface it.
  const pushOrderToDt = useCallback(async (
    changedFields?: DtFieldGroup[],
  ): Promise<{ dtIdentifier?: string; linkedIdentifier?: string }> => {
    if (!order) throw new Error('No order loaded');
    // changedFields scopes a re-push to only the groups the operator
    // edited (Save & Resync). Omitted (footer Republish) → full push.
    // Never send an empty array: the edge function reads [] as a full
    // push, so callers must skip the invoke entirely when nothing
    // DT-relevant changed.
    const { data, error: invokeErr } = await supabase.functions.invoke('dt-push-order', {
      body: {
        orderId: order.id,
        ...(changedFields && changedFields.length > 0 ? { changedFields } : {}),
      },
    });
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
    void logDtOrderAudit({
      orderId: order.id,
      tenantId: order.tenantId,
      action: 'push_to_dt',
      changes: {
        dtIdentifier: res.dt_identifier ?? order.dtIdentifier,
        ...(res.linked_identifier ? { linkedIdentifier: res.linked_identifier } : {}),
        orderType: order.orderType,
        itemCount: (order.items ?? []).reduce((s, it) => s + Math.max(1, Number(it.quantity) || 1), 0),
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
    return { dtIdentifier: res.dt_identifier, linkedIdentifier: res.linked_identifier };
  }, [order, user?.email]);

  const handleSave = useCallback(async () => {
    if (!order) return;
    lastMutationAtRef.current = Date.now();
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
      driverNotes:       edit.driverNotes.trim(),
      pickupNotes:       edit.pickupNotes.trim(),
      deliveryNotes:     edit.deliveryNotes.trim(),
      internalNotes:     edit.internalNotes.trim(),
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
        driver_notes:       edit.driverNotes.trim()     || null,
        // v42 — per-leg notes. On a delivery row, delivery_notes
        // belongs here; pickup_notes is written to the linked pickup
        // row below (see linked-pickup write block) so the DT pickup
        // push picks it up from its own row. On a pickup-only row,
        // both columns can land here (delivery_notes is harmless
        // when no delivery leg exists).
        pickup_notes:       (edit.pickupNotes.trim()    || null),
        delivery_notes:     (edit.deliveryNotes.trim()  || null),
        internal_notes:     edit.internalNotes.trim()   || null,
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

      // v42 — cross-write Pickup Notes to the linked pickup row.
      // On a delivery's OrderPage the operator types pickup_notes for
      // the pickup leg; we mirror that onto the linked pickup row's
      // own pickup_notes column so dt-push-order picks it up when
      // building the pickup leg's DT payload (it reads each row's
      // own pickup_notes). Only fires when this is the delivery side
      // of a P+D pair AND the value actually changed (avoids touching
      // the pickup row when an operator only edited delivery_notes).
      const pickupNotesChanged = edit.pickupNotes !== (order.pickupNotes ?? '');
      const isPickupLegLocal = order.isPickup === true || order.orderType === 'pickup';
      if (!isPickupLegLocal && order.linkedOrderId && pickupNotesChanged) {
        const { error: linkedErr } = await supabase
          .from('dt_orders')
          .update({ pickup_notes: edit.pickupNotes.trim() || null })
          .eq('id', order.linkedOrderId);
        if (linkedErr) {
          // Don't abort the save — the delivery-side write already
          // landed and the pickup notes will still display on the
          // delivery page from the join-table fetch. Surface as
          // toast-equivalent (logging here keeps the failure visible
          // in the FailedOperationsDrawer audit trail without
          // collapsing the save UX).
          console.warn(`[OrderPage] failed to mirror pickup_notes to linked pickup ${order.linkedOrderId}: ${linkedErr.message}`);
        }
      }

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
      if (edit.driverNotes     !== (order.driverNotes     ?? '')) changedFields.push('driverNotes');
      if (edit.pickupNotes     !== (order.pickupNotes     ?? '')) changedFields.push('pickupNotes');
      if (edit.deliveryNotes   !== (order.deliveryNotes   ?? '')) changedFields.push('deliveryNotes');
      if (edit.internalNotes   !== (order.internalNotes   ?? '')) changedFields.push('internalNotes');
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

  // Save inline edits AND immediately resync to DispatchTrack. Only
  // surfaced when the order has been pushed at least once — if it
  // hasn't been pushed, the existing footer "Push to DT" button is
  // the right place to first-push. handleSave handles its own
  // success/failure via saveError; if it fails, dt_orders wasn't
  // updated and the subsequent push pushes the same data DT already
  // has (harmless no-op). Push failure surfaces a "saved locally but
  // DT push failed" message so the operator knows the local edit
  // landed and can retry the push from the footer.
  // The actual scoped re-push, run only after the operator confirms in
  // the dialog. Supabase is already saved at this point; this only
  // propagates the changed groups to DT.
  const performResync = useCallback(async (groups: DtFieldGroup[]) => {
    if (!order) return;
    setResyncConfirm(null);
    try {
      lastMutationAtRef.current = Date.now();
      setResyncPushing(true);
      setSaving(true);
      await pushOrderToDt(groups);
      const fresh = await fetchDtOrderByIdFromSupabase(order.id);
      if (fresh) setLocalOrder(fresh);
      refetch();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[OrderPage] Save & Resync push failed:', msg);
      setSaveError(`Saved locally, but DT push failed: ${msg}. Use Republish to DT in the footer to retry.`);
    } finally {
      setResyncPushing(false);
      setSaving(false);
    }
  }, [order, pushOrderToDt, refetch]);

  // Operator cancelled the re-push: the Supabase save already landed,
  // so just refresh local state. DT keeps its current route/schedule.
  const cancelResync = useCallback(async () => {
    setResyncConfirm(null);
    if (!order) return;
    const fresh = await fetchDtOrderByIdFromSupabase(order.id);
    if (fresh) setLocalOrder(fresh);
    refetch();
  }, [order, refetch]);

  const handleSaveAndResync = useCallback(async () => {
    if (!order) return;

    // Diff the form against the loaded order BEFORE saving (handleSave
    // flips editing off + refetches). Only DT-relevant columns the
    // inline edit can touch are compared — items can't be edited here,
    // so itemsChanged is always false. windowStart/End are normalized
    // to HH:MM on both sides so a storage HH:MM:SS round-trip doesn't
    // read as a change.
    const w5 = (s: string | null | undefined) => (s ?? '').slice(0, 5);
    const snapshot: Record<string, unknown> = {
      contact_name: order.contactName, contact_address: order.contactAddress,
      contact_city: order.contactCity, contact_state: order.contactState,
      contact_zip: order.contactZip, contact_phone: order.contactPhone,
      contact_email: order.contactEmail,
      local_service_date: order.localServiceDate,
      window_start_local: w5(order.windowStartLocal),
      window_end_local: w5(order.windowEndLocal),
      details: order.details, driver_notes: order.driverNotes,
      pickup_notes: order.pickupNotes, delivery_notes: order.deliveryNotes,
      internal_notes: order.internalNotes, sidemark: order.sidemark,
      client_reference: order.clientReference,
      // po_number — added 2026-05-20 alongside dt-push-order v36
      // <additional_field_1> emit so editing the PO from inline-edit
      // actually re-pushes the new value to DT. Pre-fix the column
      // was patched on the dt_orders row but the selective-push diff
      // couldn't see it, so summarizeDtChanges returned no groups and
      // no DT push fired. Trimmed on the snapshot side too so a DB
      // value with stray whitespace doesn't phantom-diff against the
      // payload (which is always trimmed).
      po_number: (order.poNumber || '').trim(),
    };
    const payload: Record<string, unknown> = {
      contact_name: edit.contactName.trim(), contact_address: edit.contactAddress.trim(),
      contact_city: edit.contactCity.trim(), contact_state: edit.contactState.trim(),
      contact_zip: edit.contactZip.trim(), contact_phone: edit.contactPhone.trim(),
      contact_email: edit.contactEmail.trim(),
      local_service_date: edit.localServiceDate,
      window_start_local: w5(edit.windowStartLocal),
      window_end_local: w5(edit.windowEndLocal),
      details: edit.details.trim(), driver_notes: edit.driverNotes.trim(),
      pickup_notes: edit.pickupNotes.trim(), delivery_notes: edit.deliveryNotes.trim(),
      internal_notes: edit.internalNotes.trim(), sidemark: edit.sidemark.trim(),
      client_reference: edit.clientReference.trim(),
      po_number: edit.poNumber.trim(),
    };
    const summary = summarizeDtChanges(snapshot, payload, false);

    await handleSave();

    // Nothing that reaches DT changed (e.g. only review status/notes or
    // pricing) → save only, never touch DT. An empty changedFields would
    // be read by the edge function as a FULL push, so we MUST skip the
    // invoke here rather than push with an empty scope.
    if (summary.groups.length === 0) {
      const fresh = await fetchDtOrderByIdFromSupabase(order.id);
      if (fresh) setLocalOrder(fresh);
      refetch();
      return;
    }

    // Order is already live in DT (the button only renders when
    // pushedToDtAt is set) → confirm before re-pushing so the operator
    // sees exactly what will propagate and can decide.
    setResyncConfirm(summary);
  }, [order, edit, handleSave, refetch]);

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
  if (status === 'not-found') return <PageState icon={SearchX} color={theme.colors.textMuted} title="Order Not Found" body={`No order found with this ID.`} actions={<button onClick={goBack} style={backBtnStyle}>Back to Orders</button>} />;
  if (status === 'error') {
    return (
      <PageState icon={AlertCircle} color={theme.colors.statusRed} title="Failed to Load Order" body={error || 'An unexpected error occurred.'}
        actions={<div style={{ display: 'flex', gap: 12 }}><button onClick={() => refetch()} style={{ ...backBtnStyle, color: theme.colors.primary }}>Retry</button><button onClick={goBack} style={backBtnStyle}>Back to Orders</button></div>}
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
          linkedOrder={linkedOrder}
          editing={editing}
          edit={edit}
          setField={setField}
          saving={saving}
          saveError={saveError}
          onStartEdit={handleStartEdit}
          onCancelEdit={handleCancelEdit}
          onSave={handleSave}
          onSaveAndResync={handleSaveAndResync}
          isStaff={canReview}
          accessorialNames={accessorialNames}
          inventoryStatuses={inventoryStatuses}
          releasableItems={releasableItems}
          releasePanelOpen={releaseMode === 'partial'}
          onCloseReleasePanel={() => setReleaseMode('none')}
          performedBy={user?.email ?? null}
          // Show + Add Pickup affordance on the delivery side of a P+D
          // pair while the order isn't in a terminal status (matches
          // the gate the rest of the Notes card uses). Hidden on
          // standalone deliveries without any pickup yet — those go
          // through the existing CreateDeliveryOrderModal convert path
          // (PR #431) for the first pickup; subsequent pickups use
          // this modal.
          onAddPickup={
            !(order.isPickup || order.orderType === 'pickup')
            && (order.orderType === 'pickup_and_delivery' || order.linkedPickups.length > 0)
            && !['completed', 'cancelled'].includes(order.statusCategory)
              ? () => setAddPickupOpen(true)
              : undefined
          }
        />
      ),
    },
    {
      id: 'photos-docs',
      label: 'Photos & Docs',
      // Pre-delivery reference attachments — parking maps, item photos,
      // BOLs, vendor packing slips. NOT proof of delivery (DT drivers
      // upload that on completion). Stays in our app only; no DT push.
      render: () => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <EPCard>
            <SectionTitle>Photos</SectionTitle>
            <PhotosPanel
              entityType="dt_order"
              entityId={order.id}
              tenantId={order.tenantId ?? undefined}
            />
          </EPCard>
          <EPCard>
            <SectionTitle>Documents</SectionTitle>
            <DocumentsPanel
              contextType="dt_order"
              contextId={order.id}
              tenantId={order.tenantId ?? undefined}
            />
          </EPCard>
        </div>
      ),
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Status & Audit Summary — moved off the Details tab so the
              Details surface stays focused on the job and the Activity
              surface is the single source of truth for who-did-what
              and when. Mirrors the data the old Review card showed
              (review status badge, created by, timestamps) plus DT
              push/sync state. The dt_order_audit timeline below
              renders the same events in chronological order. */}
          <EPCard>
            <SectionTitle>Status &amp; Audit Summary</SectionTitle>
            {order.reviewStatus && order.reviewStatus !== 'not_required' && REVIEW_CFG[order.reviewStatus] && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 12, fontSize: 12, fontWeight: 600, background: REVIEW_CFG[order.reviewStatus].bg, color: REVIEW_CFG[order.reviewStatus].color, marginBottom: 12 }}>
                {REVIEW_CFG[order.reviewStatus].icon}
                {REVIEW_CFG[order.reviewStatus].label}
              </div>
            )}
            {(order.createdByName || order.createdByEmail || order.createdByRole) && (
              <Field
                label="Created By"
                value={(() => {
                  const role = order.createdByRole ? ` · ${order.createdByRole}` : '';
                  if (order.createdByEmail && order.createdByName) {
                    return `${order.createdByName} (${order.createdByEmail})${role}`;
                  }
                  const who = order.createdByName || order.createdByEmail;
                  if (who) return `${who}${role}`;
                  return order.createdByRole || '';
                })()}
              />
            )}
            {order.reviewNotes  && <Field label="Review Notes" value={order.reviewNotes} />}
            {order.createdAt    && <Field label="Created At"   value={fmtDateTime(order.createdAt)} />}
            {/* Last Edited only when updated_at differs from created_at —
                Postgres bumps updated_at on every UPDATE so a brand-new
                row would otherwise show two identical timestamps. */}
            {order.updatedAt && order.updatedAt !== order.createdAt && (
              <Field label="Last Edited" value={fmtDateTime(order.updatedAt)} />
            )}
            {order.reviewedAt   && <Field label="Reviewed At"  value={fmtDateTime(order.reviewedAt)} />}
            {order.pushedToDtAt && <Field label="Pushed to DT" value={fmtDateTime(order.pushedToDtAt)} />}
            {order.lastSyncedAt && <Field label="Last Synced"  value={fmtDateTime(order.lastSyncedAt)} />}
          </EPCard>
          <EPCard>
            <SectionTitle>Activity Timeline</SectionTitle>
            <EntityHistory entityType="dt_order" entityId={order.id} tenantId={order.tenantId ?? undefined} />
          </EPCard>
        </div>
      ),
    },
  ];

  // ── Footer ─────────────────────────────────────────────────────────────────

  // Inventory items on this order eligible for the manual-release
  // flow. Two filters:
  //   1. Must have an inventory_id FK linkage. Ad-hoc / free-text
  //      lines (inventory_id null) have nothing in Stride inventory
  //      to flip from Active → Released — they're not selectable.
  //      Note: we no longer fall back to dt_item_code; the new
  //      Supabase-direct write path needs the UUID for the update,
  //      and the GAS sheet mirror receives item_id alongside.
  //   2. Inventory row must not already be Released. Dedup on
  //      inventory_id since two order lines can reference the same
  //      physical item (return + re-deliver pair) and you can only
  //      release each row once.
  const releasableItems: ReleasableItem[] = (() => {
    const seen = new Set<string>();
    const out: ReleasableItem[] = [];
    for (const it of order.items ?? []) {
      const invId = it.inventoryId;
      if (!invId || seen.has(invId)) continue;
      const cached = inventoryStatuses.get(invId);
      // Show items whose status hasn't loaded yet (default Active)
      // OR is explicitly something other than Released / Transferred.
      // Already-Released rows are filtered so the panel only ever
      // shows actionable lines.
      const status = cached?.status ?? 'Active';
      if (status === 'Released' || status === 'Transferred') continue;
      seen.add(invId);
      out.push({
        inventoryId: invId,
        itemId: it.dtItemCode || invId,
        description: it.description || '',
      });
    }
    return out;
  })();
  // Button is shown whenever there's at least one Active item on the
  // order. The old `statusCategory === 'completed'` gate is gone — auto-
  // release will handle the happy path on DT-Finished, and manual
  // release stays available as the universal escape hatch (DT delayed,
  // customer picked up in person, partial-delivery exceptions, etc.).
  // Hides naturally when all items are Released (releasableItems empty).
  const canReleaseItems = !!order.tenantId && releasableItems.length > 0;

  // v2026-05-09 — Edit Full Order is gated by STATUS, not role. Both
  // staff and clients can edit any non-terminal order. The modal's
  // save-changes handler detects the actor + the order's current state
  // and decides what to do with review_status:
  //   - Staff/admin editing: review_status preserved (their edits are
  //     trusted; no re-review needed).
  //   - Client editing a draft: review_status preserved at 'draft' until
  //     they Submit for Review (existing behaviour).
  //   - Client editing a non-draft (pending_review / approved /
  //     scheduled): review_status flips back to 'pending_review' and
  //     notify-order-revision fires with action='updated_by_client'.
  // Terminal states are the hard floor — completed orders are immutable
  // history, cancelled orders shouldn't be re-opened by editing (use a
  // new order), rejected orders need staff intervention.
  const isTerminalStatus = order.statusCategory === 'completed'
    || order.statusCategory === 'cancelled'
    || order.reviewStatus === 'rejected';
  const isOrderEditable = !isTerminalStatus && !editing;

  // ─── Action handlers ─────────────────────────────────────────────────
  // Defined as plain async functions (or sync wrappers) so they can be
  // wired into both the desktop EPFooterButton row AND the mobile
  // FloatingActionMenu without duplicating logic.

  const handlePrintPdf = () => { generateOrderPdf(order); };

  // ── Per-order "Sync from DT" — manual trigger ──────────────────────────
  // Invokes dt-sync-statuses with body {orderId} so the operator can
  // refresh a single order's state from DT immediately instead of waiting
  // for the next cron cycle (~5 min). The edge function's singleOrderId
  // branch bypasses the broader active-scope query and pulls just this
  // order's export.xml. Useful when:
  //   • Driver just finished a pickup leg and operator wants the linked
  //     delivery to show the propagated "Picked up by X" stamp NOW
  //   • Dispatcher edited the order in DT directly and operator wants the
  //     Stride mirror to reflect that without waiting
  //   • Verifying a push was received by checking what comes back
  // Fire-and-forget UX: toast on completion, refetch the order so the
  // page reflects whatever changed.
  //
  // NOTE: the useState(syncingFromDt) declaration for this handler lives
  // up top with the other state hooks (look for `setSyncingFromDt` ~
  // line 1495). It MUST stay above the early `if (status === 'loading')
  // return` to satisfy the Rules of Hooks — otherwise React error #310
  // crashes every order page (PR #491 originally got this wrong).
  const handleSyncFromDt = async () => {
    if (!order || syncingFromDt) return;
    setSyncingFromDt(true);
    try {
      const { data, error } = await supabase.functions.invoke('dt-sync-statuses', {
        body: { orderId: order.id },
      });
      if (error) throw new Error(error.message);
      const res = (data ?? {}) as { ok?: boolean; checked?: number; updated?: number; error?: string };
      if (res.ok === false) throw new Error(res.error || 'Sync returned ok:false');
      // Re-fetch the order so any newly-synced fields (status, driver,
      // notes, items) repaint immediately. No toast — the visible state
      // change IS the confirmation; res.updated > 0 means something
      // changed, =0 means DT had nothing new (still a successful sync).
      const fresh = await fetchDtOrderByIdFromSupabase(order.id);
      if (fresh) setLocalOrder(fresh);
      refetch();
      // Silently no-op on success. Keep the syncingFromDt flag visible
      // long enough that the operator sees the spinner finish.
      void res;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      alert(`Sync from DT failed: ${msg}`);
    } finally {
      setSyncingFromDt(false);
    }
  };

  const handleDiscardDraft = async () => {
    if (!window.confirm("Discard this draft? This can't be undone.")) return;
    lastMutationAtRef.current = Date.now();
    try {
      await supabase.from('dt_order_items').delete().eq('dt_order_id', order.id);
      const { error } = await supabase.from('dt_orders').delete().eq('id', order.id);
      if (error) throw new Error(error.message);
      refetch();
      // Post-delete: bounce back to wherever the user came from (typically
      // the orders list). If they direct-linked into this order from email,
      // history-back can't help → fallback is /orders.
      goBack();
    } catch (e) {
      alert(`Discard failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleEditFullOrder = () => { setShowFullEditModal(true); };
  const handleReleaseItems  = () => { setReleaseMode('partial'); };

  // Approve — same logic as the inline EPFooterButton onClick below, but
  // pulled out so the FAB can call it identically on mobile.
  const handleApprove = async () => {
    lastMutationAtRef.current = Date.now();
    // v2026-05-09 — Approve clears the client-resubmit diff snapshot so
    // the ResubmitBanner disappears and the next client edit's banner
    // starts fresh. last_resubmit_at = null is what hides the banner;
    // the diff/by columns are nulled too so a stale snapshot can't leak
    // back into a future render via the modal's load-time prefill.
    await supabase.from('dt_orders').update({
      review_status: 'approved',
      reviewed_at: new Date().toISOString(),
      last_resubmit_diff: null,
      last_resubmit_at: null,
      last_resubmit_by: null,
    }).eq('id', order.id);
    void logDtOrderAudit({
      orderId: order.id,
      tenantId: order.tenantId,
      action: 'approve',
      changes: { reviewStatus: { old: order.reviewStatus, new: 'approved' } },
      performedBy: user?.email ?? null,
    });
    try {
      // For client-submitted orders, the approval email goes to the person
      // who submitted the order (createdByUser), NOT the delivery contact.
      // The delivery contact is the end customer who didn't submit anything
      // and would be confused by an approval email from Stride.
      // For public-form / staff-created orders, fall back to contactEmail.
      let to = '';
      const isClientSubmitted = order.createdByRole === 'client';
      if (isClientSubmitted) {
        // No contactEmail fallback here: if the creator can't be resolved,
        // skip the email entirely rather than route it to the end customer
        // (which is the exact PII-misrouting this branch exists to prevent).
        to = (order.createdByEmail || '').trim();
        if (!to && order.createdByUser) {
          const { data: prof } = await supabase
            .from('profiles')
            .select('email')
            .eq('id', order.createdByUser)
            .maybeSingle();
          to = String(prof?.email || '').trim();
        }
      } else {
        to = (order.contactEmail || '').trim();
        if (!to) to = (order.createdByEmail || '').trim();
        if (!to && order.createdByUser) {
          const { data: prof } = await supabase
            .from('profiles')
            .select('email')
            .eq('id', order.createdByUser)
            .maybeSingle();
          to = String(prof?.email || '').trim();
        }
      }
      if (to) {
        const hasPricedExtras = Array.isArray(order.accessorials)
          && (order.accessorials as Array<{ subtotal?: number; quotePending?: boolean }>)
            .some(a => !a.quotePending && Number(a.subtotal) > 0);
        const pricingNote = hasPricedExtras
          ? "We've added pricing for the services you requested. You can view the updated total on your order."
          : '';
        // Anonymous public_form submitters don't have an account, so the
        // normal /orders/:id route bounces them to login. Route those
        // recipients to the public /p/order/:id viewer instead — a
        // SECURITY DEFINER RPC enforces a two-factor lookup using the
        // emailed-to address (passed back as a ?email= query param). All
        // other recipients (warehouse client / staff) keep the
        // authenticated link as before.
        const isPublicSubmitter = order.source === 'public_form' || !order.tenantId;
        const appDeepLink = isPublicSubmitter
          ? `https://www.mystridehub.com/#/p/order/${encodeURIComponent(order.id)}?email=${encodeURIComponent(to)}`
          : `https://www.mystridehub.com/#/orders/${encodeURIComponent(order.id)}`;
        const approverCc =
          user?.email && user.email.toLowerCase() !== to.toLowerCase()
            ? [user.email]
            : undefined;
        void supabase.functions.invoke('send-email', {
          body: {
            templateKey: 'DELIVERY_ORDER_APPROVED',
            to,
            cc: approverCc,
            tokens: {
              ORDER_ID:      order.dtIdentifier || order.id,
              CONTACT_NAME:  order.contactName || 'there',
              PRICING_NOTE:  pricingNote,
              APP_DEEP_LINK: appDeepLink,
            },
            idempotencyKey: `delivery-order-approved:${order.id}`,
          },
        });
      }
    } catch (e) {
      console.warn('[OrderPage] DELIVERY_ORDER_APPROVED send failed (non-fatal)', e);
    }
    const fresh = await fetchDtOrderByIdFromSupabase(order.id);
    if (fresh) setLocalOrder(fresh);
    refetch();
  };

  const handlePushToDt = async () => {
    if (pushingDt) return;
    lastMutationAtRef.current = Date.now();
    setPushingDt(true);
    setPushDtError(null);
    try {
      await pushOrderToDt();
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
  };

  // ─── Visibility flags (shared by desktop pill row + mobile FAB) ──────
  const showReviewActions = canReview && !editing
    && (order.reviewStatus === 'pending_review' || order.reviewStatus === 'revision_requested');
  const showDtPushAction = canReview && !editing && order.reviewStatus === 'approved' && (() => {
    const everPushed = !!order.pushedToDtAt;
    const stale = everPushed && !!order.updatedAt && new Date(order.updatedAt).getTime() > new Date(order.pushedToDtAt!).getTime();
    return !everPushed || stale;
  })();
  const dtPushLabel = pushingDt
    ? 'Pushing…'
    : (order.pushedToDtAt ? 'Republish to DT' : 'Push to DT');
  const showDiscardDraft = canReview && !editing && order.reviewStatus === 'draft';

  // Print PDF button — always available (admin / staff / client) so
  // anyone with permission to see the order can hand the customer a
  // printed copy or save one for their own records.
  const printButton = !editing ? (
    <EPFooterButton
      key="print-pdf"
      label="Print PDF"
      variant="secondary"
      onClick={handlePrintPdf}
    />
  ) : null;

  // Discard Draft — only for draft rows. Real orders should be Voided
  // through their normal flow, never deleted.
  const discardDraftButton = showDiscardDraft ? (
    <EPFooterButton
      key="discard-draft"
      label="Discard Draft"
      variant="secondary"
      onClick={handleDiscardDraft}
    />
  ) : null;

  // Sync from DT — manual single-order refresh. Only meaningful once
  // an order has been pushed to DT (no DT side to pull from before
  // that). Hidden on drafts + unpushed orders. Useful for pulling DT
  // dispatcher edits or pickup-stamp propagation immediately instead
  // of waiting for the next dt-sync-statuses cron cycle.
  const syncFromDtButton = !editing && !!order.pushedToDtAt ? (
    <EPFooterButton
      key="sync-from-dt"
      label={syncingFromDt ? 'Syncing…' : 'Sync from DT'}
      variant="secondary"
      onClick={handleSyncFromDt}
      disabled={syncingFromDt}
    />
  ) : null;

  // ─── Mobile FAB actions ──────────────────────────────────────────────
  // Pattern matches TaskDetailPanel / RepairDetailPanel / WillCallDetailPanel:
  // the most state-relevant action stays as a visible inline pill, every-
  // thing else collapses behind the ⋯ FAB so the page content owns the
  // viewport. Editing keeps the inline Cancel/Save row (no FAB) because
  // those two pills are the central UX while editing.
  //
  // Primary action priority (only one inline on mobile):
  //   1. Approve  — when pending_review / revision_requested
  //   2. Push/Republish to DT — when approved + needs push
  //   3. Release Items — when completed + has releasable items
  // Anything below the chosen primary collapses into the FAB overflow.
  // FAB actions visible to a given user depend on:
  //   - Print PDF: anyone, any state, when not editing
  //   - Edit Full Order: anyone, when isOrderEditable (covers staff +
  //     clients, hides on completed / cancelled / rejected)
  //   - Discard Draft: anyone with access on a draft
  //   - Request Revision / Reject: reviewer-only (canReview)
  const fabActions: FABAction[] = !editing ? [
    { label: 'Print PDF', icon: <Printer size={16} />, onClick: handlePrintPdf },
    ...(order.pushedToDtAt ? [{ label: syncingFromDt ? 'Syncing…' : 'Sync from DT', icon: <RefreshCw size={16} />, onClick: () => { void handleSyncFromDt(); } }] : []),
    ...(isOrderEditable ? [{ label: 'Edit Full Order', icon: <Edit3 size={16} />, onClick: handleEditFullOrder }] : []),
    ...(showDiscardDraft ? [{ label: 'Discard Draft', icon: <Trash2 size={16} />, onClick: () => { void handleDiscardDraft(); }, color: '#B91C1C' }] : []),
    ...(showReviewActions ? [
      { label: 'Request Revision', icon: <PenLine size={16} />, onClick: () => handleReviewAction('revision_requested') },
      { label: 'Reject',           icon: <XCircle size={16} />, onClick: () => handleReviewAction('rejected'), color: '#B91C1C' },
    ] : []),
  ] : [];

  // Pick the inline primary for mobile based on the current state.
  // Returns null when there's no obvious primary — in that case the
  // mobile footer is empty and the FAB is the only action surface.
  // All review-side primaries (Approve / Push to DT / Release Items)
  // require canReview; clients just get the FAB with Edit Full Order
  // + Print PDF.
  const mobilePrimary = (() => {
    if (editing) return null;
    if (canReview && showReviewActions) {
      return (
        <EPFooterButton
          key="approve-mobile"
          label="Approve"
          variant="primary"
          onClick={() => { void handleApprove(); }}
        />
      );
    }
    if (canReview && showDtPushAction) {
      return (
        <EPFooterButton
          key="dt-push-mobile"
          label={dtPushLabel}
          variant="primary"
          onClick={() => { void handlePushToDt(); }}
        />
      );
    }
    if (canReview && canReleaseItems) {
      return (
        <EPFooterButton
          key="release-mobile"
          label="Release Items…"
          variant="primary"
          onClick={handleReleaseItems}
        />
      );
    }
    return null;
  })();

  // v2026-05-09 — desktop footer composes from independent gates.
  // Print PDF + Edit Full Order are visible to anyone (including
  // clients) when applicable; review / release / DT push remain
  // reviewer-only. Pre-fix the whole row was nested under
  // `canReview && !editing`, which made the entire footer disappear
  // for client-role users.
  const desktopFooterContent = !editing ? (
    <>
      {printButton}
      {syncFromDtButton}
      {discardDraftButton}
      {/* Edit Full Order — opens the create-order modal in edit mode.
          Available to anyone with access to the order while it's
          editable (any non-terminal status). The modal's save handler
          decides what to do with review_status based on the actor's
          role + the order's current state. */}
      {isOrderEditable && (
        <EPFooterButton
          label="Edit Full Order"
          variant="secondary"
          onClick={handleEditFullOrder}
        />
      )}
      {canReview && canReleaseItems && (
        <EPFooterButton
          label="Release Items…"
          variant="primary"
          onClick={handleReleaseItems}
        />
      )}
      {canReview && showReviewActions && (
        <>
          <EPFooterButton
            label="Approve"
            variant="primary"
            onClick={() => { void handleApprove(); }}
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
      {canReview && showDtPushAction && (
        <EPFooterButton
          label={dtPushLabel}
          variant="primary"
          onClick={() => { void handlePushToDt(); }}
        />
      )}
    </>
  ) : null;

  // Mobile collapses to the chosen primary inline (or nothing) so the
  // bottom of the page isn't a wall of stacked pills. The FAB picks up
  // every secondary action including Print PDF / Edit / Reject / etc.
  const footerContent = isMobile ? mobilePrimary : desktopFooterContent;
  const hasFooter = footerContent !== null
    && (React.isValidElement(footerContent) || React.Children.count(footerContent) > 0);
  const showFab = isMobile && !editing && fabActions.length > 0;

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
      {/* v2026-05-09 — mobile FAB. Renders only on small viewports and
          only when there are actions to show. Editing mode keeps the
          inline Cancel/Save row so the FAB stays hidden there. */}
      <FloatingActionMenu show={showFab} actions={fabActions} />
      {showFullEditModal && (
        <CreateDeliveryOrderModal
          editOrderId={order.id}
          onClose={() => setShowFullEditModal(false)}
          onSubmit={async (data) => {
            setShowFullEditModal(false);
            // v2026-05-09 — when a client edits a non-draft order, the
            // modal flips review_status back to pending_review + sets
            // review_notes audit stamp. Surface that to the office via
            // notify-order-revision (action='updated_by_client'). Fire
            // and forget; never block the UI on email.
            //
            // The idempotencySuffix carries a per-edit timestamp so a
            // client editing the same order multiple times produces
            // separate emails (rather than dedupe'ing on order id).
            if (data?.clientResubmit) {
              const actorName = user?.displayName || user?.email || 'Client';
              const stamp = new Date().toLocaleString();
              void supabase.functions.invoke('notify-order-revision', {
                body: {
                  orderId: data.dtOrderId,
                  action: 'updated_by_client',
                  reviewerName: actorName,
                  reviewNotes: `Updated by ${actorName} on ${stamp}`,
                  idempotencySuffix: String(Date.now()),
                },
              }).catch(e => console.warn('[OrderPage] notify-order-revision (updated_by_client) failed:', e));
            }
            // Refetch the order so the page reflects whatever changed
            // in the modal (status flip, identifier replacement on
            // promote, fields, items, accessorials, coverage, etc.).
            lastMutationAtRef.current = Date.now();
            const fresh = await fetchDtOrderByIdFromSupabase(order.id);
            if (fresh) setLocalOrder(fresh);
            refetch();
          }}
        />
      )}
      {/* Multi-pickup Phase 1 — Add Pickup mini-modal. Renders only when
          opened from the Linked Pickups section of the Notes card. On
          success, refetches the order so the new leg + join row land
          in the UI without a manual reload. */}
      <AddPickupLegModal
        open={addPickupOpen}
        onClose={() => setAddPickupOpen(false)}
        deliveryOrder={order}
        onSuccess={async () => {
          lastMutationAtRef.current = Date.now();
          const fresh = await fetchDtOrderByIdFromSupabase(order.id);
          if (fresh) setLocalOrder(fresh);
          refetch();
        }}
      />
      {/* ReleaseItemsModal removed 2026-05-12 — replaced by the inline
          DtOrderReleasePanel inside DetailsTab, which uses a Supabase-
          direct write path. Supabase realtime fans the inventory
          status change through the Status column + button gate, so no
          modal-close refetch is needed here. */}
      <ConfirmDialog
        open={!!resyncConfirm}
        title="Re-push to DispatchTrack?"
        variant="danger"
        confirmLabel="Save & Re-push"
        cancelLabel="Save only"
        processing={resyncPushing}
        onConfirm={() => { if (resyncConfirm) void performResync(resyncConfirm.groups); }}
        onCancel={cancelResync}
        message={
          <div>
            <p style={{ margin: '0 0 10px' }}>
              This order is already in DispatchTrack. Saving will re-push and may
              affect route assignments. Only the changed fields below will be sent
              — everything else DT has stays as-is.
            </p>
            <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 4 }}>Changes:</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {(resyncConfirm?.changes ?? []).map((c, i) => (
                <li key={i} style={{ marginBottom: 2 }}>
                  <strong>{c.label}:</strong> {c.from} → {c.to}
                </li>
              ))}
            </ul>
            <div style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: 10 }}>
              Field groups re-pushed:{' '}
              {(resyncConfirm?.groups ?? []).map(g => DT_GROUP_LABEL[g]).join(', ')}
            </div>
            <div style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: 6 }}>
              “Save only” keeps your edits in Stride without touching DispatchTrack.
            </div>
          </div>
        }
      />
    </>
  );
}
