import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

export interface AccountCoverageSettings {
  id: string;
  tenant_id: string;
  account_id: string;
  override_enabled: boolean;
  coverage_rate_full_no_deductible: number | null;
  coverage_rate_full_deductible: number | null;
  coverage_deductible_amount: number | null;
  default_coverage_type: 'standard' | 'full_replacement_no_deductible' | 'full_replacement_deductible' | null;
  created_at: string;
  updated_at: string;
}

export interface AccountCoverageSettingsUpdate {
  override_enabled?: boolean;
  coverage_rate_full_no_deductible?: number | null;
  coverage_rate_full_deductible?: number | null;
  coverage_deductible_amount?: number | null;
  default_coverage_type?: 'standard' | 'full_replacement_no_deductible' | 'full_replacement_deductible' | null;
}

export interface TenantCoverageDefaults {
  coverage_enabled: boolean;
  coverage_default_type: 'standard' | 'full_replacement_no_deductible' | 'full_replacement_deductible';
  coverage_rate_full_no_deductible: number;
  coverage_rate_full_deductible: number;
  coverage_deductible_amount: number;
}

export function useAccountCoverageSettings(accountId: string) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [settings, setSettings] = useState<AccountCoverageSettings | null>(null);
  const [tenantDefaults, setTenantDefaults] = useState<TenantCoverageDefaults | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchSettings = useCallback(async () => {
    if (!profile?.tenant_id || !accountId) return;

    try {
      setLoading(true);

      // Fetch tenant defaults first
      const { data: orgSettings, error: orgError } = await (supabase as any)
        .from('organization_claim_settings')
        .select('coverage_enabled, coverage_default_type, coverage_rate_full_no_deductible, coverage_rate_full_deductible, coverage_deductible_amount')
        .eq('tenant_id', profile.tenant_id)
        .maybeSingle();

      if (orgError) throw orgError;

      setTenantDefaults(orgSettings ? {
        coverage_enabled: orgSettings.coverage_enabled ?? true,
        coverage_default_type: orgSettings.coverage_default_type ?? 'standard',
        coverage_rate_full_no_deductible: orgSettings.coverage_rate_full_no_deductible ?? 0.0188,
        coverage_rate_full_deductible: orgSettings.coverage_rate_full_deductible ?? 0.0142,
        coverage_deductible_amount: orgSettings.coverage_deductible_amount ?? 300,
      } : {
        coverage_enabled: true,
        coverage_default_type: 'standard',
        coverage_rate_full_no_deductible: 0.0188,
        coverage_rate_full_deductible: 0.0142,
        coverage_deductible_amount: 300,
      });

      // Fetch account-specific settings
      const { data, error } = await (supabase as any)
        .from('account_coverage_settings')
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .eq('account_id', accountId)
        .maybeSingle();

      if (error) throw error;

      setSettings(data as AccountCoverageSettings | null);
    } catch (error) {
      console.error('Error fetching account coverage settings:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to load account coverage settings',
      });
    } finally {
      setLoading(false);
    }
  }, [profile?.tenant_id, accountId, toast]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const updateSettings = async (updates: AccountCoverageSettingsUpdate): Promise<boolean> => {
    if (!profile?.tenant_id || !accountId) return false;

    try {
      setSaving(true);

      if (settings) {
        // Update existing settings
        const { data, error } = await (supabase as any)
          .from('account_coverage_settings')
          .update({
            ...updates,
            updated_at: new Date().toISOString(),
            updated_by: profile.id,
          })
          .eq('id', settings.id)
          .select()
          .single();

        if (error) throw error;
        setSettings(data as AccountCoverageSettings);
      } else {
        // Create new settings
        const { data, error } = await (supabase as any)
          .from('account_coverage_settings')
          .insert({
            tenant_id: profile.tenant_id,
            account_id: accountId,
            ...updates,
            created_by: profile.id,
            updated_by: profile.id,
          })
          .select()
          .single();

        if (error) throw error;
        setSettings(data as AccountCoverageSettings);
      }

      toast({
        title: 'Settings Saved',
        description: 'Account coverage settings have been updated.',
      });
      return true;
    } catch (error) {
      console.error('Error updating account coverage settings:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to save account coverage settings',
      });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const deleteSettings = async (): Promise<boolean> => {
    if (!settings) return true;

    try {
      setSaving(true);
      const { error } = await (supabase as any)
        .from('account_coverage_settings')
        .delete()
        .eq('id', settings.id);

      if (error) throw error;

      setSettings(null);
      toast({
        title: 'Settings Removed',
        description: 'Account coverage override has been removed. Tenant defaults will be used.',
      });
      return true;
    } catch (error) {
      console.error('Error deleting account coverage settings:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to remove account coverage settings',
      });
      return false;
    } finally {
      setSaving(false);
    }
  };

  // Get effective rates (account override or tenant defaults)
  const getEffectiveRates = () => {
    if (settings?.override_enabled) {
      return {
        rate_full_no_deductible: settings.coverage_rate_full_no_deductible ?? tenantDefaults?.coverage_rate_full_no_deductible ?? 0.0188,
        rate_full_deductible: settings.coverage_rate_full_deductible ?? tenantDefaults?.coverage_rate_full_deductible ?? 0.0142,
        deductible_amount: settings.coverage_deductible_amount ?? tenantDefaults?.coverage_deductible_amount ?? 300,
        default_type: settings.default_coverage_type ?? tenantDefaults?.coverage_default_type ?? 'standard',
        source: 'account' as const,
      };
    }
    return {
      rate_full_no_deductible: tenantDefaults?.coverage_rate_full_no_deductible ?? 0.0188,
      rate_full_deductible: tenantDefaults?.coverage_rate_full_deductible ?? 0.0142,
      deductible_amount: tenantDefaults?.coverage_deductible_amount ?? 300,
      default_type: tenantDefaults?.coverage_default_type ?? 'standard',
      source: 'tenant' as const,
    };
  };

  return {
    settings,
    tenantDefaults,
    loading,
    saving,
    updateSettings,
    deleteSettings,
    getEffectiveRates,
    refetch: fetchSettings,
  };
}
