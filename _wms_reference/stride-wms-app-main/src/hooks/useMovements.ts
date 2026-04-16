/**
 * useMovements - Track all inventory location changes
 * 
 * RULE: Any location change MUST:
 * 1. Update items.current_location_id
 * 2. Insert movements row with from/to location, action_type, actor_id
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';

export interface Movement {
  id: string;
  item_id: string;
  from_location_id: string | null;
  to_location_id: string | null;
  batch_id: string | null;
  actor_type: 'user' | 'system';
  actor_id: string | null;
  action_type: 'receive' | 'move' | 'release' | 'dispose';
  quantity: number | null;
  note: string | null;
  moved_at: string;
  created_at: string;
  // Joined data
  from_location?: { id: string; code: string; name: string | null } | null;
  to_location?: { id: string; code: string; name: string | null } | null;
  actor?: { id: string; first_name: string | null; last_name: string | null } | null;
  item?: { id: string; item_code: string; description: string | null } | null;
}

export interface MoveItemParams {
  item_id: string;
  to_location_id: string;
  action_type?: 'receive' | 'move' | 'release' | 'dispose';
  note?: string | null;
  quantity?: number;
}

export function useMovements(itemId?: string) {
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { user } = useAuth();

  const fetchMovements = useCallback(async () => {
    if (!itemId) {
      setMovements([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      const { data, error } = await supabase
        .from('movements')
        .select(`
          *,
          from_location:locations!from_location_id(id, code, name),
          to_location:locations!to_location_id(id, code, name),
          item:items(id, item_code, description)
        `)
        .eq('item_id', itemId)
        .order('moved_at', { ascending: false });

      if (error) {
        console.error('[useMovements] Fetch failed:', {
          error,
          message: error.message,
          code: error.code,
          details: error.details,
          itemId,
        });
        toast({
          variant: 'destructive',
          title: 'Error loading movements',
          description: error.message || 'Failed to load movement history',
        });
        setMovements([]);
        return;
      }

      // Map data to Movement interface
      const mappedMovements = (data || []).map((m: any) => ({
        ...m,
        actor_type: m.actor_type as 'user' | 'system',
        action_type: m.action_type as 'receive' | 'move' | 'release' | 'dispose',
      }));
      setMovements(mappedMovements);
    } catch (error: any) {
      console.error('[useMovements] Unexpected error:', error);
      setMovements([]);
    } finally {
      setLoading(false);
    }
  }, [itemId, toast]);

  useEffect(() => {
    fetchMovements();
  }, [fetchMovements]);

  /**
   * Move an item to a new location.
   * This updates the item's current_location_id AND creates a movement record.
   */
  const moveItem = useCallback(async (params: MoveItemParams): Promise<Movement | null> => {
    const { item_id, to_location_id, action_type = 'move', note, quantity } = params;

    // First, get the item's current location
    const { data: currentItem, error: itemError } = await supabase
      .from('items')
      .select('current_location_id, quantity')
      .eq('id', item_id)
      .single();

    if (itemError) {
      console.error('[useMovements] Failed to get current item:', {
        error: itemError,
        message: itemError.message,
        item_id,
      });
      toast({
        variant: 'destructive',
        title: 'Error',
        description: itemError.message || 'Failed to get item details',
      });
      return null;
    }

    const from_location_id = currentItem?.current_location_id || null;

    // Update item's current location
    const { error: updateError } = await supabase
      .from('items')
      .update({ 
        current_location_id: to_location_id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', item_id);

    if (updateError) {
      console.error('[useMovements] Failed to update item location:', {
        error: updateError,
        message: updateError.message,
        item_id,
        to_location_id,
      });
      toast({
        variant: 'destructive',
        title: 'Error',
        description: updateError.message || 'Failed to update item location',
      });
      return null;
    }

    // Create movement record
    const movementData = {
      item_id,
      from_location_id,
      to_location_id,
      action_type,
      actor_type: 'user' as const,
      actor_id: user?.id || null,
      quantity: quantity ?? currentItem?.quantity ?? 1,
      note: note ?? null,
      moved_at: new Date().toISOString(),
    };

    const { data: movement, error: movementError } = await supabase
      .from('movements')
      .insert(movementData)
      .select(`
        *,
        from_location:locations!from_location_id(id, code, name),
        to_location:locations!to_location_id(id, code, name)
      `)
      .single();

    if (movementError) {
      console.error('[useMovements] Failed to create movement record:', {
        error: movementError,
        message: movementError.message,
        movementData,
      });
      // Don't show toast - the location update succeeded, just the audit trail failed
      console.warn('[useMovements] Location updated but movement record failed');
      return null;
    }

    toast({
      title: 'Item moved',
      description: `Location updated successfully`,
    });

    return movement as Movement;
  }, [user?.id, toast]);

  /**
   * Record a receive movement (item enters warehouse)
   */
  const recordReceive = useCallback(async (
    item_id: string,
    to_location_id: string,
    note?: string | null,
    quantity?: number
  ): Promise<Movement | null> => {
    return moveItem({
      item_id,
      to_location_id,
      action_type: 'receive',
      note,
      quantity,
    });
  }, [moveItem]);

  /**
   * Record a release movement (item leaves warehouse)
   */
  const recordRelease = useCallback(async (
    item_id: string,
    from_location_id: string | null,
    note?: string | null
  ): Promise<Movement | null> => {
    // For releases, we might not have a to_location, but we need to track it
    const movementData = {
      item_id,
      from_location_id,
      to_location_id: null,
      action_type: 'release' as const,
      actor_type: 'user' as const,
      actor_id: user?.id || null,
      note: note ?? null,
      moved_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('movements')
      .insert(movementData)
      .select()
      .single();

    if (error) {
      console.error('[useMovements] Failed to record release:', {
        error,
        message: error.message,
        movementData,
      });
      return null;
    }

    return data as Movement;
  }, [user?.id]);

  /**
   * Record a dispose movement
   */
  const recordDispose = useCallback(async (
    item_id: string,
    from_location_id: string | null,
    note?: string | null
  ): Promise<Movement | null> => {
    const movementData = {
      item_id,
      from_location_id,
      to_location_id: null,
      action_type: 'dispose' as const,
      actor_type: 'user' as const,
      actor_id: user?.id || null,
      note: note ?? null,
      moved_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('movements')
      .insert(movementData)
      .select()
      .single();

    if (error) {
      console.error('[useMovements] Failed to record dispose:', {
        error,
        message: error.message,
        movementData,
      });
      return null;
    }

    return data as Movement;
  }, [user?.id]);

  return {
    movements,
    loading,
    refetch: fetchMovements,
    moveItem,
    recordReceive,
    recordRelease,
    recordDispose,
  };
}
