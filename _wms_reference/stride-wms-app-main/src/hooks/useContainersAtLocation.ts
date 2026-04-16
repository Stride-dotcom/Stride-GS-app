import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { Database } from '@/integrations/supabase/types';

type ContainerRow = Database['public']['Tables']['containers']['Row'];

export type Container = ContainerRow;

export function useContainersAtLocation(locationId?: string) {
  const [containers, setContainers] = useState<Container[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchContainers = useCallback(async () => {
    if (!locationId) {
      setContainers([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('containers')
        .select('*')
        .eq('location_id', locationId)
        .is('deleted_at', null)
        .order('container_code');

      if (error) throw error;
      setContainers(data || []);
    } catch (error) {
      console.error('Error fetching containers:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to load containers.',
      });
    } finally {
      setLoading(false);
    }
  }, [locationId, toast]);

  useEffect(() => {
    fetchContainers();
  }, [fetchContainers]);

  return {
    containers,
    loading,
    refetch: fetchContainers,
  };
}
