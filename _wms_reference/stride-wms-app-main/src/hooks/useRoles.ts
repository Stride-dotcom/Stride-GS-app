import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface UserAccount {
  id: string;
  user_id: string;
  account_id: string;
  access_level: string;
  account_name?: string;
}

export interface UserWithRole {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  role_name: string | null;
  role_id: string | null;
  is_active: boolean;
  last_login: string | null;
  assigned_accounts: UserAccount[];
}

export interface Role {
  id: string;
  name: string;
  description: string | null;
  permissions: any;
  is_system: boolean;
}

export function useRoles() {
  const { profile } = useAuth();
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (profile?.tenant_id) {
      fetchRoles();
    }
  }, [profile?.tenant_id]);

  const fetchRoles = async () => {
    if (!profile?.tenant_id) return;

    try {
      const { data, error } = await supabase
        .from('roles')
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .is('deleted_at', null)
        .order('name');

      if (error) throw error;
      setRoles(data || []);
    } catch (error: any) {
      // Suppress AbortError - happens during navigation/re-renders
      if (error?.name === 'AbortError' || error?.message?.includes('AbortError')) {
        return;
      }
      console.error('Error fetching roles:', error);
    } finally {
      setLoading(false);
    }
  };

  const createRole = async (name: string, description?: string, permissions?: any) => {
    if (!profile?.tenant_id) return null;

    try {
      const { data, error } = await supabase
        .from('roles')
        .insert({
          tenant_id: profile.tenant_id,
          name,
          description: description || null,
          permissions: permissions || {},
          is_system: false,
        })
        .select()
        .single();

      if (error) throw error;
      await fetchRoles();
      return data;
    } catch (error) {
      console.error('Error creating role:', error);
      return null;
    }
  };

  return { roles, loading, refetch: fetchRoles, createRole };
}

export function useUserAccounts(userId?: string) {
  const [accounts, setAccounts] = useState<UserAccount[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (userId) {
      fetchUserAccounts();
    }
  }, [userId]);

  const fetchUserAccounts = async () => {
    if (!userId) return;

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('user_accounts')
        .select(`
          id,
          user_id,
          account_id,
          access_level,
          accounts:account_id (account_name)
        `)
        .eq('user_id', userId)
        .is('deleted_at', null);

      if (error) throw error;

      const accountsWithNames = (data || []).map(ua => ({
        ...ua,
        account_name: (ua.accounts as any)?.account_name,
      }));

      setAccounts(accountsWithNames);
    } catch (error) {
      console.error('Error fetching user accounts:', error);
    } finally {
      setLoading(false);
    }
  };

  const assignAccount = async (accountId: string, accessLevel: string = 'read_only') => {
    if (!userId) return false;

    try {
      const { error } = await supabase
        .from('user_accounts')
        .insert({
          user_id: userId,
          account_id: accountId,
          access_level: accessLevel,
        });

      if (error) throw error;
      await fetchUserAccounts();
      return true;
    } catch (error) {
      console.error('Error assigning account:', error);
      return false;
    }
  };

  const removeAccount = async (userAccountId: string) => {
    try {
      const { error } = await supabase
        .from('user_accounts')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', userAccountId);

      if (error) throw error;
      await fetchUserAccounts();
      return true;
    } catch (error) {
      console.error('Error removing account:', error);
      return false;
    }
  };

  return { accounts, loading, refetch: fetchUserAccounts, assignAccount, removeAccount };
}

export function useCurrentUserRole() {
  const { profile } = useAuth();
  const [role, setRole] = useState<string | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [isAdminDev, setIsAdminDev] = useState(false);

  useEffect(() => {
    if (profile?.id) {
      fetchUserRole();
      checkAdminDev();
    }
  }, [profile?.id]);

  const fetchUserRole = async () => {
    if (!profile?.id) return;

    try {
      // Fetch ALL roles for the user, not just one
      const { data, error } = await supabase
        .from('user_roles')
        .select(`
          role_id,
          roles:role_id (name, permissions, is_system)
        `)
        .eq('user_id', profile.id)
        .is('deleted_at', null);

      if (error && error.code !== 'PGRST116') throw error;

      if (data && data.length > 0) {
        // Collect all role names
        const roleNames = data.map(d => (d.roles as any)?.name).filter(Boolean);
        setRoles(roleNames);

        // Set primary role (prefer non-system roles for display)
        const nonSystemRole = data.find(d => !(d.roles as any)?.is_system);
        const primaryRole = nonSystemRole || data[0];
        const roleName = (primaryRole?.roles as any)?.name;
        const rolePerms = (primaryRole?.roles as any)?.permissions;
        setRole(roleName);
        setPermissions(Array.isArray(rolePerms) ? rolePerms : []);

        // Check if any role is admin_dev
        const hasAdminDevRole = roleNames.includes('admin_dev');
        if (hasAdminDevRole) {
          setIsAdminDev(true);
        }
      }
    } catch (error) {
      console.error('Error fetching user role:', error);
    } finally {
      setLoading(false);
    }
  };

  // Also check via RPC for admin_dev (handles system role with null tenant_id)
  const checkAdminDev = async () => {
    if (!profile?.id) return;

    try {
      const { data, error } = await (supabase as any).rpc('user_is_admin_dev', {
        p_user_id: profile.id,
      });

      if (error) {
        // Function might not exist yet
        if (error.code === '42883') return;
        throw error;
      }

      if (data === true) {
        setIsAdminDev(true);
      }
    } catch (error) {
      console.error('Error checking admin_dev status:', error);
    }
  };

  // admin_dev has full admin access + more
  const isAdmin = isAdminDev || role === 'admin' || roles.includes('admin');
  const isManager = role === 'manager' || roles.includes('manager') || isAdmin;
  const isWarehouse = role === 'warehouse' || roles.includes('warehouse') || isManager;
  const isClientUser = role === 'client_user' || roles.includes('client_user');

  const hasPermission = (permission: string) => {
    if (isAdminDev || isAdmin) return true;
    return permissions.includes(permission) || permissions.includes('*');
  };

  // admin_dev can access everything
  const canAccessBilling = isAdminDev || isAdmin || isManager;
  const canAccessSettings = isAdminDev || isAdmin;
  const canManageUsers = isAdminDev || isAdmin;
  const canManageAccounts = isAdminDev || isAdmin || isManager;

  return {
    role,
    roles,
    loading,
    isAdmin,
    isAdminDev,
    isManager,
    isWarehouse,
    isClientUser,
    hasPermission,
    canAccessBilling,
    canAccessSettings,
    canManageUsers,
    canManageAccounts,
  };
}
