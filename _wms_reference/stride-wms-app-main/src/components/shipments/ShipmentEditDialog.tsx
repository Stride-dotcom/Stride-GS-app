import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

interface ShipmentEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shipment: {
    id: string;
    carrier: string | null;
    tracking_number: string | null;
    po_number: string | null;
    expected_arrival_date: string | null;
    notes: string | null;
  };
  onSuccess: () => void;
}

export function ShipmentEditDialog({
  open,
  onOpenChange,
  shipment,
  onSuccess,
}: ShipmentEditDialogProps) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  
  const [carrier, setCarrier] = useState(shipment.carrier || '');
  const [trackingNumber, setTrackingNumber] = useState(shipment.tracking_number || '');
  const [poNumber, setPoNumber] = useState(shipment.po_number || '');
  const [expectedArrivalDate, setExpectedArrivalDate] = useState(
    shipment.expected_arrival_date?.split('T')[0] || ''
  );
  const [notes, setNotes] = useState(shipment.notes || '');

  // Reset form when shipment changes
  useEffect(() => {
    setCarrier(shipment.carrier || '');
    setTrackingNumber(shipment.tracking_number || '');
    setPoNumber(shipment.po_number || '');
    setExpectedArrivalDate(shipment.expected_arrival_date?.split('T')[0] || '');
    setNotes(shipment.notes || '');
  }, [shipment]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const { error } = await (supabase.from('shipments') as any)
        .update({
          carrier: carrier || null,
          tracking_number: trackingNumber || null,
          po_number: poNumber || null,
          expected_arrival_date: expectedArrivalDate || null,
          notes: notes || null,
        })
        .eq('id', shipment.id);

      if (error) throw error;

      const trimmedNotes = notes.trim();
      const previousNotes = (shipment.notes || '').trim();
      if (trimmedNotes && trimmedNotes !== previousNotes) {
        const { error: noteError } = await (supabase as any).rpc('create_unified_note', {
          p_entity_type: 'shipment',
          p_entity_id: shipment.id,
          p_note_text: trimmedNotes,
          p_note_type: 'internal',
          p_metadata: {
            source: 'shipment_edit_dialog',
            legacy_field: 'shipments.notes',
          },
        });
        if (noteError) {
          console.warn('[ShipmentEditDialog] Failed to mirror shipment note into unified notes:', noteError.message);
        }
      }

      toast({
        title: 'Shipment updated',
        description: 'Shipment details have been saved.',
      });

      onSuccess();
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error updating shipment:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to update shipment.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Shipment Details</DialogTitle>
          <DialogDescription>
            Update the shipment information below.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="carrier">Carrier</Label>
            <Input
              id="carrier"
              value={carrier}
              onChange={(e) => setCarrier(e.target.value)}
              placeholder="e.g., UPS, FedEx, Freight"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tracking">Tracking Number</Label>
            <Input
              id="tracking"
              value={trackingNumber}
              onChange={(e) => setTrackingNumber(e.target.value)}
              placeholder="Enter tracking number"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="po">PO Number</Label>
            <Input
              id="po"
              value={poNumber}
              onChange={(e) => setPoNumber(e.target.value)}
              placeholder="Purchase order number"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="arrival">Expected Arrival Date</Label>
            <Input
              id="arrival"
              type="date"
              value={expectedArrivalDate}
              onChange={(e) => setExpectedArrivalDate(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional notes..."
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
