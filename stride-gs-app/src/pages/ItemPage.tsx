/**
 * ItemPage.tsx — Full-page inventory item detail view.
 * Route: #/inventory/:itemId
 * Session 80 — Entity Page Redesign Phase 1.
 *
 * Fetches item from Supabase via useItemDetail, renders via EntityPage shell.
 * Edit/write logic lives in Phase 2 — this page is read + navigate-to-actions.
 */
import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AlertCircle, Loader2, SearchX, ShieldX, ClipboardList, Plus, Truck } from 'lucide-react';
import { theme } from '../styles/theme';
import { useItemDetail } from '../hooks/useItemDetail';
import { EntityPage, EPCard, EPLabel, EPFooterButton, EntityPageTokens } from '../components/shared/EntityPage';
import { EntityHistory } from '../components/shared/EntityHistory';
import { fmtDate } from '../lib/constants';
import type { ApiInventoryItem } from '../lib/api';

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  Active:      { bg: theme.colors.statusGreenBg,  color: theme.colors.statusGreen },
  Released:    { bg: theme.colors.statusBlueBg,   color: theme.colors.statusBlue },
  'On Hold':   { bg: theme.colors.statusAmberBg,  color: theme.colors.statusAmber },
  Transferred: { bg: theme.colors.statusGrayBg,   color: theme.colors.statusGray },
};

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_COLORS[status] ?? { bg: theme.colors.statusGrayBg, color: theme.colors.statusGray };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 10px', borderRadius: theme.radii.full,
      background: c.bg, color: c.color,
      fontSize: theme.typography.sizes.xs, fontWeight: theme.typography.weights.semibold,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: c.color, flexShrink: 0 }} />
      {status}
    </span>
  );
}

// ── Meta pill ─────────────────────────────────────────────────────────────────

function MetaPill({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      padding: `2px ${theme.spacing.sm}`, borderRadius: theme.radii.md,
      background: theme.colors.bgSubtle,
      fontSize: theme.typography.sizes.xs, color: theme.colors.textSecondary,
      fontWeight: theme.typography.weights.medium,
    }}>
      <span style={{ fontSize: 9, fontWeight: theme.typography.weights.semibold, color: EntityPageTokens.labelColor, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</span>
      {value}
    </span>
  );
}

// ── Activity with filter pills ────────────────────────────────────────────────

const ACTIVITY_FILTERS: Array<{ label: string; actions: string[] }> = [
  { label: 'All',            actions: [] },
  { label: 'Status Changes', actions: ['status_change', 'release', 'transfer'] },
  { label: 'Field Updates',  actions: ['update'] },
  { label: 'Created',        actions: ['create'] },
];

function ActivityTab({ entityId, tenantId }: { entityId: string; tenantId?: string }) {
  const [activeFilter, setActiveFilter] = useState(0);
  const currentFilter = ACTIVITY_FILTERS[activeFilter];

  return (
    <div>
      {/* Filter pills */}
      <div style={{
        display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 14,
      }}>
        {ACTIVITY_FILTERS.map((f, i) => {
          const isActive = i === activeFilter;
          return (
            <button
              key={f.label}
              onClick={() => setActiveFilter(i)}
              style={{
                padding: `4px ${theme.spacing.md}`,
                borderRadius: theme.radii.full,
                border: 'none',
                fontFamily: 'inherit',
                fontSize: theme.typography.sizes.xs,
                fontWeight: theme.typography.weights.semibold,
                cursor: 'pointer',
                background: isActive ? EntityPageTokens.tabActive : theme.colors.bgSubtle,
                color: isActive ? '#fff' : theme.colors.textSecondary,
                transition: `background ${theme.transitions.fast}, color ${theme.transitions.fast}`,
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {/* History */}
      <EPCard style={{ padding: '8px 14px' }}>
        <EntityHistory
          entityType="inventory"
          entityId={entityId}
          tenantId={tenantId}
          defaultExpanded
          actionFilter={currentFilter.actions.length > 0 ? currentFilter.actions : undefined}
        />
      </EPCard>
    </div>
  );
}

// ── Details tab ───────────────────────────────────────────────────────────────

function DetailsTab({ item }: { item: ApiInventoryItem }) {
  return (
    <div>
      {/* Core fields */}
      <EPCard>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 24px' }}>
          <Field label="Vendor"       value={item.vendor} />
          <Field label="Class"        value={item.itemClass} />
          <Field label="Location"     value={item.location} />
          <Field label="Qty"          value={String(item.qty)} />
          <Field label="Sidemark"     value={item.sidemark} />
          <Field label="Room"         value={item.room} />
          <Field label="Reference"    value={item.reference} />
          <Field label="Receive Date" value={fmtDate(item.receiveDate)} />
          {item.releaseDate && (
            <Field label="Release Date" value={fmtDate(item.releaseDate)} />
          )}
          {item.shipmentNumber && (
            <Field label="Shipment #" value={item.shipmentNumber} />
          )}
          {item.carrier && (
            <Field label="Carrier" value={item.carrier} />
          )}
          {item.trackingNumber && (
            <Field label="Tracking #" value={item.trackingNumber} />
          )}
        </div>
      </EPCard>

      {/* Description */}
      {item.description && (
        <EPCard>
          <EPLabel>Description</EPLabel>
          <div style={{ fontSize: 13, color: '#333', lineHeight: 1.5 }}>{item.description}</div>
        </EPCard>
      )}

      {/* Item notes */}
      {item.itemNotes && (
        <EPCard>
          <EPLabel>Item Notes</EPLabel>
          <div style={{ fontSize: 13, color: '#333', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{item.itemNotes}</div>
        </EPCard>
      )}

      {/* Flags */}
      {(item.needsInspection || item.needsAssembly) && (
        <EPCard>
          <EPLabel>Add-on Services</EPLabel>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {item.needsInspection && <FlagChip label="Inspection Required" color="#D97706" />}
            {item.needsAssembly && <FlagChip label="Assembly Required" color="#7C3AED" />}
          </div>
        </EPCard>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <EPLabel>{label}</EPLabel>
      <div style={{ fontSize: theme.typography.sizes.base, color: value ? theme.colors.text : theme.colors.textMuted, fontWeight: value ? theme.typography.weights.medium : theme.typography.weights.normal }}>
        {value || '—'}
      </div>
    </div>
  );
}

function FlagChip({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: `3px ${theme.spacing.sm}`, borderRadius: theme.radii.md,
      background: color + '18', color,
      fontSize: theme.typography.sizes.xs, fontWeight: theme.typography.weights.semibold,
    }}>
      {label}
    </span>
  );
}

// ── Loading / error states ────────────────────────────────────────────────────

function PageState({ icon: Icon, color, title, body, actions }: {
  icon: React.ComponentType<{ size: number; color?: string }>;
  color: string;
  title: string;
  body: string;
  actions?: React.ReactNode;
}) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '100%', gap: 16,
      padding: 32, textAlign: 'center',
    }}>
      <Icon size={48} color={color} />
      <div style={{ fontSize: 18, fontWeight: 600, color: theme.colors.text }}>{title}</div>
      <div style={{ fontSize: 14, color: theme.colors.textMuted, maxWidth: 400 }}>{body}</div>
      {actions}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ItemPage() {
  const { itemId } = useParams<{ itemId: string }>();
  const navigate = useNavigate();
  const { item, status, error, refetch } = useItemDetail(itemId);

  // ── Loading ──
  if (status === 'loading') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16, color: theme.colors.textMuted }}>
        <Loader2 size={32} style={{ animation: 'spin 1s linear infinite' }} />
        <div style={{ fontSize: 14 }}>Loading item{itemId ? ` ${itemId}` : ''}…</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    );
  }

  if (status === 'access-denied') {
    return (
      <PageState
        icon={ShieldX}
        color={theme.colors.statusRed}
        title="Access Denied"
        body="You don't have permission to view this item."
        actions={<button onClick={() => navigate('/inventory')} style={backBtnStyle}><Loader2 size={13} />Back to Inventory</button>}
      />
    );
  }

  if (status === 'not-found') {
    return (
      <PageState
        icon={SearchX}
        color={theme.colors.textMuted}
        title="Item Not Found"
        body={`No item with ID "${itemId}" was found.`}
        actions={<button onClick={() => navigate('/inventory')} style={backBtnStyle}>Back to Inventory</button>}
      />
    );
  }

  if (status === 'error') {
    return (
      <PageState
        icon={AlertCircle}
        color={theme.colors.statusRed}
        title="Failed to Load Item"
        body={error || 'An unexpected error occurred.'}
        actions={
          <div style={{ display: 'flex', gap: 12 }}>
            <button onClick={refetch} style={{ ...backBtnStyle, color: theme.colors.primary }}>Retry</button>
            <button onClick={() => navigate('/inventory')} style={backBtnStyle}>Back to Inventory</button>
          </div>
        }
      />
    );
  }

  if (!item) return null;

  // ── Tabs ──
  const tabs = [
    {
      id: 'details',
      label: 'Details',
      keepMounted: true,
      render: () => <DetailsTab item={item} />,
    },
    {
      id: 'photos',
      label: 'Photos',
    },
    {
      id: 'docs',
      label: 'Docs',
    },
    {
      id: 'notes',
      label: 'Notes',
    },
    {
      id: 'activity',
      label: 'Activity',
    },
  ];

  // ── Footer ──
  const footer = (
    <>
      {/* Secondary actions (left) */}
      <div style={{ display: 'flex', gap: 8 }}>
        <EPFooterButton
          label="Create Task"
          variant="secondary"
          icon={<ClipboardList size={13} />}
          onClick={() => navigate('/tasks', { state: { createForItemId: item.itemId, clientSheetId: item.clientSheetId } })}
        />
        <EPFooterButton
          label="Add to Will Call"
          variant="secondary"
          icon={<Truck size={13} />}
          onClick={() => navigate('/will-calls', { state: { addItemId: item.itemId, clientSheetId: item.clientSheetId } })}
        />
      </div>

      {/* Primary action (right) */}
      <EPFooterButton
        label="Edit Item"
        variant="primary"
        icon={<Plus size={13} />}
      />
    </>
  );

  return (
    <EntityPage
      entityLabel="Inventory"
      entityId={item.itemId}
      statusBadge={<StatusBadge status={item.status} />}
      clientName={item.clientName}
      sidemark={item.sidemark}
      metaPills={
        <>
          <MetaPill label="Vendor" value={item.vendor} />
          <MetaPill label="Class"  value={item.itemClass} />
          <MetaPill label="Loc"    value={item.location} />
        </>
      }
      backTo="/inventory"
      tabs={tabs}
      builtInTabs={{
        photos: {
          entityType: 'inventory',
          entityId: item.itemId,
          itemId: item.itemId,
          tenantId: item.clientSheetId,
          enableSourceFilter: true,
        },
        docs: {
          contextType: 'item',
          contextId: item.itemId,
          tenantId: item.clientSheetId,
        },
        notes: {
          entityType: 'inventory',
          entityId: item.itemId,
          enableSourceFilter: true,
          itemId: item.itemId,
        },
        activity: {
          render: () => <ActivityTab entityId={item.itemId} tenantId={item.clientSheetId} />,
        },
      }}
      footer={footer}
    />
  );
}

const backBtnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: `${theme.spacing.sm} ${theme.spacing.lg}`, borderRadius: theme.radii.lg,
  border: `1px solid ${theme.colors.border}`,
  background: theme.colors.bgCard, color: theme.colors.text,
  fontSize: theme.typography.sizes.base, fontWeight: theme.typography.weights.medium,
  cursor: 'pointer', fontFamily: 'inherit',
};
