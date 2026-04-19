import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Truck, Package, FileText, Mail, ClipboardList, LayoutList } from 'lucide-react';
import { DeepLink } from './DeepLink';
import { DetailHeader } from './DetailHeader';
import { FolderButton } from './FolderButton';
import { CreateTaskModal } from './CreateTaskModal';
import { CreateWillCallModal } from './CreateWillCallModal';
import { TransferItemsModal } from './TransferItemsModal';
import { WriteButton } from './WriteButton';
import { theme } from '../../styles/theme';
import { fmtDate } from '../../lib/constants';
import { fetchShipmentItems } from '../../lib/api';
import type { ApiShipmentItem } from '../../lib/api';
import { fetchShipmentItemsFromSupabase } from '../../lib/supabaseQueries';
import type { InventoryItem } from '../../lib/types';
import { getPanelContainerStyle, panelBackdropStyle } from './panelStyles';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useResizablePanel } from '../../hooks/useResizablePanel';

/**
 * Phase 7A-7: Shipment Detail Panel
 * Slide-out panel showing completed shipment details.
 * Items are lazy-loaded via getShipmentItems API call.
 * Staff/admin see Quick Actions (Request Inspection, Create Will Call, Transfer Items).
 */

interface ShipmentItem {
  itemId: string; vendor: string; description: string; itemClass: string;
  qty: number; location: string; sidemark: string;
  needsInspection?: boolean; needsAssembly?: boolean;
}

interface Shipment {
  shipmentNo: string; client: string; clientSheetId?: string; status: string; carrier: string;
  tracking: string; receivedDate: string; createdBy: string;
  notes: string; items: ShipmentItem[]; totalItems: number;
  folderUrl?: string;
}

interface Props {
  shipment: Shipment;
  onClose: () => void;
  userRole?: 'admin' | 'staff' | 'client';
  isParent?: boolean;
  onItemsChanged?: () => void;
}

function Badge({ t, bg, color }: { t: string; bg: string; color: string }) {
  return <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: bg, color, whiteSpace: 'nowrap' }}>{t}</span>;
}

function Field({ label, value, mono }: { label: string; value?: string | number | null; mono?: boolean }) {
  return <div style={{ marginBottom: 10 }}><div style={{ fontSize: 10, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>{label}</div><div style={{ fontSize: 13, color: value ? theme.colors.text : theme.colors.textMuted, fontFamily: mono ? 'monospace' : 'inherit' }}>{String(value ?? '\u2014')}</div></div>;
}

const STATUS_CFG: Record<string, { bg: string; color: string }> = {
  Received: { bg: '#F0FDF4', color: '#15803D' },
  Pending: { bg: '#FEF3C7', color: '#B45309' },
  Cancelled: { bg: '#F3F4F6', color: '#6B7280' },
};

export function ShipmentDetailPanel({ shipment, onClose, userRole, isParent, onItemsChanged }: Props) {
  const { isMobile } = useIsMobile();
  const { width: panelWidth, handleMouseDown: handleResizeMouseDown } = useResizablePanel(460, 'shipment', isMobile);
  const navigate = useNavigate();
  const sc = STATUS_CFG[shipment.status] || STATUS_CFG.Received;
  const isStaffAdmin = userRole === 'admin' || userRole === 'staff';
  const canTransfer = isStaffAdmin || !!isParent;

  // Lazy-load items from API
  const [items, setItems] = useState<ShipmentItem[]>(shipment.items || []);
  const [itemsLoading, setItemsLoading] = useState(!!shipment.clientSheetId);
  const [itemsError, setItemsError] = useState<string | null>(null);

  useEffect(() => {
    if (!shipment.clientSheetId) return;
    let cancelled = false;
    setItemsLoading(true);
    setItemsError(null);

    const mapItem = (i: ApiShipmentItem): ShipmentItem => ({
      itemId: i.itemId, vendor: i.vendor || '', description: i.description,
      itemClass: i.itemClass, qty: i.qty, location: i.location, sidemark: i.sidemark || '',
    });

    // Session 71: Try Supabase first (~50ms), fall back to GAS (2-5s)
    (async () => {
      try {
        const sbResult = await fetchShipmentItemsFromSupabase(shipment.clientSheetId!, shipment.shipmentNo);
        if (!cancelled && sbResult && sbResult.items.length > 0) {
          setItems(sbResult.items.map(mapItem));
          setItemsLoading(false);
          return;
        }
      } catch { /* fall through to GAS */ }

      // GAS fallback
      try {
        const res = await fetchShipmentItems(shipment.clientSheetId!, shipment.shipmentNo);
        if (!cancelled) {
          setItems((res.data?.items || []).map(mapItem));
          setItemsLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setItemsError(String(err));
          setItemsLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [shipment.clientSheetId, shipment.shipmentNo]);

  // Item selection for quick actions
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [showCreateWC, setShowCreateWC] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);

  // Convert shipment items to InventoryItem shape for modals
  const itemsAsInventory = useMemo<InventoryItem[]>(() =>
    items.map(i => ({
      itemId: i.itemId, clientId: shipment.clientSheetId || '', clientName: shipment.client,
      vendor: i.vendor, description: i.description, itemClass: i.itemClass,
      qty: i.qty, location: i.location, sidemark: i.sidemark,
      status: 'Active' as const, shipmentNumber: shipment.shipmentNo, receiveDate: shipment.receivedDate,
    })),
  [items, shipment]);

  const selectedItems = useMemo(() =>
    itemsAsInventory.filter(i => selectedItemIds.has(i.itemId)),
  [itemsAsInventory, selectedItemIds]);

  const toggleItem = (id: string) => setSelectedItemIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const toggleAll = () => setSelectedItemIds(prev =>
    prev.size === items.length ? new Set() : new Set(items.map(i => i.itemId))
  );

  const openAction = (action: 'task' | 'wc' | 'transfer') => {
    // If nothing selected, auto-select all
    if (selectedItemIds.size === 0) setSelectedItemIds(new Set(items.map(i => i.itemId)));
    if (action === 'task') setShowCreateTask(true);
    else if (action === 'wc') setShowCreateWC(true);
    else setShowTransfer(true);
  };

  const closeModal = () => {
    setShowCreateTask(false); setShowCreateWC(false); setShowTransfer(false);
    setSelectedItemIds(new Set());
  };

  return (
    <>
      {!isMobile && <div onClick={onClose} style={panelBackdropStyle} />}
      <div style={getPanelContainerStyle(panelWidth, isMobile)}>
        {!isMobile && <div onMouseDown={handleResizeMouseDown} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 6, cursor: 'col-resize', zIndex: 101 }} />}

        {/* Header — unified DetailHeader (session 70 follow-up).
            Shipments have no sidemark at the shipment level (sidemarks live
            on items); mixed-item shipments make a single header chip
            misleading, so we don't compute one. */}
        <DetailHeader
          entityId={shipment.shipmentNo}
          clientName={shipment.client}
          actions={
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: theme.colors.textMuted }}>
              <X size={18} />
            </button>
          }
          belowId={<Badge t={shipment.status} bg={sc.bg} color={sc.color} />}
        />

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>

          {/* Shipment Info */}
          <div style={{ background: theme.colors.bgSubtle, border: `1px solid ${theme.colors.border}`, borderRadius: 10, padding: 14, marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}><Truck size={14} color={theme.colors.orange} /><span style={{ fontSize: 12, fontWeight: 600 }}>Shipment Details</span></div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
              <Field label="Carrier" value={shipment.carrier} />
              <Field label="Tracking #" value={shipment.tracking} mono />
              <Field label="Received Date" value={fmtDate(shipment.receivedDate)} />
              <Field label="Created By" value={shipment.createdBy} />
              <Field label="Total Items" value={shipment.totalItems} />
            </div>
            {shipment.notes && <Field label="Notes" value={shipment.notes} />}
          </div>

          {/* Folder Links */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <FolderButton label="Shipment Folder" url={shipment.folderUrl} disabledTooltip="Folder link missing — use Fix Missing Folders on Inventory page" icon={Truck} />
            <button
              onClick={() => { onClose(); navigate('/inventory', { state: { shipmentFilter: shipment.shipmentNo } }); }}
              style={{ padding: '6px 12px', fontSize: 11, fontWeight: 500, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary, display: 'flex', alignItems: 'center', gap: 4 }}
            >
              <LayoutList size={12} /> View in Inventory
            </button>
            <button onClick={() => { /* Phase 8: link to receiving doc PDF */ }} style={{ padding: '6px 12px', fontSize: 11, fontWeight: 500, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary, display: 'flex', alignItems: 'center', gap: 4 }}><FileText size={12} /> Receiving Document</button>
            <button onClick={() => { /* Phase 8: resend email */ }} style={{ padding: '6px 12px', fontSize: 11, fontWeight: 500, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary, display: 'flex', alignItems: 'center', gap: 4 }}><Mail size={12} /> Resend Email</button>
          </div>

          {/* Quick Actions — all roles */}
          {items.length > 0 && !itemsLoading && (
            <div style={{ background: theme.colors.bgSubtle, border: `1px solid ${theme.colors.border}`, borderRadius: 10, padding: 14, marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                <ClipboardList size={14} color={theme.colors.orange} />
                <span style={{ fontSize: 12, fontWeight: 600 }}>Quick Actions</span>
                {selectedItemIds.size > 0 && (
                  <span style={{ fontSize: 10, fontWeight: 600, background: theme.colors.orange, color: '#fff', padding: '1px 8px', borderRadius: 10 }}>
                    {selectedItemIds.size} selected
                  </span>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: canTransfer ? '1fr 1fr 1fr' : '1fr 1fr', gap: 6 }}>
                <WriteButton label="Request Inspection" variant="secondary" size="sm" style={{ width: '100%', fontSize: 11 }}
                  onClick={async () => openAction('task')} />
                <WriteButton label="Create Will Call" variant="secondary" size="sm" style={{ width: '100%', fontSize: 11 }}
                  onClick={async () => openAction('wc')} />
                {canTransfer && <WriteButton label="Transfer Items" variant="secondary" size="sm" style={{ width: '100%', fontSize: 11 }}
                  onClick={async () => openAction('transfer')} />}
              </div>
              <div style={{ fontSize: 10, color: theme.colors.textMuted, marginTop: 6 }}>
                Select items below, or click a button to use all items.
              </div>
            </div>
          )}

          {/* Items — lazy loaded */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}><Package size={14} color={theme.colors.orange} /><span style={{ fontSize: 12, fontWeight: 600 }}>Items Received {!itemsLoading && `(${items.length})`}</span></div>
            {itemsLoading ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '16px 0', color: theme.colors.textMuted, fontSize: 12 }}>
                <div style={{
                  width: 16, height: 16, border: '2px solid #E5E7EB', borderTopColor: theme.colors.orange,
                  borderRadius: '50%', animation: 'spin 0.8s linear infinite',
                }} />
                Loading items...
              </div>
            ) : itemsError ? (
              <div style={{ color: '#DC2626', fontSize: 12, padding: '12px 0' }}>Failed to load items</div>
            ) : items.length > 0 ? (
            <div style={{ border: `1px solid ${theme.colors.border}`, borderRadius: 10, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead><tr style={{ background: theme.colors.bgSubtle }}>
                  <th style={{ padding: '6px 6px', textAlign: 'center', width: 28 }}>
                      <input type="checkbox" checked={selectedItemIds.size === items.length && items.length > 0} onChange={toggleAll}
                        style={{ cursor: 'pointer', accentColor: theme.colors.orange }} />
                    </th>
                  <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 10, color: theme.colors.textMuted, textTransform: 'uppercase' }}>#</th>
                  <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 10, color: theme.colors.textMuted, textTransform: 'uppercase' }}>Item ID</th>
                  <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 10, color: theme.colors.textMuted, textTransform: 'uppercase' }}>Description</th>
                  <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 10, color: theme.colors.textMuted, textTransform: 'uppercase' }}>Class</th>
                  <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 10, color: theme.colors.textMuted, textTransform: 'uppercase' }}>Location</th>
                  <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 10, color: theme.colors.textMuted, textTransform: 'uppercase' }}>Tasks</th>
                </tr></thead>
                <tbody>{items.map((item, idx) => (
                  <tr key={idx} style={{
                    borderBottom: `1px solid ${theme.colors.borderLight}`,
                    background: selectedItemIds.has(item.itemId) ? '#FFF7F4' : undefined,
                  }}>
                    <td style={{ padding: '6px 6px', textAlign: 'center' }}>
                        <input type="checkbox" checked={selectedItemIds.has(item.itemId)} onChange={() => toggleItem(item.itemId)}
                          style={{ cursor: 'pointer', accentColor: theme.colors.orange }} />
                      </td>
                    <td style={{ padding: '6px 10px', fontWeight: 600, color: theme.colors.textMuted }}>{idx + 1}</td>
                    <td style={{ padding: '6px 10px', fontWeight: 600 }}><DeepLink kind="inventory" id={item.itemId} clientSheetId={shipment.clientSheetId} showIcon={false} /></td>
                    <td style={{ padding: '6px 10px', color: theme.colors.textSecondary, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.description}</td>
                    <td style={{ padding: '6px 10px' }}>{item.itemClass}</td>
                    <td style={{ padding: '6px 10px', fontFamily: 'monospace', color: theme.colors.textSecondary }}>{item.location}</td>
                    <td style={{ padding: '6px 10px' }}>
                      {item.needsInspection && <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 8, fontSize: 9, fontWeight: 600, background: '#FEF3EE', color: '#E85D2D', marginRight: 3 }}>INSP</span>}
                      {item.needsAssembly && <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 8, fontSize: 9, fontWeight: 600, background: '#F0FDF4', color: '#15803D' }}>ASM</span>}
                      {!item.needsInspection && !item.needsAssembly && <span style={{ color: theme.colors.textMuted }}>{'\u2014'}</span>}
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            ) : (
              <div style={{ color: theme.colors.textMuted, fontSize: 12, padding: '12px 0' }}>No items recorded</div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px', borderTop: `1px solid ${theme.colors.border}`, flexShrink: 0 }}>
          <button onClick={onClose} style={{ width: '100%', padding: '10px', fontSize: 13, fontWeight: 600, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary }}>Close</button>
        </div>
      </div>

      {/* Quick Action Modals */}
      {showCreateTask && shipment.clientSheetId && (
        <CreateTaskModal
          items={selectedItems.length > 0 ? selectedItems : itemsAsInventory}
          clientSheetId={shipment.clientSheetId}
          clientName={shipment.client}
          onClose={closeModal}
          onSuccess={() => { closeModal(); onItemsChanged?.(); }}
        />
      )}

      {showCreateWC && shipment.clientSheetId && (
        <CreateWillCallModal
          preSelectedItemIds={selectedItemIds.size > 0 ? [...selectedItemIds] : items.map(i => i.itemId)}
          liveItems={itemsAsInventory as any}
          onClose={closeModal}
          onSubmit={() => { closeModal(); onItemsChanged?.(); }}
        />
      )}

      {showTransfer && shipment.clientSheetId && (
        <TransferItemsModal
          sourceClientName={shipment.client}
          sourceClientSheetId={shipment.clientSheetId}
          preSelectedItemIds={selectedItemIds.size > 0 ? [...selectedItemIds] : items.map(i => i.itemId)}
          onClose={closeModal}
          onSuccess={() => { closeModal(); onItemsChanged?.(); }}
        />
      )}

      <style>{`@keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } } @keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </>
  );
}
