/**
 * useInventory - Centralized hook for inventory item operations
 * 
 * Items are created when shipments are received.
 * Each item references: shipment, account, item_type, current_location
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';

export interface InventoryItem {
  id: string;
  tenant_id: string;
  warehouse_id: string;
  item_code: string;
  client_account: string | null;
  vendor: string | null;
  description: string | null;
  quantity: number;
  sidemark: string | null;
  status: 'active' | 'released' | 'disposed';
  item_type_id: string | null;
  current_location_id: string | null;
  received_at: string | null;
  released_at: string | null;
  room: string | null;
  primary_photo_url: string | null;
  // Flags
  is_overweight: boolean;
  is_oversize: boolean;
  is_unstackable: boolean;
  is_crated: boolean;
  needs_repair: boolean;
  needs_inspection: boolean;
  needs_warehouse_assembly: boolean;
  has_damage: boolean;
  received_without_id: boolean;
  needs_minor_touchup: boolean;
  // Status tracking
  inspection_status: string | null;
  repair_status: string | null;
  assembly_status: string | null;
  minor_touchup_status: string | null;
  // Timestamps
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  // Joined data (optional)
  item_type?: { id: string; name: string } | null;
  location?: { id: string; code: string; name: string | null } | null;
  warehouse?: { id: string; name: string } | null;
}

export interface InventoryFilters {
  status?: string;
  warehouseId?: string;
  accountName?: string;
  locationId?: string;
  itemTypeId?: string;
  searchQuery?: string;
}

export interface CreateItemParams {
  warehouse_id: string;
  item_code: string;
  client_account?: string | null;
  vendor?: string | null;
  description?: string | null;
  quantity?: number;
  sidemark?: string | null;
  item_type_id?: string | null;
  current_location_id?: string | null;
  received_at?: string | null;
  // Flags
  is_overweight?: boolean;
  is_oversize?: boolean;
  is_unstackable?: boolean;
  is_crated?: boolean;
  needs_repair?: boolean;
  needs_inspection?: boolean;
  needs_warehouse_assembly?: boolean;
  has_damage?: boolean;
  received_without_id?: boolean;
}

export function useInventory(filters?: InventoryFilters) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { profile } = useAuth();

  const fetchItems = useCallback(async () => {
    if (!profile?.tenant_id) {
      setItems([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      
      let query = supabase
        .from('items')
        .select(`
          *,
          item_type:item_types(id, name),
          location:locations!current_location_id(id, code, name),
          warehouse:warehouses(id, name)
        `)
        .eq('tenant_id', profile.tenant_id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      // Apply filters
      if (filters?.status) {
        query = query.eq('status', filters.status);
      }
      if (filters?.warehouseId) {
        query = query.eq('warehouse_id', filters.warehouseId);
      }
      if (filters?.accountName) {
        query = query.eq('client_account', filters.accountName);
      }
      if (filters?.locationId) {
        query = query.eq('current_location_id', filters.locationId);
      }
      if (filters?.itemTypeId) {
        query = query.eq('item_type_id', filters.itemTypeId);
      }
      if (filters?.searchQuery) {
        const search = `%${filters.searchQuery}%`;
        query = query.or(`item_code.ilike.${search},description.ilike.${search},sidemark.ilike.${search},vendor.ilike.${search}`);
      }

      const { data, error } = await query;

      if (error) {
        console.error('[useInventory] Fetch failed:', {
          error,
          message: error.message,
          code: error.code,
          details: error.details,
        });
        toast({
          variant: 'destructive',
          title: 'Error loading inventory',
          description: error.message || 'Failed to load items',
        });
        setItems([]);
        return;
      }

      setItems((data || []) as InventoryItem[]);
    } catch (error: any) {
      console.error('[useInventory] Unexpected error:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'An unexpected error occurred',
      });
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [profile?.tenant_id, filters, toast]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const createItem = useCallback(async (params: CreateItemParams): Promise<InventoryItem | null> => {
    if (!profile?.tenant_id) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No tenant context',
      });
      return null;
    }

    const insertData = {
      tenant_id: profile.tenant_id,
      warehouse_id: params.warehouse_id,
      item_code: params.item_code,
      client_account: params.client_account ?? null,
      vendor: params.vendor ?? null,
      description: params.description ?? null,
      quantity: params.quantity ?? 1,
      sidemark: params.sidemark ?? null,
      item_type_id: params.item_type_id ?? null,
      current_location_id: params.current_location_id ?? null,
      received_at: params.received_at ?? new Date().toISOString(),
      status: 'active' as const,
      // Flags with defaults
      is_overweight: params.is_overweight ?? false,
      is_oversize: params.is_oversize ?? false,
      is_unstackable: params.is_unstackable ?? false,
      is_crated: params.is_crated ?? false,
      needs_repair: params.needs_repair ?? false,
      needs_inspection: params.needs_inspection ?? false,
      needs_warehouse_assembly: params.needs_warehouse_assembly ?? false,
      has_damage: params.has_damage ?? false,
      received_without_id: params.received_without_id ?? false,
    };

    const { data, error } = await supabase
      .from('items')
      .insert(insertData)
      .select()
      .single();

    if (error) {
      console.error('[useInventory] Create failed:', {
        error,
        message: error.message,
        code: error.code,
        details: error.details,
        insertData,
      });
      toast({
        variant: 'destructive',
        title: 'Error creating item',
        description: error.message || 'Failed to create item',
      });
      return null;
    }

    return data as InventoryItem;
  }, [profile?.tenant_id, toast]);

  const updateItem = useCallback(async (
    itemId: string,
    updates: Partial<Omit<InventoryItem, 'id' | 'tenant_id' | 'created_at'>>
  ): Promise<InventoryItem | null> => {
    const { data, error } = await supabase
      .from('items')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', itemId)
      .select()
      .single();

    if (error) {
      console.error('[useInventory] Update failed:', {
        error,
        message: error.message,
        code: error.code,
        itemId,
        updates,
      });
      toast({
        variant: 'destructive',
        title: 'Error updating item',
        description: error.message || 'Failed to update item',
      });
      return null;
    }

    return data as InventoryItem;
  }, [toast]);

  const deleteItem = useCallback(async (itemId: string): Promise<boolean> => {
    // Soft delete
    const { error } = await supabase
      .from('items')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', itemId);

    if (error) {
      console.error('[useInventory] Delete failed:', {
        error,
        message: error.message,
        code: error.code,
        itemId,
      });
      toast({
        variant: 'destructive',
        title: 'Error deleting item',
        description: error.message || 'Failed to delete item',
      });
      return false;
    }

    return true;
  }, [toast]);

  const getItemById = useCallback(async (itemId: string): Promise<InventoryItem | null> => {
    const { data, error } = await supabase
      .from('items')
      .select(`
        *,
        item_type:item_types(id, name),
        location:locations!current_location_id(id, code, name),
        warehouse:warehouses(id, name)
      `)
      .eq('id', itemId)
      .single();

    if (error) {
      console.error('[useInventory] Get by ID failed:', {
        error,
        message: error.message,
        code: error.code,
        itemId,
      });
      return null;
    }

    return data as InventoryItem;
  }, []);

  return {
    items,
    loading,
    refetch: fetchItems,
    createItem,
    updateItem,
    deleteItem,
    getItemById,
  };
}
