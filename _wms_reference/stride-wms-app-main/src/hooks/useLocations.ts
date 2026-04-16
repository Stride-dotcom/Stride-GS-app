import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { Database } from '@/integrations/supabase/types';

type LocationRow = Database['public']['Tables']['locations']['Row'];
type LocationInsert = Database['public']['Tables']['locations']['Insert'];
type LocationUpdate = Database['public']['Tables']['locations']['Update'];

export type Location = LocationRow;

export function useLocations(warehouseId?: string) {
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchLocations = useCallback(async () => {
    try {
      setLoading(true);
      let query = supabase
        .from('locations')
        .select('*')
        .is('deleted_at', null)
        .order('code');

      if (warehouseId) {
        query = query.eq('warehouse_id', warehouseId);
      }

      const { data, error } = await query;

      if (error) throw error;
      setLocations(data || []);
    } catch (error) {
      console.error('Error fetching locations:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to load locations',
      });
    } finally {
      setLoading(false);
    }
  }, [warehouseId, toast]);

  useEffect(() => {
    fetchLocations();
  }, [fetchLocations]);

  const createLocation = async (data: LocationInsert) => {
    const { data: result, error } = await supabase
      .from('locations')
      .insert([data])
      .select()
      .single();

    if (error) throw error;
    return result;
  };

  const updateLocation = async (id: string, data: LocationUpdate) => {
    const { data: result, error } = await supabase
      .from('locations')
      .update(data)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return result;
  };

  const deleteLocation = async (id: string) => {
    // Soft delete
    const { error } = await supabase
      .from('locations')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw error;
  };

  return {
    locations,
    loading,
    refetch: fetchLocations,
    createLocation,
    updateLocation,
    deleteLocation,
  };
}
