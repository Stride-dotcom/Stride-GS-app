import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import type { Database } from '@/integrations/supabase/types';

type ClassRow = Database['public']['Tables']['classes']['Row'];
type ClassInsert = Database['public']['Tables']['classes']['Insert'];
type ClassUpdate = Database['public']['Tables']['classes']['Update'];

export type ItemClass = ClassRow;

interface UseClassesOptions {
  includeInactive?: boolean;
}

export function useClasses(options?: UseClassesOptions) {
  const [classes, setClasses] = useState<ItemClass[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { profile } = useAuth();
  const includeInactive = options?.includeInactive ?? false;

  const fetchClasses = useCallback(async () => {
    if (!profile?.tenant_id) return;

    try {
      setLoading(true);
      let query = supabase
        .from('classes')
        .select('*')
        .eq('tenant_id', profile.tenant_id);

      if (!includeInactive) {
        query = query.eq('is_active', true);
      }

      const { data, error } = await query
        .order('sort_order')
        .order('name');

      if (error) throw error;
      setClasses(data || []);
    } catch (error) {
      console.error('Error fetching classes:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to load item classes',
      });
    } finally {
      setLoading(false);
    }
  }, [profile?.tenant_id, toast, includeInactive]);

  useEffect(() => {
    fetchClasses();
  }, [fetchClasses]);

  const createClass = async (data: Omit<ClassInsert, 'tenant_id'>) => {
    if (!profile?.tenant_id) throw new Error('No tenant');
    
    const { data: result, error } = await supabase
      .from('classes')
      .insert([{ ...data, tenant_id: profile.tenant_id }])
      .select()
      .single();

    if (error) throw error;
    await fetchClasses();
    return result;
  };

  const updateClass = async (id: string, data: ClassUpdate) => {
    const { data: result, error } = await supabase
      .from('classes')
      .update(data)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    await fetchClasses();
    return result;
  };

  const deleteClass = async (id: string) => {
    const { error } = await supabase
      .from('classes')
      .update({ is_active: false })
      .eq('id', id);

    if (error) throw error;
    await fetchClasses();
  };

  const getClassForCubicFeet = useCallback((cubicFeet: number): ItemClass | null => {
    return classes.find(c => 
      (c.min_cubic_feet === null || cubicFeet >= c.min_cubic_feet) &&
      (c.max_cubic_feet === null || cubicFeet <= c.max_cubic_feet)
    ) || null;
  }, [classes]);

  return {
    classes,
    loading,
    refetch: fetchClasses,
    createClass,
    updateClass,
    deleteClass,
    getClassForCubicFeet,
  };
}
