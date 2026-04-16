/**
 * useCoverageSettings Hook
 * Resolves coverage rates and settings from tenant and account levels
 * Account settings override tenant settings when enabled
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useOrganizationClaimSettings, CoverageTypeValue } from './useOrganizationClaimSettings';

export interface CoverageRates {
  full_replacement_no_deductible_rate: number;
  full_replacement_deductible_rate: number;
  deductible_amount: number;
  default_coverage_type: CoverageTypeValue;
  coverage_enabled: boolean;
  allow_item_level_coverage: boolean;
  allow_shipment_level_coverage: boolean;
}

export interface AccountCoverageOverride {
  id?: string;
  account_id: string;
  override_enabled: boolean;
  full_replacement_no_deductible_rate?: number | null;
  full_replacement_deductible_rate?: number | null;
  deductible_amount?: number | null;
  default_coverage_type?: CoverageTypeValue | null;
}

interface UseCoverageSettingsOptions {
  accountId?: string | null;
}

export function useCoverageSettings(options: UseCoverageSettingsOptions = {}) {
  const { accountId } = options;
  const { profile } = useAuth();
  const { settings: tenantSettings, loading: tenantLoading } = useOrganizationClaimSettings();

  const [accountOverride, setAccountOverride] = useState<AccountCoverageOverride | null>(null);
  const [accountLoading, setAccountLoading] = useState(false);

  // Fetch account coverage override
  const fetchAccountOverride = useCallback(async () => {
    if (!accountId || !profile?.tenant_id) return;

    setAccountLoading(true);
    try {
      // Try to get from accounts.metadata.coverage_override
      const { data, error } = await supabase
        .from('accounts')
        .select('id, metadata')
        .eq('id', accountId)
        .single();

      if (error) throw error;

      const metadata = data?.metadata as Record<string, any> | null;
      if (metadata?.coverage_override) {
        setAccountOverride({
          account_id: accountId,
          ...metadata.coverage_override,
        });
      } else {
        setAccountOverride(null);
      }
    } catch (error) {
      console.error('Error fetching account coverage override:', error);
      setAccountOverride(null);
    } finally {
      setAccountLoading(false);
    }
  }, [accountId, profile?.tenant_id]);

  useEffect(() => {
    if (accountId) {
      fetchAccountOverride();
    }
  }, [fetchAccountOverride, accountId]);

  // Save account coverage override
  const saveAccountOverride = async (override: Partial<AccountCoverageOverride>): Promise<boolean> => {
    if (!accountId || !profile?.tenant_id) return false;

    try {
      // Get current metadata
      const { data: account, error: fetchError } = await supabase
        .from('accounts')
        .select('metadata')
        .eq('id', accountId)
        .single();

      if (fetchError) throw fetchError;

      const currentMetadata = (account?.metadata as Record<string, any>) || {};
      const newMetadata = {
        ...currentMetadata,
        coverage_override: {
          ...override,
          updated_at: new Date().toISOString(),
        },
      };

      const { error: updateError } = await supabase
        .from('accounts')
        .update({ metadata: newMetadata })
        .eq('id', accountId);

      if (updateError) throw updateError;

      setAccountOverride({
        account_id: accountId,
        ...override,
      } as AccountCoverageOverride);

      return true;
    } catch (error) {
      console.error('Error saving account coverage override:', error);
      return false;
    }
  };

  // Resolve effective coverage rates (account override takes precedence)
  const getEffectiveRates = (): CoverageRates => {
    const defaults: CoverageRates = {
      full_replacement_no_deductible_rate: tenantSettings?.full_replacement_no_deductible_rate ?? 0.0188,
      full_replacement_deductible_rate: tenantSettings?.full_replacement_deductible_rate ?? 0.0142,
      deductible_amount: tenantSettings?.deductible_amount ?? 300,
      default_coverage_type: tenantSettings?.default_coverage_type ?? 'standard',
      coverage_enabled: tenantSettings?.coverage_enabled ?? true,
      allow_item_level_coverage: tenantSettings?.allow_item_level_coverage ?? true,
      allow_shipment_level_coverage: tenantSettings?.allow_shipment_level_coverage ?? true,
    };

    // If no account override or override is not enabled, use tenant defaults
    if (!accountOverride?.override_enabled) {
      return defaults;
    }

    // Apply account overrides where present
    return {
      ...defaults,
      full_replacement_no_deductible_rate:
        accountOverride.full_replacement_no_deductible_rate ?? defaults.full_replacement_no_deductible_rate,
      full_replacement_deductible_rate:
        accountOverride.full_replacement_deductible_rate ?? defaults.full_replacement_deductible_rate,
      deductible_amount:
        accountOverride.deductible_amount ?? defaults.deductible_amount,
      default_coverage_type:
        accountOverride.default_coverage_type ?? defaults.default_coverage_type,
    };
  };

  // Calculate coverage cost for a given type and declared value
  const calculateCoverageCost = (
    coverageType: CoverageTypeValue | 'pending',
    declaredValue: number
  ): number => {
    const rates = getEffectiveRates();

    switch (coverageType) {
      case 'full_replacement_no_deductible':
        return declaredValue * rates.full_replacement_no_deductible_rate;
      case 'full_replacement_deductible':
        return declaredValue * rates.full_replacement_deductible_rate;
      case 'standard':
      case 'pending':
      default:
        return 0;
    }
  };

  // Get deductible amount for a coverage type
  const getDeductible = (coverageType: CoverageTypeValue | 'pending'): number => {
    const rates = getEffectiveRates();

    switch (coverageType) {
      case 'full_replacement_deductible':
        return rates.deductible_amount;
      case 'full_replacement_no_deductible':
      case 'standard':
      case 'pending':
      default:
        return 0;
    }
  };

  // Get coverage label
  const getCoverageLabel = (coverageType: CoverageTypeValue | 'pending' | null): string => {
    const rates = getEffectiveRates();

    switch (coverageType) {
      case 'full_replacement_no_deductible':
        return 'Full Replacement (No Deductible)';
      case 'full_replacement_deductible':
        return `Full Replacement ($${rates.deductible_amount} Deductible)`;
      case 'pending':
        return 'Pending';
      case 'standard':
      default:
        return 'Standard Coverage';
    }
  };

  return {
    loading: tenantLoading || accountLoading,
    tenantSettings,
    accountOverride,
    effectiveRates: getEffectiveRates(),
    calculateCoverageCost,
    getDeductible,
    getCoverageLabel,
    saveAccountOverride,
    refetchAccountOverride: fetchAccountOverride,
  };
}

// Map old coverage type values to new canonical values
export function normalizeCoverageType(
  type: string | null | undefined
): CoverageTypeValue | 'pending' {
  switch (type) {
    case 'full_no_deductible':
    case 'full_replacement_no_deductible':
      return 'full_replacement_no_deductible';
    case 'full_deductible':
    case 'full_replacement_deductible':
      return 'full_replacement_deductible';
    case 'pending':
      return 'pending';
    case 'standard':
    default:
      return 'standard';
  }
}
