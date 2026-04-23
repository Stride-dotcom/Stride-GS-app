import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AlertCircle, Loader2, SearchX, ShieldX, ExternalLink, Printer, FileDown, Truck, ClipboardList, ArrowRightLeft } from 'lucide-react';
import { theme } from '../styles/theme';
import { useShipmentDetail } from '../hooks/useShipmentDetail';
import { useAuth } from '../contexts/AuthContext';
import { EntityPage, EPCard, EPLabel, EPFooterButton, EntityPageTokens } from '../components/shared/EntityPage';
import { EntityHistory } from '../components/shared/EntityHistory';
import { fmtDate } from '../lib/constants';
import type { ApiShipmentItem } from '../lib/api';

// ── Activity tab ──────────────────────────────────────────────────────────────

const ACTIVITY_FILTERS = [
  { label: 'All',       actions: [] },
  { label: 'Receiving', actions: ['create'] },
  { label: 'Documents', actions: ['update'] },
  { label: 'Notes',     actions: ['update'] },
];

function ActivityTab({ entityId, tenantId }: { entityId: string; tenantId?: string }) {
  const [activeFilter, setActiveFilter] = useState(0);
  const currentFilter = ACTIVITY_FILTERS[activeFilter];
  return (
    <div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 14 }}>
        {ACTIVITY_FILTERS.map((f, i) => {
          const isActive = i === activeFilter;
          return (
            <button
              key={f.label}
              onClick={() => setActiveFilter(i)}
              style={{
                padding: `4px ${theme.spacing.md}`,
                borderRadius: theme.radii.full,
                border: 'none', fontFamily: 'inherit',
                fontSize: theme.typography.sizes.xs,
                fontWeight: theme.typography.weights.semibold,
                cursor: 'pointer',
                background: isActive ? EntityPageTokens.tabActive : theme.colors.bgSubtle,
                color: isActive ? '#fff' : theme.colors.textSecondary,
                transition: `background ${theme.transitions.fast}, color ${theme.transitions.fast}`,
              }}
            >{f.label}</button>
          );
        })}
      </div>
      <EPCard style={{ padding: '8px 14px' }}>
        <EntityHistory
          entityType="shipment"
          entityId={entityId}
          tenantId={tenantId}
          defaultExpanded
          actionFilter={currentFilter.actions.length > 0 ? currentFilter.actions : undefined}
        />
      </EPCard>
    </div>
  );
}

// ── Items table with checkboxes ───────────────────────────────────────────────

interface ItemsTableProps {
  items: ApiShipmentItem[];
  selectedIds: Set<string>;
  onToggleItem: (id: string) => void;
  onToggleAll: () => void;
  onNavigateToItem: (id: string) => void;
}

function ShipmentItemsTable({ items, selectedIds, onToggleItem, onToggleAll, onNavigateToItem }: ItemsTableProps) {
  if (!items.length) {
    return <div style={{ fontSize: 13, color: theme.colors.textMuted, padding: '12px 0' }}>No items loaded yet.</div>;
  }
  const allSelected = items.length > 0 && items.every(i => selectedIds.has(i.itemId));
  const someSelected = items.some(i => selectedIds.has(i.itemId));
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${theme.colors.borderLight}` }}>
            <th style={{ padding: '6px 8px', width: 32 }}>
              <input
                type="checkbox"
                checked={allSelected}
                ref={el => { if (el) el.indeterminate = !allSelected && someSelected; }}
                onChange={onToggleAll}
                style={{ cursor: 'pointer' }}
              />
            </th>
            {['#', 'Item ID', 'Description', 'Vendor', 'Class', 'Location', 'Qty'].map(h => (
              <th key={h} style={{ padding: '6px 8px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: theme.colors.orange, textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item, idx) => {
            const isSelected = selectedIds.has(item.itemId);
            return (
              <tr
                key={item.itemId}
                style={{ borderBottom: `1px solid ${theme.colors.borderLight}`, background: isSelected ? '#FFF7F4' : 'transparent', cursor: 'pointer' }}
                onClick={() => onToggleItem(item.itemId)}
              >
                <td style={{ padding: '6px 8px' }} onClick={e => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onToggleItem(item.itemId)}
                    style={{ cursor: 'pointer' }}
                  />
                </td>
                <td style={{ padding: '6px 8px', color: theme.colors.textMuted, fontSize: 11 }}>{idx + 1}</td>
                <td style={{ padding: '6px 8px' }}>
                  <button
                    onClick={e => { e.stopPropagation(); onNavigateToItem(item.itemId); }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit', fontSize: 13, fontWeight: 600, color: theme.colors.orange, display: 'inline-flex', alignItems: 'center', gap: 3 }}
                  >
                    {item.itemId}
                    <ExternalLink size={10} />
                  </button>
                </td>
                <td style={{ padding: '6px 8px', color: theme.colors.text, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.description || '—'}</td>
                <td style={{ padding: '6px 8px', color: theme.colors.textSecondary, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.vendor || '—'}</td>
                <td style={{ padding: '6px 8px', color: theme.colors.textSecondary }}>{item.itemClass || '—'}</td>
                <td style={{ padding: '6px 8px', color: theme.colors.textSecondary }}>{item.location || '—'}</td>
                <td style={{ padding: '6px 8px', color: theme.colors.text, fontWeight: 600 }}>{item.qty ?? 1}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {someSelected && (
        <div style={{ marginTop: 8, fontSize: 12, color: theme.colors.textSecondary, padding: '4px 8px' }}>
          {selectedIds.size} of {items.length} items selected
        </div>
      )}
    </div>
  );
}

// ── Details tab ───────────────────────────────────────────────────────────────

function DetailsTab({ shipment, items, selectedIds, onToggleItem, onToggleAll, onNavigateToItem }: {
  shipment: NonNullable<ReturnType<typeof useShipmentDetail>['shipment']>;
  items: ApiShipmentItem[];
  selectedIds: Set<string>;
  onToggleItem: (id: string) => void;
  onToggleAll: () => void;
  onNavigateToItem: (id: string) => void;
}) {
  return (
    <div>
      {/* Shipment overview */}
      <EPCard>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 24px' }}>
          <Field label="Receive Date" value={fmtDate(shipment.receiveDate)} />
          <Field label="Item Count"   value={String(shipment.itemCount)} />
          <Field label="Carrier"      value={shipment.carrier} />
          <Field label="Tracking #"   value={shipment.trackingNumber} />
        </div>
        {shipment.notes && (
          <div style={{ marginTop: 14 }}>
            <EPLabel>Notes</EPLabel>
            <div style={{ fontSize: 13, color: '#333', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{shipment.notes}</div>
          </div>
        )}
      </EPCard>

      {/* Drive / document links */}
      {(shipment.folderUrl || shipment.photosUrl || shipment.invoiceUrl) && (
        <EPCard>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {shipment.folderUrl && (
              <a href={shipment.folderUrl} target="_blank" rel="noreferrer" style={linkStyle}>
                <ExternalLink size={13} /> View Shipment Folder
              </a>
            )}
            {shipment.photosUrl && (
              <a href={shipment.photosUrl} target="_blank" rel="noreferrer" style={linkStyle}>
                <ExternalLink size={13} /> Photos Folder
              </a>
            )}
            {shipment.invoiceUrl && (
              <a href={shipment.invoiceUrl} target="_blank" rel="noreferrer" style={linkStyle}>
                <ExternalLink size={13} /> Invoice
              </a>
            )}
          </div>
        </EPCard>
      )}

      {/* Items table */}
      <EPCard>
        <EPLabel>Items ({items.length || shipment.itemCount})</EPLabel>
        <div style={{ marginTop: 8 }}>
          <ShipmentItemsTable
            items={items}
            selectedIds={selectedIds}
            onToggleItem={onToggleItem}
            onToggleAll={onToggleAll}
            onNavigateToItem={onNavigateToItem}
          />
        </div>
      </EPCard>
    </div>
  );
}

const linkStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  fontSize: theme.typography.sizes.sm,
  color: theme.colors.orange, fontWeight: theme.typography.weights.medium,
  textDecoration: 'none',
};

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

// ── Loading / error states ────────────────────────────────────────────────────

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

// ── Main component ────────────────────────────────────────────────────────────

export function ShipmentPage() {
  const { shipmentNo } = useParams<{ shipmentNo: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { shipment, items, status, error, refetch } = useShipmentDetail(shipmentNo);

  const isStaff = user?.role === 'admin' || user?.role === 'staff';

  // ── Item selection ──
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  function toggleItem(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (items.every(i => selectedIds.has(i.itemId))) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(items.map(i => i.itemId)));
    }
  }

  if (status === 'loading') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16, color: theme.colors.textMuted }}>
        <Loader2 size={32} style={{ animation: 'spin 1s linear infinite' }} />
        <div style={{ fontSize: 14 }}>Loading shipment{shipmentNo ? ` ${shipmentNo}` : ''}…</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    );
  }
  if (status === 'access-denied') return <PageState icon={ShieldX} color={theme.colors.statusRed} title="Access Denied" body="You don't have permission to view this shipment." actions={<button onClick={() => navigate(-1)} style={backBtnStyle}>Go Back</button>} />;
  if (status === 'not-found')    return <PageState icon={SearchX} color={theme.colors.textMuted} title="Shipment Not Found" body={`No shipment "${shipmentNo}" was found.`} actions={<button onClick={() => navigate('/shipments')} style={backBtnStyle}>Back to Shipments</button>} />;
  if (status === 'error') {
    return (
      <PageState icon={AlertCircle} color={theme.colors.statusRed} title="Failed to Load Shipment" body={error || 'An unexpected error occurred.'}
        actions={<div style={{ display: 'flex', gap: 12 }}><button onClick={refetch} style={{ ...backBtnStyle, color: theme.colors.primary }}>Retry</button><button onClick={() => navigate('/shipments')} style={backBtnStyle}>Back to Shipments</button></div>}
      />
    );
  }
  if (!shipment) return null;

  // Selected item IDs to pass as state when navigating to actions
  const selectedItemIds = selectedIds.size > 0 ? [...selectedIds] : items.map(i => i.itemId);

  const footer = (
    <>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {/* Print labels */}
        <EPFooterButton
          label="Print Labels"
          variant="secondary"
          icon={<Printer size={13} />}
          onClick={() => navigate('/inventory', { state: { printLabels: selectedItemIds, shipmentNo: shipment.shipmentNumber } })}
        />
        {/* Download receiving document */}
        <EPFooterButton
          label="Receiving Doc"
          variant="secondary"
          icon={<FileDown size={13} />}
          onClick={() => {
            if (shipment.invoiceUrl) {
              window.open(shipment.invoiceUrl, '_blank', 'noreferrer');
            } else if (shipment.folderUrl) {
              window.open(shipment.folderUrl, '_blank', 'noreferrer');
            }
          }}
        />
        {/* Request Inspection Tasks */}
        {isStaff && (
          <EPFooterButton
            label={selectedIds.size > 0 ? `Inspect (${selectedIds.size})` : 'Create Inspection'}
            variant="secondary"
            icon={<ClipboardList size={13} />}
            onClick={() => navigate('/tasks', { state: { createFromShipmentNo: shipment.shipmentNumber, clientSheetId: shipment.clientSheetId, selectedItemIds } })}
          />
        )}
        {/* Transfer Items */}
        {isStaff && items.length > 0 && (
          <EPFooterButton
            label={selectedIds.size > 0 ? `Transfer (${selectedIds.size})` : 'Transfer Items'}
            variant="secondary"
            icon={<ArrowRightLeft size={13} />}
            onClick={() => navigate('/inventory', { state: { transferFromShipmentNo: shipment.shipmentNumber, clientSheetId: shipment.clientSheetId, selectedItemIds } })}
          />
        )}
      </div>
      <EPFooterButton
        label="Create Will Call"
        variant="primary"
        icon={<Truck size={13} />}
        onClick={() => navigate('/will-calls', { state: { createFromShipmentNo: shipment.shipmentNumber, clientSheetId: shipment.clientSheetId, selectedItemIds: selectedIds.size > 0 ? [...selectedIds] : undefined } })}
      />
    </>
  );

  const tabs = [
    {
      id: 'details',
      label: 'Details',
      keepMounted: true,
      render: () => (
        <DetailsTab
          shipment={shipment}
          items={items}
          selectedIds={selectedIds}
          onToggleItem={toggleItem}
          onToggleAll={toggleAll}
          onNavigateToItem={id => navigate(`/inventory/${id}`)}
        />
      ),
    },
    { id: 'photos',   label: 'Photos' },
    { id: 'docs',     label: 'Docs' },
    { id: 'notes',    label: 'Notes' },
    { id: 'activity', label: 'Activity' },
  ];

  return (
    <EntityPage
      entityLabel="Shipment"
      entityId={shipment.shipmentNumber}
      clientName={shipment.clientName}
      metaPills={
        shipment.carrier ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: `2px ${theme.spacing.sm}`, borderRadius: theme.radii.md, background: theme.colors.bgSubtle, fontSize: theme.typography.sizes.xs, color: theme.colors.textSecondary, fontWeight: theme.typography.weights.medium }}>
            <span style={{ fontSize: 9, fontWeight: theme.typography.weights.semibold, color: EntityPageTokens.labelColor, textTransform: 'uppercase' as const, letterSpacing: '0.5px' }}>Carrier</span>
            {shipment.carrier}
          </span>
        ) : undefined
      }
      tabs={tabs}
      builtInTabs={{
        photos:   { entityType: 'shipment', entityId: shipment.shipmentNumber, tenantId: shipment.clientSheetId },
        docs:     { contextType: 'shipment', contextId: shipment.shipmentNumber, tenantId: shipment.clientSheetId },
        notes:    { entityType: 'shipment', entityId: shipment.shipmentNumber },
        activity: { render: () => <ActivityTab entityId={shipment.shipmentNumber} tenantId={shipment.clientSheetId} /> },
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
