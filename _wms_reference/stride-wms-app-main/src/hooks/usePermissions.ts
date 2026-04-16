import { useState, useEffect, useCallback, useContext } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { __ImpersonationContext } from '@/contexts/ImpersonationContext';

// ============================================
// TYPES
// ============================================

interface Role {
  id: string;
  name: string;
  permissions: string[];
}

interface UsePermissionsReturn {
  roles: Role[];
  permissions: string[];
  loading: boolean;
  hasRole: (roleName: string) => boolean;
  hasPermission: (permission: string) => boolean;
  hasAnyPermission: (permissions: string[]) => boolean;
  hasAllPermissions: (permissions: string[]) => boolean;
  isAdmin: boolean;
  isAdminDev: boolean;
  /** True when the real user is admin_dev, even during impersonation */
  isReallyAdminDev: boolean;
}

// ============================================
// PERMISSION CONSTANTS
// ============================================

export const PERMISSIONS = {
  // Inventory
  ITEMS_READ: 'items.read',
  ITEMS_CREATE: 'items.create',
  ITEMS_UPDATE: 'items.update',
  ITEMS_DELETE: 'items.delete',
  ITEMS_MOVE: 'items.move',

  // Shipments
  SHIPMENTS_READ: 'shipments.read',
  SHIPMENTS_CREATE: 'shipments.create',
  SHIPMENTS_RECEIVE: 'shipments.receive',
  SHIPMENTS_COMPLETE: 'shipments.complete',

  // Tasks
  TASKS_READ: 'tasks.read',
  TASKS_CREATE: 'tasks.create',
  TASKS_UPDATE: 'tasks.update',
  TASKS_ASSIGN: 'tasks.assign',
  TASKS_COMPLETE: 'tasks.complete',

  // Accounts
  ACCOUNTS_READ: 'accounts.read',
  ACCOUNTS_CREATE: 'accounts.create',
  ACCOUNTS_UPDATE: 'accounts.update',

  // Billing
  BILLING_READ: 'billing.read',
  BILLING_CREATE: 'billing.create',
  BILLING_INVOICE: 'billing.invoice',

  // Reports
  REPORTS_READ: 'reports.read',
  REPORTS_CREATE: 'reports.create',

  // Notes & Attachments
  NOTES_READ: 'notes.read',
  NOTES_CREATE: 'notes.create',
  ATTACHMENTS_CREATE: 'attachments.create',

  // Movements
  MOVEMENTS_READ: 'movements.read',

  // Admin
  WILDCARD: '*',
} as const;

// Role → permissions mapping for impersonation role simulation
const ROLE_PERMISSIONS: Record<string, string[]> = {
  admin: ['*'],
  manager: ['items.read', 'items.create', 'items.update', 'items.move', 'accounts.read', 'accounts.create', 'accounts.update', 'billing.read', 'billing.create', 'tasks.read', 'tasks.create', 'tasks.update', 'tasks.assign', 'reports.read', 'reports.create', 'notes.create', 'notes.read', 'movements.read', 'attachments.create', 'shipments.read', 'shipments.create'],
  warehouse: ['items.read', 'items.create', 'items.update', 'items.move', 'tasks.read', 'tasks.update', 'notes.create', 'notes.read', 'movements.read', 'attachments.create', 'shipments.read'],
  technician: ['items.read', 'attachments.create'],
  client_user: ['items.read', 'notes.read'],
  billing_manager: ['billing.read', 'billing.create', 'billing.invoice', 'accounts.read', 'accounts.update', 'reports.read', 'items.read', 'tasks.read', 'shipments.read', 'notes.read'],
};

// ============================================
// HOOK
// ============================================

export function usePermissions(): UsePermissionsReturn {
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();

  // Safe read of impersonation context — returns undefined if provider not mounted
  const impersonation = useContext(__ImpersonationContext);

  useEffect(() => {
    if (!user) {
      setRoles([]);
      setPermissions([]);
      setLoading(false);
      return;
    }

    const fetchRolesAndPermissions = async () => {
      try {
        // Prefer SECURITY DEFINER RPC to avoid RLS blocking the roles join (roles: null).
        // Falls back to the legacy join query if RPC is not present.
        const { data: rpcRoles, error: rpcError } = await (supabase as any).rpc('get_my_roles');

        if (!rpcError && Array.isArray(rpcRoles)) {
          const fetchedRoles: Role[] = [];
          const allPermissions: Set<string> = new Set();

          rpcRoles.forEach((r: any) => {
            const rolePermissions = Array.isArray(r?.permissions) ? r.permissions : [];
            if (r?.id && r?.name) {
              fetchedRoles.push({
                id: String(r.id),
                name: String(r.name),
                permissions: rolePermissions,
              });
              rolePermissions.forEach((p: string) => allPermissions.add(p));
            }
          });

          setRoles(fetchedRoles);
          setPermissions(Array.from(allPermissions));
          return;
        }

        // If RPC doesn't exist yet, silently fall back.
        if (rpcError && rpcError.code !== '42883') {
          // Suppress AbortError - happens during navigation/re-renders
          if (rpcError.message?.includes('AbortError') || rpcError.code === '20') {
            setLoading(false);
            return;
          }
          console.error('[Permissions] Error fetching roles via get_my_roles RPC:', {
            error: rpcError,
            message: rpcError.message,
            code: rpcError.code,
          });
          setLoading(false);
          return;
        }

        const { data: userRoles, error } = await supabase
          .from('user_roles')
          .select(`
            role_id,
            roles (
              id,
              name,
              permissions
            )
          `)
          .eq('user_id', user.id)
          .is('deleted_at', null);

        if (error) {
          // Suppress AbortError - happens during navigation/re-renders
          if (error.message?.includes('AbortError') || error.code === '20') {
            setLoading(false);
            return;
          }
          console.error('[Permissions] Error fetching roles:', {
            error,
            message: error.message,
            code: error.code,
          });
          setLoading(false);
          return;
        }

        const fetchedRoles: Role[] = [];
        const allPermissions: Set<string> = new Set();

        userRoles?.forEach((ur) => {
          const role = ur.roles as unknown as { id: string; name: string; permissions: any };
          if (role) {
            const rolePermissions = Array.isArray(role.permissions) ? role.permissions : [];
            fetchedRoles.push({
              id: role.id,
              name: role.name,
              permissions: rolePermissions,
            });
            rolePermissions.forEach((p: string) => allPermissions.add(p));
          }
        });

        setRoles(fetchedRoles);
        setPermissions(Array.from(allPermissions));
      } catch (error: any) {
        // Suppress AbortError - happens during navigation/re-renders
        if (error?.name === 'AbortError' || error?.message?.includes('AbortError')) {
          return;
        }
        console.error('[Permissions] Exception fetching permissions:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchRolesAndPermissions();
  }, [user]);

  // True admin_dev status based on actual DB roles (never changes during impersonation)
  const reallyIsAdminDev = roles.some((role) => role.name === 'admin_dev');

  // Check if impersonation is active
  const isImpersonating = Boolean(impersonation?.active && impersonation.simulatedRole);
  const simulatedRole = impersonation?.simulatedRole ?? null;

  // Effective permissions during impersonation
  const effectivePermissions = isImpersonating
    ? (ROLE_PERMISSIONS[simulatedRole!] || [])
    : permissions;

  // During impersonation, isAdminDev is false (simulating the chosen role)
  const isAdminDev = isImpersonating ? false : reallyIsAdminDev;

  // Admin check: wildcard permission OR admin_dev role OR admin role
  const isAdmin = isImpersonating
    ? (simulatedRole === 'admin')
    : (permissions.includes(PERMISSIONS.WILDCARD) || reallyIsAdminDev || roles.some((role) => role.name === 'admin'));

  // hasRole: during impersonation, only matches the simulated role
  const hasRoleFinal = useCallback((roleName: string): boolean => {
    if (isImpersonating) {
      return simulatedRole?.toLowerCase() === roleName.toLowerCase();
    }
    // admin_dev has all role access
    if (reallyIsAdminDev) return true;
    return roles.some((role) => role.name.toLowerCase() === roleName.toLowerCase());
  }, [roles, reallyIsAdminDev, isImpersonating, simulatedRole]);

  // hasPermission: during impersonation, check simulated role permissions
  const hasPermissionFinal = useCallback((permission: string): boolean => {
    if (isImpersonating) {
      if (effectivePermissions.includes(PERMISSIONS.WILDCARD)) return true;
      return effectivePermissions.includes(permission);
    }
    if (reallyIsAdminDev) return true;
    if (permissions.includes(PERMISSIONS.WILDCARD)) return true;
    return permissions.includes(permission);
  }, [permissions, reallyIsAdminDev, isImpersonating, effectivePermissions]);

  const hasAnyPermissionFinal = useCallback((perms: string[]): boolean => {
    if (isImpersonating) {
      if (effectivePermissions.includes(PERMISSIONS.WILDCARD)) return true;
      return perms.some(p => effectivePermissions.includes(p));
    }
    if (reallyIsAdminDev) return true;
    if (permissions.includes(PERMISSIONS.WILDCARD)) return true;
    return perms.some(p => permissions.includes(p));
  }, [permissions, reallyIsAdminDev, isImpersonating, effectivePermissions]);

  const hasAllPermissionsFinal = useCallback((perms: string[]): boolean => {
    if (isImpersonating) {
      if (effectivePermissions.includes(PERMISSIONS.WILDCARD)) return true;
      return perms.every(p => effectivePermissions.includes(p));
    }
    if (reallyIsAdminDev) return true;
    if (permissions.includes(PERMISSIONS.WILDCARD)) return true;
    return perms.every(p => permissions.includes(p));
  }, [permissions, reallyIsAdminDev, isImpersonating, effectivePermissions]);

  return {
    roles,
    permissions,
    loading,
    hasRole: hasRoleFinal,
    hasPermission: hasPermissionFinal,
    hasAnyPermission: hasAnyPermissionFinal,
    hasAllPermissions: hasAllPermissionsFinal,
    isAdmin,
    isAdminDev,
    isReallyAdminDev: reallyIsAdminDev,
  };
}
