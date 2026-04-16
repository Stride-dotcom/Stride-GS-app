import { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePermissions } from '@/hooks/usePermissions';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';

interface RequireRoleProps {
  role: string | string[];
  children: ReactNode;
  fallback?: ReactNode;
}

export function RequireRole({ role, children, fallback = null }: RequireRoleProps) {
  const { hasRole, loading } = usePermissions();
  const { signOut } = useAuth();
  const navigate = useNavigate();

  if (loading) {
    return (
      <div className="flex items-center justify-center p-4">
        <MaterialIcon name="progress_activity" size="sm" className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  const roles = Array.isArray(role) ? role : [role];
  const hasAnyRole = roles.some((r) => hasRole(r));

  if (!hasAnyRole) {
    if (fallback !== null) return <>{fallback}</>;

    // Determine the appropriate home page based on the user's role
    const isClient = hasRole('client_user');
    const homePath = isClient ? '/client' : '/';
    const homeLabel = isClient ? 'Go to Portal' : 'Go to Dashboard';

    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="w-full max-w-md rounded-lg border bg-card p-6 text-card-foreground shadow-sm">
          <div className="flex items-start gap-3">
            <div className="mt-0.5">
              <MaterialIcon name="lock" size="md" className="text-muted-foreground" />
            </div>
            <div className="flex-1">
              <h1 className="text-lg font-semibold">Access denied</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Your account doesn't have permission to view this page.
              </p>
              <div className="mt-4 flex flex-col gap-2">
                <Button type="button" variant="outline" onClick={() => navigate(homePath)}>
                  {homeLabel}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={async () => {
                    await signOut();
                    navigate(isClient ? '/client/login' : '/auth');
                  }}
                >
                  Sign out
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

interface RequirePermissionProps {
  permission: string | string[];
  children: ReactNode;
  fallback?: ReactNode;
}

export function RequirePermission({ permission, children, fallback = null }: RequirePermissionProps) {
  const { hasPermission, loading } = usePermissions();

  if (loading) {
    return (
      <div className="flex items-center justify-center p-4">
        <MaterialIcon name="progress_activity" size="sm" className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  const permissions = Array.isArray(permission) ? permission : [permission];
  const hasAnyPermission = permissions.some((p) => hasPermission(p));

  if (!hasAnyPermission) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
