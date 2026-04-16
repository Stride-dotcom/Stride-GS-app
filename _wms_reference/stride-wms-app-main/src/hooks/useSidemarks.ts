import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import type { Database } from '@/integrations/supabase/types';

type SidemarkRow = Database['public']['Tables']['sidemarks']['Row'];
type SidemarkInsert = Database['public']['Tables']['sidemarks']['Insert'];
type SidemarkUpdate = Database['public']['Tables']['sidemarks']['Update'];

export interface Sidemark extends SidemarkRow {
  account?: {
    id: string;
    account_name: string;
    account_code: string;
  } | null;
}

export function useSidemarks(accountId?: string) {
  const [sidemarks, setSidemarks] = useState<Sidemark[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { profile } = useAuth();

  const fetchSidemarks = useCallback(async () => {
    if (!profile?.tenant_id) return;
    
    try {
      setLoading(true);
      let query = supabase
        .from('sidemarks')
        .select(`
          *,
          account:accounts!sidemarks_account_id_fkey(id, account_name, account_code)
        `)
        .eq('tenant_id', profile.tenant_id)
        .is('deleted_at', null)
        .order('sidemark_name');

      if (accountId) {
        query = query.eq('account_id', accountId);
      }

      const { data, error } = await query;

      if (error) throw error;
      setSidemarks(data || []);
    } catch (error) {
      console.error('Error fetching sidemarks:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to load sidemarks',
      });
    } finally {
      setLoading(false);
    }
  }, [accountId, profile?.tenant_id, toast]);

  useEffect(() => {
    fetchSidemarks();
  }, [fetchSidemarks]);

  const createSidemark = async (data: Omit<SidemarkInsert, 'tenant_id'>) => {
    if (!profile?.tenant_id) throw new Error('No tenant');
    
    const { data: result, error } = await supabase
      .from('sidemarks')
      .insert([{ ...data, tenant_id: profile.tenant_id }])
      .select()
      .single();

    if (error) throw error;
    await fetchSidemarks();
    return result;
  };

  const updateSidemark = async (id: string, data: SidemarkUpdate) => {
    const { data: result, error } = await supabase
      .from('sidemarks')
      .update(data)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    await fetchSidemarks();
    return result;
  };

  const deleteSidemark = async (id: string) => {
    const { error } = await supabase
      .from('sidemarks')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw error;
    await fetchSidemarks();
  };

  return {
    sidemarks,
    loading,
    refetch: fetchSidemarks,
    createSidemark,
    updateSidemark,
    deleteSidemark,
  };
}
