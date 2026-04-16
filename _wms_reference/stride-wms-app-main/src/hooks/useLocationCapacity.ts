import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface ContainerBreakdown {
  container_id: string;
  container_code: string;
  footprint_cu_ft: number;
  contents_cu_ft: number;
  used_cu_ft: number;
}

export interface LocationCapacity {
  used_cu_ft: number | null;
  capacity_cu_ft: number | null;
  utilization_pct: number | null;
  container_breakdown: ContainerBreakdown[];
}

export function useLocationCapacity(locationId?: string) {
  const { toast } = useToast();
  const [capacity, setCapacity] = useState<LocationCapacity | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchCapacity = useCallback(async (id?: string) => {
    const targetId = id || locationId;
    if (!targetId) return;

    try {
      setLoading(true);
      const { data, error } = await supabase.rpc('rpc_get_location_capacity', {
        p_location_id: targetId,
      });

      if (error) throw error;

      const result = data as unknown as LocationCapacity;
      setCapacity({
        used_cu_ft: result.used_cu_ft,
        capacity_cu_ft: result.capacity_cu_ft,
        utilization_pct: result.utilization_pct,
        container_breakdown: result.container_breakdown || [],
      });
    } catch (error) {
      console.error('Error fetching location capacity:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to load location capacity data.',
      });
    } finally {
      setLoading(false);
    }
  }, [locationId, toast]);

  return {
    capacity,
    loading,
    fetchCapacity,
    refetch: fetchCapacity,
  };
}
