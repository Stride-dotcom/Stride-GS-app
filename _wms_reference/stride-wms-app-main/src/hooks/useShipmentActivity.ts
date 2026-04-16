/**
 * useShipmentActivity - Reads shipment_activity rows for a given shipment.
 * Provides filter support and newest-first ordering.
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface ShipmentActivity {
  id: string;
  tenant_id: string;
  shipment_id: string;
  actor_user_id: string | null;
  actor_name: string | null;
  event_type: string;
  event_label: string;
  details: Record<string, unknown>;
  created_at: string;
}

export type ShipmentActivityFilter = 'all' | 'billing' | 'status' | 'receiving';

const FILTER_PREFIX_MAP: Record<Exclude<ShipmentActivityFilter, 'all'>, string[]> = {
  billing: [
    'billing_event_updated',
    'billing_event_invoiced',
    'billing_event_uninvoiced',
    'billing_event_voided',
    'billing_charge_added',
  ],
  status: [
    'shipment_status_changed',
    'shipment_account_changed',
    'shipment_field_updated',
  ],
  receiving: [
    'item_received',
    'item_scanned',
    'receiving_completed',
  ],
};

export function useShipmentActivity(shipmentId: string | undefined) {
  const [activities, setActivities] = useState<ShipmentActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ShipmentActivityFilter>('all');

  const fetchActivities = useCallback(async () => {
    if (!shipmentId) return;

    setLoading(true);
    try {
      let query = (supabase.from('shipment_activity') as any)
        .select('*')
        .eq('shipment_id', shipmentId)
        .order('created_at', { ascending: false })
        .limit(200);

      if (filter !== 'all') {
        const prefixes = FILTER_PREFIX_MAP[filter];
        if (prefixes && prefixes.length > 0) {
          query = query.in('event_type', prefixes);
        }
      }

      const { data, error } = await query;

      if (error) {
        if (error.code !== '42P01') {
          console.error('[useShipmentActivity] Error:', error);
        }
        setActivities([]);
        return;
      }

      setActivities(data || []);
    } catch (err) {
      console.error('[useShipmentActivity] Unexpected error:', err);
      setActivities([]);
    } finally {
      setLoading(false);
    }
  }, [shipmentId, filter]);

  useEffect(() => {
    fetchActivities();
  }, [fetchActivities]);

  return {
    activities,
    loading,
    filter,
    setFilter,
    refetch: fetchActivities,
  };
}
