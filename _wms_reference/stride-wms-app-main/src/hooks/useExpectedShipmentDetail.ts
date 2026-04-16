import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { Database } from '@/integrations/supabase/types';

type ShipmentRow = Database['public']['Tables']['shipments']['Row'];
type ShipmentItemRow = Database['public']['Tables']['shipment_items']['Row'];
type ExternalRefRow = Database['public']['Tables']['shipment_external_refs']['Row'];

export interface ExpectedDetail extends ShipmentRow {
  account_name?: string | null;
}

export interface ExpectedShipmentItem extends ShipmentItemRow {
  item?: {
    id: string;
    item_code: string;
    sku: string | null;
    quantity: number | null;
    size: number | null;
    size_unit: string | null;
    vendor: string | null;
    description: string | null;
    sidemark: string | null;
    room: string | null;
    primary_photo_url: string | null;
    metadata: Record<string, unknown> | null;
  } | null;
}

export function useExpectedShipmentDetail(shipmentId?: string) {
  const [shipment, setShipment] = useState<ExpectedDetail | null>(null);
  const [items, setItems] = useState<ExpectedShipmentItem[]>([]);
  const [refs, setRefs] = useState<ExternalRefRow[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchShipment = useCallback(async () => {
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
      setShipment({
        ...data,
        account_name: acct?.account_name || null,
      } as unknown as ExpectedDetail);
    } catch (error) {
      console.error('Error fetching expected shipment:', error);
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to load expected shipment.' });
    }
  }, [shipmentId, toast]);

  const fetchItems = useCallback(async () => {
    if (!shipmentId) return;
    try {
      const { data, error } = await supabase
        .from('shipment_items')
        .select(`
          *,
          item:items(
            id,
            item_code,
            sku,
            quantity,
            size,
            size_unit,
            vendor,
            description,
            sidemark,
            room,
            primary_photo_url,
            metadata
          )
        `)
        .eq('shipment_id', shipmentId)
        .order('created_at');
      if (error) throw error;
      setItems((data || []) as unknown as ExpectedShipmentItem[]);
    } catch (error) {
      console.error('Error fetching items:', error);
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
    fetchShipment();
    fetchItems();
    fetchRefs();
  }, [fetchShipment, fetchItems, fetchRefs]);

  const refetchAll = useCallback(() => {
    fetchShipment();
    fetchItems();
    fetchRefs();
  }, [fetchShipment, fetchItems, fetchRefs]);

  return { shipment, items, refs, loading, refetch: refetchAll };
}
