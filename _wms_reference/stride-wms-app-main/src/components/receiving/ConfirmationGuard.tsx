import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { ShipmentExceptionBadge } from '@/components/shipments/ShipmentExceptionBadge';
import type { Json } from '@/integrations/supabase/types';

interface ConfirmationGuardProps {
  shipmentId: string;
  shipmentNumber: string;
  shipment: {
    vendor_name: string | null;
    signed_pieces: number | null;
    driver_name: string | null;
    signature_data: string | null;
    signature_name: string | null;
    receiving_photos?: Json | null;
    dock_intake_breakdown: Record<string, unknown> | null;
    notes: string | null;
    account_id: string | null;
  };
  accountName?: string | null;
  onConfirm: () => void;
  onGoBack: () => void;
  onOpenExceptions?: () => void;
}

export function ConfirmationGuard({
  shipmentId,
  shipmentNumber,
  shipment,
  accountName,
  onConfirm,
  onGoBack,
  onOpenExceptions,
}: ConfirmationGuardProps) {
  const { toast } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [goingBack, setGoingBack] = useState(false);
  const receivingPhotoCount = Array.isArray(shipment.receiving_photos)
    ? shipment.receiving_photos.length
    : 0;

  const breakdown = shipment.dock_intake_breakdown as {
    cartons?: number;
    pallets?: number;
    crates?: number;
  } | null;

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      const { error } = await supabase
        .from('shipments')
        .update({ inbound_status: 'receiving' } as any)
        .eq('id', shipmentId);

      if (error) throw error;

      toast({ title: 'Confirmed', description: 'Proceeding to detailed receiving.' });
      onConfirm();
    } catch (err: any) {
      console.error('[ConfirmationGuard] confirm error:', err);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: err?.message || 'Failed to confirm',
      });
    } finally {
      setConfirming(false);
    }
  };

  const handleGoBack = async () => {
    setGoingBack(true);
    try {
      const { error } = await supabase
        .from('shipments')
        .update({ inbound_status: 'draft' } as any)
        .eq('id', shipmentId);

      if (error) throw error;

      toast({ title: 'Returned to Draft', description: 'You can edit the dock intake.' });
      onGoBack();
    } catch (err: any) {
      console.error('[ConfirmationGuard] goBack error:', err);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: err?.message || 'Failed to go back',
      });
    } finally {
      setGoingBack(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="border-amber-300 bg-amber-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-amber-800">
            <MaterialIcon name="verified" size="md" />
            Confirm Dock Intake
            <Badge variant="outline">{shipmentNumber}</Badge>
            <ShipmentExceptionBadge
              shipmentId={shipmentId}
              onClick={onOpenExceptions}
            />
          </CardTitle>
          <CardDescription className="text-amber-700">
            Review the dock intake details below. Confirm to proceed to detailed receiving, or go back to make changes.
          </CardDescription>
        </CardHeader>
      </Card>

      {/* Read-only Review */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Delivery Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-sm text-muted-foreground">Vendor</p>
              <p className="font-medium">{shipment.vendor_name || '-'}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Signed Pieces</p>
              <p className="font-medium">{shipment.signed_pieces ?? '-'}</p>
            </div>
            {accountName && (
              <div>
                <p className="text-sm text-muted-foreground">Account</p>
                <p className="font-medium">{accountName}</p>
              </div>
            )}
            {shipment.driver_name && (
              <div>
                <p className="text-sm text-muted-foreground">Driver</p>
                <p className="font-medium">{shipment.driver_name}</p>
              </div>
            )}
          </div>

          {breakdown && (breakdown.cartons || breakdown.pallets || breakdown.crates) && (
            <>
              <Separator />
              <div>
                <p className="text-sm text-muted-foreground mb-2">Unit Breakdown</p>
                <div className="flex gap-4">
                  {breakdown.cartons ? (
                    <Badge variant="secondary">{breakdown.cartons} Cartons</Badge>
                  ) : null}
                  {breakdown.pallets ? (
                    <Badge variant="secondary">{breakdown.pallets} Pallets</Badge>
                  ) : null}
                  {breakdown.crates ? (
                    <Badge variant="secondary">{breakdown.crates} Crates</Badge>
                  ) : null}
                </div>
              </div>
            </>
          )}

          <Separator />

          <div>
            <p className="text-sm text-muted-foreground">Photos</p>
            <p className="font-medium">{receivingPhotoCount}</p>
          </div>

          {shipment.signature_data && (
            <>
              <Separator />
              <div>
                <p className="text-sm text-muted-foreground mb-2">Signature</p>
                <div className="border rounded-md p-2 bg-white inline-block">
                  <img src={shipment.signature_data} alt="Signature" className="max-h-16" />
                </div>
                {shipment.signature_name && (
                  <p className="text-sm mt-1">{shipment.signature_name}</p>
                )}
              </div>
            </>
          )}

          {shipment.notes && (
            <>
              <Separator />
              <div>
                <p className="text-sm text-muted-foreground">Notes</p>
                <p className="text-sm">{shipment.notes}</p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex flex-col sm:flex-row gap-3 justify-end">
        <Button
          variant="outline"
          size="lg"
          onClick={handleGoBack}
          disabled={goingBack || confirming}
        >
          {goingBack ? (
            <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
          ) : (
            <MaterialIcon name="arrow_back" size="sm" className="mr-2" />
          )}
          Go Back & Edit
        </Button>
        <Button
          size="lg"
          onClick={handleConfirm}
          disabled={confirming || goingBack}
          className="gap-2"
        >
          {confirming ? (
            <MaterialIcon name="progress_activity" size="sm" className="animate-spin" />
          ) : (
            <MaterialIcon name="check_circle" size="sm" />
          )}
          Confirm & Continue to Receiving
        </Button>
      </div>
    </div>
  );
}
