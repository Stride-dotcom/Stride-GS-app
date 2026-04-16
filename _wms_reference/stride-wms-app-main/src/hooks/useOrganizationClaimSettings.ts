import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

export type CoverageTypeValue = 'standard' | 'full_replacement_no_deductible' | 'full_replacement_deductible';

export interface OrganizationClaimSettings {
  id: string;
  tenant_id: string;
  approval_threshold_amount: number;
  approval_required_above_threshold: boolean;
  default_payout_method: 'credit' | 'check' | 'ach';
  settlement_terms_template: string | null;
  acceptance_token_expiry_days: number;
  auto_create_repair_task: boolean;
  // Valuation Coverage Settings
  coverage_enabled: boolean;
  coverage_default_type: CoverageTypeValue;
  coverage_rate_full_no_deductible: number;
  coverage_rate_full_deductible: number;
  coverage_deductible_amount: number;
  coverage_allow_shipment: boolean;
  coverage_allow_item: boolean;
  coverage_display_name: string;
  coverage_rate_standard: number;
  // Aliases for AccountCoverageOverrideSection compatibility
  full_replacement_no_deductible_rate: number;
  full_replacement_deductible_rate: number;
  deductible_amount: number;
  default_coverage_type: CoverageTypeValue;
  allow_item_level_coverage: boolean;
  allow_shipment_level_coverage: boolean;
  // Claim Assistance Settings (for shipping_damage claims)
  enable_claim_assistance: boolean;
  claim_assistance_flat_fee: number;
  // AI Analysis Settings
  enable_ai_analysis: boolean;
  auto_approval_threshold: number;
  // SLA Settings
  enable_sla_tracking: boolean;
  sla_ack_minutes: number;
  sla_initial_review_business_hours: number;
  sla_manual_review_business_hours: number;
  sla_auto_approved_payout_hours: number;
  sla_shipping_damage_packet_business_hours: number;
  sla_public_report_business_hours: number;
  sla_missing_docs_pause: boolean;
  created_at: string;
  updated_at: string;
}

export interface OrganizationClaimSettingsUpdate {
  approval_threshold_amount?: number;
  approval_required_above_threshold?: boolean;
  default_payout_method?: 'credit' | 'check' | 'ach';
  settlement_terms_template?: string | null;
  acceptance_token_expiry_days?: number;
  auto_create_repair_task?: boolean;
  // Valuation Coverage Settings
  coverage_enabled?: boolean;
  coverage_default_type?: 'standard' | 'full_replacement_no_deductible' | 'full_replacement_deductible';
  coverage_rate_full_no_deductible?: number;
  coverage_rate_full_deductible?: number;
  coverage_deductible_amount?: number;
  coverage_allow_shipment?: boolean;
  coverage_allow_item?: boolean;
  coverage_display_name?: string;
  coverage_rate_standard?: number;
  // Claim Assistance Settings
  enable_claim_assistance?: boolean;
  claim_assistance_flat_fee?: number;
  // AI Analysis Settings
  enable_ai_analysis?: boolean;
  auto_approval_threshold?: number;
  // SLA Settings
  enable_sla_tracking?: boolean;
  sla_ack_minutes?: number;
  sla_initial_review_business_hours?: number;
  sla_manual_review_business_hours?: number;
  sla_auto_approved_payout_hours?: number;
  sla_shipping_damage_packet_business_hours?: number;
  sla_public_report_business_hours?: number;
  sla_missing_docs_pause?: boolean;
}

const DEFAULT_SETTINGS: Omit<OrganizationClaimSettings, 'id' | 'tenant_id' | 'created_at' | 'updated_at'> = {
  approval_threshold_amount: 1000,
  approval_required_above_threshold: true,
  default_payout_method: 'credit',
  settlement_terms_template: null,
  acceptance_token_expiry_days: 30,
  auto_create_repair_task: true,
  // Valuation Coverage Defaults
  coverage_enabled: true,
  coverage_default_type: 'standard',
  coverage_rate_full_no_deductible: 0.0188,
  coverage_rate_full_deductible: 0.0142,
  coverage_deductible_amount: 300,
  coverage_allow_shipment: true,
  coverage_allow_item: true,
  coverage_display_name: 'Valuation',
  coverage_rate_standard: 0.60,
  // Aliases for AccountCoverageOverrideSection compatibility
  full_replacement_no_deductible_rate: 0.0188,
  full_replacement_deductible_rate: 0.0142,
  deductible_amount: 300,
  default_coverage_type: 'standard',
  allow_item_level_coverage: true,
  allow_shipment_level_coverage: true,
  // Claim Assistance Defaults
  enable_claim_assistance: true,
  claim_assistance_flat_fee: 150.00,
  // AI Analysis Defaults
  enable_ai_analysis: true,
  auto_approval_threshold: 1000.00,
  // SLA Defaults
  enable_sla_tracking: true,
  sla_ack_minutes: 0,
  sla_initial_review_business_hours: 8,
  sla_manual_review_business_hours: 16,
  sla_auto_approved_payout_hours: 24,
  sla_shipping_damage_packet_business_hours: 16,
  sla_public_report_business_hours: 24,
  sla_missing_docs_pause: true,
};

const DEFAULT_TERMS_TEMPLATE = `By accepting this settlement, you acknowledge and agree that:

1. The payment represents the complete and final settlement of this claim.
2. You release the warehouse, its employees, agents, and affiliates from any and all claims, demands, damages, actions, or causes of action arising from or related to the items and/or property described in this claim.
3. The warehouse shall have no further liability, obligation, or responsibility regarding the items or property covered by this claim.
4. You waive any right to pursue additional compensation or make future claims related to the items, property, or incidents described herein.
5. You confirm that you have read and understand these terms, and are accepting this settlement voluntarily.`;

export function useOrganizationClaimSettings() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [settings, setSettings] = useState<OrganizationClaimSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchSettings = useCallback(async () => {
    if (!profile?.tenant_id) return;

    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('organization_claim_settings')
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        // Merge data with alias mappings for compatibility
        const mergedData = {
          ...data,
          full_replacement_no_deductible_rate: data.coverage_rate_full_no_deductible ?? 0.0188,
          full_replacement_deductible_rate: data.coverage_rate_full_deductible ?? 0.0142,
          deductible_amount: data.coverage_deductible_amount ?? 300,
          default_coverage_type: data.coverage_default_type ?? 'standard',
          allow_item_level_coverage: data.coverage_allow_item ?? true,
          allow_shipment_level_coverage: data.coverage_allow_shipment ?? true,
        };
        setSettings(mergedData as OrganizationClaimSettings);
      } else {
        // Create default settings if none exist
        const { data: newSettings, error: insertError } = await supabase
          .from('organization_claim_settings')
          .insert({
            tenant_id: profile.tenant_id,
            ...DEFAULT_SETTINGS,
            settlement_terms_template: DEFAULT_TERMS_TEMPLATE,
          })
          .select()
          .single();

        if (insertError) throw insertError;
        // Merge newSettings with alias mappings
        const mergedNewSettings = {
          ...newSettings,
          full_replacement_no_deductible_rate: newSettings.coverage_rate_full_no_deductible ?? 0.0188,
          full_replacement_deductible_rate: newSettings.coverage_rate_full_deductible ?? 0.0142,
          deductible_amount: newSettings.coverage_deductible_amount ?? 300,
          default_coverage_type: newSettings.coverage_default_type ?? 'standard',
          allow_item_level_coverage: newSettings.coverage_allow_item ?? true,
          allow_shipment_level_coverage: newSettings.coverage_allow_shipment ?? true,
        };
        setSettings(mergedNewSettings as OrganizationClaimSettings);
      }
    } catch (error) {
      console.error('Error fetching claim settings:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to load claim settings',
      });
    } finally {
      setLoading(false);
    }
  }, [profile?.tenant_id, toast]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const updateSettings = async (updates: OrganizationClaimSettingsUpdate): Promise<boolean> => {
    if (!profile?.tenant_id || !settings) return false;

    try {
      setSaving(true);
      const { data, error } = await supabase
        .from('organization_claim_settings')
        .update(updates)
        .eq('tenant_id', profile.tenant_id)
        .select()
        .single();

      if (error) throw error;

      // Merge data with alias mappings for compatibility
      const mergedData = {
        ...data,
        full_replacement_no_deductible_rate: data.coverage_rate_full_no_deductible ?? 0.0188,
        full_replacement_deductible_rate: data.coverage_rate_full_deductible ?? 0.0142,
        deductible_amount: data.coverage_deductible_amount ?? 300,
        default_coverage_type: data.coverage_default_type ?? 'standard',
        allow_item_level_coverage: data.coverage_allow_item ?? true,
        allow_shipment_level_coverage: data.coverage_allow_shipment ?? true,
      };
      setSettings(mergedData as OrganizationClaimSettings);
      toast({
        title: 'Settings Saved',
        description: 'Claim settings have been updated.',
      });
      return true;
    } catch (error) {
      console.error('Error updating claim settings:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to save claim settings',
      });
      return false;
    } finally {
      setSaving(false);
    }
  };

  // Helper to get settings with defaults
  const getSettings = (): OrganizationClaimSettings => {
    if (settings) return settings;
    return {
      id: '',
      tenant_id: profile?.tenant_id || '',
      ...DEFAULT_SETTINGS,
      settlement_terms_template: DEFAULT_TERMS_TEMPLATE,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  };

  return {
    settings: getSettings(),
    loading,
    saving,
    updateSettings,
    refetch: fetchSettings,
  };
}
