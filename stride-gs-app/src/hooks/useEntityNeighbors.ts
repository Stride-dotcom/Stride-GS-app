/**
 * useEntityNeighbors — resolves the graph neighborhood of a given entity so
 * detail panels can build a RollupContext for usePhotoGraphRollup /
 * useNoteGraphRollup.
 *
 * Each detail panel page wants to show photos and notes for every entity
 * directly linked to the one it's displaying. The neighborhood is one hop:
 *
 *   inventory item     → its shipment, its will calls (both directions
 *                        come from Supabase mirrors)
 *   task / repair      → same as the parent item (lookup via task.itemId
 *                        or repair.itemId — caller passes itemId)
 *   shipment           → every item with shipment_number = self
 *   will call          → preloaded item_ids (already on the WC row)
 *   claim              → preloaded item ids (caller already fetched them
 *                        from the GAS API — no Supabase mirror yet)
 *
 * Claims do not yet have a Supabase claim_items mirror, so the
 * Item → Claim direction is **not** resolved here. Once that mirror exists,
 * extend `useItemContainerScopes` to query it.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { RollupScope } from './useGraphRollup';

interface ContainerScopeResult {
  scopes: RollupScope[];
  loading: boolean;
}

/**
 * Look up the container memberships of a single inventory item — the
 * shipments and will calls it belongs to. Returned as RollupScope entries
 * ready to drop into a rollup context.
 *
 * @param itemId       The Stride item code (e.g. "IK-12345").
 * @param tenantId     Client spreadsheet ID. Required — every Supabase row
 *                     is tenant-scoped.
 * @param shipmentHint Optional shipment number already known on the item
 *                     (avoids an extra query). Most callers have it on
 *                     `item.shipmentNumber` / `task.shipmentNumber`.
 */
export function useItemContainerScopes(
  itemId: string | null | undefined,
  tenantId: string | null | undefined,
  shipmentHint?: string | null,
): ContainerScopeResult {
  const [wcNumbers, setWcNumbers] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  useEffect(() => {
    if (!itemId || !tenantId) { setWcNumbers([]); return; }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      // will_calls.item_ids is jsonb. The `cs` (contains) operator
      // performs a JSONB containment check using the GIN index, which
      // is the right shape for "does this array contain X".
      const { data, error } = await supabase
        .from('will_calls')
        .select('wc_number, item_ids')
        .eq('tenant_id', tenantId)
        .contains('item_ids', JSON.stringify([itemId]));
      if (cancelled || !mountedRef.current) return;
      if (error) {
        console.warn('[useItemContainerScopes] will_calls lookup failed', error);
        setWcNumbers([]);
        setLoading(false);
        return;
      }
      const numbers = (data ?? [])
        .map((r: { wc_number?: string | null }) => r.wc_number ?? '')
        .filter((s: string) => !!s);
      setWcNumbers(numbers);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [itemId, tenantId]);

  return useMemo(() => {
    const scopes: RollupScope[] = [];
    if (shipmentHint) {
      scopes.push({ entityType: 'shipment', entityId: shipmentHint });
    }
    for (const wc of wcNumbers) {
      scopes.push({ entityType: 'will_call', entityId: wc });
    }
    // Claim direction left out until claim_items mirror lands.
    return { scopes, loading };
  }, [shipmentHint, wcNumbers, loading]);
}

/**
 * Look up the line item IDs inside a Shipment by querying the inventory
 * mirror for rows with `shipment_number = shipmentNumber`. Used by the
 * Shipment detail panel to assemble its rollup context.
 */
export function useShipmentItemIds(
  shipmentNumber: string | null | undefined,
  tenantId: string | null | undefined,
): { itemIds: string[]; loading: boolean } {
  const [itemIds, setItemIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  useEffect(() => {
    if (!shipmentNumber || !tenantId) { setItemIds([]); return; }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const { data, error } = await supabase
        .from('inventory')
        .select('item_id')
        .eq('tenant_id', tenantId)
        .eq('shipment_number', shipmentNumber)
        .limit(1000);
      if (cancelled || !mountedRef.current) return;
      if (error) {
        console.warn('[useShipmentItemIds] inventory lookup failed', error);
        setItemIds([]);
        setLoading(false);
        return;
      }
      const ids = (data ?? [])
        .map((r: { item_id?: string | null }) => r.item_id ?? '')
        .filter((s: string) => !!s);
      setItemIds(ids);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [shipmentNumber, tenantId]);

  return useMemo(() => ({ itemIds, loading }), [itemIds, loading]);
}
