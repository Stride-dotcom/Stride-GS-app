import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useIsMobile } from '../../hooks/useIsMobile';
import { Truck, Package, FileText, Mail, ClipboardList, LayoutList } from 'lucide-react';
import { DeepLink } from './DeepLink';
import { ItemIdBadges } from './ItemIdBadges';
import { useItemIndicators } from '../../hooks/useItemIndicators';
import { TabbedDetailPanel, type TabbedDetailPanelTab } from './TabbedDetailPanel';
import { EntityPage } from './EntityPage';
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
import { DriveFoldersList, type DriveFolderLink } from './DriveFoldersList';
import { usePhotos } from '../../hooks/usePhotos';
import { useDocuments } from '../../hooks/useDocuments';
import { useEntityNotes } from '../../hooks/useEntityNotes';
import { PhotosPanel as _PhotosPanel, DocumentsPanel as _DocumentsPanel, NotesPanel as _NotesPanel } from './EntityAttachments';
import { EntityHistory } from './EntityHistory';

/**
 * Phase 7A-7 + 2026-04-22 tabbed migration.
 * Slide-out panel showing completed shipment details. Items lazy-loaded on
 * tab-activate (the Items tab's render reads `active` and only fires the
 * fetch once visible — saves an API call per panel open since most opens
 * never click Items). Staff/admin see Quick Actions in the Details tab.
 */

interface ShipmentItem {
  itemId: string; vendor: string; description: string; itemClass: string;
  qty: number; location: string; sidemark: string; reference?: string;
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
  /** Session 80+ — render as full EntityPage instead of slide-out TabbedDetailPanel.
   *  Only swaps the outer shell. All tabs, handlers, modals, and edit logic
   *  are preserved exactly as-is. */
  renderAsPage?: boolean;
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

export function ShipmentDetailPanel({ shipment, onClose, userRole, isParent, onItemsChanged, renderAsPage }: Props) {
  // (I)(A)(R) indicators for every item row in the shipment items table.
  const { inspOpenItems, inspDoneItems, asmOpenItems, asmDoneItems, repairOpenItems, repairDoneItems, wcOpenItems, wcDoneItems } = useItemIndicators(shipment.clientSheetId);
  const { isMobile } = useIsMobile();
  const navigate = useNavigate();
  const sc = STATUS_CFG[shipment.status] || STATUS_CFG.Received;
  const isStaffAdmin = userRole === 'admin' || userRole === 'staff';
  const canTransfer = isStaffAdmin || !!isParent;

  // Lazy-load items: fetch kicked off once the Items tab becomes active OR
  // the Details tab's Quick Actions render (which also needs the list).
  const [items, setItems] = useState<ShipmentItem[]>(shipment.items || []);
  // When items are supplied up-front (e.g. page mode pre-fetched them), skip
  // the panel's lazy re-fetch entirely — avoids the "items load after panel
  // opens" flash that's visible on full-page views.
  const initiallyHydrated = !!(shipment.items && shipment.items.length > 0);
  const [itemsLoading, setItemsLoading] = useState(!!shipment.clientSheetId && !initiallyHydrated);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [itemsFetched, setItemsFetched] = useState(initiallyHydrated);

  useEffect(() => {
    if (!shipment.clientSheetId || itemsFetched) return;
    let cancelled = false;
    setItemsLoading(true);
    setItemsError(null);

    const mapItem = (i: ApiShipmentItem): ShipmentItem => ({
      itemId: i.itemId, vendor: i.vendor || '', description: i.description,
      itemClass: i.itemClass, qty: i.qty, location: i.location, sidemark: i.sidemark || '',
      reference: (i as { reference?: string }).reference || '',
    });

    // Session 71: Try Supabase first (~50ms), fall back to GAS (2-5s)
    (async () => {
      try {
        const sbResult = await fetchShipmentItemsFromSupabase(shipment.clientSheetId!, shipment.shipmentNo);
        if (!cancelled && sbResult && sbResult.items.length > 0) {
          setItems(sbResult.items.map(mapItem));
          setItemsLoading(false);
          setItemsFetched(true);
          return;
        }
      } catch { /* fall through to GAS */ }

      try {
        const res = await fetchShipmentItems(shipment.clientSheetId!, shipment.shipmentNo);
        if (!cancelled) {
          setItems((res.data?.items || []).map(mapItem));
          setItemsLoading(false);
          setItemsFetched(true);
        }
      } catch (err) {
        if (!cancelled) {
          setItemsError(String(err));
          setItemsLoading(false);
          setItemsFetched(true);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [shipment.clientSheetId, shipment.shipmentNo, itemsFetched]);

  // Item selection for quick actions
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [showCreateWC, setShowCreateWC] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);

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
    if (selectedItemIds.size === 0) setSelectedItemIds(new Set(items.map(i => i.itemId)));
    if (action === 'task') setShowCreateTask(true);
    else if (action === 'wc') setShowCreateWC(true);
    else setShowTransfer(true);
  };

  const closeModal = () => {
    setShowCreateTask(false); setShowCreateWC(false); setShowTransfer(false);
    setSelectedItemIds(new Set());
  };

  // ─── Tabs ────────────────────────────────────────────────────────────────

  const renderDetailsTab = () => (
    <>
      <div style={{ background: theme.colors.bgSubtle, border: `1px solid ${theme.colors.border}`, borderRadius: 10, padding: 14, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
          <Truck size={14} color={theme.colors.orange} />
          <span style={{ fontSize: 12, fontWeight: 600 }}>Shipment Details</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
          <Field label="Carrier" value={shipment.carrier} />
          <Field label="Tracking #" value={shipment.tracking} mono />
          <Field label="Received Date" value={fmtDate(shipment.receivedDate)} />
          <Field label="Created By" value={shipment.createdBy} />
          <Field label="Total Items" value={shipment.totalItems} />
        </div>
        {shipment.notes && <Field label="Notes" value={shipment.notes} />}
      </div>

      {/* Folder + utility button row — suppressed in page mode. Drive folder
          moves to the Photos tab via DriveFoldersList; utility actions move
          to the sticky footer (Receiving Document, Resend Email, View in Inventory). */}
      {!renderAsPage && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          {shipment.folderUrl && <FolderButton label="Shipment Folder" url={shipment.folderUrl} icon={Truck} />}
          <button
            onClick={() => { onClose(); navigate('/inventory', { state: { shipmentFilter: shipment.shipmentNo } }); }}
            style={{ padding: '6px 12px', fontSize: 11, fontWeight: 500, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary, display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <LayoutList size={12} /> View in Inventory
          </button>
          <button onClick={() => { /* Phase 8: link to receiving doc PDF */ }} style={{ padding: '6px 12px', fontSize: 11, fontWeight: 500, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary, display: 'flex', alignItems: 'center', gap: 4 }}><FileText size={12} /> Receiving Document</button>
          <button onClick={() => { /* Phase 8: resend email */ }} style={{ padding: '6px 12px', fontSize: 11, fontWeight: 500, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary, display: 'flex', alignItems: 'center', gap: 4 }}><Mail size={12} /> Resend Email</button>
        </div>
      )}

      {/* Quick Actions block — suppressed in page mode; actions move to footer. */}
      {!renderAsPage && items.length > 0 && !itemsLoading && (
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

      {/* Items table — inline on Details tab (no separate Items tab per 2026-04-22 urgent fix). */}
      {renderItemsTab()}
    </>
  );

  const renderItemsTab = () => (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <Package size={14} color={theme.colors.orange} />
        <span style={{ fontSize: 12, fontWeight: 600 }}>Items Received {!itemsLoading && `(${items.length})`}</span>
      </div>
      {itemsLoading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '16px 0', color: theme.colors.textMuted, fontSize: 12 }}>
          <div style={{ width: 16, height: 16, border: '2px solid #E5E7EB', borderTopColor: theme.colors.orange, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
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
              <th style={{ padding: '6px 10px', textAlign: 'center', fontSize: 10, color: theme.colors.textMuted, textTransform: 'uppercase' }}>Qty</th>
              <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 10, color: theme.colors.textMuted, textTransform: 'uppercase' }}>Vendor</th>
              <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 10, color: theme.colors.textMuted, textTransform: 'uppercase' }}>Description</th>
              <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 10, color: theme.colors.textMuted, textTransform: 'uppercase' }}>Location</th>
              <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 10, color: theme.colors.textMuted, textTransform: 'uppercase' }}>Sidemark</th>
              <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 10, color: theme.colors.textMuted, textTransform: 'uppercase' }}>Reference</th>
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
                <td style={{ padding: '6px 10px', fontWeight: 600 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap' }}>
                    <DeepLink kind="inventory" id={item.itemId} clientSheetId={shipment.clientSheetId} showIcon={false} />
                    <ItemIdBadges itemId={item.itemId} inspOpenItems={inspOpenItems} inspDoneItems={inspDoneItems} asmOpenItems={asmOpenItems} asmDoneItems={asmDoneItems} repairOpenItems={repairOpenItems} repairDoneItems={repairDoneItems} wcOpenItems={wcOpenItems} wcDoneItems={wcDoneItems} />
                  </span>
                </td>
                <td style={{ padding: '6px 10px', textAlign: 'center' }}>{item.qty}</td>
                <td style={{ padding: '6px 10px', color: theme.colors.textSecondary, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.vendor || <span style={{ color: theme.colors.textMuted }}>{'\u2014'}</span>}</td>
                <td style={{ padding: '6px 10px', color: theme.colors.textSecondary, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.description}</td>
                <td style={{ padding: '6px 10px', fontFamily: 'monospace', color: theme.colors.textSecondary }}>{item.location}</td>
                <td style={{ padding: '6px 10px', color: theme.colors.textSecondary, maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.sidemark || <span style={{ color: theme.colors.textMuted }}>{'\u2014'}</span>}</td>
                <td style={{ padding: '6px 10px', color: theme.colors.textSecondary, maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.reference || <span style={{ color: theme.colors.textMuted }}>{'\u2014'}</span>}</td>
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
  );

  // Tab badge counts — uploaded-asset counts only. Drive folder URLs are
  // external links, not uploaded assets; they're intentionally NOT counted.
  const { photos: shPhotos } = usePhotos({
    entityType: 'shipment',
    entityId: renderAsPage ? shipment.shipmentNo : null,
    tenantId: shipment.clientSheetId ?? null,
    enabled: !!renderAsPage,
  });
  const { documents: shDocs } = useDocuments({
    contextType: 'shipment',
    contextId: renderAsPage ? shipment.shipmentNo : '',
    tenantId: shipment.clientSheetId ?? null,
    enabled: !!renderAsPage,
  });
  const { notes: shNotes } = useEntityNotes('shipment', renderAsPage ? shipment.shipmentNo : '');
  const shPhotoCount = renderAsPage ? shPhotos.length : 0;
  const shDocCount   = renderAsPage ? shDocs.length   : 0;
  const shNoteCount  = renderAsPage ? shNotes.length  : 0;

  // Drive folders surfaced in Photos tab (page mode). State-aware — only
  // entries with a URL render.
  const pageDriveFolders: DriveFolderLink[] = [
    ...(shipment.folderUrl ? [{ label: `Shipment ${shipment.shipmentNo}`, url: shipment.folderUrl }] : []),
  ];

  const renderShipmentPhotosTab = () => (
    <div>
      <_PhotosPanel
        entityType="shipment"
        entityId={shipment.shipmentNo}
        tenantId={shipment.clientSheetId}
      />
      <DriveFoldersList folders={pageDriveFolders} />
    </div>
  );
  const renderShipmentDocsTab = () => (
    <div>
      <_DocumentsPanel
        contextType="shipment"
        contextId={shipment.shipmentNo}
        tenantId={shipment.clientSheetId}
      />
      <DriveFoldersList folders={pageDriveFolders} />
    </div>
  );
  const renderShipmentNotesTab = () => (
    <_NotesPanel
      entityType="shipment"
      entityId={shipment.shipmentNo}
      pinnedNote={{ label: 'Shipment Notes', text: shipment.notes }}
    />
  );
  const renderShipmentActivityTab = () => (
    <EntityHistory entityType="shipment" entityId={shipment.shipmentNo} tenantId={shipment.clientSheetId ?? undefined} />
  );

  const customTabs: TabbedDetailPanelTab[] = [
    { id: 'details', label: 'Details', keepMounted: true, render: renderDetailsTab },
  ];

  // Page-mode tab list includes Photos/Docs/Notes/Activity with badge counts
  // and drive-folder-aware Photos/Docs renders. Items are rendered inline on
  // the Details tab (2026-04-22 urgent fix — no separate Items tab).
  const pageCustomTabs = [
    { id: 'details', label: 'Details', keepMounted: true, render: renderDetailsTab },
    { id: 'photos',   label: 'Photos',   badgeCount: shPhotoCount, render: renderShipmentPhotosTab },
    { id: 'docs',     label: 'Docs',     badgeCount: shDocCount,   render: renderShipmentDocsTab },
    { id: 'notes',    label: 'Notes',    badgeCount: shNoteCount,  render: renderShipmentNotesTab },
    { id: 'activity', label: 'Activity', render: renderShipmentActivityTab },
  ];

  const builtInTabsCfg = {
    // Shipments are CONTAINER entities — photos/notes scoped to the
    // shipment itself, no item_id rollup (rollup would mix items).
    photos: {
      entityType: 'shipment' as const,
      entityId: shipment.shipmentNo,
      tenantId: shipment.clientSheetId,
      shareContext: {
        jobId: shipment.shipmentNo,
        clientName: shipment.client,
        date: shipment.receivedDate,
        reference: shipment.tracking || null,
      },
      shareTitle: `Shipment ${shipment.shipmentNo}`,
    },
    docs: {
      contextType: 'shipment' as const,
      contextId: shipment.shipmentNo,
      tenantId: shipment.clientSheetId,
    },
    notes: {
      entityType: 'shipment',
      entityId: shipment.shipmentNo,
    },
    activity: {
      entityType: 'shipment',
      entityId: shipment.shipmentNo,
      tenantId: shipment.clientSheetId,
    },
  };

  // Page-mode footer — state-aware pill-styled buttons. Mirrors every action
  // that was in the Details tab's Quick Actions block + the utility button row.
  const pagePillBase: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    gap: 5, flex: '1 1 0',
    minWidth: isMobile ? 92 : 110,
    maxWidth: isMobile ? 140 : 170,
    padding: isMobile ? '8px 10px' : '10px 14px',
    borderRadius: 10, border: 'none',
    fontFamily: 'inherit',
    fontSize: isMobile ? 11 : 12,
    fontWeight: 700,
    letterSpacing: '0.3px', cursor: 'pointer', whiteSpace: 'nowrap',
  };
  const darkPill: React.CSSProperties = { ...pagePillBase, background: '#1C1C1C', color: '#fff' };
  const orangePill: React.CSSProperties = { ...pagePillBase, background: theme.colors.orange, color: '#fff' };
  const hasItems = items.length > 0;
  const pageFooter = (
    <>
      <button onClick={() => { navigate('/inventory', { state: { shipmentFilter: shipment.shipmentNo } }); }} style={darkPill}>
        <LayoutList size={13} /> View Inventory
      </button>
      {shipment.folderUrl && (
        <a href={shipment.folderUrl} target="_blank" rel="noopener noreferrer" style={{ ...darkPill, textDecoration: 'none' }}>
          <Truck size={13} /> Folder
        </a>
      )}
      <button onClick={() => { /* Phase 8: receiving doc */ }} style={darkPill}>
        <FileText size={13} /> Receiving Doc
      </button>
      <button onClick={() => { /* Phase 8: resend email */ }} style={darkPill}>
        <Mail size={13} /> Resend Email
      </button>
      {hasItems && (
        <button onClick={() => openAction('task')} style={darkPill}>
          <ClipboardList size={13} /> Inspection
        </button>
      )}
      {hasItems && canTransfer && (
        <button onClick={() => openAction('transfer')} style={darkPill}>
          <Package size={13} /> Transfer
        </button>
      )}
      {hasItems && (
        <button onClick={() => openAction('wc')} style={orangePill}>
          <Truck size={13} /> Create WC
        </button>
      )}
    </>
  );

  return (
    <>
      {renderAsPage ? (
        <EntityPage
          entityLabel="Shipment"
          entityId={shipment.shipmentNo}
          clientName={shipment.client}
          statusBadge={<Badge t={shipment.status} bg={sc.bg} color={sc.color} />}
          tabs={pageCustomTabs as unknown as Parameters<typeof EntityPage>[0]['tabs']}
          initialTabId="details"
          footer={pageFooter}
        />
      ) : (
        <TabbedDetailPanel
          title={shipment.shipmentNo}
          clientName={shipment.client}
          belowId={<Badge t={shipment.status} bg={sc.bg} color={sc.color} />}
          tabs={customTabs}
          builtInTabs={builtInTabsCfg}
          onClose={onClose}
          resizeKey="shipment"
          defaultWidth={460}
          footer={isMobile ? (
            <div style={{ padding: '12px 16px', paddingBottom: `calc(env(safe-area-inset-bottom, 0px) + 12px)` }}>
              <button onClick={onClose} style={{ width: '100%', padding: '14px 0', fontSize: 15, fontWeight: 600, border: 'none', borderRadius: 10, background: '#F1F5F9', cursor: 'pointer', fontFamily: 'inherit', color: '#475569' }}>Done</button>
            </div>
          ) : (
            <button onClick={onClose} style={{ width: '100%', padding: '10px', fontSize: 13, fontWeight: 600, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary }}>Close</button>
          )}
        />
      )}

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
