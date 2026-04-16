import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { AddAddonDialog } from '@/components/billing/AddAddonDialog';
import { coerceOutboundShipmentNumber } from '@/lib/shipmentNumberUtils';

interface QuickReleaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedItems: SelectedItem[];
  onSuccess: () => void;
}

interface SelectedItem {
  id: string;
  item_code: string;
  description: string | null;
  quantity: number;
  client_account?: string | null;
  account_id?: string | null;
  warehouse_id?: string | null;
}

export function QuickReleaseDialog({
  open,
  onOpenChange,
  selectedItems,
  onSuccess,
}: QuickReleaseDialogProps) {
  const [releaseDate, setReleaseDate] = useState<Date | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [showAddChargePrompt, setShowAddChargePrompt] = useState(false);
  const [addChargeDialogOpen, setAddChargeDialogOpen] = useState(false);
  const [releaseData, setReleaseData] = useState<{
    accountId: string;
    accountName: string;
    shipmentId: string;
    itemCount: number;
  } | null>(null);
  const { toast } = useToast();

  const handleSubmit = async () => {
    if (!releaseDate) {
      toast({
        title: 'Release date required',
        description: 'Please select a release date.',
        variant: 'destructive',
      });
      return;
    }

    if (selectedItems.length === 0) {
      toast({
        title: 'No items selected',
        description: 'Please select at least one item to release.',
        variant: 'destructive',
      });
      return;
    }

    setSubmitting(true);
    try {
      // Do not block outbound release for MIS_SHIP / RETURN_TO_SENDER workflows.
      // Those paths often require outbound processing to return goods to sender.

      // Get current user's profile - users.id IS the auth.uid() in this schema
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: profile } = await (supabase
        .from('users') as any)
        .select('id, tenant_id')
        .eq('id', user.id)
        .single();

      if (!profile) throw new Error('User profile not found');

      // Create the outbound shipment for tracking with customer_authorized for SOP compliance
      // Note: release_type must be 'will_call', 'disposal', or 'return' per database constraint
      const shipmentData = {
        tenant_id: profile.tenant_id,
        shipment_type: 'outbound',
        release_type: 'will_call',
        status: 'completed',
        warehouse_id: selectedItems[0]?.warehouse_id || null,
        notes: `Manual release of ${selectedItems.length} item(s)`,
        created_by: profile.id,
        completed_at: releaseDate.toISOString(),
        customer_authorized: true,
        customer_authorized_at: releaseDate.toISOString(),
        customer_authorized_by: profile.id,
      };

      const { data: shipment, error: shipmentError } = await (supabase
        .from('shipments') as any)
        .insert(shipmentData)
        .select('id, shipment_number')
        .single();

      if (shipmentError) throw shipmentError;
      let effectiveShipmentNumber: string | null = shipment.shipment_number;

      // Coerce legacy SHP-###### → OUT-##### for new outbound shipments (best-effort).
      const coerced = coerceOutboundShipmentNumber(effectiveShipmentNumber);
      if (coerced) {
        const { error: renumberError } = await (supabase.from('shipments') as any)
          .update({ shipment_number: coerced })
          .eq('tenant_id', profile.tenant_id)
          .eq('id', shipment.id);
        if (!renumberError) {
          effectiveShipmentNumber = coerced;
        }
      }

      // Create shipment items linking to actual inventory items
      const shipmentItems = selectedItems.map(item => ({
        shipment_id: shipment.id,
        item_id: item.id,
        expected_quantity: item.quantity,
        actual_quantity: item.quantity,
        expected_description: item.description,
        status: 'released',
      }));

      const { error: itemsError } = await (supabase
        .from('shipment_items') as any)
        .insert(shipmentItems);

      if (itemsError) throw itemsError;

      // Update each item's status to 'released' and set released_at
      const releaseItemIds = selectedItems.map(item => item.id);
      const { error: updateError } = await (supabase
        .from('items') as any)
        .update({
          status: 'released',
          released_at: releaseDate.toISOString(),
        })
        .in('id', releaseItemIds);

      if (updateError) throw updateError;

      toast({
        title: 'Items Released',
        description: `${selectedItems.length} item(s) released successfully. Shipment ${effectiveShipmentNumber} created.`,
      });

      onSuccess();

      // Check if there's an account to add charges to
      const accountId = selectedItems[0]?.account_id;
      const accountName = selectedItems[0]?.client_account;

      if (accountId && accountName) {
        // Show add charge prompt
        setReleaseData({
          accountId,
          accountName,
          shipmentId: shipment.id,
          itemCount: selectedItems.length,
        });
        setShowAddChargePrompt(true);
      } else {
        onOpenChange(false);
        setReleaseDate(undefined);
      }
    } catch (error: any) {
      console.error('Error releasing items:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to release items.',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = (open: boolean) => {
    if (!open) {
      setReleaseDate(undefined);
      setShowAddChargePrompt(false);
      setReleaseData(null);
    }
    onOpenChange(open);
  };

  const handleSkipCharge = () => {
    setShowAddChargePrompt(false);
    setReleaseData(null);
    onOpenChange(false);
    setReleaseDate(undefined);
  };

  const handleAddCharge = () => {
    setShowAddChargePrompt(false);
    setAddChargeDialogOpen(true);
  };

  const handleChargeSuccess = () => {
    setAddChargeDialogOpen(false);
    setReleaseData(null);
    onOpenChange(false);
    setReleaseDate(undefined);
  };

  // Show add charge prompt after successful release
  if (showAddChargePrompt && releaseData) {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MaterialIcon name="attach_money" size="md" />
              Add Release Charge?
            </DialogTitle>
            <DialogDescription>
              {releaseData.itemCount} item(s) released for {releaseData.accountName}. Would you like to add a release charge?
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={handleSkipCharge}>
              Skip
            </Button>
            <Button onClick={handleAddCharge}>
              <MaterialIcon name="attach_money" size="sm" className="mr-2" />
              Add Charge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MaterialIcon name="unarchive" size="md" />
              Release Items
            </DialogTitle>
            <DialogDescription>
              Release {selectedItems.length} item(s) from inventory. This will mark them as released and create a shipment record for tracking.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Selected Items Summary */}
            <div className="space-y-2">
              <Label>Items to Release ({selectedItems.length})</Label>
              <div className="border rounded-md p-3 max-h-32 overflow-y-auto bg-muted/30">
                <div className="space-y-1">
                  {selectedItems.slice(0, 5).map((item) => (
                    <div key={item.id} className="flex items-center justify-between text-sm">
                      <span className="font-medium">{item.item_code}</span>
                      <span className="text-muted-foreground truncate max-w-[150px]">
                        {item.description || 'No description'}
                      </span>
                    </div>
                  ))}
                  {selectedItems.length > 5 && (
                    <div className="text-sm text-muted-foreground pt-1">
                      ...and {selectedItems.length - 5} more
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Release Date Picker */}
            <div className="space-y-2">
              <Label>Release Date *</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      'w-full justify-start text-left font-normal',
                      !releaseDate && 'text-muted-foreground'
                    )}
                  >
                    <MaterialIcon name="calendar_today" size="sm" className="mr-2" />
                    {releaseDate ? format(releaseDate, 'PPP') : 'Select release date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={releaseDate}
                    onSelect={setReleaseDate}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => handleClose(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={submitting || !releaseDate}>
              {submitting && <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />}
              Release Items
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Charge Dialog */}
      {releaseData && (
        <AddAddonDialog
          open={addChargeDialogOpen}
          onOpenChange={(open) => {
            if (!open) handleChargeSuccess();
            else setAddChargeDialogOpen(open);
          }}
          accountId={releaseData.accountId}
          accountName={releaseData.accountName}
          shipmentId={releaseData.shipmentId}
          onSuccess={handleChargeSuccess}
        />
      )}
    </>
  );
}
