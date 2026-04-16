import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface AllocateResult {
  success: boolean;
  allocations_created: number;
  allocations_updated: number;
  expected_items_created: number;
  manifest_items_updated: number;
}

interface DeallocateResult {
  success: boolean;
  deallocated_qty: number;
  expected_item_deleted: boolean;
}

export function useAllocation() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const allocate = useCallback(async (
    manifestItemIds: string[],
    expectedShipmentId: string,
    quantities: number[]
  ): Promise<AllocateResult | null> => {
    try {
      setLoading(true);
      const { data, error } = await supabase.rpc('rpc_allocate_manifest_items_to_expected', {
        p_manifest_item_ids: manifestItemIds,
        p_expected_shipment_id: expectedShipmentId,
        p_quantities: quantities,
      });
      if (error) throw error;
      const result = data as unknown as AllocateResult;
      toast({
        title: 'Allocation Complete',
        description: `${result.allocations_created} created, ${result.allocations_updated} updated.`,
      });
      return result;
    } catch (error) {
      console.error('Error allocating:', error);
      toast({
        variant: 'destructive',
        title: 'Allocation Failed',
        description: error instanceof Error ? error.message : 'Failed to allocate items.',
      });
      return null;
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const deallocate = useCallback(async (allocationId: string): Promise<DeallocateResult | null> => {
    try {
      setLoading(true);
      const { data, error } = await supabase.rpc('rpc_deallocate_manifest_item', {
        p_allocation_id: allocationId,
      });
      if (error) throw error;
      const result = data as unknown as DeallocateResult;
      toast({
        title: 'Deallocation Complete',
        description: `${result.deallocated_qty} units deallocated.`,
      });
      return result;
    } catch (error) {
      console.error('Error deallocating:', error);
      toast({
        variant: 'destructive',
        title: 'Deallocation Failed',
        description: error instanceof Error ? error.message : 'Failed to deallocate.',
      });
      return null;
    } finally {
      setLoading(false);
    }
  }, [toast]);

  return { allocate, deallocate, loading };
}
