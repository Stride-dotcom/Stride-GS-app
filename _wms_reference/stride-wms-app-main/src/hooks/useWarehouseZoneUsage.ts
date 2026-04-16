import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export type WarehouseZoneUsageRow = {
  zone_id: string;
  location_count: number;
  node_count: number;
};

export function useWarehouseZoneUsage(warehouseId?: string) {
  const { toast } = useToast();
  const [rows, setRows] = useState<WarehouseZoneUsageRow[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchUsage = useCallback(async () => {
    if (!warehouseId) {
      setRows([]);
      return;
    }

    try {
      setLoading(true);
      const { data, error } = await (supabase as any).rpc('rpc_get_warehouse_zone_usage', {
        p_warehouse_id: warehouseId,
      });
      if (error) throw error;
      setRows((data || []) as unknown as WarehouseZoneUsageRow[]);
    } catch (err) {
      console.error('Error fetching warehouse zone usage:', err);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to load zone usage counts.',
      });
    } finally {
      setLoading(false);
    }
  }, [toast, warehouseId]);

  useEffect(() => {
    fetchUsage();
  }, [fetchUsage]);

  const byZoneId = useMemo(() => new Map(rows.map((r) => [r.zone_id, r])), [rows]);

  return {
    rows,
    byZoneId,
    loading,
    refetch: fetchUsage,
  };
}

