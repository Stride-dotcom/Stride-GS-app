import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface AccountSidemark {
  id: string;
  sidemark: string;
  created_at: string;
}

export function useAccountSidemarks(accountId: string | null | undefined) {
  const { user } = useAuth();
  const [sidemarks, setSidemarks] = useState<AccountSidemark[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchSidemarks = useCallback(async () => {
    if (!accountId) {
      setSidemarks([]);
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await (supabase.from('account_sidemarks') as any)
        .select('id, sidemark, created_at')
        .eq('account_id', accountId)
        .order('sidemark', { ascending: true });

      if (error) throw error;
      setSidemarks(data || []);
    } catch (error) {
      console.error('Error fetching account sidemarks:', error);
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    fetchSidemarks();
  }, [fetchSidemarks]);

  const addSidemark = useCallback(async (sidemark: string): Promise<AccountSidemark | null> => {
    if (!accountId || !sidemark.trim()) return null;

    const trimmedSidemark = sidemark.trim();

    try {
      // Check if it already exists
      const existing = sidemarks.find(
        s => s.sidemark.toLowerCase() === trimmedSidemark.toLowerCase()
      );
      if (existing) return existing;

      const { data, error } = await (supabase.from('account_sidemarks') as any)
        .insert({
          account_id: accountId,
          sidemark: trimmedSidemark,
          created_by: user?.id,
        })
        .select('id, sidemark, created_at')
        .single();

      if (error) {
        // Handle unique constraint violation gracefully
        if (error.code === '23505') {
          // Refetch and return existing
          await fetchSidemarks();
          return sidemarks.find(
            s => s.sidemark.toLowerCase() === trimmedSidemark.toLowerCase()
          ) || null;
        }
        throw error;
      }

      // Update local state
      setSidemarks(prev => [...prev, data].sort((a, b) => 
        a.sidemark.localeCompare(b.sidemark)
      ));

      return data;
    } catch (error) {
      console.error('Error adding sidemark:', error);
      return null;
    }
  }, [accountId, user?.id, sidemarks, fetchSidemarks]);

  const deleteSidemark = useCallback(async (sidemarkId: string): Promise<boolean> => {
    try {
      const { error } = await (supabase.from('account_sidemarks') as any)
        .delete()
        .eq('id', sidemarkId);

      if (error) throw error;

      setSidemarks(prev => prev.filter(s => s.id !== sidemarkId));
      return true;
    } catch (error) {
      console.error('Error deleting sidemark:', error);
      return false;
    }
  }, []);

  return {
    sidemarks,
    loading,
    addSidemark,
    deleteSidemark,
    refetch: fetchSidemarks,
  };
}
