import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';

/**
 * Environment variables for QA Center gating
 */
const QA_CENTER_ENABLED = import.meta.env.VITE_ENABLE_QA_CENTER === 'true';
const QA_ALLOWLIST_TENANTS = (import.meta.env.VITE_QA_ALLOWLIST_TENANTS || '').split(',').filter(Boolean);

interface AdminDevState {
  isAdminDev: boolean;
  loading: boolean;
  error: string | null;
}

interface UseAdminDevReturn extends AdminDevState {
  /** Check if user can access QA Center (env flag + tenant allowlist + admin_dev role) */
  canAccessQACenter: boolean;
  /** Refetch admin_dev status */
  refetch: () => Promise<void>;
  /** Grant admin_dev role to another user by email (only if current user is admin_dev) */
  grantAdminDev: (email: string) => Promise<{ success: boolean; error?: string }>;
  /** Revoke admin_dev role from a user (only if current user is admin_dev) */
  revokeAdminDev: (userId: string) => Promise<{ success: boolean; error?: string }>;
  /** Fetch all admin_dev users */
  fetchAdminDevUsers: () => Promise<{ id: string; email: string; first_name: string | null; last_name: string | null }[]>;
}

/**
 * Hook to check if the current user has the admin_dev system role
 * and manage admin_dev access for the QA Center.
 */
export function useAdminDev(): UseAdminDevReturn {
  const { profile } = useAuth();
  const [state, setState] = useState<AdminDevState>({
    isAdminDev: false,
    loading: true,
    error: null,
  });

  const fetchAdminDevStatus = useCallback(async () => {
    if (!profile?.id) {
      setState({ isAdminDev: false, loading: false, error: null });
      return;
    }

    try {
      setState(prev => ({ ...prev, loading: true, error: null }));

      // Call the RPC function to check admin_dev status
      const { data, error } = await (supabase as any).rpc('user_is_admin_dev', {
        p_user_id: profile.id,
      });

      if (error) {
        // If function doesn't exist yet, silently fail
        if (error.code === '42883') {
          setState({ isAdminDev: false, loading: false, error: null });
          return;
        }
        throw error;
      }

      setState({ isAdminDev: Boolean(data), loading: false, error: null });
    } catch (err) {
      console.error('Error checking admin_dev status:', err);
      setState({
        isAdminDev: false,
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to check admin_dev status',
      });
    }
  }, [profile?.id]);

  useEffect(() => {
    fetchAdminDevStatus();
  }, [fetchAdminDevStatus]);

  // Check if user can access QA Center (all conditions must be true)
  const canAccessQACenter = Boolean(
    QA_CENTER_ENABLED &&
    profile?.tenant_id &&
    (QA_ALLOWLIST_TENANTS.length === 0 || QA_ALLOWLIST_TENANTS.includes(profile.tenant_id)) &&
    state.isAdminDev
  );

  // Grant admin_dev to another user by email
  const grantAdminDev = useCallback(async (email: string): Promise<{ success: boolean; error?: string }> => {
    if (!state.isAdminDev) {
      return { success: false, error: 'Only admin_dev users can grant admin_dev access' };
    }

    try {
      // Find the user by email
      const { data: user, error: userError } = await supabase
        .from('users')
        .select('id')
        .eq('email', email.toLowerCase())
        .maybeSingle();

      if (userError) throw userError;
      if (!user) {
        return { success: false, error: 'User not found with that email' };
      }

      // Get the admin_dev role ID
      const { data: role, error: roleError } = await supabase
        .from('roles')
        .select('id')
        .eq('name', 'admin_dev')
        .eq('is_system', true)
        .is('tenant_id', null)
        .maybeSingle();

      if (roleError) throw roleError;
      if (!role) {
        return { success: false, error: 'admin_dev role not found' };
      }

      // Check if already has the role
      const { data: existing } = await supabase
        .from('user_roles')
        .select('id')
        .eq('user_id', user.id)
        .eq('role_id', role.id)
        .is('deleted_at', null)
        .maybeSingle();

      if (existing) {
        return { success: false, error: 'User already has admin_dev access' };
      }

      // Assign the role
      const { error: assignError } = await supabase
        .from('user_roles')
        .insert({
          user_id: user.id,
          role_id: role.id,
          assigned_by: profile?.id,
        });

      if (assignError) throw assignError;

      return { success: true };
    } catch (err) {
      console.error('Error granting admin_dev:', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to grant admin_dev access',
      };
    }
  }, [state.isAdminDev, profile?.id]);

  // Revoke admin_dev from a user
  const revokeAdminDev = useCallback(async (userId: string): Promise<{ success: boolean; error?: string }> => {
    if (!state.isAdminDev) {
      return { success: false, error: 'Only admin_dev users can revoke admin_dev access' };
    }

    // Prevent self-revocation
    if (userId === profile?.id) {
      return { success: false, error: 'Cannot revoke your own admin_dev access' };
    }

    try {
      // Get the admin_dev role ID
      const { data: role, error: roleError } = await supabase
        .from('roles')
        .select('id')
        .eq('name', 'admin_dev')
        .eq('is_system', true)
        .is('tenant_id', null)
        .maybeSingle();

      if (roleError) throw roleError;
      if (!role) {
        return { success: false, error: 'admin_dev role not found' };
      }

      // Soft delete the role assignment
      const { error: deleteError } = await supabase
        .from('user_roles')
        .update({ deleted_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('role_id', role.id)
        .is('deleted_at', null);

      if (deleteError) throw deleteError;

      return { success: true };
    } catch (err) {
      console.error('Error revoking admin_dev:', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to revoke admin_dev access',
      };
    }
  }, [state.isAdminDev, profile?.id]);

  // Fetch all users with admin_dev role
  const fetchAdminDevUsers = useCallback(async () => {
    if (!state.isAdminDev) {
      return [];
    }

    try {
      // Get the admin_dev role ID
      const { data: role, error: roleError } = await supabase
        .from('roles')
        .select('id')
        .eq('name', 'admin_dev')
        .eq('is_system', true)
        .is('tenant_id', null)
        .maybeSingle();

      if (roleError || !role) {
        return [];
      }

      // Get all users with this role
      const { data: userRoles, error: urError } = await supabase
        .from('user_roles')
        .select('user_id')
        .eq('role_id', role.id)
        .is('deleted_at', null);

      if (urError || !userRoles || userRoles.length === 0) {
        return [];
      }

      const userIds = userRoles.map(ur => ur.user_id);

      // Fetch user details
      const { data: users, error: usersError } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .in('id', userIds);

      if (usersError) {
        throw usersError;
      }

      return users || [];
    } catch (err) {
      console.error('Error fetching admin_dev users:', err);
      return [];
    }
  }, [state.isAdminDev]);

  return {
    ...state,
    canAccessQACenter,
    refetch: fetchAdminDevStatus,
    grantAdminDev,
    revokeAdminDev,
    fetchAdminDevUsers,
  };
}

/**
 * Check if QA Center feature is enabled via environment variable
 */
export function isQACenterEnabled(): boolean {
  return QA_CENTER_ENABLED;
}

/**
 * Check if a tenant is in the QA allowlist
 */
export function isTenantAllowlisted(tenantId: string): boolean {
  return QA_ALLOWLIST_TENANTS.length === 0 || QA_ALLOWLIST_TENANTS.includes(tenantId);
}
