import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { Database } from '@/integrations/supabase/types';

type WarehouseRow = Database['public']['Tables']['warehouses']['Row'];
type WarehouseInsert = Database['public']['Tables']['warehouses']['Insert'];
type WarehouseUpdate = Database['public']['Tables']['warehouses']['Update'];

export type Warehouse = WarehouseRow;

export function useWarehouses() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchWarehouses = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('warehouses')
        .select('*')
        .is('deleted_at', null)
        .order('name');

      if (error) throw error;
      setWarehouses(data || []);
    } catch (error) {
      console.error('Error fetching warehouses:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to load warehouses',
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchWarehouses();
  }, [fetchWarehouses]);

  const createWarehouse = async (data: WarehouseInsert) => {
    const { data: result, error } = await supabase
      .from('warehouses')
      .insert([data])
      .select()
      .single();

    if (error) throw error;
    return result;
  };

  const updateWarehouse = async (id: string, data: WarehouseUpdate) => {
    const { data: result, error } = await supabase
      .from('warehouses')
      .update(data)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return result;
  };

  const deleteWarehouse = async (id: string) => {
    // Soft delete
    const { error } = await supabase
      .from('warehouses')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw error;
  };

  return {
    warehouses,
    loading,
    refetch: fetchWarehouses,
    createWarehouse,
    updateWarehouse,
    deleteWarehouse,
  };
}
