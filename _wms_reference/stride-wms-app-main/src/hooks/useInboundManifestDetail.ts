import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { Database } from '@/integrations/supabase/types';

type ShipmentRow = Database['public']['Tables']['shipments']['Row'];
type ShipmentItemRow = Database['public']['Tables']['shipment_items']['Row'];
type ExternalRefRow = Database['public']['Tables']['shipment_external_refs']['Row'];

export interface ManifestDetail extends ShipmentRow {
  account_name?: string | null;
}

export interface AllocationInfo {
  id: string;
  expected_shipment_id: string;
  expected_shipment_item_id: string;
  allocated_qty: number;
  expected_shipment_number?: string;
}

export interface ManifestItem extends ShipmentItemRow {
  allocations: AllocationInfo[];
  /** Thumbnail URL from primary_photo_id join — undefined if no photo */
  photo_url?: string | null;
}

export function useInboundManifestDetail(shipmentId?: string) {
  const [manifest, setManifest] = useState<ManifestDetail | null>(null);
  const [items, setItems] = useState<ManifestItem[]>([]);
  const [refs, setRefs] = useState<ExternalRefRow[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchManifest = useCallback(async () => {
    if (!shipmentId) return;
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('shipments')
        .select('*, accounts(account_name)')
        .eq('id', shipmentId)
        .single();
      if (error) throw error;
      const acct = (data as Record<string, unknown>).accounts as { account_name: string } | null;
      setManifest({
        ...data,
        account_name: acct?.account_name || null,
      } as unknown as ManifestDetail);
    } catch (error) {
      console.error('Error fetching manifest:', error);
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to load manifest.' });
    }
  }, [shipmentId, toast]);

  const fetchItems = useCallback(async () => {
    if (!shipmentId) return;
    try {
      const { data: itemData, error: itemError } = await supabase
        .from('shipment_items')
        .select('*')
        .eq('shipment_id', shipmentId)
        .order('created_at');
      if (itemError) throw itemError;

      const itemIds = (itemData || []).map((i) => i.id);
      let allocationsByItem = new Map<string, AllocationInfo[]>();

      if (itemIds.length > 0) {
        const { data: allocData } = await supabase
          .from('shipment_item_allocations')
          .select('id, manifest_shipment_item_id, expected_shipment_id, expected_shipment_item_id, allocated_qty')
          .in('manifest_shipment_item_id', itemIds);

        if (allocData && allocData.length > 0) {
          // Fetch expected shipment numbers for display
          const expectedIds = [...new Set(allocData.map((a) => a.expected_shipment_id))];
          const { data: expectedShipments } = await supabase
            .from('shipments')
            .select('id, shipment_number')
            .in('id', expectedIds);
          const shipmentNumberMap = new Map(
            (expectedShipments || []).map((s) => [s.id, s.shipment_number])
          );

          for (const alloc of allocData) {
            const key = alloc.manifest_shipment_item_id;
            if (!allocationsByItem.has(key)) allocationsByItem.set(key, []);
            allocationsByItem.get(key)!.push({
              id: alloc.id,
              expected_shipment_id: alloc.expected_shipment_id,
              expected_shipment_item_id: alloc.expected_shipment_item_id,
              allocated_qty: alloc.allocated_qty,
              expected_shipment_number: shipmentNumberMap.get(alloc.expected_shipment_id),
            });
          }
        }
      }

      // Batch-fetch primary photo URLs (single query, no N+1)
      const photoIds = (itemData || [])
        .map((i) => i.primary_photo_id)
        .filter((pid): pid is string => pid != null);
      const photoUrlMap = new Map<string, string>();
      if (photoIds.length > 0) {
        const { data: photoData } = await supabase
          .from('shipment_item_photos')
          .select('id, storage_url')
          .in('id', photoIds);
        for (const p of photoData || []) {
          if (p.storage_url) photoUrlMap.set(p.id, p.storage_url);
        }
      }

      const mapped: ManifestItem[] = (itemData || []).map((item) => ({
        ...item,
        allocations: allocationsByItem.get(item.id) || [],
        photo_url: item.primary_photo_id ? photoUrlMap.get(item.primary_photo_id) ?? null : null,
      }));

      setItems(mapped);
    } catch (error) {
      console.error('Error fetching manifest items:', error);
    } finally {
      setLoading(false);
    }
  }, [shipmentId]);

  const fetchRefs = useCallback(async () => {
    if (!shipmentId) return;
    try {
      const { data, error } = await supabase
        .from('shipment_external_refs')
        .select('*')
        .eq('shipment_id', shipmentId)
        .order('created_at');
      if (error) throw error;
      setRefs(data || []);
    } catch (error) {
      console.error('Error fetching refs:', error);
    }
  }, [shipmentId]);

  useEffect(() => {
    fetchManifest();
    fetchItems();
    fetchRefs();
  }, [fetchManifest, fetchItems, fetchRefs]);

  const refetchAll = useCallback(() => {
    fetchManifest();
    fetchItems();
    fetchRefs();
  }, [fetchManifest, fetchItems, fetchRefs]);

  return { manifest, items, refs, loading, refetch: refetchAll };
}
