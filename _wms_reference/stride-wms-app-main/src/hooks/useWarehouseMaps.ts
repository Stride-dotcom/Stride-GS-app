import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import type { Database } from '@/integrations/supabase/types';

type WarehouseMapRow = Database['public']['Tables']['warehouse_maps']['Row'];
type WarehouseMapInsert = Database['public']['Tables']['warehouse_maps']['Insert'];
type WarehouseMapUpdate = Database['public']['Tables']['warehouse_maps']['Update'];

export type WarehouseMap = WarehouseMapRow;

export interface CreateWarehouseMapInput {
  name: string;
  width?: number;
  height?: number;
  grid_size?: number;
  /**
   * If true, the map will become the warehouse default.
   * Note: if a default already exists, we insert first and then swap defaults to
   * avoid violating the partial unique index.
   */
  makeDefault?: boolean;
}

export function useWarehouseMaps(warehouseId?: string) {
  const { profile } = useAuth();
  const { toast } = useToast();

  const [maps, setMaps] = useState<WarehouseMap[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchMaps = useCallback(async () => {
    if (!warehouseId) {
      setMaps([]);
      return;
    }

    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('warehouse_maps')
        .select('*')
        .eq('warehouse_id', warehouseId)
        .order('is_default', { ascending: false })
        .order('updated_at', { ascending: false });

      if (error) throw error;
      setMaps(data || []);
    } catch (error) {
      console.error('Error fetching warehouse maps:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to load maps',
      });
    } finally {
      setLoading(false);
    }
  }, [toast, warehouseId]);

  useEffect(() => {
    fetchMaps();
  }, [fetchMaps]);

  const getMapCount = async () => {
    if (!warehouseId) return 0;
    const { count, error } = await supabase
      .from('warehouse_maps')
      .select('*', { count: 'exact', head: true })
      .eq('warehouse_id', warehouseId);
    if (error) throw error;
    return count || 0;
  };

  const createMap = async (input: CreateWarehouseMapInput) => {
    if (!profile?.tenant_id) {
      throw new Error('Missing tenant context');
    }
    if (!warehouseId) {
      throw new Error('Missing warehouse context');
    }

    const existingCount = await getMapCount();
    const shouldAutoDefaultFirstMap = existingCount === 0;

    // If it's the first map, insert as default directly.
    // If there are existing maps and the caller wants to make default,
    // insert non-default first to avoid unique index conflicts, then swap.
    const insertAsDefault = shouldAutoDefaultFirstMap;

    const payload: WarehouseMapInsert = {
      tenant_id: profile.tenant_id,
      warehouse_id: warehouseId,
      name: input.name,
      width: input.width,
      height: input.height,
      grid_size: input.grid_size,
      is_default: insertAsDefault,
      created_by: profile.id,
      updated_by: profile.id,
    };

    const { data: created, error } = await supabase
      .from('warehouse_maps')
      .insert(payload)
      .select()
      .single();

    if (error) throw error;

    if (!shouldAutoDefaultFirstMap && input.makeDefault) {
      await setDefaultMap(created.id);
      await fetchMaps();
      return created;
    }

    await fetchMaps();
    return created;
  };

  const updateMap = async (id: string, updates: WarehouseMapUpdate) => {
    const { data, error } = await supabase
      .from('warehouse_maps')
      .update({
        ...updates,
        updated_by: profile?.id ?? null,
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    await fetchMaps();
    return data;
  };

  const setDefaultMap = async (mapId: string) => {
    if (!profile?.tenant_id) {
      throw new Error('Missing tenant context');
    }
    if (!warehouseId) {
      throw new Error('Missing warehouse context');
    }

    const { data, error } = await (supabase as any).rpc('rpc_set_default_warehouse_map', {
      p_warehouse_id: warehouseId,
      p_map_id: mapId,
    });

    if (error) throw error;
    await fetchMaps();
    return data as WarehouseMap;
  };

  const deleteMap = async (id: string) => {
    if (!warehouseId) {
      throw new Error('Missing warehouse context');
    }

    const { data: mapRow, error: fetchError } = await supabase
      .from('warehouse_maps')
      .select('id,is_default')
      .eq('id', id)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!mapRow) return;

    if (mapRow.is_default) {
      // Allow deleting the default only if it is the last map (leaves "no map configured").
      const { count, error: countError } = await supabase
        .from('warehouse_maps')
        .select('*', { count: 'exact', head: true })
        .eq('warehouse_id', warehouseId)
        .neq('id', id);
      if (countError) throw countError;

      if ((count || 0) > 0) {
        throw new Error('This map is the default. Set another map as default before deleting.');
      }
    }

    const { error } = await supabase.from('warehouse_maps').delete().eq('id', id);
    if (error) throw error;
    await fetchMaps();
  };

  const getDefaultMap = () => maps.find((m) => m.is_default) || null;

  return {
    maps,
    loading,
    refetch: fetchMaps,
    createMap,
    updateMap,
    deleteMap,
    setDefaultMap,
    getDefaultMap,
  };
}

