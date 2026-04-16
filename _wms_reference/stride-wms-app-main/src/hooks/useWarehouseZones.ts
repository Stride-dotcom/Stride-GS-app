import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import type { Database } from '@/integrations/supabase/types';

type WarehouseZoneRow = Database['public']['Tables']['warehouse_zones']['Row'];
type WarehouseZoneInsert = Database['public']['Tables']['warehouse_zones']['Insert'];
type WarehouseZoneUpdate = Database['public']['Tables']['warehouse_zones']['Update'];

export type WarehouseZone = WarehouseZoneRow;

export interface BatchGenerateZonesInput {
  prefix: string; // e.g. "ZN-"
  start: number; // e.g. 1
  count: number; // e.g. 100
  padLength?: number; // e.g. 3 -> ZN-001
  sortOrderStart?: number;
}

export function useWarehouseZones(warehouseId?: string) {
  const { profile } = useAuth();
  const { toast } = useToast();

  const [zones, setZones] = useState<WarehouseZone[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchZones = useCallback(async () => {
    if (!warehouseId) {
      setZones([]);
      return;
    }

    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('warehouse_zones')
        .select('*')
        .eq('warehouse_id', warehouseId)
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('zone_code', { ascending: true });

      if (error) throw error;
      setZones(data || []);
    } catch (error) {
      console.error('Error fetching warehouse zones:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to load zones',
      });
    } finally {
      setLoading(false);
    }
  }, [toast, warehouseId]);

  useEffect(() => {
    fetchZones();
  }, [fetchZones]);

  const createZone = async (zone: Omit<WarehouseZoneInsert, 'tenant_id' | 'warehouse_id'>) => {
    if (!profile?.tenant_id) {
      throw new Error('Missing tenant context');
    }
    if (!warehouseId) {
      throw new Error('Missing warehouse context');
    }

    const payload: WarehouseZoneInsert = {
      ...zone,
      tenant_id: profile.tenant_id,
      warehouse_id: warehouseId,
      created_by: profile.id,
      updated_by: profile.id,
    };

    const { data, error } = await supabase
      .from('warehouse_zones')
      .insert(payload)
      .select()
      .single();

    if (error) throw error;
    await fetchZones();
    return data;
  };

  const updateZone = async (id: string, updates: WarehouseZoneUpdate) => {
    const { data, error } = await supabase
      .from('warehouse_zones')
      .update({
        ...updates,
        updated_by: profile?.id ?? null,
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    await fetchZones();
    return data;
  };

  const deleteZone = async (id: string) => {
    const { error } = await supabase.from('warehouse_zones').delete().eq('id', id);
    if (error) throw error;
    await fetchZones();
  };

  const batchGenerateZones = async (input: BatchGenerateZonesInput) => {
    if (!profile?.tenant_id) {
      throw new Error('Missing tenant context');
    }
    if (!warehouseId) {
      throw new Error('Missing warehouse context');
    }
    if (!input.prefix?.trim()) {
      throw new Error('Prefix is required');
    }
    if (!Number.isFinite(input.start) || input.start < 0) {
      throw new Error('Start must be >= 0');
    }
    if (!Number.isFinite(input.count) || input.count <= 0) {
      throw new Error('Count must be > 0');
    }

    const pad = input.padLength ?? 3;
    const sortStart = input.sortOrderStart ?? input.start;

    const rows: WarehouseZoneInsert[] = Array.from({ length: input.count }).map((_, idx) => {
      const n = input.start + idx;
      const code = `${input.prefix}${String(n).padStart(pad, '0')}`;
      return {
        tenant_id: profile.tenant_id,
        warehouse_id: warehouseId,
        zone_code: code,
        sort_order: sortStart + idx,
        created_by: profile.id,
        updated_by: profile.id,
      };
    });

    const { error } = await supabase.from('warehouse_zones').insert(rows);
    if (error) throw error;

    await fetchZones();
  };

  return {
    zones,
    loading,
    refetch: fetchZones,
    createZone,
    updateZone,
    deleteZone,
    batchGenerateZones,
  };
}

