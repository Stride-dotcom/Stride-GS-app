import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import type { Database } from '@/integrations/supabase/types';

type ContainerRow = Database['public']['Tables']['containers']['Row'];

export type Container = ContainerRow;

export interface CreateContainerParams {
  /**
   * Optional override. When omitted/blank, a CNT-##### code is auto-generated.
   */
  container_code?: string | null;
  container_type: string;
  warehouse_id: string;
  location_id?: string | null;
  footprint_cu_ft?: number | null;
}

export interface UpdateContainerParams {
  container_code?: string;
  container_type?: string;
  location_id?: string | null;
  footprint_cu_ft?: number | null;
  status?: string;
}

export function useContainers(warehouseId?: string) {
  const [containers, setContainers] = useState<Container[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { profile } = useAuth();

  const fetchContainers = useCallback(async () => {
    if (!profile?.tenant_id) {
      setContainers([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      let query = supabase
        .from('containers')
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .is('deleted_at', null)
        .order('container_code');

      if (warehouseId) {
        query = query.eq('warehouse_id', warehouseId);
      }

      const { data, error } = await query;

      if (error) throw error;
      setContainers(data || []);
    } catch (error) {
      console.error('[useContainers] Fetch failed:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to load containers.',
      });
    } finally {
      setLoading(false);
    }
  }, [profile?.tenant_id, warehouseId, toast]);

  useEffect(() => {
    fetchContainers();
  }, [fetchContainers]);

  const createContainer = useCallback(async (params: CreateContainerParams): Promise<Container | null> => {
    if (!profile?.tenant_id) {
      toast({ variant: 'destructive', title: 'Error', description: 'No tenant context.' });
      return null;
    }

    try {
      const providedCode = (params.container_code || '').trim();
      const { data, error } = await (supabase.rpc as any)('rpc_create_container', {
        p_container_type: params.container_type,
        p_warehouse_id: params.warehouse_id,
        p_location_id: params.location_id ?? null,
        p_container_code: providedCode ? providedCode.toUpperCase() : null,
        p_footprint_cu_ft: params.footprint_cu_ft ?? null,
      });

      if (error) throw error;

      const created = data as ContainerRow | null;
      const createdCode = created?.container_code || (providedCode ? providedCode.toUpperCase() : '');

      toast({
        title: 'Container Created',
        description: createdCode ? `Container ${createdCode} has been created.` : 'Container has been created.',
      });

      await fetchContainers();
      return created;
    } catch (error: unknown) {
      console.error('[useContainers] Create failed:', error);
      const isDuplicate = error instanceof Object && 'code' in error && (error as { code: string }).code === '23505';
      toast({
        variant: 'destructive',
        title: isDuplicate ? 'Duplicate Container' : 'Error',
        description: isDuplicate
          ? `That container code already exists.`
          : 'Failed to create container.',
      });
      return null;
    }
  }, [profile?.tenant_id, profile?.id, toast, fetchContainers]);

  const updateContainer = useCallback(async (
    containerId: string,
    params: UpdateContainerParams
  ): Promise<Container | null> => {
    try {
      const { data, error } = await supabase
        .from('containers')
        .update({
          ...params,
          updated_at: new Date().toISOString(),
        })
        .eq('id', containerId)
        .select()
        .single();

      if (error) throw error;

      toast({
        title: 'Container Updated',
        description: 'Container has been updated.',
      });

      return data;
    } catch (error) {
      console.error('[useContainers] Update failed:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to update container.',
      });
      return null;
    }
  }, [toast]);

  const deleteContainer = useCallback(async (containerId: string): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from('containers')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', containerId);

      if (error) throw error;

      toast({
        title: 'Container Deleted',
        description: 'Container has been removed.',
      });

      await fetchContainers();
      return true;
    } catch (error) {
      console.error('[useContainers] Delete failed:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to delete container.',
      });
      return false;
    }
  }, [toast, fetchContainers]);

  return {
    containers,
    loading,
    refetch: fetchContainers,
    createContainer,
    updateContainer,
    deleteContainer,
  };
}
