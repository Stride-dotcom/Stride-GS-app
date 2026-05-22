import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { fetchShipmentByNoFromSupabase, fetchShipmentItemsFromSupabase, type ClientNameMap } from '../lib/supabaseQueries';
import { fetchShipments, fetchShipmentItems } from '../lib/api';
import { useClients } from './useClients';
import { entityEvents } from '../lib/entityEvents';
import type { ApiShipment, ApiShipmentItem } from '../lib/api';

export type ShipmentDetailStatus = 'loading' | 'loaded' | 'not-found' | 'access-denied' | 'error';

export interface UseShipmentDetailResult {
  shipment: ApiShipment | null;
  items: ApiShipmentItem[];
  status: ShipmentDetailStatus;
  error: string | null;
  refetch: () => void;
}

export function useShipmentDetail(shipmentNo: string | undefined): UseShipmentDetailResult {
  const { user } = useAuth();
  const { clients } = useClients();
  const [shipment, setShipment] = useState<ApiShipment | null>(null);
  const [items, setItems] = useState<ApiShipmentItem[]>([]);
  const [status, setStatus] = useState<ShipmentDetailStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fetchCountRef = useRef(0);

  const clientNameMap = useMemo<ClientNameMap>(() => {
    const map: ClientNameMap = {};
    for (const c of clients) { map[c.id] = c.name; }
    return map;
  }, [clients]);
  const clientNameMapRef = useRef(clientNameMap);
  clientNameMapRef.current = clientNameMap;

  // `silent: true` skips flipping status back to 'loading' — used for
  // realtime-echo refetches so the page doesn't unmount the detail panel
  // (and lose scroll position / open sub-tab state) on every save.
  const fetchShipment = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!shipmentNo || !user) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const fetchId = ++fetchCountRef.current;

    if (!silent) setStatus('loading');
    setError(null);

    try {
      // Step 1: Try Supabase
      const sbShipment = await fetchShipmentByNoFromSupabase(shipmentNo);

      if (controller.signal.aborted || fetchId !== fetchCountRef.current) return;

      if (sbShipment) {
        if (!hasAccess(user, sbShipment.clientSheetId)) {
          setStatus('access-denied');
          return;
        }

        // Resolve clientName from map
        const clientName = clientNameMapRef.current[sbShipment.clientSheetId] || sbShipment.clientName || '';
        const enriched = { ...sbShipment, clientName };

        // Fetch items from Supabase (inventory rows filtered by shipment_number
        // + tenant_id) — ~50ms vs 2-5s from GAS. Awaiting here so the page
        // renders with items already populated (no "items load after panel
        // opens" flash). GAS fallback fires only when Supabase returns empty
        // (genuine new/empty shipment or rare cache miss).
        let sbItemsLoaded = false;
        if (sbShipment.clientSheetId) {
          try {
            const sbItems = await fetchShipmentItemsFromSupabase(
              sbShipment.clientSheetId,
              shipmentNo
            );
            if (controller.signal.aborted || fetchId !== fetchCountRef.current) return;
            if (sbItems && sbItems.items.length > 0) {
              setItems(sbItems.items);
              sbItemsLoaded = true;
            }
          } catch { /* fall through to GAS below */ }
        }

        setShipment(enriched);
        setStatus('loaded');

        // GAS fallback — only when Supabase returned no items. Fire-and-forget
        // so it doesn't block the already-rendered page.
        if (sbShipment.clientSheetId && !sbItemsLoaded) {
          fetchShipmentItems(sbShipment.clientSheetId, shipmentNo, controller.signal)
            .then(resp => {
              if (fetchId !== fetchCountRef.current) return;
              if (resp?.data?.items) setItems(resp.data.items);
            })
            .catch(() => {});
        }
        return;
      }

      // Step 2: Supabase miss — scan accessible clients via GAS
      const accessibleIds = user.role === 'admin' || user.role === 'staff'
        ? user.accessibleClientSheetIds
        : user.clientSheetId
          ? [user.clientSheetId, ...user.childClientSheetIds]
          : [];

      for (const clientSheetId of accessibleIds) {
        if (controller.signal.aborted) return;
        try {
          const resp = await fetchShipments(controller.signal, clientSheetId);
          if (resp?.data?.shipments) {
            const found = resp.data.shipments.find(s => s.shipmentNumber === shipmentNo);
            if (found) {
              if (fetchId !== fetchCountRef.current) return;
              if (!hasAccess(user, clientSheetId)) {
                setStatus('access-denied');
                return;
              }
              setShipment({ ...found, clientSheetId });
              // Try Supabase items first (fast) before falling back to GAS.
              let sbItemsLoaded2 = false;
              try {
                const sbItems2 = await fetchShipmentItemsFromSupabase(clientSheetId, shipmentNo);
                if (sbItems2 && sbItems2.items.length > 0) {
                  setItems(sbItems2.items);
                  sbItemsLoaded2 = true;
                }
              } catch { /* fall through */ }
              setStatus('loaded');
              if (!sbItemsLoaded2) {
                fetchShipmentItems(clientSheetId, shipmentNo, controller.signal)
                  .then(itemsResp => {
                    if (fetchId !== fetchCountRef.current) return;
                    if (itemsResp?.data?.items) setItems(itemsResp.data.items);
                  })
                  .catch(() => {});
              }
              return;
            }
          }
        } catch {
          // try next client
        }
      }

      if (controller.signal.aborted || fetchId !== fetchCountRef.current) return;
      setStatus('not-found');
    } catch (err) {
      if (controller.signal.aborted || fetchId !== fetchCountRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load shipment');
      setStatus('error');
    }
  }, [shipmentNo, user]);

  useEffect(() => {
    fetchShipment();
    return () => { abortRef.current?.abort(); };
  }, [fetchShipment]);

  // Realtime: refetch on shipment-level changes only (carrier, tracking,
  // receive date, etc.). Item-level changes (inventory writes from inline
  // editing sidemark/vendor/description/reference/room/location) are
  // handled by ShipmentDetailPanel's own entityEvents listener, which is
  // properly guarded with OPTIMISTIC_GUARD_MS and only refetches items
  // (not the full shipment).
  //
  // v2026-05-14 — removed the `type === 'inventory'` branch from this
  // listener. It was firing a full fetchShipment() on every inline-edit,
  // unguarded — so editing 3 sidemarks in quick succession queued 3 full
  // shipment+items refetches stacked on top of the optimistic patches,
  // producing the visible flash Justin reported. Same shape as the
  // PR #393 fix on WillCallDetailPanel (COD toggle flashing). The panel-
  // level listener at ShipmentDetailPanel.tsx:184 already covers the
  // cross-tab/cross-user inventory-edit case, with the optimistic guard.
  useEffect(() => {
    if (!shipmentNo) return;
    return entityEvents.subscribe((type, id) => {
      if (type === 'shipment' && id === shipmentNo) void fetchShipment({ silent: true });
    });
  }, [shipmentNo, fetchShipment]);

  return { shipment, items, status, error, refetch: fetchShipment };
}

function hasAccess(user: NonNullable<ReturnType<typeof useAuth>['user']>, clientSheetId: string): boolean {
  if (user.role === 'admin' || user.role === 'staff') return true;
  return user.accessibleClientSheetIds.includes(clientSheetId);
}
