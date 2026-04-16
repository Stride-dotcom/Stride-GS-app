import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import type { Database } from '@/integrations/supabase/types';

type RefRow = Database['public']['Tables']['shipment_external_refs']['Row'];

export type RefType = 'BOL' | 'PRO' | 'TRACKING' | 'PO' | 'REF';

function normalizeRefValue(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, '').toUpperCase().trim();
}

export function useExternalRefs(shipmentId?: string) {
  const [refs, setRefs] = useState<RefRow[]>([]);
  const [loading, setLoading] = useState(true);
  const { profile } = useAuth();
  const { toast } = useToast();

  const fetchRefs = useCallback(async () => {
    if (!shipmentId) {
      setRefs([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('shipment_external_refs')
        .select('*')
        .eq('shipment_id', shipmentId)
        .order('created_at');
      if (error) throw error;
      setRefs(data || []);
    } catch (error) {
      console.error('Error fetching refs:', error);
    } finally {
      setLoading(false);
    }
  }, [shipmentId]);

  useEffect(() => {
    fetchRefs();
  }, [fetchRefs]);

  const addRef = useCallback(async (refType: RefType, value: string) => {
    if (!shipmentId || !profile?.tenant_id) return null;
    try {
      const normalized = normalizeRefValue(value);
      if (!normalized) {
        toast({ variant: 'destructive', title: 'Invalid', description: 'Reference value cannot be empty.' });
        return null;
      }
      const { data, error } = await supabase
        .from('shipment_external_refs')
        .insert({
          tenant_id: profile.tenant_id,
          shipment_id: shipmentId,
          ref_type: refType,
          value: value.trim(),
          normalized_value: normalized,
        })
        .select()
        .single();
      if (error) throw error;
      setRefs((prev) => [...prev, data]);
      toast({ title: 'Reference Added', description: `${refType}: ${value}` });
      return data;
    } catch (error) {
      console.error('Error adding ref:', error);
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to add reference.' });
      return null;
    }
  }, [shipmentId, profile?.tenant_id, toast]);

  const removeRef = useCallback(async (refId: string) => {
    try {
      const { error } = await supabase
        .from('shipment_external_refs')
        .delete()
        .eq('id', refId);
      if (error) throw error;
      setRefs((prev) => prev.filter((r) => r.id !== refId));
      toast({ title: 'Reference Removed' });
    } catch (error) {
      console.error('Error removing ref:', error);
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to remove reference.' });
    }
  }, [toast]);

  return { refs, loading, addRef, removeRef, refetch: fetchRefs };
}
