import { useState, useEffect, useCallback } from 'react';
import { getRoleDisplayName } from '@/lib/roles';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useImpersonation } from '@/contexts/ImpersonationContext';
import { useToast } from '@/hooks/use-toast';

interface Tenant {
  id: string;
  name: string;
  created_at: string;
}

const AVAILABLE_ROLES = [
  'admin',
  'manager',
  'warehouse',
  'technician',
  'client_user',
  'billing_manager',
];

interface TenantSwitcherDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TenantSwitcherDialog({ open, onOpenChange }: TenantSwitcherDialogProps) {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
  const [selectedRole, setSelectedRole] = useState('');
  const { startImpersonation } = useImpersonation();
  const { toast } = useToast();

  const fetchTenants = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await (supabase as any).rpc('rpc_list_all_tenants');
      if (error) throw error;
      setTenants(data || []);
    } catch (err) {
      console.error('Error fetching tenants:', err);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to load tenants',
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (open) {
      fetchTenants();
      setSelectedTenant(null);
      setSelectedRole('');
      setSearch('');
    }
  }, [open, fetchTenants]);

  const filteredTenants = tenants.filter((t) =>
    t.name.toLowerCase().includes(search.toLowerCase())
  );

  const handleEnter = async () => {
    if (!selectedTenant || !selectedRole) return;

    await startImpersonation(selectedTenant.id, selectedTenant.name, selectedRole);
    toast({
      title: 'Impersonation started',
      description: `Viewing as ${getRoleDisplayName(selectedRole)} in ${selectedTenant.name}`,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MaterialIcon name="shield_person" size="md" />
            Switch Tenant
          </DialogTitle>
          <DialogDescription>
            Select a tenant and role to view the app as that role.
          </DialogDescription>
        </DialogHeader>

        {!selectedTenant ? (
          // Step 1: Select tenant
          <div className="flex flex-col gap-3 flex-1 min-h-0">
            <div className="relative">
              <MaterialIcon name="search" size="sm" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search tenants..."
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
              />
            </div>

            <div className="flex-1 overflow-y-auto border rounded-md max-h-[400px]">
              {loading ? (
                <div className="flex items-center justify-center p-8 text-muted-foreground">
                  <MaterialIcon name="progress_activity" size="md" className="animate-spin mr-2" />
                  Loading tenants...
                </div>
              ) : filteredTenants.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-8 text-muted-foreground">
                  <MaterialIcon name="search_off" size="lg" className="mb-2 opacity-50" />
                  <p>No tenants found</p>
                </div>
              ) : (
                <div className="divide-y">
                  {filteredTenants.map((tenant) => (
                    <button
                      key={tenant.id}
                      onClick={() => setSelectedTenant(tenant)}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors text-left"
                    >
                      <div>
                        <p className="text-sm font-medium">{tenant.name}</p>
                        <p className="text-xs text-muted-foreground">
                          ID: {tenant.id.slice(0, 8)}...
                        </p>
                      </div>
                      <MaterialIcon name="chevron_right" size="sm" className="text-muted-foreground" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          // Step 2: Select role
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setSelectedTenant(null); setSelectedRole(''); }}
              >
                <MaterialIcon name="arrow_back" size="sm" className="mr-1" />
                Back
              </Button>
              <Badge variant="secondary" className="text-xs">
                {selectedTenant.name}
              </Badge>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Select Role to Simulate</label>
              <Select value={selectedRole} onValueChange={setSelectedRole}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a role..." />
                </SelectTrigger>
                <SelectContent>
                  {AVAILABLE_ROLES.map((role) => (
                    <SelectItem key={role} value={role}>
                      {getRoleDisplayName(role)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedRole && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-3 text-sm space-y-1">
                <p className="font-medium text-amber-800 dark:text-amber-200">
                  You will view the app as a <strong>{getRoleDisplayName(selectedRole)}</strong> user
                  in <strong>{selectedTenant.name}</strong>.
                </p>
                <p className="text-amber-700 dark:text-amber-300 text-xs">
                  You will have full read/write access. All actions are logged.
                </p>
              </div>
            )}

            <Button
              onClick={() => void handleEnter()}
              disabled={!selectedRole}
              className="w-full"
            >
              <MaterialIcon name="login" size="sm" className="mr-2" />
              Enter as {selectedRole ? getRoleDisplayName(selectedRole) : '...'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
