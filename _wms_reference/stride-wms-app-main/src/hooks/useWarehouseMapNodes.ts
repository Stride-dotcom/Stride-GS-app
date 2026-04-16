import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import type { Database } from '@/integrations/supabase/types';

type NodeRow = Database['public']['Tables']['warehouse_map_nodes']['Row'];
type NodeInsert = Database['public']['Tables']['warehouse_map_nodes']['Insert'];
type NodeUpdate = Database['public']['Tables']['warehouse_map_nodes']['Update'];

export type WarehouseMapNode = NodeRow;

export function useWarehouseMapNodes(mapId?: string) {
  const { profile } = useAuth();
  const { toast } = useToast();

  const [nodes, setNodes] = useState<WarehouseMapNode[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchNodes = useCallback(async (): Promise<WarehouseMapNode[] | null> => {
    if (!mapId) {
      setNodes([]);
      return [];
    }

    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('warehouse_map_nodes')
        .select('*')
        .eq('warehouse_map_id', mapId)
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true });

      if (error) throw error;
      const rows = data || [];
      setNodes(rows);
      return rows;
    } catch (error) {
      console.error('Error fetching warehouse map nodes:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to load map nodes',
      });
      return null;
    } finally {
      setLoading(false);
    }
  }, [mapId, toast]);

  useEffect(() => {
    fetchNodes();
  }, [fetchNodes]);

  const createNode = async (node: Omit<NodeInsert, 'warehouse_map_id'>) => {
    if (!mapId) throw new Error('Missing map context');

    const payload: NodeInsert = {
      ...node,
      warehouse_map_id: mapId,
      created_by: profile?.id ?? null,
      updated_by: profile?.id ?? null,
    };

    const { data, error } = await supabase
      .from('warehouse_map_nodes')
      .insert(payload)
      .select()
      .single();

    if (error) throw error;
    await fetchNodes();
    return data;
  };

  const updateNode = async (id: string, updates: NodeUpdate) => {
    const { data, error } = await supabase
      .from('warehouse_map_nodes')
      .update({
        ...updates,
        updated_by: profile?.id ?? null,
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    await fetchNodes();
    return data;
  };

  const deleteNode = async (id: string) => {
    const { error } = await supabase.from('warehouse_map_nodes').delete().eq('id', id);
    if (error) throw error;
    await fetchNodes();
  };

  const upsertNodes = async (rows: NodeInsert[]) => {
    const { error } = await supabase.from('warehouse_map_nodes').upsert(rows, {
      onConflict: 'id',
    });
    if (error) throw error;
    await fetchNodes();
  };

  return {
    nodes,
    loading,
    refetch: fetchNodes,
    createNode,
    updateNode,
    deleteNode,
    upsertNodes,
  };
}

