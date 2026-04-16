import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface UnitFilters {
  search?: string;
  status?: string;
  containerId?: string;
}

export interface ItemAtLocationWithContainer {
  id: string;
  item_code: string;
  status: string;
  class_code: string | null;
  size_cu_ft: number | null;
  vendor: string | null;
  description: string | null;
  container_id: string | null;
  container_code: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function useUnitsAtLocation(locationId?: string, filters?: UnitFilters) {
  const [units, setUnits] = useState<ItemAtLocationWithContainer[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchUnits = useCallback(async () => {
    if (!locationId) {
      setUnits([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      let query = (supabase.from('items') as any)
        .select(`
          id,
          item_code,
          status,
          size,
          vendor,
          description,
          metadata,
          class:classes!items_class_id_fkey(code)
        `)
        .eq('current_location_id', locationId)
        .is('deleted_at', null)
        .order('item_code');

      if (filters?.status) {
        query = query.eq('status', filters.status);
      }
      if (filters?.search) {
        const search = filters.search.trim().replace(/[%]/g, '');
        if (search.length > 0) {
          query = query.or(
            `item_code.ilike.%${search}%,vendor.ilike.%${search}%,description.ilike.%${search}%`
          );
        }
      }

      const { data, error } = await query;
      if (error) throw error;

      const mapped: ItemAtLocationWithContainer[] = (data || []).map((row: any) => {
        const meta = asRecord(row.metadata);
        const containerId =
          meta && typeof meta.container_id === 'string' && meta.container_id.trim().length > 0
            ? meta.container_id
            : null;
        const containerCode =
          meta && typeof meta.container_code === 'string' && meta.container_code.trim().length > 0
            ? meta.container_code
            : null;

        return {
          id: String(row.id),
          item_code: String(row.item_code || ''),
          status: String(row.status || 'active'),
          class_code: row.class?.code ? String(row.class.code) : null,
          size_cu_ft: typeof row.size === 'number' && Number.isFinite(row.size) ? row.size : null,
          vendor: row.vendor ? String(row.vendor) : null,
          description: row.description ? String(row.description) : null,
          container_id: containerId,
          container_code: containerCode,
        };
      });

      const filteredByContainer =
        filters?.containerId && filters.containerId.length > 0
          ? mapped.filter((row) => row.container_id === filters.containerId)
          : mapped;

      filteredByContainer.sort((a, b) =>
        a.item_code.localeCompare(b.item_code, undefined, { numeric: true, sensitivity: 'base' })
      );
      setUnits(filteredByContainer);
    } catch (error) {
      console.error('Error fetching units:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to load location inventory items.',
      });
    } finally {
      setLoading(false);
    }
  }, [locationId, filters?.search, filters?.status, filters?.containerId, toast]);

  useEffect(() => {
    fetchUnits();
  }, [fetchUnits]);

  return {
    units,
    loading,
    refetch: fetchUnits,
  };
}
