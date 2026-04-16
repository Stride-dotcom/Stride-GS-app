import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';

export interface Department {
  id: string;
  tenant_id: string;
  name: string;
  description?: string;
  is_active: boolean;
  created_at: string;
}

export interface UserDepartment {
  id: string;
  user_id: string;
  department_id: string;
  is_primary: boolean;
  created_at: string;
  department?: Department;
}

export function useDepartments() {
  const { toast } = useToast();
  const { profile } = useAuth();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDepartments = useCallback(async () => {
    if (!profile?.tenant_id) return;

    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('departments' as any)
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('name');

      if (error) throw error;
      setDepartments((data || []) as any as Department[]);
    } catch (error) {
      console.error('Error fetching departments:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to load departments',
      });
    } finally {
      setLoading(false);
    }
  }, [profile?.tenant_id, toast]);

  const createDepartment = useCallback(async (name: string, description?: string): Promise<Department | null> => {
    if (!profile?.tenant_id || !profile?.id) return null;

    try {
      const { data, error } = await supabase
        .from('departments' as any)
        .insert({
          tenant_id: profile.tenant_id,
          name,
          description: description || null,
          created_by: profile.id,
        })
        .select('*')
        .single();

      if (error) throw error;

      const dept = data as any as Department;
      setDepartments((prev) => [...prev, dept].sort((a, b) => a.name.localeCompare(b.name)));
      toast({ title: 'Department created', description: `${name} has been created.` });
      return dept;
    } catch (error: any) {
      console.error('Error creating department:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'Failed to create department',
      });
      return null;
    }
  }, [profile?.tenant_id, profile?.id, toast]);

  const updateDepartment = useCallback(async (id: string, updates: { name?: string; description?: string }): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from('departments' as any)
        .update(updates)
        .eq('id', id);

      if (error) throw error;

      setDepartments((prev) =>
        prev.map((d) => (d.id === id ? { ...d, ...updates } : d))
      );
      toast({ title: 'Department updated', description: 'Changes have been saved.' });
      return true;
    } catch (error: any) {
      console.error('Error updating department:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'Failed to update department',
      });
      return false;
    }
  }, [toast]);

  const deleteDepartment = useCallback(async (id: string): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from('departments' as any)
        .update({ deleted_at: new Date().toISOString(), is_active: false })
        .eq('id', id);

      if (error) throw error;

      setDepartments((prev) => prev.filter((d) => d.id !== id));
      toast({ title: 'Department deleted', description: 'Department has been removed.' });
      return true;
    } catch (error: any) {
      console.error('Error deleting department:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'Failed to delete department',
      });
      return false;
    }
  }, [toast]);

  const assignUserToDepartment = useCallback(async (userId: string, departmentId: string, isPrimary?: boolean): Promise<boolean> => {
    if (!profile?.id) return false;

    try {
      const { error } = await supabase
        .from('user_departments' as any)
        .insert({
          user_id: userId,
          department_id: departmentId,
          is_primary: isPrimary || false,
          created_by: profile.id,
        });

      if (error) throw error;
      toast({ title: 'User assigned', description: 'User has been added to the department.' });
      return true;
    } catch (error: any) {
      console.error('Error assigning user to department:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'Failed to assign user',
      });
      return false;
    }
  }, [profile?.id, toast]);

  const removeUserFromDepartment = useCallback(async (userId: string, departmentId: string): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from('user_departments' as any)
        .update({ deleted_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('department_id', departmentId);

      if (error) throw error;
      toast({ title: 'User removed', description: 'User has been removed from the department.' });
      return true;
    } catch (error: any) {
      console.error('Error removing user from department:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'Failed to remove user',
      });
      return false;
    }
  }, [toast]);

  useEffect(() => {
    fetchDepartments();
  }, [fetchDepartments]);

  return {
    departments,
    loading,
    refetch: fetchDepartments,
    createDepartment,
    updateDepartment,
    deleteDepartment,
    assignUserToDepartment,
    removeUserFromDepartment,
  };
}
