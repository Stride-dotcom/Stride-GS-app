import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface MoveContainerResult {
  affected_unit_count: number;
  old_location_id: string;
  new_location_id: string;
}

interface RemoveUnitResult {
  unit_id: string;
  old_container_id: string;
}

interface AddUnitResult {
  unit_id: string;
  container_id: string;
  from_location_id: string;
  to_location_id: string;
}

export function useContainerActions() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const moveContainer = useCallback(async (
    containerId: string,
    newLocationId: string
  ): Promise<MoveContainerResult | null> => {
    try {
      setLoading(true);
      const { data, error } = await supabase.rpc('rpc_move_container', {
        p_container_id: containerId,
        p_new_location_id: newLocationId,
      });

      if (error) throw error;

      const result = data as unknown as MoveContainerResult;
      toast({
        title: 'Container Moved',
        description: `Container moved. ${result.affected_unit_count} unit(s) updated.`,
      });
      return result;
    } catch (error) {
      console.error('Error moving container:', error);
      toast({
        variant: 'destructive',
        title: 'Move Failed',
        description: error instanceof Error ? error.message : 'Failed to move container.',
      });
      return null;
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const addUnitToContainer = useCallback(async (
    unitId: string,
    containerId: string
  ): Promise<AddUnitResult | null> => {
    try {
      setLoading(true);
      const { data, error } = await supabase.rpc('rpc_add_unit_to_container', {
        p_unit_id: unitId,
        p_container_id: containerId,
      });

      if (error) throw error;

      const result = data as unknown as AddUnitResult;
      toast({
        title: 'Unit Added',
        description: 'Unit has been added to the container.',
      });
      return result;
    } catch (error) {
      console.error('Error adding unit to container:', error);
      toast({
        variant: 'destructive',
        title: 'Add Failed',
        description: error instanceof Error ? error.message : 'Failed to add unit to container.',
      });
      return null;
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const removeUnitFromContainer = useCallback(async (
    unitId: string
  ): Promise<RemoveUnitResult | null> => {
    try {
      setLoading(true);
      const { data, error } = await supabase.rpc('rpc_remove_unit_from_container', {
        p_unit_id: unitId,
      });

      if (error) throw error;

      const result = data as unknown as RemoveUnitResult;
      toast({
        title: 'Unit Removed',
        description: 'Unit has been removed from the container.',
      });
      return result;
    } catch (error) {
      console.error('Error removing unit from container:', error);
      toast({
        variant: 'destructive',
        title: 'Remove Failed',
        description: error instanceof Error ? error.message : 'Failed to remove unit from container.',
      });
      return null;
    } finally {
      setLoading(false);
    }
  }, [toast]);

  return {
    moveContainer,
    addUnitToContainer,
    removeUnitFromContainer,
    loading,
  };
}
