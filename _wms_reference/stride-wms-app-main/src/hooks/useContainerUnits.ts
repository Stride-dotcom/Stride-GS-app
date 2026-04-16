import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface ContainerItemRow {
  id: string;
  item_code: string;
  status: string;
  class_code: string | null;
  size_cu_ft: number | null;
  description: string | null;
  vendor: string | null;
}

export function useContainerUnits(containerId?: string) {
  const [units, setUnits] = useState<ContainerItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchUnits = useCallback(async () => {
    if (!containerId) {
      setUnits([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const { data, error } = await (supabase.from('items') as any)
        .select(`
          id,
          item_code,
          status,
          size,
          description,
          vendor,
          class:classes!items_class_id_fkey(code)
        `)
        .is('deleted_at', null)
        .contains('metadata', { container_id: containerId })
        .order('item_code');

      if (error) throw error;
      const mapped: ContainerItemRow[] = (data || []).map((row: any) => ({
        id: String(row.id),
        item_code: String(row.item_code || ''),
        status: String(row.status || 'active'),
        class_code: row.class?.code ? String(row.class.code) : null,
        size_cu_ft: typeof row.size === 'number' && Number.isFinite(row.size) ? row.size : null,
        description: row.description ? String(row.description) : null,
        vendor: row.vendor ? String(row.vendor) : null,
      }));
      mapped.sort((a, b) =>
        a.item_code.localeCompare(b.item_code, undefined, { numeric: true, sensitivity: 'base' })
      );
      setUnits(mapped);
    } catch (error) {
      console.error('Error fetching container units:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to load container item links.',
      });
    } finally {
      setLoading(false);
    }
  }, [containerId, toast]);

  useEffect(() => {
    fetchUnits();
  }, [fetchUnits]);

  return {
    units,
    loading,
    refetch: fetchUnits,
  };
}
