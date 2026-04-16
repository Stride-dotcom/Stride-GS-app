import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { Button } from '@/components/ui/button';
import type { AutosaveStatus } from '@/hooks/useReceivingAutosave';

interface AutosaveIndicatorProps {
  status: AutosaveStatus;
  onRetry?: () => void;
}

export function AutosaveIndicator({ status, onRetry }: AutosaveIndicatorProps) {
  if (status === 'idle') return null;

  return (
    <div className="flex items-center gap-2 text-xs">
      {status === 'saving' && (
        <>
          <MaterialIcon name="sync" size="sm" className="animate-spin text-muted-foreground" />
          <span className="text-muted-foreground">Saving...</span>
        </>
      )}

      {status === 'saved' && (
        <>
          <MaterialIcon name="cloud_done" size="sm" className="text-green-600" />
          <span className="text-green-600">Saved</span>
        </>
      )}

      {status === 'offline-unsaved' && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-md">
          <MaterialIcon name="cloud_off" size="sm" className="text-amber-600" />
          <span className="text-amber-700 font-medium">Offline — Unsaved changes</span>
        </div>
      )}

      {status === 'error' && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-red-50 border border-red-200 rounded-md">
          <MaterialIcon name="error" size="sm" className="text-red-600" />
          <span className="text-red-700 font-medium">Save failed</span>
          {onRetry && (
            <Button variant="outline" size="sm" className="h-6 text-xs" onClick={onRetry}>
              Retry now
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
