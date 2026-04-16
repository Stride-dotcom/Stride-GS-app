/**
 * usePromoCodes - Hook for managing promo codes
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';

export type DiscountType = 'percentage' | 'flat_rate';
export type ExpirationType = 'none' | 'date';
export type ServiceScopeType = 'all' | 'selected';
export type UsageLimitType = 'unlimited' | 'limited';

export interface PromoCode {
  id: string;
  code: string;
  discount_type: DiscountType;
  discount_value: number;
  expiration_type: ExpirationType;
  expiration_date: string | null;
  service_scope: ServiceScopeType;
  selected_services: string[] | null;
  usage_limit_type: UsageLimitType;
  usage_limit: number | null;
  usage_count: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  tenant_id: string;
}

export interface PromoCodeInput {
  code: string;
  discount_type: DiscountType;
  discount_value: number;
  expiration_type: ExpirationType;
  expiration_date?: string | null;
  service_scope: ServiceScopeType;
  selected_services?: string[] | null;
  usage_limit_type: UsageLimitType;
  usage_limit?: number | null;
  is_active?: boolean;
}

export function usePromoCodes() {
  const [promoCodes, setPromoCodes] = useState<PromoCode[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { profile } = useAuth();

  const fetchPromoCodes = useCallback(async () => {
    if (!profile?.tenant_id) {
      setPromoCodes([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const { data, error } = await (supabase
        .from('promo_codes') as any)
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setPromoCodes(data || []);
    } catch (error: any) {
      console.error('[usePromoCodes] Fetch error:', error);
      toast({
        variant: 'destructive',
        title: 'Error loading promo codes',
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  }, [profile?.tenant_id, toast]);

  useEffect(() => {
    fetchPromoCodes();
  }, [fetchPromoCodes]);

  const createPromoCode = useCallback(async (input: PromoCodeInput): Promise<PromoCode | null> => {
    if (!profile?.tenant_id || !profile?.id) {
      toast({ variant: 'destructive', title: 'Error', description: 'Not authenticated' });
      return null;
    }

    try {
      const { data, error } = await (supabase
        .from('promo_codes') as any)
        .insert({
          tenant_id: profile.tenant_id,
          created_by: profile.id,
          code: input.code.toUpperCase().trim(),
          discount_type: input.discount_type,
          discount_value: input.discount_value,
          expiration_type: input.expiration_type,
          expiration_date: input.expiration_type === 'date' ? input.expiration_date : null,
          service_scope: input.service_scope,
          selected_services: input.service_scope === 'selected' ? input.selected_services : null,
          usage_limit_type: input.usage_limit_type,
          usage_limit: input.usage_limit_type === 'limited' ? input.usage_limit : null,
          is_active: input.is_active ?? true,
        })
        .select()
        .single();

      if (error) {
        if (error.code === '23505') {
          toast({ variant: 'destructive', title: 'Error', description: 'A promo code with this code already exists' });
          return null;
        }
        throw error;
      }

      toast({ title: 'Promo code created' });
      await fetchPromoCodes();
      return data;
    } catch (error: any) {
      console.error('[usePromoCodes] Create error:', error);
      toast({ variant: 'destructive', title: 'Error', description: error.message });
      return null;
    }
  }, [profile?.tenant_id, profile?.id, toast, fetchPromoCodes]);

  const updatePromoCode = useCallback(async (id: string, input: Partial<PromoCodeInput>): Promise<boolean> => {
    try {
      const updateData: any = { ...input };

      // Handle conditional fields
      if (input.code) updateData.code = input.code.toUpperCase().trim();
      if (input.expiration_type === 'none') updateData.expiration_date = null;
      if (input.service_scope === 'all') updateData.selected_services = null;
      if (input.usage_limit_type === 'unlimited') updateData.usage_limit = null;

      const { error } = await (supabase
        .from('promo_codes') as any)
        .update(updateData)
        .eq('id', id);

      if (error) {
        if (error.code === '23505') {
          toast({ variant: 'destructive', title: 'Error', description: 'A promo code with this code already exists' });
          return false;
        }
        throw error;
      }

      toast({ title: 'Promo code updated' });
      await fetchPromoCodes();
      return true;
    } catch (error: any) {
      console.error('[usePromoCodes] Update error:', error);
      toast({ variant: 'destructive', title: 'Error', description: error.message });
      return false;
    }
  }, [toast, fetchPromoCodes]);

  const deletePromoCode = useCallback(async (id: string): Promise<boolean> => {
    try {
      // Soft delete
      const { error } = await (supabase
        .from('promo_codes') as any)
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;

      toast({ title: 'Promo code deleted' });
      await fetchPromoCodes();
      return true;
    } catch (error: any) {
      console.error('[usePromoCodes] Delete error:', error);
      toast({ variant: 'destructive', title: 'Error', description: error.message });
      return false;
    }
  }, [toast, fetchPromoCodes]);

  const toggleActive = useCallback(async (id: string, isActive: boolean): Promise<boolean> => {
    try {
      const { error } = await (supabase
        .from('promo_codes') as any)
        .update({ is_active: isActive })
        .eq('id', id);

      if (error) throw error;

      toast({ title: isActive ? 'Promo code activated' : 'Promo code deactivated' });
      await fetchPromoCodes();
      return true;
    } catch (error: any) {
      console.error('[usePromoCodes] Toggle error:', error);
      toast({ variant: 'destructive', title: 'Error', description: error.message });
      return false;
    }
  }, [toast, fetchPromoCodes]);

  return {
    promoCodes,
    loading,
    refetch: fetchPromoCodes,
    createPromoCode,
    updatePromoCode,
    deletePromoCode,
    toggleActive,
  };
}
