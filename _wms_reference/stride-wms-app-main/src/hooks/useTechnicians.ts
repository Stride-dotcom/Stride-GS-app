import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';

export interface Technician {
  id: string;
  tenant_id: string;
  name: string;
  email: string;
  phone: string | null;
  markup_percent: number;
  hourly_rate: number | null;
  specialties: string[];
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface TechnicianFormData {
  name: string;
  email: string;
  phone?: string | null;
  markup_percent?: number;
  hourly_rate?: number | null;
  specialties?: string[];
  is_active?: boolean;
  notes?: string | null;
}

// Predefined specialty options
export const TECHNICIAN_SPECIALTIES = [
  'wood',
  'leather',
  'upholstery',
  'metal',
  'fabric',
  'electronics',
  'glass',
  'stone',
  'antique',
  'refinishing',
  'structural',
  'other',
] as const;

export function useTechnicians() {
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { profile } = useAuth();

  const fetchTechnicians = useCallback(async () => {
    if (!profile?.tenant_id) return;

    try {
      setLoading(true);

      const { data, error } = await supabase
        .from('technicians')
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .order('name');

      if (error) throw error;

      // Transform data to ensure specialties is always an array
      const transformedData: Technician[] = (data || []).map((tech: any) => ({
        ...tech,
        specialties: tech.specialties || [],
        markup_percent: tech.markup_percent || 0,
      }));

      setTechnicians(transformedData);
    } catch (error) {
      console.error('Error fetching technicians:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to load technicians',
      });
    } finally {
      setLoading(false);
    }
  }, [profile?.tenant_id, toast]);

  useEffect(() => {
    fetchTechnicians();
  }, [fetchTechnicians]);

  const createTechnician = useCallback(async (data: TechnicianFormData): Promise<Technician | null> => {
    if (!profile?.tenant_id || !profile?.id) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'You must be logged in to create a technician',
      });
      return null;
    }

    try {
      const { data: newTech, error } = await supabase
        .from('technicians')
        .insert({
          tenant_id: profile.tenant_id,
          name: data.name,
          email: data.email,
          phone: data.phone || null,
          markup_percent: data.markup_percent || 0,
          hourly_rate: data.hourly_rate || null,
          specialties: data.specialties || [],
          is_active: data.is_active ?? true,
          notes: data.notes || null,
          created_by: profile.id,
        })
        .select()
        .single();

      if (error) throw error;

      toast({
        title: 'Success',
        description: `Technician "${data.name}" created successfully`,
      });

      await fetchTechnicians();
      return newTech as Technician;
    } catch (error: any) {
      console.error('Error creating technician:', error);

      // Handle unique constraint violation
      if (error.code === '23505') {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: 'A technician with this email already exists',
        });
      } else {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: 'Failed to create technician',
        });
      }
      return null;
    }
  }, [profile?.tenant_id, profile?.id, toast, fetchTechnicians]);

  const updateTechnician = useCallback(async (id: string, data: Partial<TechnicianFormData>): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from('technicians')
        .update({
          ...data,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Technician updated successfully',
      });

      await fetchTechnicians();
      return true;
    } catch (error: any) {
      console.error('Error updating technician:', error);

      if (error.code === '23505') {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: 'A technician with this email already exists',
        });
      } else {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: 'Failed to update technician',
        });
      }
      return false;
    }
  }, [toast, fetchTechnicians]);

  const deleteTechnician = useCallback(async (id: string): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from('technicians')
        .delete()
        .eq('id', id);

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Technician deleted successfully',
      });

      await fetchTechnicians();
      return true;
    } catch (error) {
      console.error('Error deleting technician:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to delete technician. They may have associated quotes.',
      });
      return false;
    }
  }, [toast, fetchTechnicians]);

  const toggleActive = useCallback(async (id: string, isActive: boolean): Promise<boolean> => {
    return updateTechnician(id, { is_active: isActive });
  }, [updateTechnician]);

  // Get active technicians only (for dropdowns)
  const activeTechnicians = technicians.filter(t => t.is_active);

  // Get technicians by specialty
  const getTechniciansBySpecialty = useCallback((specialty: string): Technician[] => {
    return activeTechnicians.filter(t =>
      t.specialties.includes(specialty) || t.specialties.includes('other')
    );
  }, [activeTechnicians]);

  // Format technician name with hourly rate for display
  const formatTechnicianDisplay = useCallback((tech: Technician): string => {
    if (tech.hourly_rate) {
      return `${tech.name} ($${tech.hourly_rate}/hr)`;
    }
    return tech.name;
  }, []);

  return {
    technicians,
    activeTechnicians,
    loading,
    refetch: fetchTechnicians,
    createTechnician,
    updateTechnician,
    deleteTechnician,
    toggleActive,
    getTechniciansBySpecialty,
    formatTechnicianDisplay,
  };
}
