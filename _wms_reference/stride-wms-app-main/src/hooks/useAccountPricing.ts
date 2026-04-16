/**
 * useAccountPricing - Hook for managing account-specific pricing adjustments
 * Uses account_service_settings table for per-account price overrides
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

// Types
export interface ServiceEvent {
  id: string;
  service_code: string;
  service_name: string;
  class_code: string | null;
  rate: number;
  billing_unit: string;  // Flexible to handle all database values
  billing_trigger: string;
  is_active: boolean;
}

export interface AccountServiceSetting {
  id: string;
  account_id: string;
  tenant_id: string;
  service_code: string;
  class_code: string | null;
  custom_rate: number | null;
  custom_percent_adjust: number | null;
  adjustment_type: 'fixed' | 'percentage' | 'override';
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  // Joined data
  service_event?: ServiceEvent;
  base_rate?: number;
  effective_rate?: number;
}

export interface AccountPricingAudit {
  id: string;
  account_service_setting_id: string | null;
  account_id: string;
  tenant_id: string;
  service_code: string;
  class_code: string | null;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  old_values: Record<string, any> | null;
  new_values: Record<string, any> | null;
  changed_by: string | null;
  changed_at: string;
  changed_fields?: string[];
  user?: {
    first_name: string;
    last_name: string;
  };
}

export interface CreateAdjustmentInput {
  service_code: string;
  class_code: string | null;
  adjustment_type: 'fixed' | 'percentage' | 'override';
  adjustment_value: number;
  notes?: string;
}

export function useAccountPricing(accountId: string | null) {
  const { profile } = useAuth();
  const { toast } = useToast();

  const [adjustments, setAdjustments] = useState<AccountServiceSetting[]>([]);
  const [availableServices, setAvailableServices] = useState<ServiceEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Fetch all adjustments for this account
  const fetchAdjustments = useCallback(async () => {
    if (!accountId || !profile?.tenant_id) {
      setAdjustments([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      // Fetch account service settings
      const { data: settings, error: settingsError } = await (supabase
        .from('account_service_settings') as any)
        .select('*')
        .eq('account_id', accountId)
        .eq('tenant_id', profile.tenant_id)
        .order('service_code');

      if (settingsError) throw settingsError;

      // Fetch corresponding service events to get base rates
      const { data: services, error: servicesError } = await (supabase
        .from('service_events') as any)
        .select('id, service_code, service_name, class_code, rate, billing_unit, billing_trigger, is_active')
        .eq('tenant_id', profile.tenant_id)
        .eq('is_active', true);

      if (servicesError) throw servicesError;

      // Create lookup map for services
      const serviceMap = new Map<string, ServiceEvent>();
      for (const service of services || []) {
        const key = `${service.service_code}|${service.class_code || ''}`;
        serviceMap.set(key, service);
      }

      // Enrich adjustments with service data and calculated effective rate
      const enrichedAdjustments: AccountServiceSetting[] = (settings || []).map((setting: any) => {
        const key = `${setting.service_code}|${setting.class_code || ''}`;
        const serviceEvent = serviceMap.get(key);
        const baseRate = serviceEvent?.rate || 0;

        // Determine adjustment type from stored values
        let adjustmentType: 'fixed' | 'percentage' | 'override' = 'override';
        let effectiveRate = baseRate;

        if (setting.custom_percent_adjust !== null && setting.custom_percent_adjust !== 0) {
          adjustmentType = 'percentage';
          effectiveRate = baseRate * (1 + setting.custom_percent_adjust / 100);
        } else if (setting.custom_rate !== null) {
          // Check if it's an override or fixed adjustment
          // If custom_rate equals some value that could be base + adjustment, it's fixed
          // Otherwise it's an override. For simplicity, we'll treat custom_rate as override
          adjustmentType = 'override';
          effectiveRate = setting.custom_rate;
        }

        return {
          ...setting,
          adjustment_type: adjustmentType,
          service_event: serviceEvent,
          base_rate: baseRate,
          effective_rate: effectiveRate,
        };
      });

      setAdjustments(enrichedAdjustments);
    } catch (error) {
      console.error('[useAccountPricing] Error fetching adjustments:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to load pricing adjustments',
      });
    } finally {
      setLoading(false);
    }
  }, [accountId, profile?.tenant_id, toast]);

  // Fetch available services for creating adjustments
  const fetchAvailableServices = useCallback(async () => {
    if (!profile?.tenant_id) {
      setAvailableServices([]);
      return;
    }

    try {
      const { data, error } = await (supabase
        .from('service_events') as any)
        .select('id, service_code, service_name, class_code, rate, billing_unit, billing_trigger, is_active')
        .eq('tenant_id', profile.tenant_id)
        .eq('is_active', true)
        .order('service_code')
        .order('class_code');

      if (error) throw error;
      setAvailableServices(data || []);
    } catch (error) {
      console.error('[useAccountPricing] Error fetching services:', error);
    }
  }, [profile?.tenant_id]);

  // Create new adjustments
  const createAdjustments = async (inputs: CreateAdjustmentInput[]): Promise<boolean> => {
    if (!accountId || !profile?.tenant_id || inputs.length === 0) return false;

    setSaving(true);
    try {
      const inserts = inputs.map((input) => {
        let custom_rate: number | null = null;
        let custom_percent_adjust: number | null = null;

        // Find the base rate for this service
        const service = availableServices.find(
          (s) => s.service_code === input.service_code && s.class_code === input.class_code
        );
        const baseRate = service?.rate || 0;

        switch (input.adjustment_type) {
          case 'fixed':
            // Fixed adjustment: store as custom_rate = base + adjustment
            custom_rate = baseRate + input.adjustment_value;
            break;
          case 'percentage':
            // Percentage adjustment
            custom_percent_adjust = input.adjustment_value;
            break;
          case 'override':
            // Direct override
            custom_rate = input.adjustment_value;
            break;
        }

        return {
          account_id: accountId,
          tenant_id: profile.tenant_id,
          service_code: input.service_code,
          class_code: input.class_code,
          custom_rate,
          custom_percent_adjust,
          notes: input.notes || null,
          is_active: true,
        };
      });

      const { error } = await (supabase
        .from('account_service_settings') as any)
        .insert(inserts);

      if (error) throw error;

      toast({
        title: 'Adjustments Created',
        description: `Created ${inputs.length} pricing adjustment${inputs.length !== 1 ? 's' : ''}`,
      });

      await fetchAdjustments();
      return true;
    } catch (error: any) {
      console.error('[useAccountPricing] Error creating adjustments:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'Failed to create adjustments',
      });
      return false;
    } finally {
      setSaving(false);
    }
  };

  // Update an existing adjustment
  const updateAdjustment = async (
    id: string,
    adjustment_type: 'fixed' | 'percentage' | 'override',
    adjustment_value: number,
    notes?: string
  ): Promise<boolean> => {
    if (!profile?.tenant_id) return false;

    setSaving(true);
    try {
      // Find the current adjustment to get service info
      const current = adjustments.find((a) => a.id === id);
      if (!current) throw new Error('Adjustment not found');

      let custom_rate: number | null = null;
      let custom_percent_adjust: number | null = null;
      const baseRate = current.base_rate || 0;

      switch (adjustment_type) {
        case 'fixed':
          custom_rate = baseRate + adjustment_value;
          break;
        case 'percentage':
          custom_percent_adjust = adjustment_value;
          break;
        case 'override':
          custom_rate = adjustment_value;
          break;
      }

      const { error } = await (supabase
        .from('account_service_settings') as any)
        .update({
          custom_rate,
          custom_percent_adjust,
          notes: notes || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);

      if (error) throw error;

      toast({
        title: 'Adjustment Updated',
        description: 'Pricing adjustment has been updated',
      });

      await fetchAdjustments();
      return true;
    } catch (error: any) {
      console.error('[useAccountPricing] Error updating adjustment:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'Failed to update adjustment',
      });
      return false;
    } finally {
      setSaving(false);
    }
  };

  // Delete an adjustment
  const deleteAdjustment = async (id: string): Promise<boolean> => {
    if (!profile?.tenant_id) return false;

    setSaving(true);
    try {
      const { error } = await (supabase
        .from('account_service_settings') as any)
        .delete()
        .eq('id', id);

      if (error) throw error;

      toast({
        title: 'Adjustment Deleted',
        description: 'Pricing adjustment has been removed',
      });

      await fetchAdjustments();
      return true;
    } catch (error: any) {
      console.error('[useAccountPricing] Error deleting adjustment:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'Failed to delete adjustment',
      });
      return false;
    } finally {
      setSaving(false);
    }
  };

  // Delete multiple adjustments
  const deleteAdjustments = async (ids: string[]): Promise<boolean> => {
    if (!profile?.tenant_id || ids.length === 0) return false;

    setSaving(true);
    try {
      const { error } = await (supabase
        .from('account_service_settings') as any)
        .delete()
        .in('id', ids);

      if (error) throw error;

      toast({
        title: 'Adjustments Deleted',
        description: `Removed ${ids.length} pricing adjustment${ids.length !== 1 ? 's' : ''}`,
      });

      await fetchAdjustments();
      return true;
    } catch (error: any) {
      console.error('[useAccountPricing] Error deleting adjustments:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'Failed to delete adjustments',
      });
      return false;
    } finally {
      setSaving(false);
    }
  };

  // Fetch audit history for this account
  const fetchAuditHistory = async (): Promise<AccountPricingAudit[]> => {
    if (!accountId || !profile?.tenant_id) return [];

    try {
      const { data, error } = await (supabase
        .from('account_service_settings_audit') as any)
        .select(`
          *,
          user:users(first_name, last_name)
        `)
        .eq('account_id', accountId)
        .eq('tenant_id', profile.tenant_id)
        .order('changed_at', { ascending: false })
        .limit(100);

      if (error) throw error;

      // Process audit records to determine changed fields
      return (data || []).map((audit: any) => {
        let changed_fields: string[] = [];
        if (audit.action === 'UPDATE' && audit.old_values && audit.new_values) {
          const oldVals = audit.old_values;
          const newVals = audit.new_values;
          changed_fields = Object.keys(newVals).filter(
            (key) => JSON.stringify(oldVals[key]) !== JSON.stringify(newVals[key])
          );
        }
        return { ...audit, changed_fields };
      });
    } catch (error) {
      console.error('[useAccountPricing] Error fetching audit history:', error);
      return [];
    }
  };

  // Check which services already have adjustments
  const getExistingServiceKeys = useCallback((): Set<string> => {
    const keys = new Set<string>();
    for (const adj of adjustments) {
      keys.add(`${adj.service_code}|${adj.class_code || ''}`);
    }
    return keys;
  }, [adjustments]);

  // Initial fetch
  useEffect(() => {
    fetchAdjustments();
    fetchAvailableServices();
  }, [fetchAdjustments, fetchAvailableServices]);

  return {
    adjustments,
    availableServices,
    loading,
    saving,
    refetch: fetchAdjustments,
    createAdjustments,
    updateAdjustment,
    deleteAdjustment,
    deleteAdjustments,
    fetchAuditHistory,
    getExistingServiceKeys,
  };
}
