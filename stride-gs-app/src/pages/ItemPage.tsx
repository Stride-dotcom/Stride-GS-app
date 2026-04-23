/**
 * ItemPage.tsx — Full-page inventory item detail view.
 * Route: #/inventory/:itemId
 *
 * Thin wrapper around ItemDetailPanel in `renderAsPage` mode. Fetches the item
 * + related entities (tasks, repairs, will calls, billing, shipment) + edit
 * metadata (class names, location names, optimistic patches) and passes them
 * in as props. All rendering, state, handlers, modals, edit logic, and API
 * calls live in ItemDetailPanel — the page just wires data in and modals out,
 * preserving 100% feature parity with the slide-out panel.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AlertCircle, Loader2, SearchX, ShieldX } from 'lucide-react';
import { theme } from '../styles/theme';
import { useAuth } from '../contexts/AuthContext';
import { useItemDetail } from '../hooks/useItemDetail';
import { useInventory } from '../hooks/useInventory';
import { useTasks } from '../hooks/useTasks';
import { useRepairs } from '../hooks/useRepairs';
import { useWillCalls } from '../hooks/useWillCalls';
import { useBilling } from '../hooks/useBilling';
import { useShipments } from '../hooks/useShipments';
import { useLocations } from '../hooks/useLocations';
import { usePricing } from '../hooks/usePricing';
import { useClients } from '../hooks/useClients';
import { ItemDetailPanel, type LinkedRecord } from '../components/shared/ItemDetailPanel';
import { CreateWillCallModal } from '../components/shared/CreateWillCallModal';
import { CreateTaskModal } from '../components/shared/CreateTaskModal';
import { TransferItemsModal } from '../components/shared/TransferItemsModal';
import type { ApiInventoryItem } from '../lib/api';
import type { InventoryItem } from '../lib/types';
import { entityEvents } from '../lib/entityEvents';

// ── Loading / error / not-found / access-denied shells ────────────────────────

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

// ── Main page component ──────────────────────────────────────────────────────

export function ItemPage() {
  const { itemId } = useParams<{ itemId: string }>();
  const navigate = useNavigate();
  const { item, status, error, refetch } = useItemDetail(itemId);

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
    return <PageState icon={ShieldX} color={theme.colors.statusRed} title="Access Denied" body="You don't have permission to view this item." actions={<button onClick={() => navigate(-1)} style={backBtnStyle}>Go Back</button>} />;
  }
  if (status === 'not-found') {
    return <PageState icon={SearchX} color={theme.colors.textMuted} title="Item Not Found" body={`No item with ID "${itemId}" was found.`} actions={<button onClick={() => navigate('/inventory')} style={backBtnStyle}>Back to Inventory</button>} />;
  }
  if (status === 'error') {
    return (
      <PageState icon={AlertCircle} color={theme.colors.statusRed} title="Failed to Load Item" body={error || 'An unexpected error occurred.'}
        actions={<div style={{ display: 'flex', gap: 12 }}><button onClick={refetch} style={{ ...backBtnStyle, color: theme.colors.primary }}>Retry</button><button onClick={() => navigate('/inventory')} style={backBtnStyle}>Back to Inventory</button></div>}
      />
    );
  }
  if (!item) return null;

  return <ItemPageInner item={item} onRefetch={refetch} />;
}

// ── Inner component (once item is loaded) ────────────────────────────────────

function ItemPageInner({ item, onRefetch }: { item: ApiInventoryItem; onRefetch: () => void }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const clientSheetId = item.clientSheetId;

  // Related-entity fetches scoped to the item's tenant so we don't pull the full cross-tenant cache.
  const { apiTasks, tasks, addOptimisticTask, removeOptimisticTask } = useTasks(true, clientSheetId);
  const { apiRepairs } = useRepairs(true, clientSheetId);
  const { apiWillCalls, willCalls: liveWillCalls, addOptimisticWc, removeOptimisticWc } = useWillCalls(true, clientSheetId);
  const { apiRows: billingRows } = useBilling(true, clientSheetId);
  const { apiShipments } = useShipments(true, clientSheetId);
  const { apiItems: allInventoryItems, applyItemPatch, mergeItemPatch, clearItemPatch } = useInventory(true, clientSheetId);
  const { locationNames } = useLocations(true);
  const { classNames } = usePricing(true);
  const { apiClients } = useClients();

  // Filter related entities down to this item.
  const itemTasks = useMemo(() => apiTasks.filter(t => t.itemId === item.itemId), [apiTasks, item.itemId]);
  const itemRepairs = useMemo(() => apiRepairs.filter(r => r.itemId === item.itemId), [apiRepairs, item.itemId]);
  const itemWillCalls = useMemo(
    () => apiWillCalls.filter(w => (w.items || []).some((i: { itemId: string }) => i.itemId === item.itemId)),
    [apiWillCalls, item.itemId]
  );
  const itemBilling = useMemo(() => billingRows.filter(b => b.itemId === item.itemId), [billingRows, item.itemId]);

  // Linked record buttons (compact status-aware references).
  const linkedTasks = useMemo<LinkedRecord[]>(
    () => itemTasks.map(t => ({ id: t.taskId, type: 'task' as const, status: t.status })),
    [itemTasks]
  );
  const linkedRepairs = useMemo<LinkedRecord[]>(
    () => itemRepairs.map(r => ({ id: r.repairId, type: 'repair' as const, status: r.status })),
    [itemRepairs]
  );
  const linkedWillCalls = useMemo<LinkedRecord[]>(
    () => itemWillCalls.map(w => ({ id: w.wcNumber, type: 'willcall' as const, status: w.status })),
    [itemWillCalls]
  );

  // Enriched shipment info (carrier, tracking beyond what's on the item itself).
  const itemShipment = useMemo(() => {
    if (!item.shipmentNumber) return undefined;
    const s = apiShipments.find(sh => sh.shipmentNumber === item.shipmentNumber);
    return s ? { carrier: s.carrier, trackingNo: s.trackingNumber } : undefined;
  }, [apiShipments, item.shipmentNumber]);

  // Shipment folder URL — prefer the one baked into the item, fall back to the shipment record.
  const shipmentFolderUrl = useMemo(() => {
    if (item.shipmentFolderUrl) return item.shipmentFolderUrl;
    if (!item.shipmentNumber) return undefined;
    const s = apiShipments.find(sh => sh.shipmentNumber === item.shipmentNumber);
    return s?.folderUrl || undefined;
  }, [item.shipmentFolderUrl, item.shipmentNumber, apiShipments]);

  // Photos folder id (tenant-level) — resolves when apiClients loads.
  const photosFolderId = useMemo(() => {
    const c = apiClients.find(c => c.spreadsheetId === clientSheetId);
    return (c as { photosFolderId?: string } | undefined)?.photosFolderId;
  }, [apiClients, clientSheetId]);

  // Modal state — the panel emits callbacks; this page renders the modals.
  const [showCreateTaskModal, setShowCreateTaskModal] = useState(false);
  const [showCreateWcModal, setShowCreateWcModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);

  // Cross-entity navigation from linked-record buttons inside the panel.
  const handleNavigateToRecord = useCallback(
    (type: 'task' | 'repair' | 'willcall' | 'shipment', id: string) => {
      if (type === 'task') {
        if (id) navigate(`/tasks/${encodeURIComponent(id)}`);
        else navigate('/tasks', { state: { clientSheetId } });
      } else if (type === 'repair') {
        if (id) navigate(`/repairs/${encodeURIComponent(id)}`);
        else navigate('/repairs', { state: { clientSheetId } });
      } else if (type === 'shipment') {
        if (id) navigate(`/shipments/${encodeURIComponent(id)}`);
        else navigate('/shipments', { state: { clientSheetId } });
      } else {
        if (id) navigate(`/will-calls/${encodeURIComponent(id)}`);
        else navigate('/will-calls', { state: { clientSheetId } });
      }
    },
    [navigate, clientSheetId]
  );

  // Refetch everything after a successful write.
  const handleItemUpdated = useCallback(() => {
    onRefetch();
    entityEvents.emit('inventory', item.itemId);
  }, [onRefetch, item.itemId]);

  // Cast ApiInventoryItem → InventoryItem-like for modals that expect the legacy shape.
  // The runtime fields overlap fully (itemId, clientName, vendor, etc. are present on both).
  // clientId is the historical name; clientSheetId is the canonical one — map both.
  const itemForModals = useMemo<InventoryItem>(() => ({
    ...(item as unknown as InventoryItem),
    clientId: item.clientSheetId,
  }), [item]);

  const canTransfer = user?.role === 'staff' || user?.role === 'admin' || (user as { isParent?: boolean } | null)?.isParent;

  return (
    <>
      <ItemDetailPanel
        renderAsPage
        item={item}
        onClose={() => navigate(-1)}
        photosFolderId={photosFolderId}
        shipmentFolderUrl={shipmentFolderUrl}
        linkedTasks={linkedTasks}
        linkedRepairs={linkedRepairs}
        linkedWillCalls={linkedWillCalls}
        onNavigateToRecord={handleNavigateToRecord}
        onCreateTask={() => setShowCreateTaskModal(true)}
        onCreateWillCall={() => setShowCreateWcModal(true)}
        onTransfer={canTransfer ? () => setShowTransferModal(true) : undefined}
        itemTasks={itemTasks}
        itemRepairs={itemRepairs}
        itemWillCalls={itemWillCalls}
        itemBilling={itemBilling}
        itemShipment={itemShipment}
        userRole={user?.role}
        classNames={classNames}
        locationNames={locationNames}
        clientSheetId={clientSheetId}
        onItemUpdated={handleItemUpdated}
        applyItemPatch={applyItemPatch}
        mergeItemPatch={mergeItemPatch}
        clearItemPatch={clearItemPatch}
      />

      {/* ── Create Task Modal ── */}
      {showCreateTaskModal && (
        <CreateTaskModal
          items={[itemForModals]}
          clientSheetId={clientSheetId}
          clientName={item.clientName}
          addOptimisticTask={addOptimisticTask}
          removeOptimisticTask={removeOptimisticTask}
          existingTasks={tasks}
          onClose={() => setShowCreateTaskModal(false)}
          onSuccess={(taskIds) => {
            setShowCreateTaskModal(false);
            for (const tid of taskIds) entityEvents.emit('task', tid);
            onRefetch();
          }}
        />
      )}

      {/* ── Create Will Call Modal ── */}
      {showCreateWcModal && (
        <CreateWillCallModal
          preSelectedItemIds={[item.itemId]}
          liveItems={allInventoryItems as unknown as InventoryItem[]}
          addOptimisticWc={addOptimisticWc}
          removeOptimisticWc={removeOptimisticWc}
          existingWillCalls={liveWillCalls}
          onClose={() => setShowCreateWcModal(false)}
          onSubmit={(data) => {
            setShowCreateWcModal(false);
            onRefetch();
            entityEvents.emit('will_call', (data as { wcNumber?: string }).wcNumber || '');
          }}
        />
      )}

      {/* ── Transfer Items Modal ── */}
      {showTransferModal && (
        <TransferItemsModal
          sourceClientName={item.clientName}
          sourceClientSheetId={clientSheetId}
          preSelectedItemIds={[item.itemId]}
          preSelectedItem={itemForModals}
          onClose={() => setShowTransferModal(false)}
          onSuccess={() => {
            setShowTransferModal(false);
            onRefetch();
          }}
          applyItemPatch={applyItemPatch}
          clearItemPatch={clearItemPatch}
        />
      )}
    </>
  );
}
