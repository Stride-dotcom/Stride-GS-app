import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

// ============================================
// TYPES
// ============================================

export interface OutboundType {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  is_active: boolean;
  color: string;
  icon: string;
  sort_order: number;
}

// ============================================
// OUTBOUND TYPES HOOK
// ============================================

export function useOutboundTypes() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [outboundTypes, setOutboundTypes] = useState<OutboundType[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchOutboundTypes = useCallback(async () => {
    if (!profile?.tenant_id) return;

    try {
      setLoading(true);
      const { data, error } = await (supabase
        .from('outbound_types') as any)
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .eq('is_active', true)
        .order('sort_order');

      if (error) throw error;
      setOutboundTypes(data || []);
    } catch (error) {
      console.error('Error fetching outbound types:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to load outbound types',
      });
    } finally {
      setLoading(false);
    }
  }, [profile?.tenant_id, toast]);

  useEffect(() => {
    fetchOutboundTypes();
  }, [fetchOutboundTypes]);

  const createOutboundType = async (name: string, description?: string) => {
    if (!profile?.tenant_id) return null;

    try {
      const { data, error } = await (supabase
        .from('outbound_types') as any)
        .insert({
          tenant_id: profile.tenant_id,
          name,
          description,
          is_system: false,
          is_active: true,
        })
        .select()
        .single();

      if (error) throw error;

      toast({
        title: 'Outbound Type Created',
        description: `"${name}" has been added.`,
      });

      fetchOutboundTypes();
      return data;
    } catch (error) {
      console.error('Error creating outbound type:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to create outbound type',
      });
      return null;
    }
  };

  return {
    outboundTypes,
    loading,
    refetch: fetchOutboundTypes,
    createOutboundType,
  };
}

// ============================================
// HOOK FOR GETTING ITEMS FOR OUTBOUND
// ============================================

export function useAccountItems(accountId: string | undefined) {
  const { profile } = useAuth();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchItems = useCallback(async () => {
    if (!profile?.tenant_id || !accountId) {
      setItems([]);
      return;
    }

    try {
      setLoading(true);
      const { data, error } = await (supabase
        .from('items') as any)
        .select(`
          id,
          item_code,
          sku,
          description,
          vendor,
          quantity,
          size,
          size_unit,
          status,
          room,
          class_id,
          primary_photo_url,
          metadata,
          location:locations!current_location_id(id, code, name),
          item_type:item_types(id, name),
          sidemark:sidemarks(id, sidemark_name),
          warehouse:warehouses(id, name)
        `)
        .eq('tenant_id', profile.tenant_id)
        .eq('account_id', accountId)
        // Only items that can be shipped (stored is the common "in storage" status in this app)
        .in('status', ['stored', 'active', 'available', 'in_storage'])
        .is('deleted_at', null)
        .order('item_code');

      if (error) throw error;
      setItems(data || []);
    } catch (error) {
      console.error('Error fetching account items:', error);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [profile?.tenant_id, accountId]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  return {
    items,
    loading,
    refetch: fetchItems,
  };
}
