import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

export interface LaborSettings {
  id: string;
  tenant_id: string;
  currency_code: string;
  overtime_multiplier: number;
  standard_workweek_hours: number;
  rounding_rule_minutes: number;
  created_at: string;
  updated_at: string;
}

export interface EmployeePay {
  id: string;
  tenant_id: string;
  user_id: string;
  pay_type: 'hourly' | 'salary';
  pay_rate: number;
  salary_hourly_equivalent: number | null;
  overtime_eligible: boolean;
  primary_warehouse_id: string | null;
  cost_center: string | null;
  created_at: string;
  updated_at: string;
}

export function useLaborSettings() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [settings, setSettings] = useState<LaborSettings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (profile?.tenant_id) {
      fetchSettings();
    }
  }, [profile?.tenant_id]);

  const fetchSettings = async () => {
    if (!profile?.tenant_id) return;

    try {
      const { data, error } = await supabase
        .from('labor_settings')
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .maybeSingle();

      if (error) throw error;
      setSettings(data);
    } catch (error) {
      console.error('Error fetching labor settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async (updates: Partial<LaborSettings>) => {
    if (!profile?.tenant_id) return false;

    try {
      if (settings?.id) {
        // Update existing
        const { error } = await supabase
          .from('labor_settings')
          .update({
            ...updates,
            updated_at: new Date().toISOString(),
          })
          .eq('id', settings.id);

        if (error) throw error;

        // Log audit
        await logAudit('labor_settings', settings.id, 'update', updates);
      } else {
        // Create new
        const { data, error } = await supabase
          .from('labor_settings')
          .insert({
            tenant_id: profile.tenant_id,
            ...updates,
          })
          .select()
          .single();

        if (error) throw error;

        // Log audit
        await logAudit('labor_settings', data.id, 'create', updates);
      }

      await fetchSettings();
      toast({ title: 'Settings saved', description: 'Labor settings have been updated.' });
      return true;
    } catch (error: any) {
      console.error('Error saving labor settings:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'Failed to save settings',
      });
      return false;
    }
  };

  const logAudit = async (entityType: string, entityId: string, action: string, changes: any) => {
    if (!profile?.tenant_id || !profile?.id) return;

    try {
      await supabase.from('admin_audit_log').insert({
        tenant_id: profile.tenant_id,
        actor_id: profile.id,
        entity_type: entityType,
        entity_id: entityId,
        action,
        changes_json: changes,
      });
    } catch (error) {
      console.error('Error logging audit:', error);
    }
  };

  return {
    settings,
    loading,
    saveSettings,
    refetch: fetchSettings,
  };
}

export function useEmployeePay() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [employeePay, setEmployeePay] = useState<EmployeePay[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (profile?.tenant_id) {
      fetchEmployeePay();
    }
  }, [profile?.tenant_id]);

  const fetchEmployeePay = async () => {
    if (!profile?.tenant_id) return;

    try {
      const { data, error } = await supabase
        .from('employee_pay')
        .select('*')
        .eq('tenant_id', profile.tenant_id);

      if (error) throw error;
      setEmployeePay((data || []) as EmployeePay[]);
    } catch (error) {
      console.error('Error fetching employee pay:', error);
    } finally {
      setLoading(false);
    }
  };

  const getEmployeePay = async (userId: string): Promise<EmployeePay | null> => {
    try {
      const { data, error } = await supabase
        .from('employee_pay')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) throw error;
      return data as EmployeePay | null;
    } catch (error) {
      console.error('Error fetching employee pay:', error);
      return null;
    }
  };

  const saveEmployeePay = async (userId: string, updates: Partial<EmployeePay>) => {
    if (!profile?.tenant_id) return false;

    try {
      const existing = await getEmployeePay(userId);

      if (existing) {
        const { error } = await supabase
          .from('employee_pay')
          .update({
            ...updates,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id);

        if (error) throw error;

        // Log audit
        await logAudit('employee_pay', existing.id, 'update', updates);
      } else {
        const { data, error } = await supabase
          .from('employee_pay')
          .insert({
            tenant_id: profile.tenant_id,
            user_id: userId,
            ...updates,
          })
          .select()
          .single();

        if (error) throw error;

        // Log audit
        await logAudit('employee_pay', data.id, 'create', updates);
      }

      await fetchEmployeePay();
      return true;
    } catch (error: any) {
      console.error('Error saving employee pay:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'Failed to save pay information',
      });
      return false;
    }
  };

  const logAudit = async (entityType: string, entityId: string, action: string, changes: any) => {
    if (!profile?.tenant_id || !profile?.id) return;

    try {
      await supabase.from('admin_audit_log').insert({
        tenant_id: profile.tenant_id,
        actor_id: profile.id,
        entity_type: entityType,
        entity_id: entityId,
        action,
        changes_json: changes,
      });
    } catch (error) {
      console.error('Error logging audit:', error);
    }
  };

  return {
    employeePay,
    loading,
    getEmployeePay,
    saveEmployeePay,
    refetch: fetchEmployeePay,
  };
}
