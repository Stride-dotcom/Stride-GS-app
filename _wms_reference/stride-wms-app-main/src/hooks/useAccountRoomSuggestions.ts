import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface AccountRoomSuggestion {
  id: string;
  room: string;
  usage_count: number;
}

export function useAccountRoomSuggestions(accountId: string | null | undefined) {
  const [rooms, setRooms] = useState<AccountRoomSuggestion[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchRooms = useCallback(async () => {
    if (!accountId) {
      setRooms([]);
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await (supabase.from('account_room_suggestions') as any)
        .select('id, room, usage_count')
        .eq('account_id', accountId)
        .order('usage_count', { ascending: false })
        .limit(100);

      if (error) throw error;
      setRooms(data || []);
    } catch (error) {
      console.error('Error fetching account room suggestions:', error);
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    fetchRooms();
  }, [fetchRooms]);

  const addOrUpdateRoom = useCallback(async (room: string): Promise<void> => {
    if (!accountId || !room.trim()) return;

    const trimmedRoom = room.trim();

    try {
      // Check if room exists
      const existing = rooms.find(
        r => r.room.toLowerCase() === trimmedRoom.toLowerCase()
      );

      if (existing) {
        // Update usage count
        await (supabase.from('account_room_suggestions') as any)
          .update({
            usage_count: existing.usage_count + 1,
            last_used_at: new Date().toISOString(),
          })
          .eq('id', existing.id);

        // Update local state
        setRooms(prev =>
          prev.map(r =>
            r.id === existing.id
              ? { ...r, usage_count: r.usage_count + 1 }
              : r
          ).sort((a, b) => b.usage_count - a.usage_count)
        );
      } else {
        // Insert new room
        const { data, error } = await (supabase.from('account_room_suggestions') as any)
          .insert({
            account_id: accountId,
            room: trimmedRoom,
            usage_count: 1,
          })
          .select('id, room, usage_count')
          .single();

        if (error) {
          // Handle unique constraint violation gracefully
          if (error.code === '23505') {
            await fetchRooms();
            return;
          }
          throw error;
        }

        // Update local state
        setRooms(prev => [data, ...prev]);
      }
    } catch (error) {
      console.error('Error adding/updating room suggestion:', error);
    }
  }, [accountId, rooms, fetchRooms]);

  return {
    rooms,
    loading,
    addOrUpdateRoom,
    refetch: fetchRooms,
  };
}
