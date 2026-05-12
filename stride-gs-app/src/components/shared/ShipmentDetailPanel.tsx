import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useIsMobile } from '../../hooks/useIsMobile';
import { FloatingActionMenu, type FABAction } from './FloatingActionMenu';
import { Truck, Package, FileText, Mail, ClipboardList, LayoutList, Pencil, Save, Loader2 } from 'lucide-react';
import { DeepLink } from './DeepLink';
import { ItemIdBadges } from './ItemIdBadges';
import { useItemIndicators } from '../../hooks/useItemIndicators';
import { EntityNotesInline } from '../notes/EntityNotesInline';
import { TabbedDetailPanel, type TabbedDetailPanelTab } from './TabbedDetailPanel';
import { EntityPage } from './EntityPage';
import { CreateTaskModal } from './CreateTaskModal';
import { CreateWillCallModal } from './CreateWillCallModal';
import { TransferItemsModal } from './TransferItemsModal';
import { WriteButton } from './WriteButton';
import { theme } from '../../styles/theme';
import { fmtDate, toDateInputValue } from '../../lib/constants';
import { fetchShipmentItems } from '../../lib/api';
import type { ApiShipmentItem } from '../../lib/api';
import { fetchShipmentItemsFromSupabase } from '../../lib/supabaseQueries';
import { supabase } from '../../lib/supabase';
import { entityEvents } from '../../lib/entityEvents';
import type { InventoryItem } from '../../lib/types';
import { DriveFoldersList, type DriveFolderLink } from './DriveFoldersList';
import { usePhotoGraphRollup, useNoteGraphRollup, type RollupContext } from '../../hooks/useGraphRollup';
import { useDocuments } from '../../hooks/useDocuments';
import { PhotosPanel as _PhotosPanel, DocumentsPanel as _DocumentsPanel, NotesPanel as _NotesPanel } from './EntityAttachments';
import { EntityHistory } from './EntityHistory';
import { InlineEditableCell } from './InlineEditableCell';
import { generateReceivingDocPdf } from '../../lib/workOrderPdf';

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
  const { inspOpenItems, inspDoneItems, inspFailedItems, asmOpenItems, asmDoneItems, repairOpenItems, repairDoneItems, wcOpenItems, wcDoneItems } = useItemIndicators(shipment.clientSheetId);
  const { isMobile, isTablet } = useIsMobile();
  const isCompactViewport = isMobile || isTablet;
  const navigate = useNavigate();
  const sc = STATUS_CFG[shipment.status] || STATUS_CFG.Received;
  const isStaffAdmin = userRole === 'admin' || userRole === 'staff';
  const canTransfer = isStaffAdmin || !!isParent;

  // Mutation timestamp guard, same shape as TaskPage / RepairPage /
  // WillCallPage / OrderPage. Declared early because both the inline-edit
  // setter (`applyShipmentItemPatch`) and the realtime subscriber below
  // reference it before the rest of the edit-mode state machine wires up.
  const lastMutationAtRef = useRef<number>(0);
  const OPTIMISTIC_GUARD_MS = 6000;

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

  // ── Inline-edit patch overlay (sidemark / reference cells) ─────────────
  // Mirrors useInventory's pattern: optimistic patch keyed by itemId,
  // merged into the displayed items via useMemo. Persists for the panel's
  // lifetime so the user sees the new value immediately and it survives
  // until the row is re-fetched.
  const [itemPatches, setItemPatches] = useState<Record<string, Partial<ShipmentItem>>>({});
  const applyShipmentItemPatch = (itemId: string, patch: Record<string, unknown>) => {
    // Bump the mutation timestamp so the realtime listener below doesn't
    // refetch+overwrite items during the GAS write-through window.
    lastMutationAtRef.current = Date.now();
    setItemPatches(prev => ({
      ...prev,
      [itemId]: { ...(prev[itemId] ?? {}), ...(patch as Partial<ShipmentItem>) },
    }));
  };
  // mergeItemPatch is the rollback path the cell uses on save failure —
  // semantics match useInventory's mergeItemPatch (overlay the rollback
  // values on top of any existing patch entries).
  const mergeShipmentItemPatch = applyShipmentItemPatch;

  const mergedItems = useMemo<ShipmentItem[]>(() => {
    if (Object.keys(itemPatches).length === 0) return items;
    return items.map(it => {
      const p = itemPatches[it.itemId];
      return p ? { ...it, ...p } : it;
    });
  }, [items, itemPatches]);

  // Listen for entityEvents 'inventory' fired by InlineEditableCell after a
  // successful save. When one of OUR shipment items is the target, refresh
  // the whole shipment items query so the patch overlay can be cleared and
  // any GAS-side side-effects (vendor-prefix normalization, downstream
  // task/repair fan-out updates surfacing on the description column, etc.)
  // land. Falls back to keeping the optimistic patch on stale tabs.
  useEffect(() => {
    if (!shipment.clientSheetId) return;
    const ourItemIds = new Set(items.map(i => i.itemId));
    return entityEvents.subscribe(async (entityType, entityId) => {
      if (entityType !== 'inventory' || !ourItemIds.has(entityId)) return;
      // Skip the refetch+overwrite if we recently fired a mutation —
      // the GAS write-through can echo back before our optimistic patch
      // has had a chance to surface to the user. The patch overlay keeps
      // the cell looking correct; the server-authoritative refresh comes
      // on the next event after the guard window expires.
      if (Date.now() - lastMutationAtRef.current < OPTIMISTIC_GUARD_MS) return;
      try {
        const sbResult = await fetchShipmentItemsFromSupabase(shipment.clientSheetId!, shipment.shipmentNo);
        if (sbResult && sbResult.items.length > 0) {
          setItems(sbResult.items.map(i => ({
            itemId: i.itemId, vendor: i.vendor || '', description: i.description,
            itemClass: i.itemClass, qty: i.qty, location: i.location, sidemark: i.sidemark || '',
            reference: (i as { reference?: string }).reference || '',
          })));
          // Drop the patch entry for the touched item — server now authoritative.
          setItemPatches(prev => {
            if (!(entityId in prev)) return prev;
            const next = { ...prev };
            delete next[entityId];
            return next;
          });
        }
      } catch { /* keep optimistic patch as the visible truth */ }
    });
  }, [shipment.clientSheetId, shipment.shipmentNo, items]);

  // ─── Edit mode (staff/admin only) ────────────────────────────────────────
  // Edits the four cache fields directly on public.shipments — there's no
  // GAS-side updateShipment endpoint and these aren't authoritative on a
  // sheet anyway (carrier/tracking/notes are Supabase-only metadata; the
  // receive_date is on the client Inventory sheet too but the Supabase
  // mirror gets re-synced on the next inventory write, so editing the
  // mirror in isolation is fine for the React display path).
  //
  // Optimistic-overrides pattern (mirrors ItemDetailPanel) — `optimistic`
  // values shadow the prop until either the parent's refetch arrives with
  // the canonical state OR the user re-opens the panel.
  type ShipmentDraft = {
    carrier: string;
    tracking: string;
    receivedDate: string;  // YYYY-MM-DD for <input type="date">
    notes: string;
  };
  const makeDraft = useCallback((): ShipmentDraft => ({
    carrier: shipment.carrier || '',
    tracking: shipment.tracking || '',
    receivedDate: toDateInputValue(shipment.receivedDate),
    notes: shipment.notes || '',
  }), [shipment]);

  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<ShipmentDraft>(makeDraft);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [optimistic, setOptimistic] = useState<Partial<ShipmentDraft> | null>(null);

  // Clear optimistic overrides when shipment id changes (panel re-used for
  // a different shipment) so the new shipment's prop values render clean.
  const lastShipmentNoRef = useRef(shipment.shipmentNo);
  useEffect(() => {
    if (shipment.shipmentNo !== lastShipmentNoRef.current) {
      lastShipmentNoRef.current = shipment.shipmentNo;
      setOptimistic(null);
      setIsEditing(false);
      lastMutationAtRef.current = 0;
    }
  }, [shipment.shipmentNo]);

  const setDraftField = useCallback(<K extends keyof ShipmentDraft>(field: K, value: ShipmentDraft[K]) => {
    setDraft(prev => ({ ...prev, [field]: value }));
  }, []);

  const handleEditStart = useCallback(() => {
    setDraft(makeDraft());
    setSaveError(null);
    setSaveSuccess(false);
    setIsEditing(true);
  }, [makeDraft]);

  const handleEditCancel = useCallback(() => {
    setIsEditing(false);
    setSaveError(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (!shipment.clientSheetId || !shipment.shipmentNo) return;
    const original = makeDraft();
    // Build patch of only changed fields (so we don't write unchanged values
    // back unnecessarily — keeps updated_at meaningful).
    const patch: Record<string, string | null> = {};
    if (draft.carrier !== original.carrier) patch.carrier = draft.carrier.trim();
    if (draft.tracking !== original.tracking) patch.tracking_number = draft.tracking.trim();
    if (draft.receivedDate !== original.receivedDate) patch.receive_date = draft.receivedDate || null;
    if (draft.notes !== original.notes) patch.notes = draft.notes.trim();

    if (Object.keys(patch).length === 0) {
      setIsEditing(false);
      return;
    }

    // Optimistic — paint edits immediately so closing edit mode doesn't
    // briefly flash old values during the network round-trip.
    const overrides: Partial<ShipmentDraft> = {
      carrier: draft.carrier.trim(),
      tracking: draft.tracking.trim(),
      receivedDate: draft.receivedDate,
      notes: draft.notes.trim(),
    };
    setOptimistic(overrides);

    lastMutationAtRef.current = Date.now();
    setSaving(true);
    setSaveError(null);
    try {
      const { error } = await supabase
        .from('shipments')
        .update(patch)
        .eq('tenant_id', shipment.clientSheetId)
        .eq('shipment_number', shipment.shipmentNo);
      if (error) throw error;
      setSaveSuccess(true);
      setIsEditing(false);
      setTimeout(() => setSaveSuccess(false), 3000);
      // Realtime echo will flow back through useShipmentDetail and replace
      // the optimistic overrides with the canonical row state. Emit so other
      // consumers (Shipments list, anywhere else) refetch immediately rather
      // than waiting on the central Supabase channel debounce.
      entityEvents.emit('shipment', shipment.shipmentNo);
    } catch (err) {
      // Rollback the optimistic overrides on failure
      setOptimistic(null);
      setSaveError(err instanceof Error ? err.message : 'Save failed — please try again');
    }
    setSaving(false);
  }, [shipment.clientSheetId, shipment.shipmentNo, draft, makeDraft]);

  // Display helper: optimistic override > shipment prop > fallback
  const dv = useCallback((field: keyof ShipmentDraft): string => {
    if (optimistic && optimistic[field] !== undefined) return String(optimistic[field]);
    if (field === 'tracking') return shipment.tracking || '';
    if (field === 'receivedDate') return shipment.receivedDate || '';
    return (shipment as unknown as Record<string, string>)[field] || '';
  }, [shipment, optimistic]);

  // v2026-05-04: Receiving Doc generator — pure Supabase. Fetches the
  // DOC_RECEIVING template (cached per tab), renders client-side, opens
  // print dialog. No GAS round-trip. Used by all three button surfaces
  // below (Quick Action card, page-mode footer pill, FAB).
  const handleGenerateReceivingDoc = useCallback(() => {
    void generateReceivingDocPdf({
      shipmentNo:   shipment.shipmentNo,
      clientName:   shipment.client,
      carrier:      shipment.carrier,
      tracking:     shipment.tracking,
      receivedDate: shipment.receivedDate,
      notes:        shipment.notes,
      totalItems:   shipment.totalItems,
      items: (mergedItems.length ? mergedItems : items).map(i => ({
        itemId:      i.itemId,
        qty:         i.qty,
        vendor:      i.vendor,
        description: i.description,
        itemClass:   i.itemClass,
        location:    i.location,
        sidemark:    i.sidemark,
        reference:   i.reference,
      })),
    });
  }, [shipment, items, mergedItems]);

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

  const editInput: React.CSSProperties = {
    width: '100%', padding: '7px 10px', fontSize: 13,
    border: `1px solid ${theme.colors.border}`, borderRadius: 6,
    outline: 'none', fontFamily: 'inherit',
    background: '#fff', boxSizing: 'border-box',
  };
  const editLabel: React.CSSProperties = {
    fontSize: 10, fontWeight: 500, color: theme.colors.textMuted,
    textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4,
    display: 'block',
  };

  const renderDetailsTab = () => (
    <>
      <div style={{ background: theme.colors.bgSubtle, border: `1px solid ${theme.colors.border}`, borderRadius: 10, padding: 14, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
          <Truck size={14} color={theme.colors.orange} />
          <span style={{ fontSize: 12, fontWeight: 600 }}>Shipment Details</span>
          {saveSuccess && !isEditing && (
            <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 600, color: '#15803D' }}>✓ Saved</span>
          )}
        </div>

        {isEditing && isStaffAdmin ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px', marginBottom: 10 }}>
              <div>
                <label style={editLabel}>Carrier</label>
                <input
                  type="text"
                  value={draft.carrier}
                  onChange={e => setDraftField('carrier', e.target.value)}
                  disabled={saving}
                  placeholder="e.g. UPS, FedEx, Sun Delivery"
                  style={editInput}
                />
              </div>
              <div>
                <label style={editLabel}>Tracking #</label>
                <input
                  type="text"
                  value={draft.tracking}
                  onChange={e => setDraftField('tracking', e.target.value)}
                  disabled={saving}
                  style={{ ...editInput, fontFamily: 'monospace' }}
                />
              </div>
              <div>
                <label style={editLabel}>Received Date</label>
                <input
                  type="date"
                  value={draft.receivedDate}
                  onChange={e => setDraftField('receivedDate', e.target.value)}
                  disabled={saving}
                  style={editInput}
                />
              </div>
              <div>
                <Field label="Created By" value={shipment.createdBy} />
              </div>
            </div>
            <div>
              <label style={editLabel}>Notes</label>
              <textarea
                value={draft.notes}
                onChange={e => setDraftField('notes', e.target.value)}
                disabled={saving}
                rows={3}
                placeholder="Damage notes, special instructions, etc."
                style={{ ...editInput, resize: 'vertical', minHeight: 64 }}
              />
            </div>
            {saveError && (
              <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 6, background: '#FEF2F2', color: '#B91C1C', fontSize: 12 }}>
                {saveError}
              </div>
            )}
          </>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
              <Field label="Carrier" value={dv('carrier')} />
              <Field label="Tracking #" value={dv('tracking')} mono />
              <Field label="Received Date" value={fmtDate(dv('receivedDate'))} />
              <Field label="Created By" value={shipment.createdBy} />
              <Field label="Total Items" value={shipment.totalItems} />
            </div>
            {dv('notes') && <Field label="Notes" value={dv('notes')} />}
          </>
        )}
      </div>

      {/* Threaded Notes preview — entity_notes for this shipment. Composer
          + full thread live in the Notes tab. */}
      <EntityNotesInline
        entityType="shipment"
        entityId={shipment.shipmentNo}
        itemId={null}
        tenantId={shipment.clientSheetId ?? null}
      />

      {/* Folder + utility button row — suppressed in page mode. Drive folder
          moves to the Photos tab via DriveFoldersList; utility actions move
          to the sticky footer (Receiving Document, Resend Email, View in Inventory). */}
      {!renderAsPage && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Shipment Folder button removed from the Details body — it's
              still reachable from Photos/Docs → Legacy Folders. */}
          <button
            onClick={() => { onClose(); navigate('/inventory', { state: { shipmentFilter: shipment.shipmentNo } }); }}
            style={{ padding: '6px 12px', fontSize: 11, fontWeight: 500, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary, display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <LayoutList size={12} /> View in Inventory
          </button>
          <button onClick={handleGenerateReceivingDoc} style={{ padding: '6px 12px', fontSize: 11, fontWeight: 500, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary, display: 'flex', alignItems: 'center', gap: 4 }}><FileText size={12} /> Receiving Document</button>
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
          <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <table style={{ width: '100%', minWidth: 720, borderCollapse: 'collapse', fontSize: 12 }}>
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
            <tbody>{mergedItems.map((item, idx) => (
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
                    <ItemIdBadges itemId={item.itemId} inspOpenItems={inspOpenItems} inspDoneItems={inspDoneItems} inspFailedItems={inspFailedItems} asmOpenItems={asmOpenItems} asmDoneItems={asmDoneItems} repairOpenItems={repairOpenItems} repairDoneItems={repairDoneItems} wcOpenItems={wcOpenItems} wcDoneItems={wcDoneItems} />
                  </span>
                </td>
                <td style={{ padding: '6px 10px', textAlign: 'center' }}>{item.qty}</td>
                <td style={{ padding: '6px 10px', color: theme.colors.textSecondary, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.vendor || <span style={{ color: theme.colors.textMuted }}>{'\u2014'}</span>}</td>
                <td style={{ padding: '6px 10px', color: theme.colors.textSecondary, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.description}</td>
                <td style={{ padding: '6px 10px', fontFamily: 'monospace', color: theme.colors.textSecondary }}>{item.location}</td>
                <td style={{ padding: '6px 10px', maxWidth: 120, color: theme.colors.textSecondary }}>
                  <InlineEditableCell
                    value={item.sidemark || ''}
                    itemId={item.itemId}
                    clientSheetId={shipment.clientSheetId || ''}
                    fieldKey="sidemark"
                    variant="autocomplete-db"
                    dbField="sidemarks"
                    applyItemPatch={applyShipmentItemPatch}
                    mergeItemPatch={mergeShipmentItemPatch}
                    renderValue={v => <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{v || <span style={{ color: theme.colors.textMuted }}>{'\u2014'}</span>}</span>}
                  />
                </td>
                <td style={{ padding: '6px 10px', maxWidth: 120, color: theme.colors.textSecondary }}>
                  <InlineEditableCell
                    value={item.reference || ''}
                    itemId={item.itemId}
                    clientSheetId={shipment.clientSheetId || ''}
                    fieldKey="reference"
                    variant="autocomplete-db"
                    dbField="references"
                    applyItemPatch={applyShipmentItemPatch}
                    mergeItemPatch={mergeShipmentItemPatch}
                    renderValue={v => <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{v || <span style={{ color: theme.colors.textMuted }}>{'\u2014'}</span>}</span>}
                  />
                </td>
                <td style={{ padding: '6px 10px' }}>
                  {item.needsInspection && <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 8, fontSize: 9, fontWeight: 600, background: '#FEF3EE', color: '#E85D2D', marginRight: 3 }}>INSP</span>}
                  {item.needsAssembly && <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 8, fontSize: 9, fontWeight: 600, background: '#F0FDF4', color: '#15803D' }}>ASM</span>}
                  {!item.needsInspection && !item.needsAssembly && <span style={{ color: theme.colors.textMuted }}>{'\u2014'}</span>}
                </td>
              </tr>
            ))}</tbody>
          </table>
          </div>
        </div>
      ) : (
        <div style={{ color: theme.colors.textMuted, fontSize: 12, padding: '12px 0' }}>No items recorded</div>
      )}
    </div>
  );

  // v2026-05-04 — graph rollup. Container entity: photos/notes for the
  // shipment itself + every photo/note on items in the shipment (catches
  // each item's inspections, repairs, etc.). itemIds come from the loaded
  // line-items list above.
  const shItemIds = useMemo(
    () => (items ?? []).map(it => String(it.itemId || '')).filter(Boolean),
    [items],
  );
  const shRollupCtx = useMemo<RollupContext>(() => ({
    tenantId: shipment.clientSheetId ?? null,
    itemIds: shItemIds,
    scopes: [{ entityType: 'shipment', entityId: shipment.shipmentNo }],
  }), [shipment.clientSheetId, shipment.shipmentNo, shItemIds]);

  // Tab badge counts — uploaded-asset counts only. Drive folder URLs are
  // external links, not uploaded assets; they're intentionally NOT counted.
  const { photos: shPhotos } = usePhotoGraphRollup(
    renderAsPage ? shRollupCtx : { tenantId: null, itemIds: [], scopes: [], enabled: false }
  );
  const { documents: shDocs } = useDocuments({
    contextType: 'shipment',
    contextId: renderAsPage ? shipment.shipmentNo : '',
    tenantId: shipment.clientSheetId ?? null,
    enabled: !!renderAsPage,
  });
  const { notes: shNotes } = useNoteGraphRollup(
    renderAsPage ? shRollupCtx : { tenantId: null, itemIds: [], scopes: [], enabled: false }
  );
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
        enableSourceFilter
        rollupCtx={shRollupCtx}
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
      enableSourceFilter
      tenantId={shipment.clientSheetId ?? null}
      rollupCtx={shRollupCtx}
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
    // v2026-05-04: graph rollup folds in every line item's photos/notes so
    // the slide-out matches what the page-mode Photos/Notes tabs render.
    photos: {
      entityType: 'shipment' as const,
      entityId: shipment.shipmentNo,
      tenantId: shipment.clientSheetId,
      enableSourceFilter: true,
      rollupCtx: shRollupCtx,
    },
    docs: {
      contextType: 'shipment' as const,
      contextId: shipment.shipmentNo,
      tenantId: shipment.clientSheetId,
    },
    notes: {
      entityType: 'shipment',
      entityId: shipment.shipmentNo,
      enableSourceFilter: true,
      tenantId: shipment.clientSheetId ?? null,
      rollupCtx: shRollupCtx,
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
  // FAB action set mirrors the inline pill row. Used on phone + tablet
  // viewports where the inline footer is suppressed below.
  const fabActions: FABAction[] = [
    ...(isStaffAdmin && !isEditing ? [{ label: 'Edit', icon: <Pencil size={16} />, onClick: handleEditStart }] : []),
    { label: 'View Inventory', icon: <LayoutList size={16} />, onClick: () => navigate('/inventory', { state: { shipmentFilter: shipment.shipmentNo } }) },
    ...(shipment.folderUrl ? [{ label: 'Folder', icon: <Truck size={16} />, onClick: () => window.open(shipment.folderUrl!, '_blank', 'noopener,noreferrer') }] : []),
    { label: 'Receiving Doc', icon: <FileText size={16} />, onClick: handleGenerateReceivingDoc },
    { label: 'Resend Email', icon: <Mail size={16} />, onClick: () => { /* Phase 8 */ } },
    ...(hasItems ? [{ label: 'Inspection', icon: <ClipboardList size={16} />, onClick: () => openAction('task') }] : []),
    ...(hasItems && canTransfer ? [{ label: 'Transfer', icon: <Package size={16} />, onClick: () => openAction('transfer') }] : []),
    ...(hasItems ? [{ label: 'Create WC', icon: <Truck size={16} />, onClick: () => openAction('wc'), color: theme.colors.orange }] : []),
  ];
  const pageFooter = isCompactViewport ? null : isEditing ? (
    // Edit mode owns the footer entirely — Save + Cancel only, so the
    // operator can't accidentally fire one of the action buttons mid-edit.
    <>
      <button onClick={handleSave} disabled={saving} style={{ ...orangePill, cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.85 : 1 }}>
        {saving ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={13} />}
        {saving ? 'Saving…' : 'Save'}
      </button>
      <button onClick={handleEditCancel} disabled={saving} style={{ ...darkPill, background: '#F1F5F9', color: '#475569', cursor: saving ? 'wait' : 'pointer' }}>
        Cancel
      </button>
    </>
  ) : (
    <>
      {isStaffAdmin && (
        <button onClick={handleEditStart} style={{ ...darkPill, background: '#F1F5F9', color: '#1E293B' }}>
          <Pencil size={13} /> Edit
        </button>
      )}
      <button onClick={() => { navigate('/inventory', { state: { shipmentFilter: shipment.shipmentNo } }); }} style={darkPill}>
        <LayoutList size={13} /> View Inventory
      </button>
      {shipment.folderUrl && (
        <a href={shipment.folderUrl} target="_blank" rel="noopener noreferrer" style={{ ...darkPill, textDecoration: 'none' }}>
          <Truck size={13} /> Folder
        </a>
      )}
      <button onClick={handleGenerateReceivingDoc} style={darkPill}>
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
        <>
          <EntityPage
            entityLabel="Shipment"
            entityId={shipment.shipmentNo}
            clientName={shipment.client}
            statusBadge={<Badge t={shipment.status} bg={sc.bg} color={sc.color} />}
            tabs={pageCustomTabs as unknown as Parameters<typeof EntityPage>[0]['tabs']}
            initialTabId="details"
            footer={pageFooter}
          />
          <FloatingActionMenu show={isCompactViewport} actions={fabActions} />
        </>
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
            isEditing ? (
              // Mobile edit mode — full-width Save + condensed Cancel, same
              // shape as ItemDetailPanel's mobile edit footer.
              <div style={{ padding: '12px 16px', display: 'flex', gap: 10, paddingBottom: `calc(env(safe-area-inset-bottom, 0px) + 12px)` }}>
                <button onClick={handleSave} disabled={saving} style={{ flex: 1, padding: '14px 0', fontSize: 15, fontWeight: 600, border: 'none', borderRadius: 10, background: theme.colors.orange, color: '#fff', cursor: saving ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontFamily: 'inherit' }}>
                  {saving ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={16} />}
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button onClick={handleEditCancel} disabled={saving} style={{ flex: '0 0 auto', padding: '14px 20px', fontSize: 15, fontWeight: 600, border: 'none', borderRadius: 10, background: '#F1F5F9', color: '#475569', cursor: saving ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
                  Cancel
                </button>
              </div>
            ) : (
              <div style={{ padding: '12px 16px', display: 'flex', gap: 10, paddingBottom: `calc(env(safe-area-inset-bottom, 0px) + 12px)` }}>
                {isStaffAdmin && (
                  <button onClick={handleEditStart} style={{ flex: '0 0 auto', padding: '14px 20px', fontSize: 15, fontWeight: 600, border: 'none', borderRadius: 10, background: '#F1F5F9', color: '#1E293B', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit' }}>
                    <Pencil size={16} /> Edit
                  </button>
                )}
                <button onClick={onClose} style={{ flex: 1, padding: '14px 0', fontSize: 15, fontWeight: 600, border: 'none', borderRadius: 10, background: '#F1F5F9', cursor: 'pointer', fontFamily: 'inherit', color: '#475569' }}>Done</button>
              </div>
            )
          ) : isEditing ? (
            // Desktop slide-out edit footer — Save + Cancel pair.
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={handleSave} disabled={saving} style={{ flex: 1, padding: '10px', fontSize: 13, fontWeight: 600, border: 'none', borderRadius: 8, background: theme.colors.orange, color: '#fff', cursor: saving ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontFamily: 'inherit' }}>
                {saving ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={14} />}
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button onClick={handleEditCancel} disabled={saving} style={{ flex: '0 0 auto', padding: '10px 16px', fontSize: 13, fontWeight: 600, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', color: theme.colors.textSecondary, cursor: saving ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
                Cancel
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              {isStaffAdmin && (
                <button onClick={handleEditStart} style={{ flex: '0 0 auto', padding: '10px 14px', fontSize: 13, fontWeight: 600, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', color: theme.colors.textSecondary, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit' }}>
                  <Pencil size={14} /> Edit
                </button>
              )}
              <button onClick={onClose} style={{ flex: 1, padding: '10px', fontSize: 13, fontWeight: 600, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary }}>Close</button>
            </div>
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
