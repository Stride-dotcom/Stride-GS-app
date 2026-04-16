import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface UserPreference {
  id: string;
  user_id: string;
  preference_key: string;
  preference_value: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export function useUserPreferences() {
  const { profile } = useAuth();
  const [preferences, setPreferences] = useState<Map<string, Record<string, unknown>>>(new Map());
  const [loading, setLoading] = useState(true);

  const fetchPreferences = useCallback(async () => {
    if (!profile?.id) {
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await (supabase
        .from('user_preferences') as any)
        .select('*')
        .eq('user_id', profile.id);

      if (error) throw error;

      const prefMap = new Map<string, Record<string, unknown>>();
      (data as UserPreference[] || []).forEach(pref => {
        prefMap.set(pref.preference_key, pref.preference_value);
      });
      setPreferences(prefMap);
    } catch (error) {
      console.error('Error fetching user preferences:', error);
    } finally {
      setLoading(false);
    }
  }, [profile?.id]);

  useEffect(() => {
    fetchPreferences();
  }, [fetchPreferences]);

  const getPreference = <T = Record<string, unknown>>(key: string): T | null => {
    return (preferences.get(key) as T) || null;
  };

  const setPreference = async (key: string, value: Record<string, unknown>): Promise<boolean> => {
    if (!profile?.id) return false;

    try {
      const { error } = await (supabase
        .from('user_preferences') as any)
        .upsert(
          {
            user_id: profile.id,
            preference_key: key,
            preference_value: value,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,preference_key' }
        );

      if (error) throw error;

      setPreferences(prev => {
        const next = new Map(prev);
        next.set(key, value);
        return next;
      });

      return true;
    } catch (error) {
      console.error('Error saving user preference:', error);
      return false;
    }
  };

  // Specific helper for card order
  const getCardOrder = (pageKey: string): string[] | null => {
    const pref = getPreference<{ order: string[] }>(`card_order_${pageKey}`);
    return pref?.order || null;
  };

  const setCardOrder = async (pageKey: string, order: string[]): Promise<boolean> => {
    return setPreference(`card_order_${pageKey}`, { order });
  };

  return {
    preferences,
    loading,
    getPreference,
    setPreference,
    getCardOrder,
    setCardOrder,
    refetch: fetchPreferences,
  };
}
