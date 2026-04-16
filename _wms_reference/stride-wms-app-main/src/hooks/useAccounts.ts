/**
 * useAccounts - Hook for account management with sub-account hierarchy support
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';

export interface Account {
  id: string;
  tenant_id: string;
  account_code: string;
  account_name: string;
  account_type: string | null;
  status: string;
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  billing_city: string | null;
  billing_state: string | null;
  credit_hold: boolean | null;
  parent_account_id: string | null;
  is_master_account: boolean | null;
  can_view_parent_data: boolean | null;
  allow_item_reassignment: boolean | null;
  sidemark_label: string | null;
}

export function useAccounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { profile } = useAuth();

  const fetchAccounts = useCallback(async () => {
    if (!profile?.tenant_id) {
      setAccounts([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      const db = supabase as any;
      const { data, error } = await db
        .from('accounts')
        .select(`
          id,
          tenant_id,
          account_code,
          account_name,
          account_type,
          status,
          primary_contact_name,
          primary_contact_email,
          billing_city,
          billing_state,
          credit_hold,
          parent_account_id,
          is_master_account,
          can_view_parent_data,
          allow_item_reassignment,
          sidemark_label
        `)
        .eq('tenant_id', profile.tenant_id)
        .is('deleted_at', null)
        .order('account_name');

      if (error) {
        console.error('[useAccounts] Fetch failed:', error);
        toast({
          variant: 'destructive',
          title: 'Error loading accounts',
          description: error.message,
        });
        return;
      }

      setAccounts((data || []) as Account[]);
    } catch (error: any) {
      console.error('[useAccounts] Unexpected error:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to load accounts',
      });
    } finally {
      setLoading(false);
    }
  }, [profile?.tenant_id, toast]);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  const getAccountById = useCallback((accountId: string): Account | undefined => {
    return accounts.find(a => a.id === accountId);
  }, [accounts]);

  const getActiveAccounts = useCallback(() => {
    return accounts.filter(a => a.status === 'active');
  }, [accounts]);

  // Get all sub-accounts for a given parent account
  const getSubAccounts = useCallback((parentAccountId: string): Account[] => {
    return accounts.filter(a => a.parent_account_id === parentAccountId);
  }, [accounts]);

  // Get the parent account for a given sub-account
  const getParentAccount = useCallback((accountId: string): Account | undefined => {
    const account = accounts.find(a => a.id === accountId);
    if (!account?.parent_account_id) return undefined;
    return accounts.find(a => a.id === account.parent_account_id);
  }, [accounts]);

  // Get all accounts in the same hierarchy (parent + all siblings + children)
  const getAccountHierarchy = useCallback((accountId: string): Account[] => {
    const account = accounts.find(a => a.id === accountId);
    if (!account) return [];

    // Find the root (parent or self if no parent)
    const rootId = account.parent_account_id || account.id;

    // Return root + all its children
    return accounts.filter(a =>
      a.id === rootId || a.parent_account_id === rootId
    );
  }, [accounts]);

  // Check if credit hold is active (including parent cascade)
  const isCreditHoldActive = useCallback((accountId: string): boolean => {
    const account = accounts.find(a => a.id === accountId);
    if (!account) return false;

    // Check account's own credit hold
    if (account.credit_hold === true) return true;

    // Check parent's credit hold
    if (account.parent_account_id) {
      const parent = accounts.find(a => a.id === account.parent_account_id);
      if (parent?.credit_hold === true) return true;
    }

    return false;
  }, [accounts]);

  // Check if item reassignment is allowed for an account
  const isItemReassignmentAllowed = useCallback((accountId: string): boolean => {
    const account = accounts.find(a => a.id === accountId);
    if (!account) return false;

    // If has parent, check parent's setting
    if (account.parent_account_id) {
      const parent = accounts.find(a => a.id === account.parent_account_id);
      return parent?.allow_item_reassignment === true;
    }

    // Otherwise check self
    return account.allow_item_reassignment === true;
  }, [accounts]);

  // Get the sidemark label for an account (defaults to 'sidemark')
  const getSidemarkLabel = useCallback((accountId: string): string => {
    const account = accounts.find(a => a.id === accountId);
    return account?.sidemark_label || 'sidemark';
  }, [accounts]);

  // Get accounts that can receive reassigned items (within hierarchy)
  const getReassignmentTargets = useCallback((accountId: string): Account[] => {
    if (!isItemReassignmentAllowed(accountId)) return [];
    return getAccountHierarchy(accountId).filter(a => a.status === 'active');
  }, [isItemReassignmentAllowed, getAccountHierarchy]);

  // Build a hierarchical tree of accounts for display
  const accountTree = useMemo(() => {
    const parentAccounts = accounts.filter(a => !a.parent_account_id);
    return parentAccounts.map(parent => ({
      ...parent,
      children: accounts.filter(a => a.parent_account_id === parent.id),
    }));
  }, [accounts]);

  return {
    accounts,
    loading,
    refetch: fetchAccounts,
    getAccountById,
    getActiveAccounts,
    getSubAccounts,
    getParentAccount,
    getAccountHierarchy,
    isCreditHoldActive,
    isItemReassignmentAllowed,
    getSidemarkLabel,
    getReassignmentTargets,
    accountTree,
  };
}
