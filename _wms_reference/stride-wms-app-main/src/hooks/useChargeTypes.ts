/**
 * useChargeTypes - Hook for managing charge types and pricing rules
 *
 * This hook provides CRUD operations for the new pricing system.
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';

// =============================================================================
// TYPES
// =============================================================================

export interface ChargeType {
  id: string;
  tenant_id: string;
  charge_code: string;
  charge_name: string;
  category: string;
  is_active: boolean;
  is_taxable: boolean;
  default_trigger: 'manual' | 'task' | 'shipment' | 'storage' | 'auto';
  input_mode: 'qty' | 'time' | 'both';
  qty_step: number | null;
  min_qty: number | null;
  time_unit_default: string | null;
  min_minutes: number | null;
  add_to_scan: boolean;
  add_flag: boolean;
  flag_is_indicator: boolean;
  alert_rule: string | null;
  notes: string | null;
  legacy_service_code: string | null;
  created_at: string;
  updated_at: string;
}

export interface PricingRule {
  id: string;
  tenant_id: string;
  charge_type_id: string;
  pricing_method: 'flat' | 'class_based' | 'tiered';
  class_code: string | null;
  unit: string;
  rate: number;
  minimum_charge: number | null;
  is_default: boolean;
  service_time_minutes: number | null;
  created_at: string;
  updated_at: string;
}

export interface ChargeTypeWithRules extends ChargeType {
  pricing_rules: PricingRule[];
}

export interface CreateChargeTypeInput {
  charge_code: string;
  charge_name: string;
  category?: string;
  is_active?: boolean;
  is_taxable?: boolean;
  default_trigger?: 'manual' | 'task' | 'shipment' | 'storage' | 'auto';
  input_mode?: 'qty' | 'time' | 'both';
  qty_step?: number;
  min_qty?: number;
  time_unit_default?: string;
  min_minutes?: number;
  add_to_scan?: boolean;
  add_flag?: boolean;
  flag_is_indicator?: boolean;
  alert_rule?: string;
  notes?: string;
}

export interface UpdateChargeTypeInput extends Partial<CreateChargeTypeInput> {
  id: string;
}

export interface CreatePricingRuleInput {
  charge_type_id: string;
  pricing_method?: 'flat' | 'class_based' | 'tiered';
  class_code?: string | null;
  unit?: string;
  rate: number;
  minimum_charge?: number;
  is_default?: boolean;
  service_time_minutes?: number;
}

export interface UpdatePricingRuleInput extends Partial<CreatePricingRuleInput> {
  id: string;
}

// =============================================================================
// CONSTANTS
// =============================================================================

// FALLBACK ONLY — prefer useServiceCategories() for tenant-specific categories
export const CHARGE_CATEGORIES = [
  { value: 'receiving', label: 'Receiving' },
  { value: 'storage', label: 'Storage' },
  { value: 'handling', label: 'Handling' },
  { value: 'task', label: 'Task/Labor' },
  { value: 'shipping', label: 'Shipping' },
  { value: 'service', label: 'Service' },
] as const;

export const TRIGGER_OPTIONS = [
  { value: 'manual', label: 'Manual' },
  { value: 'task', label: 'Task Completion' },
  { value: 'shipment', label: 'Shipment' },
  { value: 'storage', label: 'Storage (Auto)' },
  { value: 'auto', label: 'Auto Calculate' },
] as const;

export const INPUT_MODE_OPTIONS = [
  { value: 'qty', label: 'Quantity' },
  { value: 'time', label: 'Time' },
  { value: 'both', label: 'Both' },
] as const;

export const UNIT_OPTIONS = [
  { value: 'each', label: 'Each / Qty' },
  { value: 'per_item', label: 'Per Item' },
  { value: 'per_task', label: 'Per Task' },
  { value: 'per_hour', label: 'Per Hour' },
  { value: 'per_minute', label: 'Per Minute' },
  { value: 'per_day', label: 'Per Day' },
  { value: 'per_month', label: 'Per Month' },
] as const;

export const PRICING_METHOD_OPTIONS = [
  { value: 'flat', label: 'Flat Rate' },
  { value: 'class_based', label: 'Class-Based' },
  { value: 'tiered', label: 'Tiered' },
] as const;

// DEPRECATED: Class codes should come from useClasses() hook, not hardcoded here
// Kept as fallback for any code that still references it
export const CLASS_CODES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'] as const;

// =============================================================================
// HOOK
// =============================================================================

export function useChargeTypes() {
  const [chargeTypes, setChargeTypes] = useState<ChargeType[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { profile } = useAuth();

  // Fetch all charge types
  const fetchChargeTypes = useCallback(async () => {
    if (!profile?.tenant_id) {
      setChargeTypes([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      const { data, error } = await supabase
        .from('charge_types')
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .order('charge_name');

      if (error) {
        // Table might not exist yet
        if (error.code === '42P01') {
          setChargeTypes([]);
          return;
        }
        throw error;
      }

      setChargeTypes((data || []) as unknown as ChargeType[]);
    } catch (error: any) {
      console.error('[useChargeTypes] Fetch failed:', error);
      toast({
        variant: 'destructive',
        title: 'Error loading charge types',
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  }, [profile?.tenant_id, toast]);

  useEffect(() => {
    fetchChargeTypes();
  }, [fetchChargeTypes]);

  // Create charge type
  const createChargeType = useCallback(async (input: CreateChargeTypeInput): Promise<ChargeType | null> => {
    if (!profile?.tenant_id) {
      toast({ variant: 'destructive', title: 'Error', description: 'Not authenticated' });
      return null;
    }

    try {
      const { data, error } = await supabase
        .from('charge_types')
        .insert({
          tenant_id: profile.tenant_id,
          charge_code: input.charge_code,
          charge_name: input.charge_name,
          category: input.category || 'service',
          is_active: input.is_active ?? true,
          is_taxable: input.is_taxable ?? false,
          default_trigger: input.default_trigger || 'manual',
          input_mode: input.input_mode || 'qty',
          qty_step: input.qty_step,
          min_qty: input.min_qty,
          time_unit_default: input.time_unit_default,
          min_minutes: input.min_minutes,
          add_to_scan: input.add_to_scan ?? false,
          add_flag: input.add_flag ?? false,
          flag_is_indicator: input.flag_is_indicator ?? false,
          alert_rule: input.alert_rule || 'none',
          notes: input.notes,
        })
        .select()
        .single();

      if (error) throw error;

      toast({ title: 'Charge type created', description: `Created ${input.charge_name}` });
      await fetchChargeTypes();
      return data as unknown as ChargeType;
    } catch (error: any) {
      console.error('[useChargeTypes] Create failed:', error);
      toast({
        variant: 'destructive',
        title: 'Failed to create charge type',
        description: error.message,
      });
      return null;
    }
  }, [profile, toast, fetchChargeTypes]);

  // Update charge type
  const updateChargeType = useCallback(async (input: UpdateChargeTypeInput): Promise<boolean> => {
    try {
      const { id, ...updates } = input;

      const { error } = await supabase
        .from('charge_types')
        .update(updates)
        .eq('id', id);

      if (error) throw error;

      toast({ title: 'Charge type updated' });
      await fetchChargeTypes();
      return true;
    } catch (error: any) {
      console.error('[useChargeTypes] Update failed:', error);
      toast({
        variant: 'destructive',
        title: 'Failed to update charge type',
        description: error.message,
      });
      return false;
    }
  }, [toast, fetchChargeTypes]);

  // Delete charge type
  const deleteChargeType = useCallback(async (id: string): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from('charge_types')
        .delete()
        .eq('id', id);

      if (error) throw error;

      toast({ title: 'Charge type deleted' });
      await fetchChargeTypes();
      return true;
    } catch (error: any) {
      console.error('[useChargeTypes] Delete failed:', error);
      toast({
        variant: 'destructive',
        title: 'Failed to delete charge type',
        description: error.message,
      });
      return false;
    }
  }, [toast, fetchChargeTypes]);

  const isCodeUnique = useCallback((code: string, excludeId?: string): boolean => {
    return !chargeTypes.some(ct => ct.charge_code === code && ct.id !== excludeId);
  }, [chargeTypes]);

  return {
    chargeTypes,
    loading,
    refetch: fetchChargeTypes,
    createChargeType,
    updateChargeType,
    deleteChargeType,
    isCodeUnique,
  };
}


// =============================================================================
// PRICING RULES HOOK
// =============================================================================

export function usePricingRules(chargeTypeId?: string) {
  const [pricingRules, setPricingRules] = useState<PricingRule[]>([]);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const { profile } = useAuth();

  // Fetch pricing rules for a charge type
  const fetchPricingRules = useCallback(async (ctId?: string) => {
    const targetId = ctId || chargeTypeId;
    if (!targetId) {
      setPricingRules([]);
      return;
    }

    try {
      setLoading(true);

      const { data, error } = await supabase
        .from('pricing_rules')
        .select('*')
        .eq('charge_type_id', targetId)
        .order('class_code', { ascending: true, nullsFirst: true });

      if (error) {
        if (error.code === '42P01') {
          setPricingRules([]);
          return;
        }
        throw error;
      }

      setPricingRules((data || []) as PricingRule[]);
    } catch (error: any) {
      console.error('[usePricingRules] Fetch failed:', error);
      toast({
        variant: 'destructive',
        title: 'Error loading pricing rules',
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  }, [chargeTypeId, toast]);

  useEffect(() => {
    if (chargeTypeId) {
      fetchPricingRules();
    }
  }, [chargeTypeId, fetchPricingRules]);

  // Create pricing rule
  const createPricingRule = useCallback(async (input: CreatePricingRuleInput): Promise<PricingRule | null> => {
    if (!profile?.tenant_id) {
      toast({ variant: 'destructive', title: 'Error', description: 'Not authenticated' });
      return null;
    }

    try {
      const { data, error } = await supabase
        .from('pricing_rules')
        .insert({
          tenant_id: profile.tenant_id,
          charge_type_id: input.charge_type_id,
          pricing_method: input.pricing_method || 'flat',
          class_code: input.class_code || null,
          unit: input.unit || 'each',
          rate: input.rate,
          minimum_charge: input.minimum_charge,
          is_default: input.is_default ?? false,
          service_time_minutes: input.service_time_minutes,
        })
        .select()
        .single();

      if (error) throw error;

      toast({ title: 'Pricing rule created' });
      await fetchPricingRules(input.charge_type_id);
      return data as PricingRule;
    } catch (error: any) {
      console.error('[usePricingRules] Create failed:', error);
      toast({
        variant: 'destructive',
        title: 'Failed to create pricing rule',
        description: error.message,
      });
      return null;
    }
  }, [profile, toast, fetchPricingRules]);

  // Update pricing rule
  const updatePricingRule = useCallback(async (input: UpdatePricingRuleInput): Promise<boolean> => {
    try {
      const { id, ...updates } = input;

      const { error } = await supabase
        .from('pricing_rules')
        .update(updates)
        .eq('id', id);

      if (error) throw error;

      toast({ title: 'Pricing rule updated' });
      if (input.charge_type_id) {
        await fetchPricingRules(input.charge_type_id);
      }
      return true;
    } catch (error: any) {
      console.error('[usePricingRules] Update failed:', error);
      toast({
        variant: 'destructive',
        title: 'Failed to update pricing rule',
        description: error.message,
      });
      return false;
    }
  }, [toast, fetchPricingRules]);

  // Delete pricing rule
  const deletePricingRule = useCallback(async (id: string, chargeTypeIdForRefresh?: string): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from('pricing_rules')
        .delete()
        .eq('id', id);

      if (error) throw error;

      toast({ title: 'Pricing rule deleted' });
      if (chargeTypeIdForRefresh) {
        await fetchPricingRules(chargeTypeIdForRefresh);
      }
      return true;
    } catch (error: any) {
      console.error('[usePricingRules] Delete failed:', error);
      toast({
        variant: 'destructive',
        title: 'Failed to delete pricing rule',
        description: error.message,
      });
      return false;
    }
  }, [toast, fetchPricingRules]);

  return {
    pricingRules,
    loading,
    refetch: fetchPricingRules,
    createPricingRule,
    updatePricingRule,
    deletePricingRule,
  };
}


// =============================================================================
// COMBINED HOOK FOR CHARGE TYPES WITH RULES
// =============================================================================

export function useChargeTypesWithRules() {
  const [chargeTypesWithRules, setChargeTypesWithRules] = useState<ChargeTypeWithRules[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { profile } = useAuth();

  const fetchAll = useCallback(async () => {
    if (!profile?.tenant_id) {
      setChargeTypesWithRules([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      // Fetch charge types
      const { data: chargeTypes, error: ctError } = await supabase
        .from('charge_types')
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .order('charge_name');

      if (ctError) {
        if (ctError.code === '42P01') {
          setChargeTypesWithRules([]);
          return;
        }
        throw ctError;
      }

      if (!chargeTypes || chargeTypes.length === 0) {
        setChargeTypesWithRules([]);
        return;
      }

      // Fetch all pricing rules
      const chargeTypeIds = chargeTypes.map(ct => ct.id);
      const { data: pricingRules, error: prError } = await supabase
        .from('pricing_rules')
        .select('*')
        .in('charge_type_id', chargeTypeIds);

      if (prError && prError.code !== '42P01') {
        throw prError;
      }

      // Combine
      const combined: ChargeTypeWithRules[] = (chargeTypes as unknown as ChargeType[]).map(ct => ({
        ...ct,
        pricing_rules: ((pricingRules || []) as PricingRule[]).filter(pr => pr.charge_type_id === ct.id),
      }));

      setChargeTypesWithRules(combined);
    } catch (error: any) {
      console.error('[useChargeTypesWithRules] Fetch failed:', error);
      toast({
        variant: 'destructive',
        title: 'Error loading pricing data',
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  }, [profile?.tenant_id, toast]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  return {
    chargeTypesWithRules,
    loading,
    refetch: fetchAll,
  };
}
