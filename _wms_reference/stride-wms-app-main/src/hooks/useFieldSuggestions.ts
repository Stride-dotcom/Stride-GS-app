import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface FieldSuggestion {
  id: string;
  value: string;
  usage_count: number;
}

export function useFieldSuggestions(fieldName: string) {
  const { profile } = useAuth();
  const [suggestions, setSuggestions] = useState<FieldSuggestion[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchSuggestions = useCallback(async () => {
    if (!profile?.tenant_id) return;

    setLoading(true);
    try {
      const { data, error } = await (supabase.from('field_suggestions') as any)
        .select('id, value, usage_count')
        .eq('tenant_id', profile.tenant_id)
        .eq('field_name', fieldName)
        .order('usage_count', { ascending: false })
        .limit(100);

      if (error) throw error;
      setSuggestions(data || []);
    } catch (error) {
      console.error('Error fetching suggestions:', error);
    } finally {
      setLoading(false);
    }
  }, [profile?.tenant_id, fieldName]);

  useEffect(() => {
    fetchSuggestions();
  }, [fetchSuggestions]);

  const addOrUpdateSuggestion = useCallback(async (value: string) => {
    if (!profile?.tenant_id || !value.trim()) return;

    const trimmedValue = value.trim();

    try {
      // Check if suggestion exists
      const { data: existing } = await (supabase.from('field_suggestions') as any)
        .select('id, usage_count')
        .eq('tenant_id', profile.tenant_id)
        .eq('field_name', fieldName)
        .eq('value', trimmedValue)
        .single();

      if (existing) {
        // Update usage count
        await (supabase.from('field_suggestions') as any)
          .update({
            usage_count: existing.usage_count + 1,
            last_used_at: new Date().toISOString(),
          })
          .eq('id', existing.id);
      } else {
        // Insert new suggestion
        await (supabase.from('field_suggestions') as any)
          .insert({
            tenant_id: profile.tenant_id,
            field_name: fieldName,
            value: trimmedValue,
            usage_count: 1,
          });
      }

      // Refresh suggestions
      fetchSuggestions();
    } catch (error) {
      // Ignore errors - suggestions are not critical
      console.error('Error adding suggestion:', error);
    }
  }, [profile?.tenant_id, fieldName, fetchSuggestions]);

  return {
    suggestions,
    loading,
    addOrUpdateSuggestion,
    refetch: fetchSuggestions,
  };
}
