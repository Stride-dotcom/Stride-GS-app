import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Fetches (or creates) the UNIDENTIFIED SHIPMENT system account for the current tenant.
 * Calls the ensure_unidentified_account() DB function which is idempotent.
 */
export function useUnidentifiedAccount() {
  const { profile } = useAuth();
  const [accountId, setAccountId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [ensuring, setEnsuring] = useState(false);

  const lookupExistingAccount = useCallback(async (tenantId: string): Promise<string | null> => {
    try {
      const { data } = await supabase
        .from('accounts')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('account_name', 'UNIDENTIFIED SHIPMENT')
        .eq('is_active', true)
        .is('deleted_at', null)
        .limit(1)
        .maybeSingle();
      return data?.id ?? null;
    } catch {
      return null;
    }
  }, []);

  const ensureUnidentifiedAccount = useCallback(async (tenantIdOverride?: string): Promise<string | null> => {
    const tenantId = tenantIdOverride ?? profile?.tenant_id;
    if (!tenantId) return null;

    setEnsuring(true);
    try {
      const { data, error } = await (supabase as any).rpc('ensure_unidentified_account', {
        p_tenant_id: tenantId,
      });

      if (error) throw error;

      const resolvedId = (data as string | null) ?? null;
      if (resolvedId) {
        setAccountId(resolvedId);
      }
      return resolvedId;
    } catch (err) {
      console.warn('[useUnidentifiedAccount] ensure_unidentified_account failed:', err);
      const fallbackId = await lookupExistingAccount(tenantId);
      if (fallbackId) {
        setAccountId(fallbackId);
      }
      return fallbackId;
    } finally {
      setEnsuring(false);
    }
  }, [lookupExistingAccount, profile?.tenant_id]);

  const fetch = useCallback(async () => {
    if (!profile?.tenant_id) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      await ensureUnidentifiedAccount(profile.tenant_id);
    } finally {
      setLoading(false);
    }
  }, [ensureUnidentifiedAccount, profile?.tenant_id]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return {
    unidentifiedAccountId: accountId,
    loading,
    ensuring,
    ensureUnidentifiedAccount,
    refetch: fetch,
  };
}
