import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

// Interface matching the database schema
export interface TaskCustomCharge {
  id: string;
  task_id: string;
  tenant_id: string;
  template_id: string | null;
  charge_name: string;
  charge_description: string | null;
  charge_amount: number;
  charge_type: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface ChargeTemplate {
  id: string;
  name: string;
  description: string | null;
  amount: number;
  charge_type: string | null;
  is_active: boolean;
}

export function useTaskCustomCharges(taskId: string | undefined) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [charges, setCharges] = useState<TaskCustomCharge[]>([]);
  const [templates, setTemplates] = useState<ChargeTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCharges = useCallback(async () => {
    if (!taskId) {
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await (supabase
        .from('task_custom_charges') as any)
        .select('*')
        .eq('task_id', taskId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setCharges(data || []);
    } catch (error) {
      console.error('Error fetching task custom charges:', error);
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  const fetchTemplates = useCallback(async () => {
    if (!profile?.tenant_id) return;

    try {
      const { data, error } = await supabase
        .from('billing_charge_templates')
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setTemplates((data as ChargeTemplate[]) || []);
    } catch (error) {
      console.error('Error fetching charge templates:', error);
    }
  }, [profile?.tenant_id]);

  useEffect(() => {
    fetchCharges();
    fetchTemplates();
  }, [fetchCharges, fetchTemplates]);

  const addCharge = async (
    chargeName: string,
    chargeAmount: number,
    templateId?: string,
    chargeType?: string,
    chargeDescription?: string
  ): Promise<TaskCustomCharge | null> => {
    if (!profile?.tenant_id || !taskId) return null;

    try {
      const { data, error } = await (supabase
        .from('task_custom_charges') as any)
        .insert({
          task_id: taskId,
          tenant_id: profile.tenant_id,
          template_id: templateId || null,
          charge_name: chargeName,
          charge_description: chargeDescription || null,
          charge_amount: chargeAmount,
          charge_type: chargeType || null,
          created_by: profile.id,
        })
        .select()
        .single();

      if (error) throw error;

      setCharges(prev => [...prev, data]);

      toast({
        title: 'Charge Added',
        description: `${chargeName} - $${chargeAmount.toFixed(2)}`,
      });

      return data;
    } catch (error) {
      console.error('Error adding custom charge:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to add custom charge',
      });
      return null;
    }
  };

  const addChargeFromTemplate = async (templateId: string): Promise<TaskCustomCharge | null> => {
    const template = templates.find(t => t.id === templateId);
    if (!template) return null;

    return addCharge(
      template.name,
      template.amount,
      templateId,
      template.charge_type || undefined,
      template.description || undefined
    );
  };

  const updateCharge = async (
    chargeId: string,
    updates: { charge_name?: string; charge_amount?: number; charge_description?: string }
  ): Promise<boolean> => {
    try {
      const { error } = await (supabase
        .from('task_custom_charges') as any)
        .update(updates)
        .eq('id', chargeId);

      if (error) throw error;

      setCharges(prev =>
        prev.map(c => (c.id === chargeId ? { ...c, ...updates } : c))
      );

      toast({
        title: 'Charge Updated',
      });

      return true;
    } catch (error) {
      console.error('Error updating custom charge:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to update custom charge',
      });
      return false;
    }
  };

  const deleteCharge = async (chargeId: string): Promise<boolean> => {
    try {
      const { error } = await (supabase
        .from('task_custom_charges') as any)
        .delete()
        .eq('id', chargeId);

      if (error) throw error;

      setCharges(prev => prev.filter(c => c.id !== chargeId));

      toast({
        title: 'Charge Removed',
      });

      return true;
    } catch (error) {
      console.error('Error deleting custom charge:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to remove custom charge',
      });
      return false;
    }
  };

  const totalCharges = charges.reduce((sum, c) => sum + c.charge_amount, 0);

  return {
    charges,
    templates,
    loading,
    totalCharges,
    refetch: fetchCharges,
    addCharge,
    addChargeFromTemplate,
    updateCharge,
    deleteCharge,
  };
}
