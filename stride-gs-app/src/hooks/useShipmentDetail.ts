import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { fetchShipmentByNoFromSupabase, type ClientNameMap } from '../lib/supabaseQueries';
import { fetchShipments, fetchShipmentItems } from '../lib/api';
import { useClients } from './useClients';
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

  const fetchShipment = useCallback(async () => {
    if (!shipmentNo || !user) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const fetchId = ++fetchCountRef.current;

    setStatus('loading');
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
        setShipment(enriched);
        setStatus('loaded');

        // Fetch items from GAS
        if (sbShipment.clientSheetId) {
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
              setStatus('loaded');
              // Fetch items
              fetchShipmentItems(clientSheetId, shipmentNo, controller.signal)
                .then(itemsResp => {
                  if (fetchId !== fetchCountRef.current) return;
                  if (itemsResp?.data?.items) setItems(itemsResp.data.items);
                })
                .catch(() => {});
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

  return { shipment, items, status, error, refetch: fetchShipment };
}

function hasAccess(user: NonNullable<ReturnType<typeof useAuth>['user']>, clientSheetId: string): boolean {
  if (user.role === 'admin' || user.role === 'staff') return true;
  return user.accessibleClientSheetIds.includes(clientSheetId);
}
