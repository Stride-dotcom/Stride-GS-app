/**
 * useAccountPromoCodes - Hook for managing promo codes assigned to an account
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';

export interface AccountPromoCode {
  id: string;
  promo_code_id: string;
  assigned_at: string;
  assigned_by: string | null;
  notes: string | null;
  // Joined promo code fields
  promo_code: {
    id: string;
    code: string;
    discount_type: 'percentage' | 'flat_rate';
    discount_value: number;
    expiration_type: 'none' | 'date';
    expiration_date: string | null;
    service_scope: 'all' | 'selected';
    selected_services: string[] | null;
    usage_limit_type: 'unlimited' | 'limited';
    usage_limit: number | null;
    usage_count: number;
    is_active: boolean;
  };
}

export interface AvailablePromoCode {
  id: string;
  code: string;
  discount_type: 'percentage' | 'flat_rate';
  discount_value: number;
  expiration_type: 'none' | 'date';
  expiration_date: string | null;
  service_scope: 'all' | 'selected';
  is_active: boolean;
}

export function useAccountPromoCodes(accountId: string | null | undefined) {
  const [assignedCodes, setAssignedCodes] = useState<AccountPromoCode[]>([]);
  const [availableCodes, setAvailableCodes] = useState<AvailablePromoCode[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { profile } = useAuth();

  const fetchAssignedCodes = useCallback(async () => {
    if (!accountId) {
      setAssignedCodes([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const { data, error } = await (supabase as any)
        .from('account_promo_codes')
        .select(`
          id,
          promo_code_id,
          assigned_at,
          assigned_by,
          notes,
          promo_codes:promo_code_id (
            id,
            code,
            discount_type,
            discount_value,
            expiration_type,
            expiration_date,
            service_scope,
            selected_services,
            usage_limit_type,
            usage_limit,
            usage_count,
            is_active
          )
        `)
        .eq('account_id', accountId)
        .order('assigned_at', { ascending: false });

      if (error) throw error;

      // Transform data to flatten the promo_codes join
      const transformed = (data || []).map((item: any) => ({
        id: item.id,
        promo_code_id: item.promo_code_id,
        assigned_at: item.assigned_at,
        assigned_by: item.assigned_by,
        notes: item.notes,
        promo_code: item.promo_codes,
      })).filter((item: any) => item.promo_code); // Filter out any with deleted promo codes

      setAssignedCodes(transformed);
    } catch (error: any) {
      console.error('[useAccountPromoCodes] Error fetching assigned codes:', error);
      toast({
        variant: 'destructive',
        title: 'Error loading promo codes',
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  }, [accountId, toast]);

  const fetchAvailableCodes = useCallback(async () => {
    if (!profile?.tenant_id || !accountId) {
      setAvailableCodes([]);
      return;
    }

    try {
      // Get all active promo codes
      const { data: allCodes, error: codesError } = await (supabase
        .from('promo_codes') as any)
        .select('id, code, discount_type, discount_value, expiration_type, expiration_date, service_scope, is_active')
        .eq('tenant_id', profile.tenant_id)
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('code');

      if (codesError) throw codesError;

      // Get already assigned codes for this account
      const { data: assigned, error: assignedError } = await (supabase as any)
        .from('account_promo_codes')
        .select('promo_code_id')
        .eq('account_id', accountId);

      if (assignedError) throw assignedError;

      const assignedIds = new Set((assigned || []).map((a: any) => a.promo_code_id));

      // Filter out already assigned codes
      const available = (allCodes || []).filter((pc: any) => !assignedIds.has(pc.id));
      setAvailableCodes(available);
    } catch (error: any) {
      console.error('[useAccountPromoCodes] Error fetching available codes:', error);
    }
  }, [profile?.tenant_id, accountId]);

  useEffect(() => {
    fetchAssignedCodes();
    fetchAvailableCodes();
  }, [fetchAssignedCodes, fetchAvailableCodes]);

  const assignPromoCode = useCallback(async (promoCodeId: string, notes?: string): Promise<boolean> => {
    if (!accountId || !profile?.id) {
      toast({ variant: 'destructive', title: 'Error', description: 'Not authenticated' });
      return false;
    }

    try {
      const { error } = await (supabase as any)
        .from('account_promo_codes')
        .insert({
          account_id: accountId,
          promo_code_id: promoCodeId,
          assigned_by: profile.id,
          notes: notes || null,
        });

      if (error) {
        if (error.code === '23505') {
          toast({ variant: 'destructive', title: 'Error', description: 'This promo code is already assigned to this account' });
          return false;
        }
        throw error;
      }

      toast({ title: 'Promo code assigned' });
      await fetchAssignedCodes();
      await fetchAvailableCodes();
      return true;
    } catch (error: any) {
      console.error('[useAccountPromoCodes] Error assigning promo code:', error);
      toast({ variant: 'destructive', title: 'Error', description: error.message });
      return false;
    }
  }, [accountId, profile?.id, toast, fetchAssignedCodes, fetchAvailableCodes]);

  const removePromoCode = useCallback(async (assignmentId: string): Promise<boolean> => {
    try {
      const { error } = await (supabase as any)
        .from('account_promo_codes')
        .delete()
        .eq('id', assignmentId);

      if (error) throw error;

      toast({ title: 'Promo code removed' });
      await fetchAssignedCodes();
      await fetchAvailableCodes();
      return true;
    } catch (error: any) {
      console.error('[useAccountPromoCodes] Error removing promo code:', error);
      toast({ variant: 'destructive', title: 'Error', description: error.message });
      return false;
    }
  }, [toast, fetchAssignedCodes, fetchAvailableCodes]);

  return {
    assignedCodes,
    availableCodes,
    loading,
    assignPromoCode,
    removePromoCode,
    refetch: fetchAssignedCodes,
  };
}
