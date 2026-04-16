import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { getRoleDisplayName } from '@/lib/roles';

interface RoleEligibilityRow {
  role_name: string;
  role_description: string | null;
  is_system: boolean;
  is_eligible: boolean;
  updated_at: string | null;
}

const ROLE_ORDER: Record<string, number> = {
  admin: 1,
  billing_manager: 2,
  manager: 3,
  warehouse: 4,
  technician: 5,
  client_user: 6,
};

export function InAppRoleEligibilityCard() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [savingRole, setSavingRole] = useState<string | null>(null);
  const [rows, setRows] = useState<RoleEligibilityRow[]>([]);

  const loadRows = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await (supabase as any).rpc('rpc_get_my_in_app_role_eligibility');
      if (error) throw new Error(error.message);
      setRows((data || []) as RoleEligibilityRow[]);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to load in-app role eligibility';
      toast({ variant: 'destructive', title: 'Load failed', description: message });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const aRank = ROLE_ORDER[a.role_name] ?? 100;
      const bRank = ROLE_ORDER[b.role_name] ?? 100;
      if (aRank !== bRank) return aRank - bRank;
      return a.role_name.localeCompare(b.role_name);
    });
  }, [rows]);

  const handleToggleRole = async (roleName: string, checked: boolean) => {
    setSavingRole(roleName);
    try {
      const { data, error } = await (supabase as any).rpc('rpc_set_my_in_app_role_eligibility', {
        p_role_name: roleName,
        p_is_eligible: checked,
      });
      if (error) throw new Error(error.message);

      const updated = Array.isArray(data) && data.length > 0 ? data[0] : null;
      setRows((prev) =>
        prev.map((row) =>
          row.role_name === roleName
            ? {
                ...row,
                is_eligible: updated?.is_eligible ?? checked,
                updated_at: updated?.updated_at ?? row.updated_at,
              }
            : row,
        ),
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to update role eligibility';
      toast({ variant: 'destructive', title: 'Update failed', description: message });
    } finally {
      setSavingRole(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MaterialIcon name="admin_panel_settings" size="md" />
          In-App Role Eligibility
        </CardTitle>
        <CardDescription>
          Control which role tokens can receive in-app alerts. This gate is enforced during in-app dispatch.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : sortedRows.length === 0 ? (
          <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            No tenant roles found.
          </div>
        ) : (
          sortedRows.map((row) => (
            <div key={row.role_name} className="rounded-md border p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{getRoleDisplayName(row.role_name)}</span>
                {row.is_system && <Badge variant="outline">System role</Badge>}
                <Badge variant="secondary" className="font-mono text-[11px]">
                  [[{row.role_name}_role]]
                </Badge>
              </div>
              {row.role_description && (
                <div className="mb-2 text-xs text-muted-foreground">{row.role_description}</div>
              )}
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  {row.is_eligible ? 'Eligible for in-app alerts' : 'Blocked from in-app alerts'}
                </span>
                <Switch
                  checked={row.is_eligible}
                  disabled={savingRole === row.role_name}
                  onCheckedChange={(checked) => void handleToggleRole(row.role_name, checked)}
                />
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
