import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  SHIPMENT_EXCEPTION_CODE_META,
  useShipmentExceptions,
  type ShipmentExceptionRow,
} from '@/hooks/useShipmentExceptions';

interface ExceptionsTabProps {
  shipmentId: string;
}

function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export function ExceptionsTab({ shipmentId }: ExceptionsTabProps) {
  const { exceptions, loading, openCount, resolveException, reopenException } = useShipmentExceptions(shipmentId);
  const [resolveTarget, setResolveTarget] = useState<ShipmentExceptionRow | null>(null);
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [resolving, setResolving] = useState(false);
  const [reopeningId, setReopeningId] = useState<string | null>(null);

  const handleResolve = async () => {
    if (!resolveTarget || !resolutionNotes.trim()) return;
    setResolving(true);
    const success = await resolveException(resolveTarget.id, resolutionNotes.trim());
    setResolving(false);
    if (success) {
      setResolveTarget(null);
      setResolutionNotes('');
    }
  };

  const handleReopen = async (id: string) => {
    setReopeningId(id);
    await reopenException(id);
    setReopeningId(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-primary" />
      </div>
    );
  }

  if (exceptions.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <MaterialIcon name="check_circle" size="xl" className="mb-2 opacity-40" />
        <p>No exceptions recorded for this shipment.</p>
      </div>
    );
  }

  const resolvedCount = exceptions.length - openCount;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Badge variant={openCount > 0 ? 'destructive' : 'default'}>
          {openCount} open
        </Badge>
        <Badge variant="secondary">
          {resolvedCount} resolved
        </Badge>
      </div>

      <div className="space-y-3">
        {exceptions.map((exception) => {
          const meta = SHIPMENT_EXCEPTION_CODE_META[exception.code];
          return (
            <Card key={exception.id} className={exception.status === 'open' ? 'border-amber-200' : ''}>
              <CardContent className="pt-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <MaterialIcon
                      name={meta?.icon || 'warning'}
                      size="md"
                      className={exception.status === 'open' ? 'text-amber-600' : 'text-green-600'}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{meta?.label || exception.code}</span>
                        <Badge variant={exception.status === 'open' ? 'destructive' : 'outline'} className="text-xs">
                          {exception.status}
                        </Badge>
                      </div>

                      {exception.note && (
                        <p className="text-sm text-muted-foreground mt-1">{exception.note}</p>
                      )}

                      <p className="text-xs text-muted-foreground mt-1">
                        Created {formatDateTime(exception.created_at)}
                      </p>

                      {exception.status === 'resolved' && exception.resolution_note && (
                        <div className="mt-2 p-2 bg-green-50 rounded-md border border-green-100">
                          <p className="text-xs font-medium text-green-700">Resolution</p>
                          <p className="text-sm text-green-800">{exception.resolution_note}</p>
                          {exception.resolved_at && (
                            <p className="text-xs text-green-600 mt-1">
                              Resolved {formatDateTime(exception.resolved_at)}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {exception.status === 'open' ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setResolveTarget(exception)}
                    >
                      Resolve
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleReopen(exception.id)}
                      disabled={reopeningId === exception.id}
                    >
                      {reopeningId === exception.id ? (
                        <MaterialIcon name="progress_activity" size="sm" className="animate-spin mr-1" />
                      ) : (
                        <MaterialIcon name="undo" size="sm" className="mr-1" />
                      )}
                      Reopen
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={!!resolveTarget} onOpenChange={(open) => !open && setResolveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolve Exception</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {resolveTarget && (
              <div className="text-sm">
                <span className="font-medium">
                  {SHIPMENT_EXCEPTION_CODE_META[resolveTarget.code]?.label || resolveTarget.code}
                </span>
              </div>
            )}
            <div className="space-y-2">
              <Label>Resolution Notes <span className="text-red-500">*</span></Label>
              <Textarea
                placeholder="Describe how this exception was resolved..."
                value={resolutionNotes}
                onChange={(e) => setResolutionNotes(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setResolveTarget(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleResolve}
              disabled={!resolutionNotes.trim() || resolving}
            >
              {resolving ? (
                <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
              ) : (
                <MaterialIcon name="check" size="sm" className="mr-2" />
              )}
              Resolve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
