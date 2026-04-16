import { useImpersonation } from '@/contexts/ImpersonationContext';
import { getRoleDisplayName } from '@/lib/roles';
import { Button } from '@/components/ui/button';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

export function ImpersonationBanner() {
  const { active, tenantName, simulatedRole, stopImpersonation } = useImpersonation();

  if (!active) return null;

  return (
    <div className="sticky top-0 z-[60] flex items-center justify-center gap-3 bg-amber-500 text-amber-950 px-4 py-1.5 text-sm font-medium shadow-md">
      <MaterialIcon name="shield_person" size="sm" />
      <span>
        Viewing as <strong>{simulatedRole ? getRoleDisplayName(simulatedRole) : 'Unknown'}</strong> in <strong>{tenantName || 'Unknown Tenant'}</strong>
      </span>
      <Button
        variant="outline"
        size="sm"
        className="h-6 px-2 text-xs bg-white/80 hover:bg-white border-amber-700 text-amber-900"
        onClick={() => void stopImpersonation()}
      >
        <MaterialIcon name="logout" size="sm" className="mr-1" />
        Exit
      </Button>
    </div>
  );
}
